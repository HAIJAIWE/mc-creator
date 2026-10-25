import { describe, it, expect } from 'vitest';
import {
  MC_ENTITLEMENTS_URL,
  MC_LOGIN_WITH_XBOX_URL,
  MC_PROFILE_URL,
  XBL_USER_AUTH_URL,
  XBL_XSTS_URL,
  authenticateXboxLive,
  authorizeXsts,
  fetchEntitlements,
  fetchMinecraftProfile,
  isUuidLike,
  loginMinecraft,
  normalizeUuid,
  readCapes,
} from './mc-account-service.js';
import { SecretScrubber } from './token-redact.js';

/**
 * XBL → XSTS → Minecraft → profile/cape 链路测试。
 *
 * 网络层**全部**是注入的 fetch 替身，绝不写真实 HTTP。
 */

interface Route {
  status?: number;
  /** `null` = 空响应体（204 这类状态**不能**带 body，否则 Response 构造器抛错）。 */
  body: unknown;
  headers?: Record<string, string>;
}

/** 按 URL 前缀分发的假 fetch。 */
function makeFetch(routes: Record<string, Route | (() => Route)>) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    seen.push({
      url,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ''),
    });
    if (key === undefined) return new Response(null, { status: 404 });
    const r =
      typeof routes[key] === 'function' ? (routes[key] as () => Route)() : (routes[key] as Route);
    return new Response(r.body === null ? null : JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) },
    });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const HAPPY_ROUTES: Record<string, Route> = {
  [XBL_USER_AUTH_URL]: {
    body: { Token: 'XBL-TOKEN-abcdefghijklmnop', DisplayClaims: { xui: [{ uhs: 'UHS-1' }] } },
  },
  [XBL_XSTS_URL]: {
    body: { Token: 'XSTS-TOKEN-abcdefghijklmno', DisplayClaims: { xui: [{ uhs: 'UHS-1' }] } },
  },
  [MC_LOGIN_WITH_XBOX_URL]: {
    body: { access_token: 'MC-TOKEN-abcdefghijklmnop', expires_in: 86400 },
  },
  [MC_ENTITLEMENTS_URL]: { body: { items: [{ name: 'product_minecraft' }] } },
  [MC_PROFILE_URL]: {
    body: {
      id: '853c80ef-3c37-49fd-aa49-938b674adae6',
      name: 'jeb_',
      skins: [{ id: 's1', state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/skin' }],
      capes: [
        {
          id: 'c1',
          state: 'ACTIVE',
          url: 'https://textures.minecraft.net/texture/cape1',
          alias: 'Migrator',
        },
        {
          id: 'c2',
          state: 'INACTIVE',
          url: 'https://textures.minecraft.net/texture/cape2',
          alias: null,
        },
      ],
    },
  },
};

describe('完整正版链路（注入 fetch）', () => {
  it('MS token → XBL → XSTS → Minecraft → profile', async () => {
    const scrubber = new SecretScrubber();
    const { impl, seen } = makeFetch(HAPPY_ROUTES);

    const xbl = await authenticateXboxLive(impl, 'MS-ACCESS-TOKEN-1234567890', scrubber);
    expect(xbl.uhs).toBe('UHS-1');

    const xsts = await authorizeXsts(impl, xbl.token, xbl.uhs, scrubber);
    expect(xsts.uhs).toBe('UHS-1');

    const mc = await loginMinecraft(impl, xsts.token, xsts.uhs, scrubber);
    expect(mc.accessToken).toBe('MC-TOKEN-abcdefghijklmnop');

    const profile = await fetchMinecraftProfile(impl, mc.accessToken, scrubber);
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe('853c80ef-3c37-49fd-aa49-938b674adae6');
    // ⚠️ 关键：玩家名来自 profile，不是 XBox 昵称
    expect(profile!.name).toBe('jeb_');
    expect(profile!.skinUrl).toBe('https://textures.minecraft.net/texture/skin');

    // 四步都发生了，且顺序正确
    expect(seen.map((s) => s.url)).toEqual([
      XBL_USER_AUTH_URL,
      XBL_XSTS_URL,
      MC_LOGIN_WITH_XBOX_URL,
      MC_PROFILE_URL,
    ]);
  });

  it('XBL 请求体/头都带 RPS 票据（d=<token>）', async () => {
    const { impl, seen } = makeFetch(HAPPY_ROUTES);
    await authenticateXboxLive(impl, 'MS-ACCESS-TOKEN-1234567890', new SecretScrubber());
    const call = seen[0]!;
    expect(call.headers['Authorization']).toBe('d=MS-ACCESS-TOKEN-1234567890');
    expect(JSON.parse(call.body).Properties.RpsTicket).toBe('d=MS-ACCESS-TOKEN-1234567890');
    expect(JSON.parse(call.body).Properties.AuthMethod).toBe('RPS');
    expect(JSON.parse(call.body).RelyingParty).toBe('http://auth.xboxlive.com');
  });

  it('XSTS 用 XBL3.0 头 + RelyingParty=rp://api.minecraftservices.com/', async () => {
    const { impl, seen } = makeFetch(HAPPY_ROUTES);
    await authorizeXsts(impl, 'XBL-TOKEN-abcdefghijklmnop', 'UHS-1', new SecretScrubber());
    const call = seen[0]!;
    expect(call.headers['Authorization']).toBe('XBL3.0 x=UHS-1;XBL-TOKEN-abcdefghijklmnop');
    const body = JSON.parse(call.body);
    expect(body.RelyingParty).toBe('rp://api.minecraftservices.com/');
    expect(body.Properties.SandboxId).toBe('RETAIL');
    expect(body.Properties.UserTokens).toEqual(['XBL-TOKEN-abcdefghijklmnop']);
  });

  it('login_with_xbox 的 identityToken 形状是 XBL3.0 x=<uhs>;<xsts>', async () => {
    const { impl, seen } = makeFetch(HAPPY_ROUTES);
    await loginMinecraft(impl, 'XSTS-TOKEN-abcdefghijklmno', 'UHS-9', new SecretScrubber());
    expect(JSON.parse(seen[0]!.body).identityToken).toBe(
      'XBL3.0 x=UHS-9;XSTS-TOKEN-abcdefghijklmno',
    );
  });

  it('profile 请求带 Bearer Minecraft token（不是 MS token）', async () => {
    const { impl, seen } = makeFetch(HAPPY_ROUTES);
    await fetchMinecraftProfile(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber());
    expect(seen[0]!.headers['Authorization']).toBe('Bearer MC-TOKEN-abcdefghijklmnop');
  });
});

describe('披风（Cape）—— 来自正版 profile', () => {
  it('读出 ACTIVE 披风与其图片直链', () => {
    const capes = readCapes({
      capes: [
        {
          id: 'c1',
          state: 'ACTIVE',
          url: 'https://textures.minecraft.net/texture/cape1',
          alias: 'Migrator',
        },
        { id: 'c2', state: 'INACTIVE', url: 'https://textures.minecraft.net/texture/cape2' },
      ],
    });
    expect(capes).toHaveLength(2);
    expect(capes[0]!.active).toBe(true);
    expect(capes[0]!.imageUrl).toBe('https://textures.minecraft.net/texture/cape1');
    expect(capes[0]!.alias).toBe('Migrator');
    expect(capes[1]!.active).toBe(false);
  });

  it('没有 capes 字段 / 空数组 / 缺 url 的条目都被安全忽略', () => {
    expect(readCapes({})).toEqual([]);
    expect(readCapes({ capes: [] })).toEqual([]);
    expect(readCapes({ capes: [{ id: 'x' }, { url: 'u' }, null] })).toEqual([]);
  });

  it('披风只在正版链路下可达（端点需要 Bearer Minecraft token）', async () => {
    const scrubber = new SecretScrubber();
    // 未带 token → 401
    const { impl: noAuth } = makeFetch({
      [MC_PROFILE_URL]: { status: 401, body: null },
    });
    await expect(fetchMinecraftProfile(noAuth, 'bad', scrubber)).rejects.toMatchObject({
      code: 'mc_token_rejected',
    });
  });
});

describe('无 Minecraft 档案的账号（刚购买 / 只有 Game Pass）', () => {
  it('404 → 返回 null（不抛错）', async () => {
    const { impl } = makeFetch({ [MC_PROFILE_URL]: { status: 404, body: null } });
    await expect(
      fetchMinecraftProfile(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber()),
    ).resolves.toBeNull();
  });

  it('204 → 同样返回 null（文档里部分端点用 204 表示无玩家）', async () => {
    const { impl } = makeFetch({ [MC_PROFILE_URL]: { status: 204, body: null } });
    await expect(
      fetchMinecraftProfile(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber()),
    ).resolves.toBeNull();
  });

  it('401 与「无档案」严格区分（前者是真错误）', async () => {
    const { impl } = makeFetch({ [MC_PROFILE_URL]: { status: 401, body: null } });
    await expect(
      fetchMinecraftProfile(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'mc_token_rejected' });
  });

  it('Game Pass：entitlements 无 product_minecraft 但 bedrock 条目存在', async () => {
    const { impl } = makeFetch({
      [MC_ENTITLEMENTS_URL]: { body: { items: [{ name: 'product_minecraft_bedrock' }] } },
    });
    const ent = await fetchEntitlements(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber());
    expect(ent.ownsMinecraft).toBe(false);
    expect(ent.bedrockOnly).toBe(true);
    expect(ent.productNames).toEqual(['product_minecraft_bedrock']);
  });

  it('买断：product_minecraft → ownsMinecraft=true', async () => {
    const { impl } = makeFetch({
      [MC_ENTITLEMENTS_URL]: { body: { items: [{ name: 'product_minecraft' }] } },
    });
    const ent = await fetchEntitlements(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber());
    expect(ent.ownsMinecraft).toBe(true);
    expect(ent.bedrockOnly).toBe(false);
  });

  it('entitlements 401 是「token 失效」而不是「没买」', async () => {
    const { impl } = makeFetch({ [MC_ENTITLEMENTS_URL]: { status: 401, body: null } });
    await expect(fetchEntitlements(impl, 'bad', new SecretScrubber())).rejects.toMatchObject({
      code: 'mc_token_rejected',
    });
  });
});

describe('错误与异常形状', () => {
  it('XBL 401 → xbl_auth_failed', async () => {
    const { impl } = makeFetch({ [XBL_USER_AUTH_URL]: { status: 401, body: {} } });
    await expect(
      authenticateXboxLive(impl, 'MS-ACCESS-TOKEN-1234567890', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'xbl_auth_failed' });
  });

  it('XSTS 401 + X-Err 2148916233 → 未成年人/无 Xbox 档案的可执行提示', async () => {
    const { impl } = makeFetch({
      [XBL_XSTS_URL]: {
        status: 401,
        body: {},
        headers: { 'X-Err': '2148916233', 'X-Msg': 'no xbox profile' },
      },
    });
    try {
      await authorizeXsts(impl, 'XBL-TOKEN-abcdefghijklmnop', 'UHS-1', new SecretScrubber());
      expect.unreachable('应当抛错');
    } catch (e) {
      expect((e as { code: string }).code).toBe('xsts_denied');
      expect((e as Error).message).toContain('Xbox 档案');
    }
  });

  it('XSTS 401 + X-Err 2148916238 → 地区/会员问题（专用错误码）', async () => {
    const { impl } = makeFetch({
      [XBL_XSTS_URL]: { status: 401, body: {}, headers: { 'X-Err': '2148916238' } },
    });
    await expect(
      authorizeXsts(impl, 'XBL-TOKEN-abcdefghijklmnop', 'UHS-1', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'xsts_unsupported_region' });
  });

  it('缺 DisplayClaims.xui → invalid_response（不做「猜」的处理）', async () => {
    const { impl } = makeFetch({ [XBL_USER_AUTH_URL]: { body: { Token: 'X' } } });
    await expect(
      authenticateXboxLive(impl, 'MS-ACCESS-TOKEN-1234567890', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('profile 的 id 不是 UUID → invalid_response', async () => {
    const { impl } = makeFetch({ [MC_PROFILE_URL]: { body: { id: 'not-a-uuid', name: 'x' } } });
    await expect(
      fetchMinecraftProfile(impl, 'MC-TOKEN-abcdefghijklmnop', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('网络错误 → network（不吞异常）', async () => {
    const impl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(
      authenticateXboxLive(impl, 'MS-ACCESS-TOKEN-1234567890', new SecretScrubber()),
    ).rejects.toMatchObject({ code: 'network' });
  });
});

describe('§13.2：错误信息里不含 token', () => {
  it('login_with_xbox 封禁错误回显 identityToken 时被洗掉', async () => {
    // Mojang 的 ACCOUNT_SUSPENDED 错误体会回显请求里的 identityToken。
    const scrubber = new SecretScrubber();
    const leaked = 'XSTS-TOKEN-abcdefghijklmno';
    scrubber.track(leaked);
    const { impl } = makeFetch({
      [MC_LOGIN_WITH_XBOX_URL]: {
        status: 403,
        body: {
          path: '/authentication/login_with_xbox',
          details: { reason: 'ACCOUNT_SUSPENDED' },
          errorMessage: `Your account has been suspended. identityToken=XBL3.0 x=UHS-1;${leaked}`,
        },
      },
    });
    try {
      await loginMinecraft(impl, leaked, 'UHS-1', scrubber);
      expect.unreachable('应当抛错');
    } catch (e) {
      expect((e as Error).message).not.toContain(leaked);
      expect((e as Error).message).toContain('suspended');
    }
  });
});

describe('UUID 工具', () => {
  it('normalizeUuid 去连字符并小写', () => {
    expect(normalizeUuid('853C80EF-3C37-49FD-AA49-938B674ADAE6')).toBe(
      '853c80ef3c3749fdaa49938b674adae6',
    );
  });

  it('isUuidLike 接受带/不带连字符，拒绝其它', () => {
    expect(isUuidLike('853c80ef-3c37-49fd-aa49-938b674adae6')).toBe(true);
    expect(isUuidLike('853c80ef3c3749fdaa49938b674adae6')).toBe(true);
    expect(isUuidLike('jeb_')).toBe(false);
    expect(isUuidLike('')).toBe(false);
  });
});
