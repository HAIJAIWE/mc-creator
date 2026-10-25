/**
 * 在线模组搜索/下载通道的**接线**测试。
 *
 * 曾经的坑：`LAUNCHER_SEARCH_MODS` handler 写在 `registerLauncherHandlers()`
 * 里但从未被调用过(或注册在了错误的位置)，结果渲染层 invoke 时 Electron
 * 抛 `No handler registered for 'launcher:searchMods'` —— 而 typecheck /
 * lint / 单测全绿。这类"通道名对得上、代码看着也在"的断线，只有把
 * `ipcMain.handle` 收进 Map 再查键才能发现。
 *
 * 所以这个测试的断言刻意很薄：不测搜索逻辑(那是 service 层的事)，
 * 只测「`registerLauncherHandlers()` 之后，这两个通道确实有 handler」。
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
 * 只替换 Modrinth 客户端（`importOriginal` 保留其余一切）。
 *
 * 理由：搜索富化会**真的**打网络。这条用例要钉的是「源站返回的 loaders
 * 到了结果里剩下哪些」，那跟网络能不能通毫无关系 —— 得把源站换成假的。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();

  /**
   * 源站故意返回 **fabric / forge / quilt / neoforge 四个** —— 真实项目
   * （Sodium 之类）就是这样，项目级 loaders 是历史累积。
   *
   * 数据写在工厂**内部**：`vi.mock` 的工厂会被提升到文件顶部、在
   * `import './ipc/launcher.js'` 时就被调用，那时文件里的 `const` 还没执行
   * （引用外部 const 会 TDZ 报错）。
   */
  const HIT: ModrinthSearchHit = {
    project_id: 'p1',
    slug: 'sodium',
    title: 'Sodium',
    description: '渲染优化',
    icon_url: null,
    downloads: 1000,
    categories: ['optimization'],
    latest_version: 'v1',
    date_modified: '2026-01-01T00:00:00Z',
  };

  const PROJECT: ModrinthProject = {
    id: 'p1',
    slug: 'sodium',
    title: 'Sodium',
    description: '渲染优化',
    body: '',
    icon_url: null,
    categories: ['optimization'],
    downloads: 1000,
    followers: 1,
    project_type: 'mod',
    game_versions: ['1.21.1'],
    loaders: ['fabric', 'forge', 'quilt', 'neoforge'],
    versions: ['v1'],
    wiki_url: null,
    source_url: null,
    issues_url: null,
    discord_url: null,
    donation_urls: [],
    published: '2021-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    client_side: 'required',
    server_side: 'optional',
    team: 't1',
  };

  const VERSION: ModrinthVersion = {
    id: 'v1',
    project_id: 'p1',
    version_number: '0.6.0',
    name: '0.6.0',
    game_versions: ['1.21.1'],
    loaders: ['fabric', 'forge', 'quilt', 'neoforge'],
    files: [
      {
        url: 'https://example.com/sodium.jar',
        filename: 'sodium.jar',
        primary: true,
        size: 10,
      },
    ],
    date_published: '2026-01-01T00:00:00Z',
  };

  /** 只实现富化用到的那三个方法（搜索富化会真的打网络，这里换成假的）。 */
  class FakeModrinthApiClient {
    async search(): Promise<{ hits: ModrinthSearchHit[]; total: number }> {
      return { hits: [HIT], total: 1 };
    }
    async getProjectsByIds(): Promise<Map<string, ModrinthProject>> {
      return new Map([[HIT.project_id, PROJECT]]);
    }
    async getVersionsByIds(): Promise<Map<string, ModrinthVersion>> {
      return new Map([[VERSION.id, VERSION]]);
    }
  }

  return {
    ...actual,
    ModrinthApiClient: FakeModrinthApiClient as unknown as typeof actual.ModrinthApiClient,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import {
  LAUNCHER_SEARCH_MODS,
  LAUNCHER_DOWNLOAD_MOD,
  LAUNCHER_DOWNLOAD_URL,
  LAUNCHER_INSTALL_MODPACK,
} from '../shared/ipc-channels.js';
import { LauncherDownloadUrlRequest } from '../shared/ipc/launcher.js';
import type { ModrinthProject, ModrinthSearchHit, ModrinthVersion } from '@mc-creator/core';

beforeAll(() => {
  registerLauncherHandlers();
});

describe('在线模组搜索/下载 IPC 接线', () => {
  it('LAUNCHER_SEARCH_MODS 通道有 handler', () => {
    expect(h.handlers.has(LAUNCHER_SEARCH_MODS)).toBe(true);
  });

  it('LAUNCHER_DOWNLOAD_MOD 通道有 handler', () => {
    expect(h.handlers.has(LAUNCHER_DOWNLOAD_MOD)).toBe(true);
  });

  it('通道名与渲染层 invoke 的字符串一致', () => {
    // 硬编码字符串是故意的：这里要钉住的正是「主进程注册的键」与
    // 「preload/渲染层 invoke 的字面量」是同一个，防止有人改了常量值
    // 却只改了一侧。
    expect(LAUNCHER_SEARCH_MODS).toBe('launcher:searchMods');
    expect(LAUNCHER_DOWNLOAD_MOD).toBe('launcher:downloadMod');
  });

  it('搜索 handler 对 source 参数不挑剔：all / modrinth / curseforge 都能解析请求', async () => {
    const fn = h.handlers.get(LAUNCHER_SEARCH_MODS);
    expect(fn).toBeDefined();
    // 请求体验证失败会走 error 分支而不是抛出去；这里只验证 handler
    // 不因 source 字段崩溃(三种取值都应被 zod 接受)。
    for (const source of ['all', 'modrinth', 'curseforge'] as const) {
      const res = (await fn!(
        { sender: {} },
        {
          query: '',
          contentType: 'mod',
          source,
        },
      )) as { mods: unknown[]; error: string | null };
      expect(Array.isArray(res.mods)).toBe(true);
    }
  });
});

/**
 * 下载必须落到**目标实例**的 mods 目录。
 *
 * 曾经的坑：落盘写的是 `join(baseDir, 'mods')` —— 一个谁也不读的全局目录。
 * 下了等于没下，多实例还会互相串。这组用例钉住「目标实例是必填的」
 * 且「它必须能挡掉路径穿越」。
 */
describe('下载目标实例', () => {
  it('不给 targetInstance 就该被拒（不能静默落到某个默认目录）', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_MOD);
    expect(fn).toBeDefined();
    await expect(fn!({ sender: {} }, { modId: 'mr_sodium' })).rejects.toThrow();
  });

  it('targetInstance 为空串同样被拒', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_MOD);
    await expect(fn!({ sender: {} }, { modId: 'mr_sodium', targetInstance: '' })).rejects.toThrow();
  });

  it('LAUNCHER_DOWNLOAD_URL 也必须带 targetInstance', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_URL);
    expect(fn).toBeDefined();
    await expect(
      fn!({ sender: {} }, { url: 'https://example.com/a.jar', filename: 'a.jar' }),
    ).rejects.toThrow();
  });

  it('targetInstance 含路径穿越时不落到 baseDir 之外', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_URL);
    // 路径穿越是 handler **内部**被拦的（assertVersionId），所以是
    // 「ok:false + error」而不是 reject —— 渲染层能显示原因。
    const res = (await fn!(
      { sender: {} },
      {
        url: 'https://example.com/a.jar',
        filename: 'a.jar',
        targetInstance: '../../..',
      },
    )) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/版本|路径|非法/);
  });
});

/**
 * 整合包安装是**另一条通道**，不是下载通道加个参数。
 *
 * 曾经只有 `LAUNCHER_DOWNLOAD_MOD`，它的语义是「往已存在的实例塞一个 jar」。
 * 整合包要新建实例 + 装加载器 + 铺整份清单，`targetInstance` 在那一刻
 * 根本还不存在 —— 硬塞进同一条通道的结果只能是「装到某个说不清的实例」。
 */
/**
 * 内容类型决定落盘目录。
 *
 * 曾经的 bug：资源包 / 光影包 / 数据包一律落 `gameDir/mods/`，加载器会把它们
 * 当 mod 扫。这组用例钉住「datapack 没有世界名必须被拒」——
 * 因为原版**没有**实例级数据包目录，硬塞只会得到一个不生效的安装。
 */
describe('内容类型的落盘目录', () => {
  it('数据包不给 world 时被拒（不是默默塞进 mods/）', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_URL);
    const res = (await fn!(
      { sender: {} },
      {
        url: 'https://example.com/a.zip',
        filename: 'a.zip',
        targetInstance: '1.21.1',
        contentKind: 'datapack',
      },
    )) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/必须指定要装进哪个世界/);
  });

  it('LAUNCHER_DOWNLOAD_MOD 的数据包同样要求 world', async () => {
    const fn = h.handlers.get(LAUNCHER_DOWNLOAD_MOD);
    const res = (await fn!(
      { sender: {} },
      { modId: 'mr_abc', targetInstance: '1.21.1', contentKind: 'datapack' },
    )) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/必须指定要装进哪个世界/);
  });

  it('contentKind 缺省时按 mod 处理（向后兼容，但别依赖它）', () => {
    // 直接断言 schema 的缺省，不走 handler —— 走 handler 会发真实网络请求，
    // 那让这条用例变成「测网络能不能通」，与它要钉的东西无关。
    const parsed = LauncherDownloadUrlRequest.parse({
      url: 'https://example.com/a.jar',
      filename: 'a.jar',
      targetInstance: '1.21.1',
    });
    expect(parsed.contentKind).toBe('mod');
    // mod 不需要 world
    expect(parsed.world).toBeUndefined();
  });

  it('resourcepack / shader 也不需要 world（只有 datapack 要）', () => {
    for (const kind of ['resourcepack', 'shader', 'mod'] as const) {
      const parsed = LauncherDownloadUrlRequest.parse({
        url: 'https://example.com/a.zip',
        filename: 'a.zip',
        targetInstance: '1.21.1',
        contentKind: kind,
      });
      expect(parsed.contentKind).toBe(kind);
      expect(parsed.world).toBeUndefined();
    }
  });
});

describe('整合包安装通道', () => {
  it('LAUNCHER_INSTALL_MODPACK 通道有 handler', () => {
    expect(h.handlers.has(LAUNCHER_INSTALL_MODPACK)).toBe(true);
  });

  it('通道名与渲染层 invoke 的字符串一致', () => {
    expect(LAUNCHER_INSTALL_MODPACK).toBe('launcher:installModpack');
  });

  it('不传 versionId 就被拒（整合包几百个版本，「装哪一版」不能省）', async () => {
    const fn = h.handlers.get(LAUNCHER_INSTALL_MODPACK);
    expect(fn).toBeDefined();
    const res = (await fn!({ sender: {} }, { modId: 'mr_1KVo5zza' })) as { ok: boolean };
    expect(res.ok).toBe(false);
  });

  /**
   * 这条用例**曾经**钉的是「没 key 就当场拒」—— 那是 key 是前置条件时的正确行为。
   * 现在 key 不再是前置条件（走国内镜像时镜像自带 key，PCL 同款），所以改钉：
   * 没 key 也会**真的去试**，失败原因来自「镜像不通 + 官方要 key」这条组合，
   * 而不是一道在本地就把用户挡住的闸门。
   */
  it('CurseForge 整合包没配 key 时不再当场拒，而是真去走镜像', async () => {
    const realFetch = globalThis.fetch;
    const fetchSpy = vi.fn(async (url: string | URL) => {
      // 断言它真的尝试了镜像（而不是因为没 key 就一步没走）
      expect(String(url)).toContain('mod.mcimirror.top');
      throw new Error('模拟镜像不通');
    });
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const fn = h.handlers.get(LAUNCHER_INSTALL_MODPACK);
      const res = (await fn!({ sender: {} }, { modId: 'cf_123', versionId: '456' })) as {
        ok: boolean;
        error: string | null;
      };
      expect(res.ok).toBe(false);
      expect(fetchSpy).toHaveBeenCalled();
      expect(res.error ?? '').not.toMatch(/CurseForge 整合包需要 API Key/);
      // 镜像不通 && 没 key → 文案必须把两件事都说出来（否则用户不知道该改哪一头）
      expect(res.error ?? '').toMatch(/国内镜像/);
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
  });

  it('来源前缀不认识就拒，不猜', async () => {
    const fn = h.handlers.get(LAUNCHER_INSTALL_MODPACK);
    const res = (await fn!({ sender: {} }, { modId: 'zz_1', versionId: '2' })) as {
      ok: boolean;
      error: string | null;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/未知的来源前缀/);
  });
});

/**
 * 搜索富化会把源站给的 loaders 按**我们认的**加载器整形。
 *
 * 主进程这一层（`ipc/launcher.ts` 里两处 `pickLoaders`）和渲染层的筛选器、
 * 详情页的分组用的是**同一份清单**（`shared/play-loaders.ts`）。历史上
 * 三处各自手写、且当时恰好一致 —— 于是没有任何测试会红，这正是漂移最危险
 * 的形态。这条用例把「主进程这份也吃共享清单」变成可验证事实。
 *
 * 期望值刻意写**字面量**而不是引用那个常量：引用的话，往共享清单里加回
 * forge 会同时改掉两边，测试永远绿 —— 那就白测了。
 */
describe('搜索富化的加载器整形', () => {
  it('源站给 fabric/forge/quilt/neoforge → 结果里只剩 fabric + neoforge', async () => {
    const fn = h.handlers.get(LAUNCHER_SEARCH_MODS);
    expect(fn).toBeDefined();

    const res = (await fn!(
      { sender: {} },
      { query: 'sodium', contentType: 'mod', source: 'modrinth' },
    )) as { mods: Array<{ id: string; loaders: string[]; latestVersion?: string }> };

    const mod = res.mods.find((m) => m.id === 'mr_p1');
    expect(mod).toBeDefined();
    expect([...mod!.loaders].sort()).toEqual(['fabric', 'neoforge']);
    // 顺带证明富化真的跑通了 —— 否则「loaders 是空数组」也能让上面那条绿
    expect(mod!.latestVersion).toBe('0.6.0');
  });
});
