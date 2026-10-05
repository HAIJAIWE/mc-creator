/**
 * §5.8 账户：微软 OAuth 2.0 —— **Authorization Code + PKCE（S256）**。
 *
 * ## 为什么选 Authorization Code + PKCE 而不是 Device Code Flow
 *
 * 设计文档 §5.8 写的是「Authorization Code + PKCE / Device Code Flow」，
 * 二者是**或**的关系。本实现选前者，理由按任务书要求的四个维度列：
 *
 * 1. **官方推荐**：Microsoft identity platform 对 *桌面/移动 public client*
 *    的推荐流程就是 Authorization Code + PKCE（MSAL 的默认流程）。
 *    Device Code 在微软文档里明确是给 **input-constrained device**
 *    （电视、IoT、只有命令行的机器）用的 —— 一个有鼠标键盘、且系统里就有
 *    浏览器的 Electron 桌面应用不满足「无法安全输入凭据」这个前提。
 *
 * 2. **端口占用 / 防火墙**：loopback 监听不构成问题，前提是三件事都做对：
 *    - 绑定 `127.0.0.1` 而**不是** `0.0.0.0`。Windows 防火墙只对
 *      非 loopback 的入站监听弹窗；绑 0.0.0.0 才会弹「允许 Node 联网吗」，
 *      而那恰恰是本应用**不需要**的暴露面。
 *    - 监听 `port = 0` 让 OS 分配临时端口，因此**永远不与既有服务抢端口**。
 *    - 对外声明的 `redirect_uri` 用 `http://localhost:<port>/callback`
 *      （Azure 的 public client 只登记 `http://localhost`，**任意端口**都匹配，
 *      这是 RFC 8252 §7.3 对 native app 的规定行为）。
 *      监听地址用 127.0.0.1、声明地址用 localhost 是刻意的：避免 IPv6 的
 *      `::1` 解析差异导致浏览器连不上。
 *
 * 3. **企业环境**：loopback 失败只发生在「本机禁用所有 TCP 监听」的极端
 *    受管终端上，此时报一条明确错误让用户改用系统浏览器里的官方登录即可。
 *    反过来，Device Code 在企业环境有**更难察觉**的风险：Azure 的
 *    conditional access / device compliance 策略对 device code 流的处理
 *    与 auth code 并不一致（微软自己就提示 device code 流存在 phishing 面），
 *    而且用户要把 9 位代码敲到**另一个**窗口里，企业 SSO/MFA 的
 *    「设备合规」弹窗往往在那个窗口上再次打断用户。
 *
 * 4. **与既有交互一致**：本仓已有 fail-closed 的原生 dialog 确认模式
 *    （`kernel-confirm.ts`）。PKCE 的用户旅程是「点一下 → 系统浏览器 → 自动回来」，
 *    一次交互、一个对话框；Device Code 需要额外展示「去打开这个网址、
 *    输入这串代码」并轮询等待，与现有的单对话框交互模型不搭，
 *    且轮询失败路径（`authorization_pending` / `slow_down` / `expired_token`）
 *    远多于 PKCE。
 *
 * ## PKCE 参数为什么必须这样取
 *
 * - `code_verifier`：`randomBytes(32)` 的 base64url。RFC 7636 §4.1 要求
 *   长度 43–128 且字符集为 `[A-Za-z0-9-._~]`；32 字节 → 43 字符 base64url，
 *   字符全部落在该集合内（base64url 用 `-`/`_`，都在 unreserved 里）。
 *   **必须用 CSPRNG**（`node:crypto.randomBytes`）而不是 `Math.random()`：
 *   verifier 是防止「授权码被截获后被换 token」的唯一凭据，可预测就等于没有。
 *
 * - `code_challenge`：**S256**，即 `base64url(sha256(verifier))`。
 *   为什么不能是 `plain`：PKCE 防的是「攻击者截获授权码后**自己也**去换 token」。
 *   `plain` 下 challenge 与 verifier 相同，攻击者只要能改动
 *   授权请求（恶意 App 里的中间人、或用户被诱导访问了攻击者的授权 URL），
 *   就能把自己的 verifier 一起塞进去，服务器看到「challenge 与 verifier 匹配」
 *   就会放行 —— PKCE 直接失效。RFC 7636 §4.2 明确要求
 *   「服务器只要支持 S256 就必须拒绝 plain」，RFC 8252 §8.1 对 native app
 *   更是直接要求 S256。Azure v2.0 对 public client 同样只接受 S256。
 *
 * - `state`：同样 `randomBytes(32)` base64url，用于防 CSRF（把用户诱导到
 *   带着攻击者授权码的回调）。比较必须**定长比较**（`timingSafeEqual`），
 *   否则会泄漏前缀信息。
 *
 * - `code_verifier` **一次性**：换 token 成功/失败后立即从 pending 表里删除。
 *   RFC 7636 §4.6 + 微软 token 端点的授权码本身就是一次性的（第二次换会拿到
 *   `invalid_grant` / `AADSTS70008`），本地也再挡一层，双保险。
 *
 * ## client_id 的来源
 *
 * `client_id` **不是** secret（它会明文出现在授权 URL 里，任何人可见），
 * 但它**是**「这个应用是谁」的标识，因此**不在源码里硬编**：
 * 由 `MsOAuthConfig.clientId` 注入，默认从环境变量
 * `MC_CREATOR_MS_CLIENT_ID` 读。缺失时 `assertConfigured()` 抛一条
 * 指明「去哪申请、填什么」的明确错误，而不是带着空 client_id 去撞微软的 400。
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SecretScrubber } from './token-redact.js';

/** Microsoft identity platform v2.0 端点（Minecraft 只面向个人微软账户 → consumers 租户）。 */
export const MS_AUTHORIZE_ENDPOINT =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';
export const MS_TOKEN_ENDPOINT = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

/** 换 Minecraft access token 所需的 scope：XboxLive 登录 + 可续期的 refresh token。 */
export const MS_SCOPE = 'XboxLive.signin offline_access';

/** 唯一的 code_challenge 算法。plain 会被 Azure 直接拒绝，且安全上无意义（见文件头）。 */
export const PKCE_CHALLENGE_METHOD = 'S256';

/** 环境变量名：Azure 应用（public client / "Mobile and desktop applications"）的 Application (client) ID。 */
export const CLIENT_ID_ENV = 'MC_CREATOR_MS_CLIENT_ID';

/** loopback 回调路径。 */
export const CALLBACK_PATH = '/callback';

/** OAuth 2.0 错误码里我们会给明确文案的几个（其余一律映射为通用失败）。 */
export const OAUTH_ERRORS = {
  invalidGrant: 'invalid_grant',
  authorizationPending: 'authorization_pending',
  slowDown: 'slow_down',
  expiredToken: 'expired_token',
  accessDenied: 'access_denied',
} as const;

/** 本模块的错误码（跨层传递，不依赖 message 文本匹配）。 */
export type MsAuthErrorCode =
  | 'not_configured'
  | 'state_mismatch'
  | 'auth_request_used'
  | 'auth_request_unknown'
  | 'timeout'
  | 'callback_error'
  | 'invalid_callback_url'
  | 'missing_code'
  | 'token_exchange_failed'
  | 'token_refresh_failed'
  | 'network'
  | 'invalid_response';

export class MsAuthError extends Error {
  constructor(
    readonly code: MsAuthErrorCode,
    message: string,
    /** 上游 OAuth `error` / `error_description`（已由调用方过 redact）。 */
    readonly upstreamError?: string,
  ) {
    super(message);
    this.name = 'MsAuthError';
  }
}

/** 一次待完成的授权请求（pending）。verifier 只能被消费一次。 */
export interface PendingAuthRequest {
  readonly state: string;
  readonly codeVerifier: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly createdAt: number;
}

export interface MsOAuthConfig {
  /** Azure 应用的 client id（非 secret，但必须配置，不进源码）。 */
  readonly clientId: string;
  readonly scope?: string;
  readonly authorizeEndpoint?: string;
  readonly tokenEndpoint?: string;
}

export interface AuthorizeUrlParams {
  readonly redirectUri: string;
  readonly state: string;
  readonly codeChallenge: string;
}

export interface TokenSet {
  readonly accessToken: string;
  /** 微软可能不返回 refresh_token（此时视为无法续期）。 */
  readonly refreshToken: string | null;
  /** 绝对过期时间（epoch ms）。 */
  readonly expiresAt: number;
  readonly scope: string;
}

/** 随机源可注入：测试要能断言「用的是 CSPRNG」而不是碰运气。 */
export type RandomBytes = (size: number) => Buffer;

/** RFC 7636 §4.1：verifier 43–128 字符，unreserved 字符集。32 字节 → 43 字符。 */
export function generateCodeVerifier(randomBytesImpl: RandomBytes = randomBytes): string {
  return randomBytesImpl(32).toString('base64url');
}

/** RFC 7636 §4.2 / §4.3：S256 = base64url(sha256(ascii(verifier)))，无 padding。 */
export function computeCodeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** state 同样必须 CSPRNG：它是 CSRF 防护的唯一凭据。 */
export function generateState(randomBytesImpl: RandomBytes = randomBytes): string {
  return randomBytesImpl(32).toString('base64url');
}

/** 定长比较。长度不等必须先短路（timingSafeEqual 对长度不等会抛）。 */
export function stateEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf-8');
  const bb = Buffer.from(b, 'utf-8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * 构造一次待完成的授权请求（pending）。
 *
 * 一次性生成三样东西并保持派生关系：
 * - `codeVerifier`（CSPRNG，永不外传）
 * - `codeChallenge` = S256(verifier)（发往授权端点）
 * - `state`（CSPRNG，用于 CSRF 校验；不传则内部生成）
 */
export function createPendingAuthRequest(params: {
  readonly redirectUri: string;
  readonly state?: string;
  readonly randomBytesImpl?: RandomBytes;
}): PendingAuthRequest {
  const random = params.randomBytesImpl ?? randomBytes;
  const codeVerifier = generateCodeVerifier(random);
  return {
    state: params.state ?? generateState(random),
    codeVerifier,
    codeChallenge: computeCodeChallengeS256(codeVerifier),
    redirectUri: params.redirectUri,
    createdAt: Date.now(),
  };
}

export function buildAuthorizeUrl(config: MsOAuthConfig, params: AuthorizeUrlParams): string {
  assertConfigured(config);
  const url = new URL(config.authorizeEndpoint ?? MS_AUTHORIZE_ENDPOINT);
  url.searchParams.set('client_id', config.clientId.trim());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('scope', config.scope ?? MS_SCOPE);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  // 只能是 S256：plain 不提供任何保护（攻击者能同时改 challenge 与 verifier）。
  url.searchParams.set('code_challenge_method', PKCE_CHALLENGE_METHOD);
  // 尽量不让用户被问「是否同意访问基本信息」；仍可能出现（首次登录/策略变更）。
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/**
 * client_id 未配置时抛**可操作**的错误。
 *
 * 单独抽成函数是为了让调用方能在**做任何事之前**检查
 * （起 loopback、打开浏览器都要花代价，不该在明知配错的情况下先做）。
 */
export function assertConfigured(config: MsOAuthConfig): void {
  if (config.clientId.trim() === '') {
    throw new MsAuthError(
      'not_configured',
      `未配置微软应用 client id：请在 Azure Portal 注册「移动和桌面应用程序」public client，` +
        `把「应用程序(客户端) ID」填到环境变量 ${CLIENT_ID_ENV} 或启动器账户配置中。`,
    );
  }
}

/** 校验 loopback 回调的形态：必须是 http + loopback 主机 + 我们的路径。 */
export function assertLoopbackRedirectUri(redirectUri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new MsAuthError('invalid_callback_url', `回调地址不是合法 URL: ${redirectUri}`);
  }
  if (parsed.protocol !== 'http:') {
    throw new MsAuthError(
      'invalid_callback_url',
      `回调地址必须是 http loopback（实测到 ${parsed.protocol}）`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '[::1]') {
    throw new MsAuthError(
      'invalid_callback_url',
      `回调地址必须指向 loopback 主机（实测到 ${host}），不允许把授权码发到外部地址`,
    );
  }
  if (parsed.pathname !== CALLBACK_PATH) {
    throw new MsAuthError(
      'invalid_callback_url',
      `回调路径必须是 ${CALLBACK_PATH}（实测到 ${parsed.pathname}），与 Azure 登记的 redirect URI 不一致`,
    );
  }
}

/** token 端点的响应体（只取我们要的字段，其余忽略）。 */
interface RawTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
  correlation_id?: unknown;
}

function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

/**
 * 把 token 端点的失败响应翻译成 MsAuthError。
 *
 * `summary` 必须是**已经过 scrubber** 的文本（由调用方传进来），
 * 否则 `error_description` 里夹带的凭据会直接进 message。
 */
function tokenFailure(
  status: number,
  body: RawTokenResponse,
  summary: string,
  scrubber: SecretScrubber,
): MsAuthError {
  const upstream = asNonEmptyString(body.error);
  const suffix = summary === '' ? '' : `：${summary}`;
  if (upstream === OAUTH_ERRORS.invalidGrant) {
    // 最常见：refresh token 过期 / 被撤销 / 已被轮换掉。
    return new MsAuthError(
      'token_refresh_failed',
      scrubber.scrub(`微软拒绝了凭据（invalid_grant）：需重新登录${suffix}`),
      upstream,
    );
  }
  return new MsAuthError(
    'token_exchange_failed',
    scrubber.scrub(`微软 token 端点返回 HTTP ${status}${suffix}`),
    upstream ?? `http_${status}`,
  );
}

function parseTokenSet(status: number, rawText: string, scrubber: SecretScrubber): TokenSet {
  let body: RawTokenResponse;
  try {
    body = JSON.parse(rawText) as RawTokenResponse;
  } catch {
    throw new MsAuthError(
      'invalid_response',
      `微软 token 端点返回了非 JSON 响应（HTTP ${status}）`,
    );
  }
  const accessToken = asNonEmptyString(body.access_token);
  if (accessToken === null) throw tokenFailure(status, body, summarizeError(body), scrubber);
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return {
    accessToken,
    // 微软会在轮换时下发新 refresh token；没有则保留不了续期能力。
    refreshToken: asNonEmptyString(body.refresh_token),
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    scope: asNonEmptyString(body.scope) ?? '',
  };
}

/**
 * 从错误体里只取 `error` / `error_description` 拼成短摘要。
 *
 * 摘要**不做**过滤（过滤由调用方的 scrubber 统一做），但**绝不**带上
 * 请求体回显之外的东西：只认这两个字段，原始响应体不会整段进 message。
 */
function summarizeError(body: RawTokenResponse): string {
  const parts = [asNonEmptyString(body.error), asNonEmptyString(body.error_description)].filter(
    (s): s is string => s !== null,
  );
  return parts.join(' / ');
}

/** 表单编码。 */
function formBody(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export interface TokenClientDeps {
  readonly fetchImpl: typeof fetch;
  readonly now?: () => number;
  /**
   * 过滤器：用于清洗**上游返回的**错误文案。
   *
   * 为什么必要：token 端点的 `error_description` 偶尔会把请求内容回显
   * （例如 `refresh token <值> has expired`）。那个值此刻还没被
   * 「本进程见过的秘密」登记，所以不能只靠字面量替换 ——
   * 必须在**构造 message 的那一刻**就过一遍模式过滤。
   */
  readonly scrubber?: SecretScrubber;
}

/** 面向 token 端点的薄客户端。fetch 注入 → 测试永不写真实 HTTP。 */
export class MsTokenClient {
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  private readonly scrubber: SecretScrubber;

  constructor(
    private readonly config: MsOAuthConfig,
    deps: TokenClientDeps,
  ) {
    this.fetchImpl = deps.fetchImpl;
    this.endpoint = config.tokenEndpoint ?? MS_TOKEN_ENDPOINT;
    this.scrubber = deps.scrubber ?? new SecretScrubber();
  }

  private async post(fields: Record<string, string>): Promise<TokenSet> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: formBody(fields),
      });
    } catch (e) {
      throw new MsAuthError(
        'network',
        `访问微软 token 端点失败（网络错误）：${this.scrubber.scrub((e as Error).name)}`,
      );
    }
    // 读一次文本：既要 JSON 解析也要在非 JSON 时给出可读摘要。
    const text = await res.text();
    if (!res.ok) {
      let body: RawTokenResponse = {};
      try {
        body = JSON.parse(text) as RawTokenResponse;
      } catch {
        /* 非 JSON 错误体：走下面的通用分支 */
      }
      throw tokenFailure(res.status, body, summarizeError(body), this.scrubber);
    }
    return parseTokenSet(res.status, text, this.scrubber);
  }

  /** 用授权码换 token。`codeVerifier` 由调用方保证一次性。 */
  async exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<TokenSet> {
    return this.post({
      client_id: this.config.clientId,
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: params.redirectUri,
      code_verifier: params.codeVerifier,
      scope: this.config.scope ?? MS_SCOPE,
    });
  }

  /**
   * 刷新。
   *
   * 返回的 `refreshToken` 可能与传入的不同（微软的 refresh token 轮换），
   * 调用方**必须**用返回值覆盖持久化的旧值，否则旧的下一次就用不了了。
   */
  async refresh(refreshToken: string): Promise<TokenSet> {
    return this.post({
      client_id: this.config.clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: this.config.scope ?? MS_SCOPE,
    });
  }
}
