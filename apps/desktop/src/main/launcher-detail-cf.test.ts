/**
 * CurseForge **详情页** handler 的用例。
 *
 * ## 为什么非要有这个文件
 *
 * 上一版 CF 详情页在应用里**每一页都打不开**，报的是
 * `Cannot read properties of undefined (reading 'map')` —— 原因有两层：
 *
 *   1. `CurseForgeApiClient.getMod()` 忘了拆信封（`/mods/{id}` 返回
 *      `{data:{...}}`），调用方拿到的是信封，`project.categories` 恒为
 *      undefined；
 *   2. 就算拆了信封，字段路径也写错了：官网 / wiki / issue 全在 `links`
 *      对象里，而且 `wikiUrl` 可能是**空串**。
 *
 * 这两个都不是"跑一遍源码逻辑"能看出来的 —— 一是信封形状，二是真实字段
 * 布局。所以 fixture 按**实测响应**抄（JEI 238222 的原响应），并且用
 * `LauncherGetModDetailResponse` 真的 parse 一遍：响应 schema 是渲染层与
 * 主进程之间的契约，NaN / 缺字段这类问题会在这里当场露馅。
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => {
      h.handlers.set(ch, fn);
    },
    on: () => undefined,
    removeHandler: (ch: string) => {
      h.handlers.delete(ch);
    },
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getPath: () => h.userData, on: () => undefined },
}));

/**
 * 把 CurseForge 客户端换成假的。
 *
 * 数据按**线上实测形状**抄（2026-10-17 走 MCIM 镜像拉 JEI 238222）：
 * `/mods/{id}` 有 `links`、没有 `description`；`/files` 的文件带
 * `gameVersions`（已归一化，不含 loader 名）/ `modLoaderNames` / `fileDate`。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();

  /** 完整项目：字段齐全（对齐 JEI 的实测响应）。 */
  const JEI = {
    id: 238222,
    name: 'Just Enough Items',
    summary: 'View Items and Recipes',
    downloadCount: 1_500_000_000,
    categories: [
      { id: 421, name: 'API and Library' },
      { id: 423, name: 'Map and Information' },
    ],
    // ⚠️ 真实响应里 wikiUrl 是**空串**（JEI 就是），空串不该渲染成链接。
    links: {
      websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei',
      wikiUrl: '',
      issuesUrl: 'https://github.com/mezz/JustEnoughItems/issues',
      sourceUrl: 'https://github.com/mezz/JustEnoughItems',
    },
    classId: 6,
    slug: 'jei',
    dateCreated: '2015-11-23T23:00:41.923Z',
    dateModified: '2026-10-17T11:19:33.153Z',
    // 没有 description —— 实测整个字段都不存在。
  };

  /** 极简项目：分类 / 外链 / 时间全缺席（塌成 undefined 的那种）。 */
  const BARE = {
    id: 999,
    name: 'Bare Project',
    summary: '只有必填字段',
    downloadCount: 1,
    classId: 6,
    slug: 'bare',
  };

  const FILE = {
    id: 7063238,
    displayName: '31.15.0.79 for NeoForge 26.3',
    fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
    fileLength: 1_234_567,
    downloadUrl: 'https://edge.forgecdn.net/files/7063/238/x.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['NeoForge'],
    fileDate: '2026-10-15T17:51:37.020Z',
    releaseType: 2,
    hashes: [
      { value: 'deadbeef', algo: 1 },
      { value: 'cafe', algo: 2 },
    ],
  };

  /**
   * 同一 loader + 同一 MC 版本的**重复**文件（真实项目必然如此：JEI 有 3909 个
   * 文件，几乎全被 `gameVersions`/`modLoaders` 撞车）。用来钉「头部不能渲染成
   * 复读墙」这条 —— 老实现直接 `flatMap` 摊平，详情页顶部会变成
   * `NeoForge / Fabric / NeoForge / Fabric / …` 几百遍。
   */
  const FILE_2 = {
    ...FILE,
    id: 7063239,
    fileName: 'jei-1.21.1-neoforge.jar',
    gameVersions: ['1.21.1'],
  };
  const FILE_3 = {
    ...FILE,
    id: 7063240,
    fileName: 'jei-26.3-fabric.jar',
    modLoaderNames: ['Fabric'],
  };

  class FakeCurseForgeApiClient {
    async getMod(modId: number): Promise<unknown> {
      return modId === 238222 ? JEI : BARE;
    }
    async getFiles(): Promise<unknown[]> {
      return [FILE, FILE_2, FILE_3];
    }
  }

  return {
    ...actual,
    CurseForgeApiClient: FakeCurseForgeApiClient as unknown as typeof actual.CurseForgeApiClient,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import { LAUNCHER_GET_MOD_DETAIL } from '../shared/ipc-channels.js';
import { LauncherGetModDetailResponse } from '../shared/ipc/launcher.js';

beforeAll(() => {
  registerLauncherHandlers();
});

async function detail(
  modId: string,
): Promise<ReturnType<typeof LauncherGetModDetailResponse.parse>> {
  const fn = h.handlers.get(LAUNCHER_GET_MOD_DETAIL);
  expect(fn).toBeDefined();
  const raw = await fn!({ sender: {} }, { modId, contentType: 'mod' });
  // 用**真的响应 schema** 过一遍：这是渲染层与主进程之间的契约。
  return LauncherGetModDetailResponse.parse(raw);
}

describe('CF 详情页 handler', () => {
  it('不再抛 undefined.map，且响应能通过 schema 校验', async () => {
    const res = await detail('cf_238222');
    expect(res.error ?? null).toBeNull();
    expect(res.detail?.name).toBe('Just Enough Items');
  });

  it('分类来自 project.categories', async () => {
    const res = await detail('cf_238222');
    expect(res.detail?.categories).toEqual(['API and Library', 'Map and Information']);
  });

  it('外链从 `links` 里取，且空串 wikiUrl 不算链接', async () => {
    const res = await detail('cf_238222');
    // 老实现读的是顶层的 project.wikiUrl / project.issueTrackerUrl —— 两个都不存在
    expect(res.detail?.wikiUrl).toBeUndefined();
    expect(res.detail?.issuesUrl).toBe('https://github.com/mezz/JustEnoughItems/issues');
    expect(res.detail?.sourceUrl).toBe('https://github.com/mezz/JustEnoughItems');
  });

  it('镜像不给长描述时退回 summary（不至于一片空白）', async () => {
    const res = await detail('cf_238222');
    expect(res.detail?.body).toBe('View Items and Recipes');
  });

  it('时间戳从 ISO 解析成毫秒', async () => {
    const res = await detail('cf_238222');
    expect(res.detail?.publishedAt).toBe(Date.parse('2015-11-23T23:00:41.923Z'));
    expect(res.detail?.updatedAt).toBe(Date.parse('2026-10-17T11:19:33.153Z'));
  });

  it('文件映射：fileDate → datePublished、releaseType 2 → beta、sha1 取 algo 1', async () => {
    const res = await detail('cf_238222');
    const v = res.detail?.versions[0];
    expect(v?.name).toBe('jei-26.3-neoforge-31.15.0.79.jar');
    expect(v?.datePublished).toBe(Date.parse('2026-10-15T17:51:37.020Z'));
    expect(v?.versionType).toBe('beta');
    expect(v?.gameVersions).toEqual(['26.3']);
    expect(v?.loaders).toEqual(['NeoForge']);
    expect(v?.files[0]?.sha1).toBe('deadbeef');
    expect(v?.files[0]?.size).toBe(1_234_567);
  });

  /**
   * 头部那两个列表（支持版本 / 加载器）是**所有文件摊平**来的 —— 3000 个文件
   * 就是 3000 条重复项。详情页头部把这俩直接 join 显示，不去重会变成一堵
   * 复读墙（实测 JEI 详情页：`NeoForge / Fabric / NeoForge / …` 铺满 20 行）。
   */
  it('loaders / gameVersions 去重（不然头部是复读墙）', async () => {
    const res = await detail('cf_238222');
    expect(res.detail?.loaders).toEqual(['NeoForge', 'Fabric']);
    // 去重后仍保留全部版本（顺序 = 文件顺序，第一个文件是 26.3）
    expect(new Set(res.detail?.gameVersions)).toEqual(new Set(['26.3', '1.21.1']));
    expect(res.detail?.gameVersions.length).toBe(2);
  });

  it('字段全缺的项目也不崩：分类空数组、时间 undefined', async () => {
    const res = await detail('cf_999');
    expect(res.error ?? null).toBeNull();
    expect(res.detail?.categories).toEqual([]);
    expect(res.detail?.wikiUrl).toBeUndefined();
    expect(res.detail?.issuesUrl).toBeUndefined();
    expect(res.detail?.publishedAt).toBeUndefined();
    expect(res.detail?.updatedAt).toBeUndefined();
  });
});
