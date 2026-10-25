/**
 * 「主文件 / 前置必须能在**目标实例**上跑」—— 主进程侧端到端钉子。
 *
 * 为什么需要这一组：这两条路的版本选择原来都是「取源站给的第一版」（= 最新版）。
 * 实测（2026-10）代价是两个用户可见的坏结果：
 *
 *  1. **前置与实例不兼容**。1.20.1 + Fabric 实例下载 WTHIT，前置被选成
 *     `fabric-api 0.163.0+26.4`（`game_versions` 只有 `26.4-snapshot-4`）与
 *     `badpackets neo-0.12.2`（26.1–26.2）；正确的应是 `0.92.12+1.20.1` /
 *     `fabric-0.4.3`。把 26.x 的 Fabric API 装进 1.20.1 实例 = 启动即崩，
 *     而界面写着「前置已装」。
 *  2. **数据包分类下到 mod 构建**。Modrinth 上数据包的 `project_type` 是 `mod`，
 *     而 Terralith / Dungeons and Taverns / Tectonic / Trek 的**最新版都是 mod
 *     构建**（`.jar`）。不按 `datapack` 过滤就会把一个 jar 放进
 *     `saves/<世界>/datapacks/` —— 游戏不读它，用户的症状是「装了没效果」。
 *
 * 断言刻意走**真 handler + 真 `collectRequiredDependencies`**：只断言「我们把
 * filter 传下去了」证明不了「落盘的是兼容的那一版」。源站（`ModrinthApiClient`）
 * 与 `fetch` 换成假的，**落盘是真的**，所以 `expect(existsSync(...))` 有分量。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type VersionsQuery = { mcVersion?: string; loader?: string };

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
  /** 每次 getVersions 收到的 (pid, 过滤条件) —— 用来钉「按实例过滤」。 */
  queries: [] as Array<{ pid: string; opts: VersionsQuery }>,
  /** pid → 按过滤条件返回版本（模拟源站的 `game_versions`/`loaders` 服务端过滤）。 */
  versions: new Map<string, (opts: VersionsQuery) => unknown[]>(),
  /** pid → project_type（依赖落盘目录要用它）。 */
  projectTypes: new Map<string, string>(),
  /** 假 fetch 收到过的下载地址。 */
  fetched: [] as string[],
  /**
   * 假 fetch。`beforeAll` 里装、并保持**同一个实例**贯穿整个文件：handler 构造
   * `LauncherService` 时会把当时的全局 fetch 固定住（见 `beforeAll` 的注释），
   * 所以 `beforeEach` 只能 `mockClear()` 它，不能换一个新的。
   */
  fetchMock: null as unknown as ReturnType<typeof vi.fn>,
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
 * 只替换 `ModrinthApiClient`（`importOriginal` 保留其余一切，特别是
 * `collectRequiredDependencies` / `pickPrimaryFile` 的**真实现**）。
 *
 * 假客户端**不做本地过滤**：它把过滤条件转交给测试注册的响应函数，
 * 由测试决定"带条件时返回什么、不带条件时返回什么"。这样才能同时钉住
 * 「选对了版本」与「从来没问过不带条件的那一次」。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();

  class FakeModrinthApiClient {
    async getVersions(pid: string, opts: VersionsQuery = {}): Promise<unknown[]> {
      h.queries.push({ pid, opts });
      const respond = h.versions.get(pid);
      return respond ? respond(opts) : [];
    }
    async getProject(pid: string): Promise<{ project_type: string }> {
      return { project_type: h.projectTypes.get(pid) ?? 'mod' };
    }
  }

  return {
    ...actual,
    ModrinthApiClient: FakeModrinthApiClient as unknown as typeof actual.ModrinthApiClient,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import { InstanceRegistry } from './instance-registry.js';
import { LAUNCHER_DOWNLOAD_MOD } from '../shared/ipc-channels.js';
import type { ModrinthVersion } from '@mc-creator/core';

/** 实例名 = 目录名（多实例的约定），这里用中文名顺带钉住它可用。 */
const INSTANCE = '兼容性测试实例';
const MC = '1.20.1';

function ver(partial: {
  id: string;
  project_id: string;
  filename: string;
  version_number?: string;
  loaders?: string[];
  dependencies?: Array<{ project_id: string; dependency_type: string; version_id?: string }>;
}): ModrinthVersion {
  return {
    id: partial.id,
    project_id: partial.project_id,
    version_number: partial.version_number ?? '1.0.0',
    name: partial.version_number ?? '1.0.0',
    game_versions: [MC],
    loaders: partial.loaders ?? ['fabric'],
    files: [
      {
        url: `https://cdn.test/${partial.filename}`,
        filename: partial.filename,
        primary: true,
        // 4 字节：与下面的 fetch 替身返回的 `new ArrayBuffer(4)` 对齐。
        // 下载会按清单校验 size（那是真的会拦住截断/错误页的一道闸），
        // 所以替身**不能**在 size 上撒谎 —— 撒谎就是在测一个假前提。
        size: 4,
      },
    ],
    date_published: '2026-01-01T00:00:00Z',
    ...(partial.dependencies === undefined ? {} : { dependencies: partial.dependencies }),
  } as ModrinthVersion;
}

/** 实例真正在用的游戏目录（注册表缺省就是 `<base>/game/<实例名>`）。 */
const gameDir = (): string => join(h.userData, 'mc-launcher', 'game', INSTANCE);

const invoke = async (
  channel: string,
  req: unknown,
): Promise<{
  ok: boolean;
  path?: string | null;
  error?: string | null;
  missingDependencies?: string[];
}> => {
  const fn = h.handlers.get(channel);
  expect(fn, `${channel} 没有 handler`).toBeDefined();
  return (await fn!({ sender: {} }, req)) as {
    ok: boolean;
    path?: string | null;
    error?: string | null;
    missingDependencies?: string[];
  };
};

beforeAll(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'mc-deps-compat-'));
  /*
   * ⚠️ 替身必须在 `registerLauncherHandlers()` **之前**装好。
   *
   * handler 里 `new LauncherService(dir, undefined, ...)` 的第二个参数默认值是
   * 构造那一刻的全局 `fetch`（构造器默认参数在调用时求值）—— 服务把这个引用
   * **固定**下来，之后再 `vi.stubGlobal('fetch', ...)` 已经换不掉它了。以前下载
   * 走的是 handler 里的裸 `fetch()`（每次重新解析全局），所以放在 `beforeEach`
   * 里也能生效；现在下载统一走 `LauncherService.fetchContent()`（这是刻意的：
   * 候选源 / 哈希校验收在一处），替身就得提前装。
   *
   * 症状很有欺骗性：`res.ok === false`，看起来像业务回归，其实是测试在真打网络。
   */
  h.fetchMock = vi.fn(async (url: string | URL) => {
    h.fetched.push(String(url));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      text: async () => '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', h.fetchMock);
  registerLauncherHandlers();
  // 注册表每次 get() 都重读 instances.json，所以先建也能被 handler 看到。
  new InstanceRegistry(join(h.userData, 'mc-launcher')).create({
    versionId: MC,
    name: INSTANCE,
    loader: 'fabric',
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(h.userData, { recursive: true, force: true });
});

beforeEach(() => {
  h.queries.length = 0;
  h.fetched.length = 0;
  h.versions.clear();
  h.projectTypes.clear();
  h.fetchMock.mockClear();
});

describe('下载时按目标实例挑版本（MC 版本 + 加载器）', () => {
  /**
   * 实测那个坑（WTHIT 1.20.1 + fabric）：源站的「最新前置」是给 26.x 的。
   * 修复后应当装 `0.92.12+1.20.1`，**并且**：磁盘上不能出现那个 26.x 的文件。
   */
  it('前置装的是与实例兼容的那一版，最新版既不落盘也不下载', async () => {
    const DEP_OK = ver({
      id: 'v-dep-ok',
      project_id: 'DEP',
      filename: 'fabric-api-0.92.12+1.20.1.jar',
      version_number: '0.92.12+1.20.1',
    });
    const DEP_LATEST = ver({
      id: 'v-dep-new',
      project_id: 'DEP',
      filename: 'fabric-api-0.163.0+26.4.jar',
      version_number: '0.163.0+26.4',
    });
    const ROOT = ver({
      id: 'v-root',
      project_id: 'ROOT',
      filename: 'wthit-fabric-8.21.1.jar',
      dependencies: [{ project_id: 'DEP', dependency_type: 'required' }],
    });

    h.projectTypes.set('DEP', 'mod');
    h.versions.set('ROOT', (o) => (o.mcVersion === MC && o.loader === 'fabric' ? [ROOT] : []));
    // 带条件 → 兼容的那版；不带条件（旧行为）→ 最新版
    h.versions.set('DEP', (o) =>
      o.mcVersion === MC && o.loader === 'fabric' ? [DEP_OK] : [DEP_LATEST],
    );

    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_ROOT',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });

    expect(res.ok).toBe(true);
    const mods = join(gameDir(), 'mods');
    expect(existsSync(join(mods, 'wthit-fabric-8.21.1.jar'))).toBe(true);
    expect(existsSync(join(mods, 'fabric-api-0.92.12+1.20.1.jar'))).toBe(true);
    // 关键断言：不兼容的最新版**没有**落盘，也没有被下载
    expect(existsSync(join(mods, 'fabric-api-0.163.0+26.4.jar'))).toBe(false);
    expect(h.fetched).not.toContain('https://cdn.test/fabric-api-0.163.0+26.4.jar');
  });

  it('问前置版本时**只**带实例的 MC 版本 + 加载器（没有"不带条件"的那一次）', async () => {
    const DEP = ver({ id: 'v-dep', project_id: 'DEP', filename: 'lib.jar' });
    const ROOT = ver({
      id: 'v-root',
      project_id: 'ROOT',
      filename: 'root.jar',
      dependencies: [{ project_id: 'DEP', dependency_type: 'required' }],
    });
    h.projectTypes.set('DEP', 'mod');
    h.versions.set('ROOT', () => [ROOT]);
    h.versions.set('DEP', () => [DEP]);

    await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_ROOT',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });

    const depQueries = h.queries.filter((q) => q.pid === 'DEP');
    expect(depQueries).toHaveLength(1);
    expect(depQueries[0].opts).toEqual({ mcVersion: MC, loader: 'fabric' });
  });

  /**
   * 资源包 / 光影包与加载器**无关**。硬套 `loaders=["fabric"]` 会把本来能下成的
   * 资源包变成「找不到版本」—— 所以这两类只按 MC 版本过滤。
   */
  it('资源包不按加载器过滤（只看 MC 版本）', async () => {
    const RP = ver({ id: 'v-rp', project_id: 'RP', filename: 'textures.zip' });
    h.versions.set('RP', (o) => (o.loader === undefined ? [RP] : []));

    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_RP',
      targetInstance: INSTANCE,
      contentKind: 'resourcepack',
    });

    expect(res.ok).toBe(true);
    expect(h.queries.find((q) => q.pid === 'RP')?.opts).toEqual({ mcVersion: MC });
    expect(existsSync(join(gameDir(), 'resourcepacks', 'textures.zip'))).toBe(true);
  });

  it('实例查不到时退回"不过滤"，不因为筛选条件把下载弄失败', async () => {
    const ROOT = ver({ id: 'v-root', project_id: 'ROOT', filename: 'root.jar' });
    h.versions.set('ROOT', () => [ROOT]);

    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_ROOT',
      targetInstance: '不存在的实例',
      contentKind: 'mod',
    });

    expect(res.ok).toBe(true);
    expect(h.queries.find((q) => q.pid === 'ROOT')?.opts).toEqual({});
  });
});

describe('数据包分类：要拿到数据包构建，不要 mod 构建', () => {
  /**
   * 实测（2026-10）：`Dungeons and Taverns` 最新版 `6.0.2+mod` 是 `.jar`，
   * 数据包版是 `6.0.2` 的 `.zip`。按最新版下 → jar 进 `datapacks/` → 游戏不读。
   */
  it('按 datapack 过滤后落盘的是 .zip，落点在世界的 datapacks/', async () => {
    const DP_ZIP = ver({
      id: 'v-dp-zip',
      project_id: 'DP',
      filename: 'Dungeons and Taverns v6.0.2.zip',
      loaders: ['datapack'],
    });
    const DP_MOD = ver({
      id: 'v-dp-mod',
      project_id: 'DP',
      filename: 'Dungeons and Taverns v6.0.2+mod.jar',
      loaders: ['neoforge'],
    });
    h.versions.set('DP', (o) =>
      o.loader === 'datapack' && o.mcVersion === MC ? [DP_ZIP] : [DP_MOD],
    );

    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_DP',
      targetInstance: INSTANCE,
      contentKind: 'datapack',
      world: '新世界',
    });

    expect(res.ok).toBe(true);
    const dir = join(gameDir(), 'saves', '新世界', 'datapacks');
    expect(readdirSync(dir)).toEqual(['Dungeons and Taverns v6.0.2.zip']);
    expect(h.queries.find((q) => q.pid === 'DP')?.opts).toEqual({
      mcVersion: MC,
      loader: 'datapack',
    });
  });

  it('这个项目只有 mod 构建时：明确报错，不往世界目录里塞 jar', async () => {
    const DP_MOD = ver({
      id: 'v-dp-mod',
      project_id: 'ONLYMOD',
      filename: 'only-mod.jar',
      loaders: ['neoforge'],
    });
    h.versions.set('ONLYMOD', (o) => (o.loader === 'datapack' ? [] : [DP_MOD]));

    // 换一个没被别的用例碰过的世界名：世界目录是递归创建的，
    // 用同一个名字会分不清"没建"和"上一条用例建过"。
    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'mr_ONLYMOD',
      targetInstance: INSTANCE,
      contentKind: 'datapack',
      world: '没装过数据包的世界',
    });

    expect(res.ok).toBe(false);
    expect(res.error).toContain('数据包');
    expect(existsSync(join(gameDir(), 'saves', '没装过数据包的世界'))).toBe(false);
  });
});
