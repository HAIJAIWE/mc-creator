import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

let tmpDir: string;
let encryptionAvailable = true;

const enc = (s: string) => Buffer.from(`ENC(${s})`, 'utf-8');
const dec = (b: Buffer) => {
  const s = b.toString('utf-8');
  return s.startsWith('ENC(') && s.endsWith(')') ? s.slice(4, -1) : '';
};

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
  safeStorage: {
    isEncryptionAvailable: () => encryptionAvailable,
    encryptString: (s: string) => enc(s),
    decryptString: (b: Buffer) => dec(b),
  },
}));

import { CALLBACK_PATH, MsAuthError, type MsOAuthConfig } from './ms-oauth.js';
import {
  MC_ENTITLEMENTS_URL,
  MC_LOGIN_WITH_XBOX_URL,
  MC_PROFILE_URL,
  XBL_USER_AUTH_URL,
  XBL_XSTS_URL,
} from './mc-account-service.js';
import { AccountStore } from './mc-account-store.js';
import { MicrosoftAuthService, type LoopbackFactory } from './ms-auth-service.js';
import type { AuthCallback, LoopbackAuthServer } from './auth-loopback.js';
import { REDACTED } from './token-redact.js';

/**
 * §5.8 微软登录的端到端编排测试（网络层与 loopback 全部注入替身）。
 *
 * 覆盖任务书列的 9 项：
 * 完整流程 / state 校验失败 / code_verifier 一次性 / 刷新成功 / 刷新失败（过期·撤销·网络）/
 * 无 profile / 多账户并存+切换 / 日志与错误不含 token / 落盘是密文。
 */

const CLIENT_ID = 'client-id-for-tests-0001';
const CONFIG: MsOAuthConfig = { clientId: CLIENT_ID };

// ===== 可编程的假 fetch =====

interface RouteCtx {
  /** 第几次命中该路由。 */
  hits: number;
}

type RouteHandler = (ctx: RouteCtx) => {
  status?: number;
  /** `null` = 空响应体（204 这类状态不能带 body，否则 Response 构造器抛错）。 */
  body: unknown;
  headers?: Record<string, string>;
};

const TOKENS = {
  msAccess: 'MS-ACCESS-TOKEN-canary-0123456789abcdef',
  msRefresh: 'MS-REFRESH-TOKEN-canary-0123456789abcdef',
  xbl: 'XBL-TOKEN-canary-0123456789abcdef',
  xsts: 'XSTS-TOKEN-canary-0123456789abcdefgh',
  mc: 'MC-ACCESS-TOKEN-canary-0123456789abcdef',
};

interface WorldOptions {
  /** token 端点（换码/刷新）的响应。 */
  token?: RouteHandler;
  profile?: RouteHandler;
  entitlements?: RouteHandler;
  xbl?: RouteHandler;
  xsts?: RouteHandler;
  login?: RouteHandler;
}

function makeFetch(opts: WorldOptions = {}) {
  const calls: { url: string; body: string }[] = [];
  const counters = new Map<string, number>();
  const routes: Record<string, RouteHandler> = {
    'https://login.microsoftonline.com':
      opts.token ??
      (() => ({
        body: {
          access_token: TOKENS.msAccess,
          refresh_token: TOKENS.msRefresh,
          expires_in: 3600,
          scope: 'XboxLive.signin offline_access',
        },
      })),
    [XBL_USER_AUTH_URL]:
      opts.xbl ??
      (() => ({
        body: { Token: TOKENS.xbl, DisplayClaims: { xui: [{ uhs: 'UHS-1' }] } },
      })),
    [XBL_XSTS_URL]:
      opts.xsts ??
      (() => ({
        body: { Token: TOKENS.xsts, DisplayClaims: { xui: [{ uhs: 'UHS-1' }] } },
      })),
    [MC_LOGIN_WITH_XBOX_URL]:
      opts.login ??
      (() => ({
        body: { access_token: TOKENS.mc, expires_in: 86400 },
      })),
    [MC_ENTITLEMENTS_URL]:
      opts.entitlements ??
      (() => ({
        body: { items: [{ name: 'product_minecraft' }] },
      })),
    [MC_PROFILE_URL]:
      opts.profile ??
      (() => ({
        body: {
          id: '853c80ef-3c37-49fd-aa49-938b674adae6',
          name: 'jeb_',
          capes: [
            {
              id: 'cape-1',
              state: 'ACTIVE',
              url: 'https://textures.minecraft.net/texture/cape1',
              alias: 'Migrator',
            },
          ],
        },
      })),
  };
  const impl = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, body: String(init.body ?? '') });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (key === undefined) return new Response('', { status: 404 });
    const n = (counters.get(key) ?? 0) + 1;
    counters.set(key, n);
    const r = routes[key]!({ hits: n });
    return new Response(r.body === null ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

// ===== 可编程的假 loopback =====

interface FakeLoopback extends LoopbackAuthServer {
  /** 服务已关闭？ */
  closed: () => boolean;
  /** 已产出的授权 URL（openUrl 收到的）。 */
  urls: string[];
}

function makeLoopback(behavior: {
  /** 依据授权 URL 里的 state 生成回调；返回 null 表示这次不回调（模拟用户没反应）。 */
  callback: (url: string) => AuthCallback | null;
}): { factory: LoopbackFactory; state: FakeLoopback[] } {
  const created: FakeLoopback[] = [];
  const factory: LoopbackFactory = async () => {
    let resolveCb: ((cb: AuthCallback) => void) | null = null;
    // openUrl 在 waitForCallback **之前**被调用（服务先开浏览器再等回调），
    // 所以回调必须能先存着，等 waitForCallback 来了再兑现。
    let queued: AuthCallback | null = null;
    let closedFlag = false;
    const srv = {
      redirectUri: `http://localhost:54321${CALLBACK_PATH}`,
      waitForCallback(): Promise<AuthCallback> {
        if (queued !== null) {
          const cb = queued;
          queued = null;
          return Promise.resolve(cb);
        }
        return new Promise<AuthCallback>((resolve) => {
          resolveCb = resolve;
        });
      },
      async close() {
        closedFlag = true;
      },
      closed: () => closedFlag,
      urls: [] as string[],
      /** 供 openUrl 回调使用（模拟浏览器重定向）。 */
      __feed(url: string) {
        const cb = behavior.callback(url);
        if (cb === null) return;
        if (resolveCb !== null) {
          const r = resolveCb;
          resolveCb = null;
          r(cb);
        } else {
          queued = cb;
        }
      },
    } as unknown as FakeLoopback & { __feed: (u: string) => void };
    created.push(srv);
    return srv;
  };
  return { factory, state: created };
}

/** 成功回调：state 取自授权 URL（模拟浏览器原样回传）。 */
const okCallback =
  (code = 'AUTH-CODE-FROM-MICROSOFT') =>
  (url: string): AuthCallback => ({
    code,
    state: new URL(url).searchParams.get('state'),
    error: null,
    errorDescription: null,
  });

/** 篡改 state 的回调（模拟 CSRF）。 */
const badStateCallback =
  () =>
  (url: string): AuthCallback => ({
    code: 'AUTH-CODE-FROM-MICROSOFT',
    state: `tampered${new URL(url).searchParams.get('state') ?? ''}`,
    error: null,
    errorDescription: null,
  });

// ===== 组装 =====

interface Harness {
  service: MicrosoftAuthService;
  store: AccountStore;
  calls: { url: string; body: string }[];
  opened: string[];
  loopbacks: FakeLoopback[];
  accountsFile: string;
}

let now = 1_700_000_000_000;

function makeService(
  world: WorldOptions = {},
  loopbackBehavior: Parameters<typeof makeLoopback>[0] = { callback: okCallback() },
  extra: { randomBytes?: (n: number) => Buffer } = {},
): Harness {
  const { impl, calls } = makeFetch(world);
  const { factory, state: loopbacks } = makeLoopback(loopbackBehavior);
  const accountsFile = join(tmpDir, 'mc-accounts.json');
  const store = new AccountStore(accountsFile, () => now);
  const opened: string[] = [];
  const service = new MicrosoftAuthService({
    config: CONFIG,
    store,
    fetchImpl: impl,
    now: () => now,
    openUrl: (url) => {
      opened.push(url);
      // 模拟浏览器：openUrl 之后立刻回调
      for (const lb of loopbacks) {
        (lb as unknown as { __feed: (u: string) => void }).__feed(url);
      }
    },
    loopbackFactory: factory,
    // 短超时：替身不回调时立刻失败，而不是让测试挂到 5 分钟。
    loginTimeoutMs: 500,
    ...(extra.randomBytes === undefined ? {} : { randomBytes: extra.randomBytes }),
  });
  return { service, store, calls, opened, loopbacks, accountsFile };
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ms-auth-'));
  encryptionAvailable = true;
  now = 1_700_000_000_000;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ===== 1. 完整 PKCE 流程 =====

describe('完整流程：授权 → 回调 → 换 token → 取 profile', () => {
  it('走完 5 步并把账户入库', async () => {
    const h = makeService();
    const res = await h.service.login();

    // 授权 URL 带齐 PKCE 参数
    const authUrl = new URL(h.opened[0]!);
    expect(authUrl.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get('response_type')).toBe('code');
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authUrl.searchParams.get('code_challenge')!.length).toBeGreaterThan(20);
    expect(authUrl.searchParams.get('redirect_uri')).toBe(`http://localhost:54321${CALLBACK_PATH}`);
    // ⚠️ 授权 URL 里**绝不能**出现 verifier
    expect(h.opened[0]).not.toContain('code_verifier=');

    // 换 token 用的是授权码 + verifier
    const tokenCall = h.calls.find((c) => c.url.includes('login.microsoftonline.com'))!;
    const form = new URLSearchParams(tokenCall.body);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('AUTH-CODE-FROM-MICROSOFT');
    expect(form.get('code_verifier')!.length).toBe(43);

    // profile 里的玩家名/UUID 入库（不是 XBox 昵称、不是随机 UUID）
    expect(res.profile!.name).toBe('jeb_');
    expect(res.account.uuid).toBe('853c80ef-3c37-49fd-aa49-938b674adae6');
    expect(res.account.msRefreshToken).toBe(TOKENS.msRefresh);
    expect(res.account.mcAccessToken).toBe(TOKENS.mc);
    expect(res.warning).toBeNull();

    // 顺序：token → XBL → XSTS → MC login → entitlements → profile
    const seq = h.calls.map((c) => c.url);
    expect(seq[0]).toContain('login.microsoftonline.com');
    expect(seq[1]).toBe(XBL_USER_AUTH_URL);
    expect(seq[2]).toBe(XBL_XSTS_URL);
    expect(seq[3]).toBe(MC_LOGIN_WITH_XBOX_URL);
    expect(seq).toContain(MC_ENTITLEMENTS_URL);
    expect(seq).toContain(MC_PROFILE_URL);

    // loopback 被关掉（不留端口）
    expect(h.loopbacks[0]!.closed()).toBe(true);
  });

  it('getLaunchIdentity 用 profile 的 UUID（不是随机值）且 userType=msa', async () => {
    const h = makeService();
    await h.service.login();
    const identity = await h.service.getLaunchIdentity();
    expect(identity.username).toBe('jeb_');
    expect(identity.uuid).toBe('853c80ef-3c37-49fd-aa49-938b674adae6');
    expect(identity.userType).toBe('msa');
    expect(identity.accessToken).toBe(TOKENS.mc);
  });

  it('披风取自正版 profile 的 ACTIVE cape', async () => {
    const h = makeService();
    await h.service.login();
    const cape = await h.service.activeCape();
    expect(cape).not.toBeNull();
    expect(cape!.capeId).toBe('cape-1');
    expect(cape!.imageUrl).toBe('https://textures.minecraft.net/texture/cape1');
  });

  it('client_id 未配置 → 不发任何请求，抛可操作错误', async () => {
    const h = makeService();
    const bad = new MicrosoftAuthService({
      config: { clientId: '' },
      store: h.store,
      fetchImpl: makeFetch().impl,
      loopbackFactory: async () => {
        throw new Error('不该走到这里');
      },
    });
    await expect(bad.login()).rejects.toMatchObject({ code: 'not_configured' });
  });
});

// ===== 2. state 校验失败 → 拒绝 =====

describe('state 校验失败 → 拒绝', () => {
  it('回调 state 与 pending 不符 → state_mismatch，且不换 token', async () => {
    const h = makeService({}, { callback: badStateCallback() });
    await expect(h.service.login()).rejects.toMatchObject({ code: 'state_mismatch' });
    // 一条网络请求都不该有
    expect(h.calls).toHaveLength(0);
  });

  it('回调缺少 state → state_mismatch', async () => {
    const h = makeService(
      {},
      { callback: () => ({ code: 'c', state: null, error: null, errorDescription: null }) },
    );
    await expect(h.service.login()).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(h.calls).toHaveLength(0);
  });

  it('state 不匹配后 pending 被清掉（不能拿旧 pending 复用）', async () => {
    const h = makeService({}, { callback: badStateCallback() });
    await expect(h.service.login()).rejects.toMatchObject({ code: 'state_mismatch' });
    expect(h.service.pendingCount).toBe(0);
  });

  it('微软返回 access_denied → callback_error（明确带上游 error）', async () => {
    const h = makeService(
      {},
      {
        callback: (url) => ({
          code: null,
          state: new URL(url).searchParams.get('state'),
          error: 'access_denied',
          errorDescription: '用户拒绝了授权',
        }),
      },
    );
    await expect(h.service.login()).rejects.toMatchObject({
      code: 'callback_error',
      upstreamError: 'access_denied',
    });
  });

  it('回调缺 code → missing_code', async () => {
    const h = makeService(
      {},
      {
        callback: (url) => ({
          code: null,
          state: new URL(url).searchParams.get('state'),
          error: null,
          errorDescription: null,
        }),
      },
    );
    await expect(h.service.login()).rejects.toMatchObject({ code: 'missing_code' });
  });
});

// ===== 3. code_verifier 一次性 =====

describe('code_verifier 一次性：重复使用 → 拒绝', () => {
  it('成功后 pending 表为空（verifier 不残留、不可二次使用）', async () => {
    const h = makeService();
    expect(h.service.pendingCount).toBe(0);
    await h.service.login();
    expect(h.service.pendingCount).toBe(0);
  });

  it('授权失败（access_denied）后 pending 也被清掉', async () => {
    const h = makeService(
      {},
      {
        callback: (url) => ({
          code: null,
          state: new URL(url).searchParams.get('state'),
          error: 'access_denied',
          errorDescription: 'no',
        }),
      },
    );
    await expect(h.service.login()).rejects.toMatchObject({ code: 'callback_error' });
    expect(h.service.pendingCount).toBe(0);
  });

  it('换 token 失败后 pending 也被清掉（verifier 不留给第二次）', async () => {
    const h = makeService({ token: () => ({ status: 400, body: { error: 'invalid_request' } }) });
    await expect(h.service.login()).rejects.toBeTruthy();
    expect(h.service.pendingCount).toBe(0);
  });

  it('verifier 与 state 都取自 CSPRNG（注入随机源可验证「确实要了 32 字节」）', async () => {
    const asked: number[] = [];
    const fixed = (n: number): Buffer => {
      asked.push(n);
      return Buffer.alloc(n, 0x5a);
    };
    const h = makeService({}, { callback: okCallback() }, { randomBytes: fixed });
    await h.service.login();
    // state 一次 + verifier 一次
    expect(asked).toEqual([32, 32]);
    // 且授权 URL 里带的是 S256(verifier)，不是 verifier 本身
    const url = new URL(h.opened[0]!);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256')
        .update(Buffer.alloc(32, 0x5a).toString('base64url'), 'ascii')
        .digest('base64url'),
    );
  });

  it('同一授权请求重复发起登录不会互相污染（各自的 state/verifier 独立）', async () => {
    const h = makeService();
    await h.service.login();
    await expect(h.service.login()).resolves.toMatchObject({ profile: { name: 'jeb_' } });
    // 两次换 token 用的是**各自**的 verifier（都是 43 字符的 CSPRNG 值）
    const verifiers = h.calls
      .filter((c) => c.url.includes('login.microsoftonline.com'))
      .map((c) => new URLSearchParams(c.body).get('code_verifier'));
    expect(verifiers).toHaveLength(2);
    expect(verifiers[0]).not.toBe(verifiers[1]);
  });
});

// ===== 4. token 刷新 =====

describe('token 刷新', () => {
  /** 造一个「token 已过期」的账户。 */
  async function seedExpired(
    h: Harness,
    opts: { username?: string; uuid?: string; refresh?: string } = {},
  ) {
    await h.store.upsert({
      username: opts.username ?? 'jeb_',
      uuid: opts.uuid ?? '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: opts.refresh ?? 'OLD-REFRESH-TOKEN-0123456789abcdef',
      mcAccessToken: 'OLD-MC-TOKEN-0123456789abcdef',
      // 已在刷新窗口内（过期时间 < now + 5min）
      mcAccessTokenExpiresAt: now + 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
  }

  it('刷新成功：走 refresh_token grant + 重跑 XBL 链', async () => {
    const h = makeService();
    await seedExpired(h);

    const acc = await h.service.ensureFreshAccessToken();
    expect(acc.mcAccessToken).toBe(TOKENS.mc);
    // refresh 换到了新的 ms refresh token（轮换）
    expect(acc.msRefreshToken).toBe(TOKENS.msRefresh);

    const tokenForm = new URLSearchParams(h.calls[0]!.body);
    expect(tokenForm.get('grant_type')).toBe('refresh_token');
    expect(tokenForm.get('refresh_token')).toBe('OLD-REFRESH-TOKEN-0123456789abcdef');
    // 整条链重跑
    expect(h.calls.map((c) => c.url)).toEqual([
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
      XBL_USER_AUTH_URL,
      XBL_XSTS_URL,
      MC_LOGIN_WITH_XBOX_URL,
      MC_ENTITLEMENTS_URL,
      MC_PROFILE_URL,
    ]);
  });

  it('token 仍新鲜时不发任何请求（不打扰微软）', async () => {
    const h = makeService();
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'OLD-REFRESH-TOKEN-0123456789abcdef',
      mcAccessToken: 'STILL-FRESH-TOKEN-0123456789',
      mcAccessTokenExpiresAt: now + 60 * 60 * 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    const acc = await h.service.ensureFreshAccessToken();
    expect(acc.mcAccessToken).toBe('STILL-FRESH-TOKEN-0123456789');
    expect(h.calls).toHaveLength(0);
  });

  it('刷新失败：refresh token 过期（invalid_grant）→ 要求重新登录', async () => {
    const h = makeService({
      token: () => ({
        status: 400,
        body: { error: 'invalid_grant', error_description: 'AADSTS70008: refresh token expired' },
      }),
    });
    await seedExpired(h);
    await expect(h.service.ensureFreshAccessToken()).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
    try {
      await h.service.ensureFreshAccessToken();
    } catch (e) {
      expect((e as Error).message).toContain('重新登录');
    }
  });

  it('刷新失败：token 被撤销（同为 invalid_grant）→ 同样拒绝且不崩', async () => {
    const h = makeService({
      token: () => ({
        status: 400,
        body: { error: 'invalid_grant', error_description: 'revoked' },
      }),
    });
    await seedExpired(h);
    await expect(h.service.getLaunchIdentity()).rejects.toBeInstanceOf(MsAuthError);
  });

  it('刷新失败：网络错误 → 明确报错，不静默退化成离线随机 UUID', async () => {
    const impl = (async (url: string) => {
      if (url.includes('login.microsoftonline.com')) throw new TypeError('fetch failed');
      return makeFetch().impl(url);
    }) as unknown as typeof fetch;
    const h = makeService();
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'OLD-REFRESH-TOKEN-0123456789abcdef',
      mcAccessToken: 'OLD-MC-TOKEN-0123456789abcdef',
      mcAccessTokenExpiresAt: now + 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    const svc = new MicrosoftAuthService({
      config: CONFIG,
      store: h.store,
      fetchImpl: impl,
      now: () => now,
    });
    await expect(svc.ensureFreshAccessToken()).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
  });

  it('刷新后 XSTS 401（账号被 Xbox 拒绝）→ 错误冒泡，不降级', async () => {
    const h = makeService({
      xsts: () => ({ status: 401, body: {}, headers: { 'X-Err': '2148916233' } }),
    });
    await seedExpired(h);
    // 保留 McAccountError（xsts_denied）而不是压成 token_refresh_failed：
    // 前者指向账号本身（家长需开通 Xbox 档案），后者指向凭据，两者排障方向不同。
    await expect(h.service.ensureFreshAccessToken()).rejects.toMatchObject({
      code: 'xsts_denied',
    });
  });

  it('没有 refresh token（跨机器迁移后解密为空）→ 明确要求重新登录', async () => {
    const h = makeService();
    // 先正常写一个账户，再把落盘的 refresh token 换成「解不开的密文」，
    // 模拟 decryptSecret 失败返回空串的路径。
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'X',
      mcAccessToken: 'OLD-MC-TOKEN-0123456789abcdef',
      mcAccessTokenExpiresAt: now + 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    const raw = JSON.parse(readFileSync(h.accountsFile, 'utf-8')) as {
      accounts: { msRefreshToken: string }[];
    };
    raw.accounts[0]!.msRefreshToken = 'enc:bm90LWEtcmVhbC1jaXBoZXI=';
    writeFileSync(h.accountsFile, JSON.stringify(raw), 'utf-8');

    // 断言前提：解密后确实是空串
    expect((await h.store.list())[0]!.msRefreshToken).toBe('');
    await expect(h.service.ensureFreshAccessToken()).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
    // 一条网络请求都不该有（没有凭据可用来刷新）
    expect(h.calls).toHaveLength(0);
  });
});

// ===== 5. 无 profile 的账号 =====

describe('无 Minecraft 档案的账号 → 明确行为，不崩', () => {
  it('profile 404 → profile=null + 可执行 warning，且不入库', async () => {
    const h = makeService({ profile: () => ({ status: 404, body: null }) });
    const res = await h.service.login();
    expect(res.profile).toBeNull();
    expect(res.warning).toContain('没有 Minecraft Java 版档案');
    expect(res.warning).toContain('官方 Minecraft 启动器');
    // 不产生幽灵账户
    expect(await h.store.list()).toEqual([]);
  });

  it('profile 204 → 同样处理', async () => {
    const h = makeService({ profile: () => ({ status: 204, body: null }) });
    const res = await h.service.login();
    expect(res.profile).toBeNull();
    expect(res.warning).not.toBeNull();
  });

  it('只有基岩版购买记录 → 仍能登录，但给出购买状态提示', async () => {
    const h = makeService({
      entitlements: () => ({ body: { items: [{ name: 'product_minecraft_bedrock' }] } }),
    });
    const res = await h.service.login();
    expect(res.profile).not.toBeNull();
    expect(res.warning).toContain('未检测到 Java 版购买记录');
  });

  it('无档案的账户无法生成启动身份（明确报错，不是崩溃）', async () => {
    const h = makeService();
    await h.store.upsert({
      username: '',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'R',
      mcAccessToken: 'M',
      mcAccessTokenExpiresAt: now + 1000,
      capes: [],
      hasMinecraftProfile: false,
    });
    await expect(h.service.getLaunchIdentity()).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
  });
});

// ===== 6. 多账户并存 + 切换 =====

describe('多账户并存与切换', () => {
  const ACC_B = {
    username: 'Notch',
    uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5',
    msRefreshToken: 'REFRESH-TOKEN-BRAVO-0123456789',
    mcAccessToken: 'MC-ACCESS-TOKEN-BRAVO-0123456789',
    mcAccessTokenExpiresAt: 0,
    capes: [],
    hasMinecraftProfile: true,
  };

  it('两个微软账户可并存（先登录 A，再切库换 name/uuid 登录 B）', async () => {
    let hits = 0;
    const h = makeService({
      profile: () => {
        hits += 1;
        return hits === 1
          ? { body: { id: '853c80ef-3c37-49fd-aa49-938b674adae6', name: 'jeb_', capes: [] } }
          : { body: { id: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch', capes: [] } };
      },
    });
    await h.service.login();
    await h.service.login();

    const list = await h.service.listAccounts();
    expect(list).toHaveLength(2);
    expect(list.map((a) => a.username).sort()).toEqual(['Notch', 'jeb_']);
    // 摘要里没有任何 token
    expect(JSON.stringify(list)).not.toContain('REFRESH-TOKEN');
  });

  it('切换当前账户后 getLaunchIdentity 用的是被切到的那个', async () => {
    const h = makeService();
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'REFRESH-A-0123456789abcdef',
      mcAccessToken: 'MC-A-0123456789abcdef',
      mcAccessTokenExpiresAt: now + 60 * 60 * 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    await h.store.upsert(ACC_B, { setActive: false });
    await h.store.upsert({
      username: 'Dinnerbone',
      uuid: '61699b2e-d327-4a01-9f1e-0ea8c3f06bc6',
      msRefreshToken: 'REFRESH-C-0123456789abcdef',
      mcAccessToken: 'MC-C-0123456789abcdef',
      mcAccessTokenExpiresAt: now + 60 * 60 * 1000,
      capes: [],
      hasMinecraftProfile: true,
    });

    expect((await h.service.getLaunchIdentity()).username).toBe('Dinnerbone');
    await h.service.switchAccount('853c80ef3c3749fdaa49938b674adae6');
    expect((await h.service.getLaunchIdentity()).username).toBe('jeb_');
    await h.service.switchAccount('069a79f4-44e9-4726-a5be-fca90e38aaf5');
    expect((await h.service.getLaunchIdentity()).username).toBe('Notch');
  });

  it('移除账户后列表少一个', async () => {
    const h = makeService();
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'REFRESH-A-0123456789abcdef',
      mcAccessToken: 'MC-A-0123456789abcdef',
      mcAccessTokenExpiresAt: now + 60 * 60 * 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    await h.store.upsert(ACC_B);
    await h.service.removeAccount('069a79f444e94726a5befca90e38aaf5');
    expect(await h.service.listAccounts()).toHaveLength(1);
  });

  it('未登录任何账户时 getLaunchIdentity → not_configured（不是崩溃）', async () => {
    const h = makeService();
    await expect(h.service.getLaunchIdentity()).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('按 id 指定不存在的账户 → auth_request_unknown', async () => {
    const h = makeService();
    await expect(
      h.service.getLaunchIdentity('ffffffffffff4f9f9f9f9f9f9f9f9f9f9f9f9f9f9'),
    ).rejects.toMatchObject({ code: 'auth_request_unknown' });
  });
});

// ===== 7. §13.2 日志/错误不含 token =====

describe('§13.2 token 泄露防护', () => {
  it('⚠️ 错误信息里搜不到任何 token 片段', async () => {
    const h = makeService({
      login: () => ({
        status: 403,
        body: {
          errorMessage: `Your account has been suspended. identityToken=XBL3.0 x=UHS-1;${TOKENS.xsts} access_token=${TOKENS.msAccess}`,
        },
      }),
    });
    try {
      await h.service.login();
      expect.unreachable('应当抛错');
    } catch (e) {
      const msg = (e as Error).message;
      for (const t of Object.values(TOKENS)) expect(msg).not.toContain(t);
      expect(msg).toContain('suspended');
    }
  });

  it('⚠️ token 端点错误体里夹带的 token 不会进入错误信息', async () => {
    const h = makeService({
      token: () => ({
        status: 400,
        body: {
          error: 'invalid_grant',
          error_description: `refresh_token ${TOKENS.msRefresh} has expired`,
        },
      }),
    });
    try {
      await h.service.login();
      expect.unreachable('应当抛错');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).not.toContain(TOKENS.msRefresh);
      expect(msg).not.toContain('REFRESH');
    }
  });

  it('⚠️ 失败时 console 输出里搜不到 token 片段', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const h = makeService({
      xsts: () => ({
        status: 401,
        body: {},
        headers: { 'X-Err': '2148916233', 'X-Msg': `leak ${TOKENS.xbl}` },
      }),
    });
    await h.service.login().catch(() => undefined);
    // 服务内部不会打日志（这是好事），若将来加了日志也必须已洗过
    const output = [...spy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .join(' ');
    for (const t of Object.values(TOKENS)) expect(output).not.toContain(t);
    spy.mockRestore();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('刷新失败时错误里不含旧的 refresh token', async () => {
    const h = makeService({
      token: () => ({
        status: 400,
        body: { error: 'invalid_grant', error_description: 'expired' },
      }),
    });
    await h.store.upsert({
      username: 'jeb_',
      uuid: '853c80ef-3c37-49fd-aa49-938b674adae6',
      msRefreshToken: 'OLD-REFRESH-TOKEN-canary-0123456789',
      mcAccessToken: 'OLD-MC-TOKEN-canary-0123456789',
      mcAccessTokenExpiresAt: now + 1000,
      capes: [],
      hasMinecraftProfile: true,
    });
    try {
      await h.service.ensureFreshAccessToken();
      expect.unreachable('应当抛错');
    } catch (e) {
      expect((e as Error).message).not.toContain('OLD-REFRESH-TOKEN-canary');
    }
  });

  it('scrubber 已登记全部链路 token（防「登记漏了」）', async () => {
    const h = makeService();
    await h.service.login();
    expect(h.service.scrubber.size).toBeGreaterThanOrEqual(5);
  });
});

// ===== 8. §13.2 落盘是密文 =====

describe('§13.2 refresh token 落盘是密文', () => {
  it('⚠️ 磁盘文件里搜不到 refresh / access token 明文', async () => {
    const h = makeService();
    await h.service.login();
    const raw = readFileSync(h.accountsFile, 'utf-8');
    expect(raw).not.toContain(TOKENS.msRefresh);
    expect(raw).not.toContain(TOKENS.mc);
    expect(raw).not.toContain(TOKENS.msAccess);
    const parsed = JSON.parse(raw) as { accounts: { msRefreshToken: string }[] };
    expect(parsed.accounts[0]!.msRefreshToken).toMatch(/^enc:/);
  });

  it('OS 加密不可用时拒绝保存微软账户（不落明文）', async () => {
    encryptionAvailable = false;
    const h = makeService();
    await expect(h.service.login()).rejects.toThrow(/禁止明文落 json/);
  });
});

// ===== 杂项 =====

describe('杂项', () => {
  it('loopback 服务器必须在 finally 里被关掉（超时/失败也不漏端口）', async () => {
    const h = makeService({}, { callback: badStateCallback() });
    await expect(h.service.login()).rejects.toThrow();
    expect(h.loopbacks[0]!.closed()).toBe(true);
  });

  it('回调地址不是 loopback → 立刻拒绝（不打开浏览器）', async () => {
    const factory: LoopbackFactory = async () => ({
      redirectUri: 'http://evil.example.com/callback',
      waitForCallback: () => new Promise(() => undefined),
      close: async () => undefined,
    });
    const svc = new MicrosoftAuthService({
      config: CONFIG,
      store: new AccountStore(join(tmpDir, 'x.json'), () => now),
      fetchImpl: makeFetch().impl,
      loopbackFactory: factory,
    });
    await expect(svc.login()).rejects.toMatchObject({ code: 'invalid_callback_url' });
  });

  it('REDACTED 占位符被用于替换（保证输出可读）', () => {
    expect(REDACTED).toBe('[REDACTED]');
  });
});
