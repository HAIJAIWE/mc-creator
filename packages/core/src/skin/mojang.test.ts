/**
 * Mojang 官方皮肤（按 UUID 查）测试。
 *
 * ## 这个文件盯三件事
 *
 * 1. **UUID 归一化**：sessionserver 要无横线小写 32 位，而用户会带横线输入
 *    （多数地方贴的都是带横线的）。转错就 100% 404，而且错误信息说的是
 *    "HTTP 404" 而不是「你的格式不对」。
 *
 * 2. **http → https**：官方 textures 里的皮肤 URL 是 `http://` 的。
 *    不换的话渲染进程 CSP 拦掉，症状是「导入成功、预览全空」——
 *    最难查的那种。
 *
 * 3. **模型只认 `metadata.model`**：`variant` 实测有一半是 `unknown`，
 *    拿它当准会把 slim 皮肤显示成 classic。而且这两种字段长得太像，
 *    很容易顺手写成 variant。
 *
 * 网络请求不 mock 真打 Mojang（测试会慢且不稳定），而是把 fetch 换成受控
 * 的假实现，返回事先拼好的 profile 结构 —— 要点是**结构必须照抄真实响应**，
 * 否则测的是一个自己想象的接口。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  normalizeUuid,
  fetchOfficialSkin,
  downloadOfficialSkinPng,
  type OfficialSkin,
} from './mojang.js';

/** 真实 sessionserver 响应的形状（Notch 的 profile 截短）。 */
const NOTCH_COMPACT = '069a79f444e94726a5befca90e38aaf5';

function profileJson(
  skinUrl: string,
  opts: { noSkin?: boolean; cape?: string; model?: string } = {},
): string {
  const textures: Record<string, unknown> = {};
  if (opts.noSkin !== true) {
    textures.SKIN = {
      url: skinUrl,
      // 真实响应里 metadata 是可选的，只在能判定时才有
      ...(opts.model === undefined ? {} : { metadata: { model: opts.model } }),
    };
  }
  if (opts.cape !== undefined) textures.CAPE = { url: opts.cape };
  return JSON.stringify({
    timestamp: 1791971075098,
    profileId: NOTCH_COMPACT,
    profileName: 'Notch',
    textures,
  });
}

/** 把 profile JSON base64 成 properties 里的 value。 */
function asProfile(body: string): unknown {
  return {
    id: NOTCH_COMPACT,
    name: 'Notch',
    properties: [{ name: 'textures', value: Buffer.from(body, 'utf-8').toString('base64') }],
  };
}

/** 合法 PNG 头（64×64）。 */
function png(): Buffer {
  const b = Buffer.alloc(64, 0x42);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(64, 16);
  b.writeUInt32BE(64, 20);
  return b;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('normalizeUuid', () => {
  it('去横线 + 转小写（sessionserver 要无横线小写）', () => {
    expect(normalizeUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5')).toBe(NOTCH_COMPACT);
  });

  it('无横线的小写原样通过', () => {
    expect(normalizeUuid(NOTCH_COMPACT)).toBe(NOTCH_COMPACT);
  });

  it('带横线的 32 位也接受（用户从别处贴来的多半是带横线的）', () => {
    expect(normalizeUuid('069a79f4-44e9-4726-a5be-fca90e38aaf5')).toBe(NOTCH_COMPACT);
  });

  it('前后有空白也接受（复制粘贴大概率带）', () => {
    expect(normalizeUuid(`  ${NOTCH_COMPACT}  `)).toBe(NOTCH_COMPACT);
  });

  it('长度不对就拒', () => {
    expect(normalizeUuid('069a79f4')).toBeNull();
  });

  it('含非十六进制字符就拒', () => {
    expect(normalizeUuid('069a79f444e94726a5befca90e38aag5'.replace('g', 'z'))).toBeNull();
  });

  it('空串就拒', () => {
    expect(normalizeUuid('')).toBeNull();
  });
});

describe('fetchOfficialSkin', () => {
  function stubFetch(impl: (url: string) => { status?: number; body?: string }): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        async json() {
          const r = impl(url);
          return asProfile(r.body ?? profileJson('http://textures.minecraft.net/texture/abc'));
        },
        async arrayBuffer() {
          return png().buffer;
        },
      })),
    );
  }

  it('把 http 皮肤 URL 换成 https（否则渲染进程 CSP 拦掉，预览全空）', async () => {
    stubFetch(() => ({ body: profileJson('http://textures.minecraft.net/texture/abc') }));
    const s = (await fetchOfficialSkin(NOTCH_COMPACT)) as OfficialSkin;
    expect(s.skinUrl).toBe('https://textures.minecraft.net/texture/abc');
    expect(s.playerName).toBe('Notch');
  });

  it('UUID 用无横线形式去请求 sessionserver', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return asProfile(profileJson('http://textures.minecraft.net/texture/x'));
          },
          async arrayBuffer() {
            return png().buffer;
          },
        };
      }),
    );
    await fetchOfficialSkin('069A79F4-44E9-4726-A5BE-FCA90E38AAF5');
    expect(seen[0]).toContain(`/profile/${NOTCH_COMPACT}`);
    expect(seen[0]).not.toContain('-');
  });

  it('取官方 metadata.model 当模型（classic / slim）', async () => {
    stubFetch(() => ({
      body: profileJson('http://textures.minecraft.net/texture/x', { model: 'slim' }),
    }));
    const s = (await fetchOfficialSkin(NOTCH_COMPACT)) as OfficialSkin;
    expect(s.model).toBe('slim');
  });

  it('ILLEGAL variant 不能当模型（实测有一半是 unknown）', async () => {
    // 真响应在能判时给 metadata.model，判不出时连 metadata 都不给。
    // 这里刻意不给 metadata，model 必须是 null 而不是瞎猜。
    stubFetch(() => ({ body: profileJson('http://textures.minecraft.net/texture/x') }));
    const s = (await fetchOfficialSkin(NOTCH_COMPACT)) as OfficialSkin;
    expect(s.model).toBeNull();
  });

  it('有披风时报 hasCape 与 capeUrl（都换成 https）', async () => {
    stubFetch(() => ({
      body: profileJson('http://textures.minecraft.net/texture/x', {
        cape: 'http://textures.minecraft.net/texture/cape123',
      }),
    }));
    const s = (await fetchOfficialSkin(NOTCH_COMPACT)) as OfficialSkin;
    expect(s.hasCape).toBe(true);
    expect(s.capeUrl).toBe('https://textures.minecraft.net/texture/cape123');
  });

  it('没披风时 hasCape=false', async () => {
    stubFetch(() => ({ body: profileJson('http://textures.minecraft.net/texture/x') }));
    const s = (await fetchOfficialSkin(NOTCH_COMPACT)) as OfficialSkin;
    expect(s.hasCape).toBe(false);
    expect(s.capeUrl).toBeNull();
  });

  it('UUID 格式不对 → 说清「要 UUID 不是名字」（别让人以为接口挂了）', async () => {
    let called = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        called = true;
        throw new Error('should not fetch');
      }),
    );
    await expect(fetchOfficialSkin('Notch')).rejects.toThrow(/UUID/);
    expect(called).toBe(false);
  });

  it('404 → 说清没有这个账号', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        async json() {
          return {};
        },
      })),
    );
    await expect(fetchOfficialSkin(NOTCH_COMPACT)).rejects.toThrow(
      'Mojang 没有这个 UUID 的正版账号记录',
    );
  });

  it('没有 textures 属性 → 说清没有皮肤数据', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { id: NOTCH_COMPACT, name: 'Ghost', properties: [] };
        },
      })),
    );
    await expect(fetchOfficialSkin(NOTCH_COMPACT)).rejects.toThrow('没有皮肤数据');
  });

  it('textures 里没有 SKIN → 说清没有皮肤', async () => {
    stubFetch(() => ({ body: profileJson('http://x', { noSkin: true }) }));
    await expect(fetchOfficialSkin(NOTCH_COMPACT)).rejects.toThrow('这个账号没有皮肤');
  });
});

describe('downloadOfficialSkinPng', () => {
  it('拉下来的不是 PNG 就当拦下（别把 HTML 错误页塞进库）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from('<html>404</html>').buffer;
        },
      })),
    );
    await expect(
      downloadOfficialSkinPng('http://textures.minecraft.net/texture/x'),
    ).rejects.toThrow();
  });

  it('HTTP 失败时报状态码', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 404,
        async arrayBuffer() {
          return new ArrayBuffer(0);
        },
      })),
    );
    await expect(
      downloadOfficialSkinPng('http://textures.minecraft.net/texture/x'),
    ).rejects.toThrow('HTTP 404');
  });

  it('合法 PNG 原样返回', async () => {
    const p = png();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        async arrayBuffer() {
          return p.buffer;
        },
      })),
    );
    const out = await downloadOfficialSkinPng('http://textures.minecraft.net/texture/x');
    expect(out.equals(p)).toBe(true);
  });

  it('请求用的也是 https（同上，CSP）', async () => {
    const seen: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.push(url);
        return {
          ok: true,
          status: 200,
          async arrayBuffer() {
            return png().buffer;
          },
        };
      }),
    );
    await downloadOfficialSkinPng('http://textures.minecraft.net/texture/x');
    expect(seen[0]?.startsWith('https://')).toBe(true);
  });
});
