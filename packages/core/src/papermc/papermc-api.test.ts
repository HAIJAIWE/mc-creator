/**
 * PaperMC API 客户端测试（§7.2 代理层下载源）。
 *
 * 两类证据：
 * 1. **形状测试**：用注入的假响应锁住 v3 的嵌套结构解析（含嵌套层级改错时必须红）。
 * 2. **真网络冒烟**：真打 `fill.papermc.io/v3`，验证端点**此刻**可用。
 *    真网络用例失败时先看是端点变了还是代码错了 —— 这是本仓一贯的纪律
 *    （区分「环境问题」与「实现问题」，别把前者报成后者）。
 */
import { describe, expect, it } from 'vitest';
import {
  PAPERMC_API_BASE,
  PAPERMC_DOWNLOAD_HOST,
  PaperApiError,
  compareVersionDesc,
  fetchProjectVersions,
  fetchServerDownload,
  parseBuildDownload,
  parseProjectVersions,
  type FetchLike,
} from './papermc-api.js';

/** v3 实测响应（2026-10 原样摘录，只保留本测试用到的字段）。 */
const REAL_PROJECT_VERSIONS = {
  project: { id: 'velocity', name: 'Velocity' },
  versions: {
    '4.0.0': ['4.2.1-SNAPSHOT', '4.2.0', '4.1.2-SNAPSHOT', '4.1.1', '4.1.0'],
    '3.0.0': ['3.5.1', '3.5.0', '3.6.0-SNAPSHOT', '3.4.0', '3.1.1'],
    '1.1.0': ['1.1.9'],
  },
};

/** v3 实测 build 详情（2026-10 原样摘录）。 */
const REAL_BUILD_LATEST = {
  id: 566,
  time: '2026-01-25T17:52:08.734Z',
  channel: 'STABLE',
  downloads: {
    'server:default': {
      name: 'velocity-3.4.0-566.jar',
      checksums: { sha256: 'fb599cbda6a6d01decce5e281f71f51cae7cacffcfafca32a09601f407b0583e' },
      size: 17816748,
      url: 'https://fill-data.papermc.io/v1/objects/fb599cbda6a6d01decce5e281f71f51cae7cacffcfafca32a09601f407b0583e/velocity-3.4.0-566.jar',
    },
  },
};

function fakeFetch(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

describe('端点常量（实测确认，v2 已下线）', () => {
  it('API 根是 fill.papermc.io/v3，不是已 410 的 api.papermc.io/v2', () => {
    expect(PAPERMC_API_BASE).toBe('https://fill.papermc.io/v3');
    expect(PAPERMC_API_BASE).not.toContain('api.papermc.io/v2');
  });

  it('下载域与 API 域分离', () => {
    expect(PAPERMC_DOWNLOAD_HOST).toBe('https://fill-data.papermc.io/v1/objects');
    expect(PAPERMC_DOWNLOAD_HOST).not.toBe(PAPERMC_API_BASE);
  });
});

describe('v3 版本列表解析（versions 按 major 分组，与 v2 的扁平数组不同）', () => {
  it('解析实测响应，剔除 -SNAPSHOT', () => {
    const vs = parseProjectVersions(REAL_PROJECT_VERSIONS);
    const names = vs.map((v) => v.version);
    expect(names).not.toContain('4.2.1-SNAPSHOT');
    expect(names).not.toContain('3.6.0-SNAPSHOT');
    expect(names).toContain('4.2.0');
    expect(names).toContain('3.4.0');
    expect(names).toContain('1.1.9');
  });

  it('带出主版本号与原始分组键（实测分组键是完整三段，如 "3.0.0"）', () => {
    const vs = parseProjectVersions(REAL_PROJECT_VERSIONS);
    const v340 = vs.find((v) => v.version === '3.4.0');
    expect(v340?.major).toBe(3);
    // 分组键是完整三段而非裸主版本 —— 这是实测形态，别照直觉写成 '3'
    expect(v340?.group).toBe('3.0.0');
    expect(vs.find((v) => v.version === '4.2.0')?.group).toBe('4.0.0');
    expect(vs.find((v) => v.version === '1.1.9')?.major).toBe(1);
  });

  it('按数值三元组降序，不是字符串序（3.10.0 必须排在 3.9.0 之前）', () => {
    expect(compareVersionDesc('3.10.0', '3.9.0')).toBeLessThan(0);
    expect(compareVersionDesc('3.9.0', '3.10.0')).toBeGreaterThan(0);
    const vs = parseProjectVersions({
      versions: { '3.0.0': ['3.9.0', '3.10.0', '3.1.1'] },
    });
    expect(vs.map((v) => v.version)).toEqual(['3.10.0', '3.9.0', '3.1.1']);
  });

  it('形状不对时报错而非静默返回空', () => {
    expect(() => parseProjectVersions(null)).toThrow(PaperApiError);
    expect(() => parseProjectVersions({})).toThrow(PaperApiError);
    expect(() => parseProjectVersions({ versions: 'x' })).toThrow(PaperApiError);
  });

  it('v2 的扁平数组形状会被明确拒（防止静默返回空列表）', () => {
    // v2: {"versions": ["3.4.0", "3.3.0"]} —— 数组不是分组对象。
    // 这里必须**抛错**：若只靠 Array.isArray(list) 逐项判断，
    // Object.entries(数组) 得到 index→字符串 会全部被跳过 → 静默返回空列表，
    // 上游改版时就会表现为「版本列表莫名其妙空了」而不是「形状不对」。
    expect(() => parseProjectVersions({ versions: ['3.4.0', '3.3.0'] })).toThrow(PaperApiError);
    expect(() => parseProjectVersions({ versions: ['3.4.0'] })).toThrow(/v2/);
  });
});

describe('build 下载条目解析（downloads.<平台>:<架构> 再嵌一层）', () => {
  it('解析实测 build 详情', () => {
    const d = parseBuildDownload(REAL_BUILD_LATEST);
    expect(d.filename).toBe('velocity-3.4.0-566.jar');
    expect(d.size).toBe(17816748);
    expect(d.buildId).toBe(566);
    expect(d.channel).toBe('STABLE');
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.url.startsWith(PAPERMC_DOWNLOAD_HOST)).toBe(true);
  });

  it('缺 sha256 必须报错（§13.3 供应链校验不能落空）', () => {
    const bad = structuredClone(REAL_BUILD_LATEST) as Record<string, unknown>;
    (bad['downloads'] as Record<string, Record<string, unknown>>)['server:default'] = {
      name: 'x.jar',
      size: 1,
      url: 'https://example.invalid/x.jar',
    };
    expect(() => parseBuildDownload(bad)).toThrow(PaperApiError);
    expect(() => parseBuildDownload(bad)).toThrow(/sha256/);
  });

  it('缺 url / name 同样报错', () => {
    for (const drop of ['url', 'name'] as const) {
      const bad = structuredClone(REAL_BUILD_LATEST) as Record<string, unknown>;
      const dl = (bad['downloads'] as Record<string, Record<string, unknown>>)['server:default']!;
      delete dl[drop];
      expect(() => parseBuildDownload(bad), drop).toThrow(PaperApiError);
    }
  });

  it('没有 x64 条目时报错并列出可用键，绝不回退到任意条目', () => {
    const armOnly = {
      ...REAL_BUILD_LATEST,
      downloads: {
        'server:arm64': {
          name: 'a.jar',
          checksums: { sha256: 'a'.repeat(64) },
          url: 'https://x/a.jar',
        },
      },
    };
    let caught: PaperApiError | undefined;
    try {
      parseBuildDownload(armOnly);
    } catch (e) {
      caught = e as PaperApiError;
    }
    expect(caught).toBeInstanceOf(PaperApiError);
    expect(caught?.message).toContain('server:arm64');
  });

  it('downloads 缺失 / 非对象时报错', () => {
    expect(() => parseBuildDownload({ id: 1 })).toThrow(PaperApiError);
    expect(() => parseBuildDownload({ downloads: 'x' })).toThrow(PaperApiError);
  });
});

describe('网络封装：非 2xx 抛错并带上状态与 URL', () => {
  it('版本列表 404 → PaperApiError 带 status', async () => {
    await expect(
      fetchProjectVersions('no-such-project', fakeFetch({}, false, 404)),
    ).rejects.toThrow(PaperApiError);
    try {
      await fetchProjectVersions('no-such-project', fakeFetch({}, false, 404));
    } catch (e) {
      expect((e as PaperApiError).status).toBe(404);
      expect((e as PaperApiError).url).toContain('no-such-project');
    }
  });

  it('build 请求 URL 用传入的真实版本号（实测 v3 不接受 latest 作版本段）', async () => {
    const seen: string[] = [];
    const spy: FetchLike = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => REAL_BUILD_LATEST };
    };
    await fetchServerDownload('velocity', spy, { version: '3.4.0' });
    await fetchServerDownload('paper', spy, { version: '1.21.4' });
    expect(seen[0]).toBe(`${PAPERMC_API_BASE}/projects/velocity/versions/3.4.0/builds/latest`);
    expect(seen[1]).toBe(`${PAPERMC_API_BASE}/projects/paper/versions/1.21.4/builds/latest`);
  });

  it('⚠️ 上一版把 /versions/latest/builds/latest 当正确行为钉住了 —— 实测那是 404', async () => {
    // 2026-10 实测：GET /v3/projects/paper/versions/latest/builds/latest
    //   → 404 {"ok":false,"error":"version_not_found"}
    // v3 的 `latest` 只在最后一段（build 号）有意义；versions/{版本} 必须真实。
    // 所以本模块**不做** 'latest' 兜底，必须由调用方显式给版本号。
    const spy: FetchLike = async () => {
      throw new Error('不该发出请求：版本段非法时必须在本地就拒掉');
    };
    await expect(fetchServerDownload('paper', spy, { version: 'latest' })).rejects.toThrow(
      PaperApiError,
    );
    await expect(fetchServerDownload('paper', spy, { version: 'latest' })).rejects.toThrow(
      /404 version_not_found/,
    );
    // 空串同样拒（否则会拼出 /versions//builds/latest 这种畸形路径）
    await expect(fetchServerDownload('paper', spy, { version: '   ' })).rejects.toThrow(
      PaperApiError,
    );
  });

  it('指定版本时 build 响应没带 version 字段，用请求版本补上', async () => {
    const d = await fetchServerDownload('velocity', fakeFetch(REAL_BUILD_LATEST), {
      version: '3.4.0',
    });
    expect(d.version).toBe('3.4.0');
  });
});

// 真网络冒烟默认不跑：`VERIFY_VERSIONS=1` 时启用（与 verify-loader-versions.test.ts 同约定）。
// 默认门禁不能让上游一次连接超时把整个测试套件判红，但联网核验仍要保留入口。
const networkEnabled = process.env.VERIFY_VERSIONS === '1';

describe.skipIf(!networkEnabled)('真网络冒烟（端点此刻是否真可用）', () => {
  const fetchImpl: FetchLike = async (url) => {
    const res = await globalThis.fetch(url);
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };

  it('fill.papermc.io/v3/projects/velocity 真能取到版本列表', async () => {
    let versions: Awaited<ReturnType<typeof fetchProjectVersions>>;
    try {
      versions = await fetchProjectVersions('velocity', fetchImpl);
    } catch (e) {
      // 端点变更时这条会红 —— 报「环境/上游变了」，不是「实现错了」。
      throw new Error(
        `真网络取版本失败（端点可能又变了）：${(e as Error).message}。` +
          `若上游改版，请更新 ${PAPERMC_API_BASE} 并同步测试里的实测响应样本。`,
      );
    }
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.some((v) => v.version.includes('SNAPSHOT'))).toBe(false);
  });

  it('builds/latest 真能取到带 sha256 的下载条目', async () => {
    let d: Awaited<ReturnType<typeof fetchServerDownload>>;
    try {
      d = await fetchServerDownload('velocity', fetchImpl, { version: '3.4.0' });
    } catch (e) {
      throw new Error(`真网络取 build 下载信息失败（端点可能又变了）：${(e as Error).message}`);
    }
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.url.startsWith('https://')).toBe(true);
    expect(d.filename.endsWith('.jar')).toBe(true);
    expect(d.size).toBeGreaterThan(0);
  });

  it('旧 v2 端点确实已下线（这是本次迁移的直接依据）', async () => {
    const res = await globalThis.fetch('https://api.papermc.io/v2/projects/velocity');
    // 期望 410 Gone。若将来上游恢复 v2，这条会红 —— 那时说明该重新评估。
    expect(res.status).toBe(410);
  });

  it("'latest' 作版本段在上游确实是 404 version_not_found（本地拒它的依据）", async () => {
    const res = await globalThis.fetch(
      `${PAPERMC_API_BASE}/projects/paper/versions/latest/builds/latest`,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe('version_not_found');
  });

  it('真实版本号 + builds/latest 真能取到 paper 的下载条目（对照上一条）', async () => {
    const d = await fetchServerDownload('paper', fetchImpl, { version: '1.21.4' });
    expect(d.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(d.filename).toMatch(/^paper-1\.21\.4-\d+\.jar$/);
    expect(d.size).toBeGreaterThan(0);
    expect(d.url.startsWith('https://fill-data.papermc.io/')).toBe(true);
  });
});
