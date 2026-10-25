/**
 * MineSkin 客户端。
 *
 * fixture 用**实测的真实响应**（2026-10 抓的 `api.mineskin.org/get/list/1`），
 * 包括那些「理论上不该有」的形态：`_deprecated` 提示字段、缺 `uuid` 的条目、
 * `http://` 而非 `https://` 的链接。用真实数据才能测出这些边界。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  fetchMineSkinPage,
  downloadMineSkinPng,
  MINESKIN_PAGE_SIZE,
  MINESKIN_SOURCE,
  DEFAULT_SKIN_MODEL,
} from './mineskin.js';

/** 实测响应（截取 3 条 + 真实字段名）。 */
const REAL_PAGE_1 = {
  _deprecated: 'use list by reference instead. see https://api.mineskin.org/openapi for details',
  skins: [
    {
      id: 1370552387,
      skinUuid: '5d8fcbe06e0a419bb985b53c2c8f01dc',
      uuid: '5d8fcbe06e0a419bb985b53c2c8f01dc',
      url: 'http://textures.minecraft.net/texture/708b8d302221135572cea0e01bac3696f174c69ca481ac6f158f4bd0d6eac57f',
      time: 1778429319.384,
    },
    {
      id: 574245168,
      skinUuid: '14a73894778b4009b8fb07c0e02',
      url: 'http://textures.minecraft.net/texture/b9f0d7994e3c',
    },
    // 故意缺 url —— 源站数据不保证完整
    { id: 999, uuid: 'abc' },
  ],
  page: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(payload: unknown, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status,
      json: async () => payload,
      arrayBuffer: async () => payload,
    })),
  );
}

describe('fetchMineSkinPage', () => {
  it('解析出真实响应里的条目', async () => {
    stubFetch(REAL_PAGE_1);
    const page = await fetchMineSkinPage(1);
    expect(page.entries).toHaveLength(2); // 第 3 条缺 url 被跳过
    expect(page.entries[0]).toMatchObject({
      id: 1370552387,
      uuid: '5d8fcbe06e0a419bb985b53c2c8f01dc',
      textureUrl:
        'https://textures.minecraft.net/texture/708b8d302221135572cea0e01bac3696f174c69ca481ac6f158f4bd0d6eac57f',
    });
  });

  it('http:// 升级成 https://（否则混合内容策略会拦）', async () => {
    stubFetch(REAL_PAGE_1);
    const page = await fetchMineSkinPage(1);
    for (const e of page.entries) {
      expect(e.textureUrl.startsWith('https://')).toBe(true);
    }
  });

  it('time 缺失时是 null，不是 undefined', async () => {
    stubFetch({
      skins: [{ id: 1, url: 'https://textures.minecraft.net/texture/x' }],
    });
    const page = await fetchMineSkinPage(1);
    expect(page.entries[0].time).toBeNull();
  });

  it('uuid 回落到 skinUuid', async () => {
    stubFetch({ skins: [{ id: 1, skinUuid: 'bbb', url: 'https://t/x' }] });
    expect((await fetchMineSkinPage(1)).entries[0].uuid).toBe('bbb');
  });

  it('满页 → hasMore=true；未满 → false', async () => {
    const full = Array.from({ length: MINESKIN_PAGE_SIZE }, (_, i) => ({
      id: i,
      url: `https://t/${i}`,
    }));
    stubFetch({ skins: full });
    expect((await fetchMineSkinPage(1)).hasMore).toBe(true);

    stubFetch({ skins: full.slice(0, 3) });
    expect((await fetchMineSkinPage(2)).hasMore).toBe(false);
  });

  it('页码非法时落到第 1 页（别构造出 /get/list/0）', async () => {
    const calls: unknown[] = [];
    const spy = vi.fn(async (url: unknown) => {
      calls.push(url);
      return { ok: true, status: 200, json: async () => ({ skins: [] }) };
    });
    vi.stubGlobal('fetch', spy);
    await fetchMineSkinPage(0);
    await fetchMineSkinPage(-5);
    await fetchMineSkinPage(1.9);
    const urls = calls.map((c) => String(c));
    expect(urls.every((u) => u.endsWith('/get/list/1'))).toBe(true);
  });

  it('非 2xx → 抛错并带状态码', async () => {
    stubFetch({}, false, 503);
    await expect(fetchMineSkinPage(1)).rejects.toThrow(/HTTP 503/);
  });

  it('响应缺 skins → 明确报错（不是返回空列表假装成功）', async () => {
    stubFetch({ error: 'nope' });
    await expect(fetchMineSkinPage(1)).rejects.toThrow(/没有 skins/);
  });
});

describe('downloadMineSkinPng', () => {
  it('正常下载：返回字节', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => png })),
    );
    const out = await downloadMineSkinPng({
      id: 1,
      uuid: 'u',
      textureUrl: 'https://t/x',
      time: null,
    });
    expect(out.equals(png)).toBe(true);
  });

  it('非 2xx → 抛错', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, arrayBuffer: async () => Buffer.alloc(0) })),
    );
    await expect(
      downloadMineSkinPng({ id: 1, uuid: 'u', textureUrl: 'https://t/x', time: null }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('超过上限 → 拒（皮肤 PNG 实际几十 KB）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.alloc(10) })),
    );
    await expect(
      downloadMineSkinPng({ id: 1, uuid: 'u', textureUrl: 'https://t/x', time: null }, 4),
    ).rejects.toThrow(/过大/);
  });
});

describe('常量', () => {
  it('Source 与默认模型', () => {
    expect(MINESKIN_SOURCE).toBe('mineskin');
    // classic 是 Minecraft 默认皮肤，也是 PCL / HMCL 的默认选择
    expect(DEFAULT_SKIN_MODEL).toBe('classic');
  });
});
