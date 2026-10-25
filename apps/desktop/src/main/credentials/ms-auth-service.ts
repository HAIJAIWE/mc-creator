/**
 * §5.8 账户：微软登录的**编排层** —— 把 PKCE / XBL / XSTS / Minecraft / 账户存储
 * 串成一条可调用、可测试的链路。
 *
 * ## 职责边界
 *
 * | 模块 | 职责 |
 * | --- | --- |
 * | `ms-oauth.ts` | PKCE 原语、授权 URL、token 端点（无状态） |
 * | `mc-account-service.ts` | XBL → XSTS → Minecraft → profile/cape（无状态） |
 * | `mc-account-store.ts` | 多账户持久化（safeStorage 加密） |
 * | `auth-loopback.ts` | loopback 回调监听（有状态、有 IO） |
 * | **本文件** | 编排 + 过期前刷新 + 错误文案（**所有秘密在此登记到 scrubber**） |
 *
 * ## 编排层必须保证的三件事
 *
 * 1. **code_verifier 一次性**：pending 表在「取出」时**同步删除**。
 *    即便攻击者拿到授权码并重放回调，第二次进来只能拿到
 *    `auth_request_used`；而微软端点本身也会对同一 code 返回
 *    `invalid_grant`。两层防护互不依赖。
 *
 * 2. **state 校验用定长比较**：见 `ms-oauth.ts` 的 `stateEquals`。
 *
 * 3. **所有错误/日志过 scrubber**：本模块是**唯一**同时接触全部 6 类 token
 *    的地方，因此它是登记秘密（`scrubber.track`）与清洗输出的**唯一关口**。
 *
 * ## 刷新策略：过期前刷新，且不早于必要时刻
 *
 * 启动游戏前调 `ensureFreshAccessToken()`：
 * - token 距过期 > `TOKEN_REFRESH_SKEW_MS`（5min）→ 直接用，不发任何请求
 *   （避免每次开游戏都打一次微软）；
 * - 否则用 **OAuth refresh token** 重跑整条链（XBL→XSTS→Minecraft）。
 *   这条链**没有**「只用 refresh token 换 MC token」的短路径，
 *   所以刷新成本 = 3 次 POST。这是官方链路的固有形状，不是本实现偷懒。
 * - 刷新失败（`invalid_grant` = 过期/撤销）→ 抛错要求重新登录，
 *   **不**静默退化成随机 UUID 离线启动（静默退化会让用户以为在用正版，
 *   实际进了离线模式 —— 这正是 §1.2 要避免的形态）。
 *
 * ## 无 profile 的账号
 *
 * profile 返回 `null` 时：账户**不入库**（因为没有 UUID 可作主键，
 * 入库会产生一条无法启动的幽灵账户），登录结果里 `profile: null` +
 * 一条可执行提示（"请先在官方启动器进一次游戏"）。**不崩溃**。
 */

import { randomBytes } from 'node:crypto';
import { SecretScrubber } from './token-redact.js';
import {
  CLIENT_ID_ENV,
  MsAuthError,
  MsTokenClient,
  assertConfigured,
  assertLoopbackRedirectUri,
  buildAuthorizeUrl,
  createPendingAuthRequest,
  stateEquals,
  type MsAuthErrorCode,
  type MsOAuthConfig,
  type PendingAuthRequest,
  type RandomBytes,
  type TokenSet,
} from './ms-oauth.js';
import {
  McAccountError,
  authenticateXboxLive,
  authorizeXsts,
  fetchEntitlements,
  fetchMinecraftProfile,
  loginMinecraft,
  type McCape,
  type McProfile,
} from './mc-account-service.js';
import { AccountStore, type AccountSummary, type StoredAccount } from './mc-account-store.js';
import { startLoopbackAuthServer, type LoopbackAuthServer } from './auth-loopback.js';

/** 启动游戏需要的身份三元组（对应 `--username` / `--uuid` / `--accessToken`）。 */
export interface LaunchIdentity {
  readonly username: string;
  /** 带连字符的 UUID —— 正版模式下**不是**随机值。 */
  readonly uuid: string;
  readonly accessToken: string;
  /** Minecraft 服务端只认 `msa`（或 `mojang`）；离线才用 `legacy`。 */
  readonly userType: 'msa';
}

/** loopback 服务器工厂：测试注入替身，生产用真实监听。 */
export type LoopbackFactory = () => Promise<LoopbackAuthServer>;

export interface AuthResult {
  /** 入库的账户（token 已解密，仅内存里）。 */
  readonly account: StoredAccount;
  /** 跳转用的授权 URL（供 UI 展示/手动打开）。 */
  readonly authorizationUrl: string;
  /** Minecraft 档案；`null` = 该账号没有 Java 版档案。 */
  readonly profile: McProfile | null;
  /** 无档案时的可执行提示（正常账号为 null）。 */
  readonly warning: string | null;
}

export interface MicrosoftAuthServiceDeps {
  readonly config: MsOAuthConfig;
  readonly store: AccountStore;
  readonly fetchImpl: typeof fetch;
  readonly scrubber?: SecretScrubber;
  readonly now?: () => number;
  readonly openUrl?: (url: string) => Promise<void> | void;
  readonly loopbackFactory?: LoopbackFactory;
  /** 注入随机源（测试断言「用的是 CSPRNG」）。 */
  readonly randomBytes?: RandomBytes;
  readonly loginTimeoutMs?: number;
}

const DEFAULT_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

export class MicrosoftAuthService {
  private readonly config: MsOAuthConfig;
  private readonly store: AccountStore;
  private readonly fetchImpl: typeof fetch;
  readonly scrubber: SecretScrubber;
  private readonly now: () => number;
  private readonly openUrl: (url: string) => Promise<void> | void;
  private readonly loopbackFactory: LoopbackFactory;
  private readonly randomBytes: RandomBytes;
  private readonly loginTimeoutMs: number;
  private readonly tokenClient: MsTokenClient;

  /**
   * pending 授权请求：`state` → { codeVerifier, codeChallenge, redirectUri }。
   *
   * **取出即删除**（`consumePending`）→ code_verifier 一次性（见文件头约束 1）。
   */
  private readonly pending = new Map<string, PendingAuthRequest>();

  constructor(deps: MicrosoftAuthServiceDeps) {
    this.config = deps.config;
    this.store = deps.store;
    this.fetchImpl = deps.fetchImpl;
    this.scrubber = deps.scrubber ?? new SecretScrubber();
    this.now = deps.now ?? Date.now;
    this.openUrl = deps.openUrl ?? (() => undefined);
    this.loopbackFactory = deps.loopbackFactory ?? (() => startLoopbackAuthServer());
    this.randomBytes = deps.randomBytes ?? randomBytes;
    this.loginTimeoutMs = deps.loginTimeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    this.tokenClient = new MsTokenClient(this.config, {
      fetchImpl: deps.fetchImpl,
      now: this.now,
      // 同一个 scrubber：token 端点错误文案里的回显也在这里被洗掉。
      scrubber: this.scrubber,
    });
  }

  /** 登记秘密。此后任何经本服务抛出的错误都不会带它们。 */
  private trackSecrets(...values: (string | null | undefined)[]): void {
    this.scrubber.track(...values);
  }

  private safeError(code: MsAuthErrorCode, e: unknown): MsAuthError {
    return new MsAuthError(code, this.scrubber.scrubError(e));
  }

  /**
   * 取出并**销毁** pending 请求。找不到 → `auth_request_used`。
   *
   * 错误码区分「state 不匹配」（可能 CSRF）与「已用过」（可能重放）：
   * 两者都拒绝，但诊断信息不同，排障时能区分方向。
   */
  private consumePending(state: string): PendingAuthRequest {
    const known = this.pending.get(state);
    if (known === undefined) {
      throw new MsAuthError(
        'auth_request_used',
        '授权请求不存在或已被使用（可能已被重放，或用户发起了新的登录）。请重新发起登录。',
      );
    }
    this.pending.delete(state);
    return known;
  }

  /**
   * 走完一次微软登录。
   *
   * 起 loopback → 生成 PKCE/state → 打开浏览器 → 等回调 → 校验 state →
   * 换 token → XBL→XSTS→Minecraft → 购买状态 → profile → 入库。
   */
  async login(): Promise<AuthResult> {
    // 配置检查**必须**在起 loopback 之前：明知 client_id 没配还先占一个端口，
    // 再报错，既留垃圾端口又给出错误的失败原因。
    assertConfigured(this.config);
    const server = await this.loopbackFactory();
    try {
      const redirectUri = server.redirectUri;
      // 回调地址必须是 loopback：把授权码发到外部地址等于把它送人。
      assertLoopbackRedirectUri(redirectUri);

      const pending = createPendingAuthRequest({
        redirectUri,
        randomBytesImpl: this.randomBytes,
      });
      this.trackSecrets(pending.codeVerifier, pending.state);
      this.pending.set(pending.state, pending);

      const authorizationUrl = buildAuthorizeUrl(this.config, {
        redirectUri,
        state: pending.state,
        codeChallenge: pending.codeChallenge,
      });
      await this.openUrl(authorizationUrl);

      const callback = await server.waitForCallback(this.loginTimeoutMs);

      // ⚠️ state 校验：定长比较。失败 = 可能是 CSRF，拒绝。
      if (callback.state === null || !stateEquals(callback.state, pending.state)) {
        this.pending.delete(pending.state);
        throw new MsAuthError(
          'state_mismatch',
          '回调 state 校验失败（可能是 CSRF 尝试，或用户发起了新的登录），已拒绝。',
        );
      }
      // 一次性消费：拿 verifier 的同时把它从 pending 里删掉。
      const request = this.consumePending(pending.state);

      if (callback.error !== null) {
        throw new MsAuthError(
          'callback_error',
          `微软返回授权错误：${callback.error}` +
            `${callback.errorDescription === null ? '' : `（${callback.errorDescription}）`}`,
          callback.error,
        );
      }
      if (callback.code === null || callback.code === '') {
        throw new MsAuthError('missing_code', '回调中缺少授权码。');
      }

      const tokenSet = await this.tokenClient.exchangeCode({
        code: callback.code,
        codeVerifier: request.codeVerifier,
        redirectUri: request.redirectUri,
      });
      this.trackSecrets(tokenSet.accessToken, tokenSet.refreshToken);

      const chain = await this.runMicrosoftChain(tokenSet.accessToken);
      if (chain.profile === null) {
        // 无档案 → 不入库（没有 UUID 可作主键），但**给明确提示**、不崩。
        return {
          account: {
            id: '',
            username: '',
            uuid: '',
            msRefreshToken: tokenSet.refreshToken ?? '',
            mcAccessToken: chain.mcAccessToken,
            mcAccessTokenExpiresAt: chain.mcExpiresAt,
            capes: [],
            hasMinecraftProfile: false,
            addedAt: this.now(),
            lastUsedAt: this.now(),
          },
          authorizationUrl,
          profile: null,
          warning: chain.warning,
        };
      }
      const account = await this.store.upsert({
        username: chain.profile.name,
        uuid: chain.profile.id,
        msRefreshToken: tokenSet.refreshToken ?? '',
        mcAccessToken: chain.mcAccessToken,
        mcAccessTokenExpiresAt: chain.mcExpiresAt,
        capes: chain.profile.capes,
        hasMinecraftProfile: true,
      });
      return { account, authorizationUrl, profile: chain.profile, warning: chain.warning };
    } catch (e) {
      // 任何失败都必须洗过再抛（§13.2），但**不能**把不同性质的错误压成同一个码
      // （把「存盘失败」标成 `token_exchange_failed` 会让排障跑偏）。
      if (e instanceof MsAuthError) {
        throw new MsAuthError(e.code, this.scrubber.scrub(e.message), e.upstreamError);
      }
      if (e instanceof McAccountError) {
        throw new McAccountError(e.code, this.scrubber.scrub(e.message));
      }
      if (e instanceof Error) {
        // 存储层 / IO 层的错误：保留原始 message（已洗过），类型归一为 Error。
        throw new Error(this.scrubber.scrub(`${e.name}: ${e.message}`));
      }
      throw this.safeError('token_exchange_failed', e);
    } finally {
      await server.close();
    }
  }

  /**
   * MS access token → XBL → XSTS → Minecraft token → 购买状态 → profile。
   *
   * 购买状态拿不到**不阻断**（Game Pass 条目名不固定，靠它判断本来就不稳）；
   * profile 返回 `null` = 无档案（不阻断，由调用方提示）。
   */
  private async runMicrosoftChain(msAccessToken: string): Promise<{
    mcAccessToken: string;
    mcExpiresAt: number;
    profile: McProfile | null;
    warning: string | null;
  }> {
    const xbl = await authenticateXboxLive(this.fetchImpl, msAccessToken, this.scrubber);
    this.trackSecrets(xbl.token);
    const xsts = await authorizeXsts(this.fetchImpl, xbl.token, xbl.uhs, this.scrubber);
    this.trackSecrets(xsts.token);
    const mc = await loginMinecraft(this.fetchImpl, xsts.token, xsts.uhs, this.scrubber);
    this.trackSecrets(mc.accessToken);

    const entitlements = await fetchEntitlements(
      this.fetchImpl,
      mc.accessToken,
      this.scrubber,
    ).catch(() => null);

    const profile = await fetchMinecraftProfile(this.fetchImpl, mc.accessToken, this.scrubber);

    let warning: string | null = null;
    if (profile === null) {
      warning =
        '该微软账户没有 Minecraft Java 版档案（刚购买或仅有 Game Pass 时会这样）。' +
        '请先在官方 Minecraft 启动器里用同一账户进一次游戏创建档案，然后再回到本应用。';
    } else if (entitlements !== null && !entitlements.ownsMinecraft) {
      warning = '未检测到 Java 版购买记录（Game Pass 同样可进游戏）。若启动失败请先购买或激活。';
    }
    return { mcAccessToken: mc.accessToken, mcExpiresAt: mc.expiresAt, profile, warning };
  }

  /**
   * 拿一个「现在就能用于启动」的 Minecraft access token，必要时先刷新。
   *
   * @param accountId 不传则用当前账户。
   */
  async ensureFreshAccessToken(accountId?: string): Promise<StoredAccount> {
    const account = await this.resolveAccount(accountId);
    if (account.hasMinecraftProfile && this.store.isTokenFresh(account)) return account;
    if (!account.hasMinecraftProfile) {
      throw new MsAuthError(
        'token_refresh_failed',
        `账户「${account.username || account.id}」没有 Minecraft Java 版档案，无法启动正版游戏。` +
          '请先在官方启动器里进一次游戏创建档案。',
      );
    }
    if (account.msRefreshToken === '') {
      throw new MsAuthError(
        'token_refresh_failed',
        `账户「${account.username}」缺少 OAuth refresh token，需重新登录微软账户。`,
      );
    }
    let refreshed: TokenSet;
    try {
      refreshed = await this.tokenClient.refresh(account.msRefreshToken);
    } catch (e) {
      // 失效的 refresh token 不删账户（用户可能在另一台机器上登录过），
      // 但明确要求重新登录，绝不静默退化成离线随机 UUID。
      const msg = e instanceof Error ? e.message : String(e);
      throw new MsAuthError(
        'token_refresh_failed',
        `刷新微软凭据失败，需重新登录：${this.scrubber.scrub(msg)}`,
        e instanceof MsAuthError ? e.upstreamError : undefined,
      );
    }
    this.trackSecrets(refreshed.accessToken, refreshed.refreshToken);
    // 微软的 refresh token 会轮换 → 用返回值覆盖（为 null 表示这次没发新的）。
    const msRefreshToken = refreshed.refreshToken ?? account.msRefreshToken;
    const chain = await this.runMicrosoftChain(refreshed.accessToken);
    return this.store.updateTokens(account.id, {
      msRefreshToken,
      mcAccessToken: chain.mcAccessToken,
      mcAccessTokenExpiresAt: chain.mcExpiresAt,
      capes: chain.profile?.capes,
      hasMinecraftProfile: chain.profile !== null,
    });
  }

  /** 拿启动身份（会自动刷新）。UUID 来自 profile，**不是**随机值。 */
  async getLaunchIdentity(accountId?: string): Promise<LaunchIdentity> {
    const account = await this.ensureFreshAccessToken(accountId);
    if (!account.hasMinecraftProfile || account.username === '') {
      throw new MsAuthError(
        'token_refresh_failed',
        `账户「${account.username || account.id}」没有 Minecraft 档案，无法生成启动身份。`,
      );
    }
    return {
      username: account.username,
      uuid: account.uuid,
      accessToken: account.mcAccessToken,
      userType: 'msa',
    };
  }

  /** 当前账号的披风（仅正版，来自 profile.capes 中 ACTIVE 的那件）。 */
  async activeCape(accountId?: string): Promise<McCape | null> {
    const account = await this.resolveAccount(accountId);
    return account.capes.find((c) => c.active) ?? null;
  }

  /** 列出账户摘要（无 token）。 */
  listAccounts(): Promise<AccountSummary[]> {
    return this.store.summaries();
  }

  /** 切换当前账户。 */
  switchAccount(id: string): Promise<StoredAccount> {
    return this.store.switchTo(id);
  }

  /** 移除账户。 */
  removeAccount(id: string): Promise<void> {
    return this.store.remove(id);
  }

  private async resolveAccount(accountId?: string): Promise<StoredAccount> {
    if (accountId !== undefined) {
      const all = await this.store.list();
      const hit = all.find((a) => a.id === accountId.replace(/-/g, '').toLowerCase());
      if (hit === undefined)
        throw new MsAuthError('auth_request_unknown', `账户不存在：${accountId}`);
      return hit;
    }
    const current = await this.store.current();
    if (current === null) throw new MsAuthError('not_configured', '尚未登录任何微软账户。');
    return current;
  }

  /** 未完成登录的 pending 数量（测试/诊断用；不清空）。 */
  get pendingCount(): number {
    return this.pending.size;
  }
}

export { CLIENT_ID_ENV };
