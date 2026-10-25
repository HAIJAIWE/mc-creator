// @vitest-environment node
/**
 * 整合包装进**哪个目录** —— 一条真机上真发生过的错位（2026-10-18 实测）。
 *
 * 现象：装 Fabulously Optimized（MC 26.3）之后
 *
 * - 注册表里建出来的实例叫「Fabulously Optimized」，`gameDir` 是
 *   `game/Fabulously Optimized/`（实例名 = 显示名 = 目录名，多实例）；
 * - 而清单里的 49 个文件 + 下载账本全被写进了 `game/26.3/` —— 那是拿
 *   **MC 版本号当实例 id** 现算出来的目录。
 *
 * 用户点「开始游戏」进的是前者：一个 mod 都没有。账本也落在了没有实例读的
 * 地方，于是「从搜索页下同一个 mod 会替换旧文件」在整合包实例上根本不生效。
 *
 * 所以这里钉的不是「某个路径能算出来」，而是「清单落在实例记录里的 gameDir」：
 * 前者正是出 bug 的那份逻辑。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModrinthProject, ModrinthVersion } from '@mc-creator/core';

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
 * 假 Modrinth 客户端 —— 只实现清单「降级到 API」那条路用到的方法。
 *
 * 故意让 pack 的 `files` 为空：handler 会跳过 `.mrpack`（那要真 zip），直接走
 * `buildModpackManifestFromApi`。这里要钉的是**落盘目录**，不是清单解析
 * （清单解析有自己的用例，见 core `modrinth/modpack.test.ts`）。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();
  const { createHash } = await import('node:crypto');
  const sha1 = createHash('sha1').update('AAA').digest('hex');

  const PROJ = {
    id: 'p1',
    slug: 'x',
    title: '测试模组',
    description: '',
    body: '',
    icon_url: null,
    categories: [],
    downloads: 1,
    followers: 1,
    project_type: 'mod',
    game_versions: ['26.3'],
    loaders: ['fabric'],
    versions: ['v1'],
    wiki_url: null,
    source_url: null,
    issues_url: null,
    discord_url: null,
    donation_urls: [],
    published: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    client_side: 'required',
    server_side: 'optional',
    team: 't1',
  };

  const PROJ_B = {
    ...PROJ,
    id: 'p2',
    slug: 'y',
    title: '旧版独有模组',
  };

  /** 清单里的那一个 mod 文件。 */
  const MOD_VERSION = {
    id: 'v1',
    project_id: 'p1',
    version_number: '1.0.0',
    name: '1.0.0',
    game_versions: ['26.3'],
    loaders: ['fabric'],
    files: [
      {
        url: 'https://cdn.modrinth.com/data/p1/versions/v1/a.jar',
        filename: 'a.jar',
        primary: true,
        size: 3,
        hashes: { sha1 },
      },
    ],
    date_published: '2026-01-01T00:00:00Z',
  };

  /** 只在旧版整合包里出现的文件，用来钉「升级后清理」。 */
  const MOD_VERSION_B = {
    id: 'v2',
    project_id: 'p2',
    version_number: '2.0.0',
    name: '2.0.0',
    game_versions: ['26.3'],
    loaders: ['fabric'],
    files: [
      {
        url: 'https://cdn.modrinth.com/data/p2/versions/v2/b.jar',
        filename: 'b.jar',
        primary: true,
        size: 3,
        hashes: { sha1: createHash('sha1').update('BBB').digest('hex') },
      },
    ],
    date_published: '2026-01-01T00:00:00Z',
  };

  /** 整合包版本本身：embedded 依赖 + fabric/26.3。 */
  const PACK = {
    id: 'pv1',
    project_id: 'pack1',
    version_number: '9.9',
    name: '9.9',
    game_versions: ['26.3'],
    loaders: ['fabric'],
    files: [],
    dependencies: [{ version_id: 'v1', project_id: 'p1', dependency_type: 'embedded' }],
    date_published: '2026-01-01T00:00:00Z',
  };

  /** 同一个整合包的旧版：比 PACK 多一个 b.jar。 */
  const PACK_OLD = {
    ...PACK,
    id: 'pv-old',
    version_number: '9.8',
    dependencies: [
      { version_id: 'v1', project_id: 'p1', dependency_type: 'embedded' },
      { version_id: 'v2', project_id: 'p2', dependency_type: 'embedded' },
    ],
  };

  class FakeModrinthApiClient {
    async getVersion(versionId: string): Promise<ModrinthVersion> {
      return (versionId === 'pv-old' ? PACK_OLD : PACK) as unknown as ModrinthVersion;
    }
    async getVersionsByIds(ids: string[]): Promise<Map<string, ModrinthVersion>> {
      const all = new Map([
        ['v1', MOD_VERSION as unknown as ModrinthVersion],
        ['v2', MOD_VERSION_B as unknown as ModrinthVersion],
      ]);
      return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!]));
    }
    async getProjectsByIds(ids: string[]): Promise<Map<string, ModrinthProject>> {
      const all = new Map([
        ['p1', PROJ as unknown as ModrinthProject],
        ['p2', PROJ_B as unknown as ModrinthProject],
      ]);
      return new Map(ids.filter((id) => all.has(id)).map((id) => [id, all.get(id)!]));
    }
  }

  return {
    ...actual,
    ModrinthApiClient: FakeModrinthApiClient as unknown as typeof actual.ModrinthApiClient,
  };
});

/**
 * 只替掉联网的那部分 `LauncherService`（客户端 / 资源 / 库 / 加载器）。
 * `resolveInside` 等纯函数保留原件 —— 路径守卫要测原件才有意义。
 */
vi.mock('./launcher-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./launcher-service.js')>();
  class FakeLauncherService {
    /** 老实现「按实例 id 现算目录」。修复后**不该再被调用**。 */
    gameDir(id: string): string {
      return join(h.userData, 'mc-launcher', 'game', id);
    }
    async resolveVersion(): Promise<unknown> {
      return { id: '26.3' };
    }
    async downloadClient(): Promise<void> {}
    async downloadAssets(): Promise<void> {}
    async downloadLibraries(): Promise<void> {}
    async isLoaderInstalled(): Promise<boolean> {
      return true;
    }
  }
  return {
    ...actual,
    LauncherService: FakeLauncherService as unknown as typeof actual.LauncherService,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import { InstanceRegistry } from './instance-registry.js';
import { LAUNCHER_CANCEL_MODPACK, LAUNCHER_INSTALL_MODPACK } from '../shared/ipc-channels.js';

interface InstallRes {
  ok: boolean;
  instanceId?: string;
  gameDir?: string;
  installed?: number;
  failed?: Array<{ name: string; error: string | null }>;
  cancelled?: boolean;
  error?: string | null;
}

/** 走真实的 handler（含真实的 `installModpackFiles` 与账本）。 */
async function install(instanceName: string, versionId = 'pv1'): Promise<InstallRes> {
  const fn = h.handlers.get(LAUNCHER_INSTALL_MODPACK);
  expect(fn).toBeDefined();
  return (await fn!(
    { sender: { send: () => undefined } },
    { modId: 'mr_pack1', versionId, instanceName },
  )) as InstallRes;
}

const baseDir = (): string => join(h.userData, 'mc-launcher');

beforeEach(() => {
  h.handlers.clear();
  h.userData = mkdtempSync(join(tmpdir(), 'mp-target-'));
  registerLauncherHandlers();
  // 只放行清单里的文件：别的地址一律 404 —— 证明安装没偷偷去别处要东西
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input);
    if (url.endsWith('/a.jar')) return new Response('AAA', { status: 200 });
    if (url.endsWith('/b.jar')) return new Response('BBB', { status: 200 });
    return new Response('nope', { status: 404 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(h.userData, { recursive: true, force: true });
});

describe('LAUNCHER_INSTALL_MODPACK · 装到实例记录里的目录', () => {
  it('文件与账本落在 game/<实例名>，不是 game/<MC 版本号>', async () => {
    const res = await install('Fabulously Optimized');
    // 清单里的文件必须全部装上（这里只有 a.jar）。`failed` 里会有一条
    // 「未能读取 .mrpack，overrides 不会安装」—— 那是走 API 降级路径的诚实提示，
    // 不是安装失败。
    expect(res.failed?.some((f) => f.name === 'a.jar')).toBe(false);
    expect(res.ok, res.error ?? '').toBe(true);
    expect(res.instanceId).toBe('Fabulously Optimized');
    expect(res.gameDir).toBe(join(baseDir(), 'game', 'Fabulously Optimized'));

    const instanceDir = join(baseDir(), 'game', 'Fabulously Optimized');
    expect(readFileSync(join(instanceDir, 'mods', 'a.jar'), 'utf-8')).toBe('AAA');

    // 就是这条曾经红：`game/26.3/` 是拿版本号现算出来的空壳，没有实例读它
    expect(existsSync(join(baseDir(), 'game', '26.3'))).toBe(false);

    // 账本必须跟着实例走 —— 否则「再从搜索页下同一个 mod」不会替换
    const ledger = JSON.parse(
      readFileSync(join(instanceDir, '.mc-launcher-downloads.json'), 'utf-8'),
    ) as { files: Array<{ projectId: string; dir: string; name: string }> };
    expect(ledger.files).toEqual([
      expect.objectContaining({ projectId: 'mr_p1', dir: 'mods', name: 'a.jar' }),
    ]);
  });

  it('同名同版本 = 重装：复用同一个实例，不产生 (2)', async () => {
    const first = await install('Fabulously Optimized');
    const second = await install('Fabulously Optimized');
    expect(second.instanceId).toBe(first.instanceId);
    expect(new InstanceRegistry(baseDir()).list().map((i) => i.id)).toEqual([
      'Fabulously Optimized',
    ]);
  });

  it('同名但版本不同：另起 (2)，旧实例的记录与目录都原样不动', async () => {
    // 用户之前给 1.21.1 建过一个同名实例
    const registry = new InstanceRegistry(baseDir());
    const old = registry.create({ versionId: '1.21.1', name: 'Fabulously Optimized' });
    const oldDir = old.gameDir;
    if (!oldDir) throw new Error('create() 应当写入默认 gameDir');

    const res = await install('Fabulously Optimized');
    expect(res.instanceId).toBe('Fabulously Optimized (2)');

    const after = registry.get('Fabulously Optimized');
    expect(after?.versionId).toBe('1.21.1');
    expect(after?.gameDir).toBe(oldDir);
    expect(existsSync(join(oldDir, 'mods'))).toBe(false);
    expect(existsSync(join(baseDir(), 'game', 'Fabulously Optimized (2)', 'mods', 'a.jar'))).toBe(
      true,
    );
  });

  it('升级同包新版本：清理旧版独有文件，手动文件不动', async () => {
    // 旧版 9.8 带 b.jar；新版 9.9 的清单里只剩 a.jar
    const first = await install('升级清理', 'pv-old');
    expect(first.ok, first.error ?? '').toBe(true);
    const instanceDir = join(baseDir(), 'game', '升级清理');
    expect(readFileSync(join(instanceDir, 'mods', 'a.jar'), 'utf-8')).toBe('AAA');
    expect(readFileSync(join(instanceDir, 'mods', 'b.jar'), 'utf-8')).toBe('BBB');

    // 用户自己丢进 mods 的 jar 不能被当成「旧版文件」清掉
    writeFileSync(join(instanceDir, 'mods', 'user.jar'), 'USER');

    const second = await install('升级清理');
    expect(second.ok, second.error ?? '').toBe(true);
    expect(existsSync(join(instanceDir, 'mods', 'a.jar'))).toBe(true);
    expect(existsSync(join(instanceDir, 'mods', 'b.jar'))).toBe(false);
    expect(readFileSync(join(instanceDir, 'mods', 'user.jar'), 'utf-8')).toBe('USER');

    const ledger = JSON.parse(
      readFileSync(join(instanceDir, '.mc-launcher-downloads.json'), 'utf-8'),
    ) as { files: Array<{ name: string; packId?: string }> };
    expect(ledger.files.some((f) => f.name === 'b.jar')).toBe(false);
    expect(ledger.files.some((f) => f.name === 'a.jar' && f.packId === 'mr_pack1')).toBe(true);
  });

  it('安装中可以取消：返回 cancelled，停止下载，并且之后可以重新发起', async () => {
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });

    // 文件请求挂住，直到取消信号把它 reject —— 这才是真机上「点了取消」的时刻
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/a.jar')) {
        started();
        await new Promise<never>((_resolve, reject) => {
          const signal = init?.signal;
          const onAbort = (): void => reject(new DOMException('Aborted', 'AbortError'));
          if (signal?.aborted) onAbort();
          else signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
      return new Response('nope', { status: 404 });
    });

    const installFn = h.handlers.get(LAUNCHER_INSTALL_MODPACK);
    const cancelFn = h.handlers.get(LAUNCHER_CANCEL_MODPACK);
    expect(installFn).toBeDefined();
    expect(cancelFn).toBeDefined();

    const sender = { sender: { send: () => undefined } };
    const pending = installFn!(sender, {
      modId: 'mr_pack1',
      versionId: 'pv1',
      instanceName: '取消也保留',
    }) as Promise<InstallRes>;
    await startedPromise;

    const cancelRes = (await cancelFn!(sender, {
      modId: 'mr_pack1',
      versionId: 'pv1',
    })) as { ok: boolean; cancelled?: boolean };
    expect(cancelRes).toMatchObject({ ok: true, cancelled: true });

    const res = await pending;
    expect(res.cancelled).toBe(true);
    expect(res.instanceId).toBe('取消也保留');
    expect(res.installed).toBe(0);
    expect(res.failed).toEqual([]);
    expect(existsSync(join(baseDir(), 'game', '取消也保留', 'mods', 'a.jar'))).toBe(false);

    // 取消后 map 必须释放，否则这个整合包会永远显示「正在安装」
    const again = (await cancelFn!(sender, {
      modId: 'mr_pack1',
      versionId: 'pv1',
    })) as { ok: boolean };
    expect(again.ok).toBe(false);
  });
});
