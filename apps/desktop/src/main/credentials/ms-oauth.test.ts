import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CALLBACK_PATH,
  CLIENT_ID_ENV,
  MS_SCOPE,
  PKCE_CHALLENGE_METHOD,
  MsAuthError,
  MsTokenClient,
  assertLoopbackRedirectUri,
  buildAuthorizeUrl,
  computeCodeChallengeS256,
  createPendingAuthRequest,
  generateCodeVerifier,
  generateState,
  stateEquals,
} from './ms-oauth.js';

/**
 * PKCE 原语与授权 URL 测试。
 *
 * 全部**不发起任何网络请求**（token 端点用注入的 fetch 替身）。
 */

const CLIENT_ID = '12345678-1234-1234-1234-123456789abc';

describe('PKCE code_verifier', () => {
  it('32 字节 CSPRNG → 43 字符 base64url（RFC 7636 §4.1 的 43–128）', () => {
    const v = generateCodeVerifier();
    expect(v).toHaveLength(43);
    // unreserved 字符集：base64url 只会产出 A-Za-z0-9-_，全在集合内
    expect(v).toMatch(/^[A-Za-z0-9\-._~]+$/);
  });

  it('两次生成必须不同（用了随机源，不是常量）', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it('随机源可注入：测试能断言「确实向 CSPRNG 要了 32 字节」', () => {
    const asked: number[] = [];
    const fake = (n: number): Buffer => {
      asked.push(n);
      return Buffer.alloc(n, 7);
    };
    const v = generateCodeVerifier(fake);
    expect(asked).toEqual([32]);
    expect(v).toBe(Buffer.alloc(32, 7).toString('base64url'));
  });
});

describe('PKCE code_challenge 必须是 S256', () => {
  it('等于 base64url(sha256(verifier))，且不等于 verifier 本身', () => {
    const verifier = 'a'.repeat(43);
    const expected = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const challenge = computeCodeChallengeS256(verifier);
    expect(challenge).toBe(expected);
    // plain 的失败模式：challenge === verifier。S256 下绝不能发生。
    expect(challenge).not.toBe(verifier);
    expect(challenge).not.toContain('='); // base64url 无 padding
  });

  it('授权 URL 里写死 S256（不是 plain）', () => {
    const pending = createPendingAuthRequest({ redirectUri: 'http://localhost:5000/callback' });
    const url = new URL(
      buildAuthorizeUrl(
        { clientId: CLIENT_ID },
        {
          redirectUri: pending.redirectUri,
          state: pending.state,
          codeChallenge: pending.codeChallenge,
        },
      ),
    );
    expect(url.searchParams.get('code_challenge_method')).toBe(PKCE_CHALLENGE_METHOD);
    expect(PKCE_CHALLENGE_METHOD).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(pending.codeChallenge);
  });

  it('challenge 与 verifier 满足 S256 关系（防止实现里悄悄改了算法）', () => {
    const pending = createPendingAuthRequest({ redirectUri: 'http://localhost:5000/callback' });
    expect(pending.codeChallenge).toBe(computeCodeChallengeS256(pending.codeVerifier));
  });
});

describe('state', () => {
  it('同样 43 字符 base64url，且每次不同', () => {
    const s = generateState();
    expect(s).toHaveLength(43);
    expect(s).not.toBe(generateState());
  });

  it('定长比较：相等/不等/长度不同都正确', () => {
    const a = generateState();
    expect(stateEquals(a, a)).toBe(true);
    expect(stateEquals(a, generateState())).toBe(false);
    expect(stateEquals(a, a.slice(0, 10))).toBe(false);
    expect(stateEquals('', '')).toBe(true);
  });
});

describe('buildAuthorizeUrl', () => {
  it('带齐 response_type / scope / redirect_uri / prompt', () => {
    const url = new URL(
      buildAuthorizeUrl(
        { clientId: CLIENT_ID },
        {
          redirectUri: 'http://localhost:5000/callback',
          state: 'S',
          codeChallenge: 'C',
        },
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
    );
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(MS_SCOPE);
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:5000/callback');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    // scope 必须含 offline_access 才有 refresh token
    expect(MS_SCOPE).toContain('offline_access');
    expect(MS_SCOPE).toContain('XboxLive.signin');
  });

  it('client_id 为空 → 抛出指明配置方式的可操作错误（不硬编 secret）', () => {
    expect(() =>
      buildAuthorizeUrl(
        { clientId: '  ' },
        { redirectUri: 'http://localhost:1/callback', state: 's', codeChallenge: 'c' },
      ),
    ).toThrow(MsAuthError);
    try {
      buildAuthorizeUrl(
        { clientId: '' },
        { redirectUri: 'http://localhost:1/callback', state: 's', codeChallenge: 'c' },
      );
    } catch (e) {
      expect((e as MsAuthError).code).toBe('not_configured');
      // 错误信息必须告诉用户去哪儿填
      expect((e as Error).message).toContain(CLIENT_ID_ENV);
    }
  });
});

describe('assertLoopbackRedirectUri', () => {
  it('接受 localhost / 127.0.0.1 + 正确路径', () => {
    expect(() => assertLoopbackRedirectUri(`http://localhost:1234${CALLBACK_PATH}`)).not.toThrow();
    expect(() => assertLoopbackRedirectUri(`http://127.0.0.1:0${CALLBACK_PATH}`)).not.toThrow();
  });

  it('拒绝 https（loopback 用 http）', () => {
    expect(() => assertLoopbackRedirectUri(`https://localhost${CALLBACK_PATH}`)).toThrow(
      /必须是 http loopback/,
    );
  });

  it('拒绝非 loopback 主机（防把授权码发到外部）', () => {
    expect(() => assertLoopbackRedirectUri(`http://evil.example.com${CALLBACK_PATH}`)).toThrow(
      /loopback 主机/,
    );
  });

  it('拒绝路径不符（与 Azure 登记的 redirect URI 不一致）', () => {
    expect(() => assertLoopbackRedirectUri('http://localhost/steal')).toThrow(/回调路径/);
  });
});

describe('MsTokenClient（注入 fetch，无真实 HTTP）', () => {
  function client(handler: (url: string, init: RequestInit) => Response) {
    const calls: { url: string; body: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body ?? '') });
      return handler(url, init);
    }) as unknown as typeof fetch;
    return { client: new MsTokenClient({ clientId: CLIENT_ID }, { fetchImpl }), calls };
  }

  const json = (obj: unknown, status = 200): Response =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  it('exchangeCode 发的是 authorization_code + code_verifier', async () => {
    const { client: c, calls } = client(() =>
      json({
        access_token: 'AT-0123456789abcdef',
        refresh_token: 'RT-0123456789abcdef',
        expires_in: 3600,
      }),
    );
    const set = await c.exchangeCode({
      code: 'the-code',
      codeVerifier: 'v'.repeat(43),
      redirectUri: 'http://localhost:1/callback',
    });
    expect(set.accessToken).toBe('AT-0123456789abcdef');
    expect(set.refreshToken).toBe('RT-0123456789abcdef');
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('the-code');
    expect(body.get('code_verifier')).toBe('v'.repeat(43));
    expect(body.get('client_id')).toBe(CLIENT_ID);
    expect(body.get('redirect_uri')).toBe('http://localhost:1/callback');
  });

  it('refresh 走 refresh_token grant', async () => {
    const { client: c, calls } = client(() =>
      json({
        access_token: 'AT2-0123456789abcdefg',
        refresh_token: 'RT2-0123456789abcdefg',
        expires_in: 3600,
      }),
    );
    const set = await c.refresh('RT-0123456789abcdef');
    const body = new URLSearchParams(calls[0]!.body);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('RT-0123456789abcdef');
    // 微软会轮换 refresh token → 返回值必须带上新的
    expect(set.refreshToken).toBe('RT2-0123456789abcdefg');
  });

  it('响应里没有 refresh_token 时返回 null（调用方据此保留旧值）', async () => {
    const { client: c } = client(() =>
      json({ access_token: 'AT3-0123456789abcdefg', expires_in: 10 }),
    );
    const set = await c.refresh('RT-0123456789abcdef');
    expect(set.refreshToken).toBeNull();
  });

  it('invalid_grant（refresh token 过期/撤销）→ 可操作的中文提示', async () => {
    const { client: c } = client(() =>
      json(
        {
          error: 'invalid_grant',
          error_description:
            'AADSTS70008: The provided authorization code or refresh token has expired.',
        },
        400,
      ),
    );
    await expect(c.refresh('RT-0123456789abcdef')).rejects.toMatchObject({
      code: 'token_refresh_failed',
    });
    try {
      await c.refresh('RT-0123456789abcdef');
    } catch (e) {
      expect((e as Error).message).toContain('重新登录');
    }
  });

  it('网络错误 → network 错误码（不吞）', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const c = new MsTokenClient({ clientId: CLIENT_ID }, { fetchImpl });
    await expect(c.refresh('RT-0123456789abcdef')).rejects.toMatchObject({ code: 'network' });
  });

  it('200 但不是 JSON → invalid_response', async () => {
    const { client: c } = client(() => new Response('<html>oops</html>', { status: 200 }));
    await expect(c.refresh('RT-0123456789abcdef')).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('200 但没有 access_token → token_exchange_failed', async () => {
    const { client: c } = client(() => json({ token_type: 'Bearer' }));
    await expect(c.refresh('RT-0123456789abcdef')).rejects.toMatchObject({
      code: 'token_exchange_failed',
    });
  });
});
