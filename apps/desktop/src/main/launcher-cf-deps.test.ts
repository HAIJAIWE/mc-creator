/**
 * CurseForge 下载时的**前置提示**用例。
 *
 * ## 为什么需要这一组
 *
 * 老实现把 CF 依赖的「必需 / 可选」标记整个丢掉了（客户端
 * `dependencies.map((d) => d.modId)`），于是两条路都出错：
 *
 *  1. **列表行下载**：把**每条**依赖都报成"缺前置会导致启动失败"。实测 JEI 26.3
 *     的依赖是 `MezzConfig`（3=必需）与 `MezzConfigGUI`（2=可选）—— 用户一装
 *     JEI 就被吓一跳，说还缺两个前置。
 *  2. **详情页那一行（按 URL 下载）**：对**每次** CF 下载都固定喊一句
 *     「前置需手动安装」，连一个依赖都没有的 mod 也照喊 —— 因为那时候手上只有
 *     URL，根本没法核对。
 *
 * 现在：`relationType=3` 才算前置；URL 路靠 CF 自己的地址约定反推文件 id
 * （`/files/{去尾三位}/{尾三位}/…`，实测六个样本全中）再问一次源站。
 *
 * 断言走**真 handler + 真 core 判定函数**：只 mock 源站客户端与 `fetch`，
 * 落盘与依赖判定都是真的。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
  /** 每次 getFilesByIds 收到的 id 列表（用来钉 URL 反推出来的那个 id）。 */
  filesByIdsCalls: [] as number[][],
  /** 每次 getMod 收到的 id（提示文案要不要查名字）。 */
  getModCalls: [] as number[],
  fetchMock: null as unknown as ReturnType<typeof vi.fn>,
  /** 测试可以覆盖「源站现在给哪个文件」（模拟源站发了新构建）。 */
  projectFiles: {} as Record<number, unknown[]>,
  /** 测试可以覆盖「某个文件 id 长什么样」。 */
  byId: {} as Record<number, unknown>,
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
 * 只换掉 CurseForge 客户端（`importOriginal` 保留其余实现 —— 特别是
 * `requiredDependencyIds` / `curseforgeFileIdFromUrl`，这两个正是被测的判定）。
 *
 * 数据按**线上实测形状**抄（JEI 238222，2026-10-17 走 MCIM 镜像）：
 * 文件级依赖是 `[{modId, relationType}]`，1 条必需（MezzConfig）+ 1 条可选
 * （MezzConfigGUI）。
 */
vi.mock('@mc-creator/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mc-creator/core')>();

  const JEI_NEOFORGE = {
    id: 9221721,
    displayName: '31.15.0.79 for NeoForge 26.3',
    fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
    fileLength: 4, // 与假 fetch 的 4 字节对齐（体积校验是真的会拦人的）
    downloadUrl: 'https://edge.forgecdn.net/files/9221/721/jei-26.3-neoforge-31.15.0.79.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['NeoForge'],
    fileDate: '2026-10-15T17:51:37.020Z',
    releaseType: 2,
    dependencies: [
      { modId: 1689768, relationType: 3 }, // MezzConfig：必需
      { modId: 1700987, relationType: 2 }, // MezzConfigGUI：可选
    ],
  };

  /** 一个**没有任何依赖**的文件（老实现在 URL 路上也会喊"前置需手动安装"）。 */
  const LONE = {
    id: 10000005, // 尾三位带前导零的 id：/files/10000/005/…
    displayName: '1.0 for NeoForge 26.3',
    fileName: 'lone-1.0.jar',
    fileLength: 4,
    downloadUrl: 'https://edge.forgecdn.net/files/10000/005/lone-1.0.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['NeoForge'],
    fileDate: '2026-10-15T17:51:37.020Z',
    releaseType: 1,
    dependencies: [],
  };

  /**
   * JEI 的**下一个构建**由测试自己临时替换（`h.projectFiles`）—— 见「同一项目换
   * 版本」那条用例：源站发新构建时文件名会变，必须靠账本删掉旧的那份。
   */

  const BY_ID: Record<number, unknown> = {
    [JEI_NEOFORGE.id]: JEI_NEOFORGE,
    [LONE.id]: LONE,
  };
  const BY_PROJECT: Record<number, unknown[]> = {
    238222: [JEI_NEOFORGE],
    424242: [LONE],
  };
  const NAMES: Record<number, string> = {
    1689768: 'MezzConfig',
    1700987: 'MezzConfigGUI',
  };

  class FakeCurseForgeApiClient {
    async getFiles(modId: number): Promise<unknown[]> {
      // 测试可以临时改「源站现在给哪个文件」（模拟旧构建被新构建顶掉）
      return h.projectFiles[modId] ?? BY_PROJECT[modId] ?? [];
    }
    async getFilesByIds(ids: number[]): Promise<Map<number, unknown>> {
      h.filesByIdsCalls.push(ids);
      const out = new Map<number, unknown>();
      for (const id of ids) {
        const f = h.byId[id] ?? BY_ID[id];
        if (f !== undefined) out.set(id, f);
      }
      return out;
    }
    async getMod(modId: number): Promise<unknown> {
      h.getModCalls.push(modId);
      return { id: modId, name: NAMES[modId] ?? `Project ${modId}` };
    }
  }

  return {
    ...actual,
    CurseForgeApiClient: FakeCurseForgeApiClient as unknown as typeof actual.CurseForgeApiClient,
  };
});

import { registerLauncherHandlers } from './ipc/launcher.js';
import { InstanceRegistry } from './instance-registry.js';
import { LAUNCHER_DOWNLOAD_MOD, LAUNCHER_DOWNLOAD_URL } from '../shared/ipc-channels.js';

const INSTANCE = 'cf-deps-instance';
const MC = '26.3';

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
  h.userData = mkdtempSync(join(tmpdir(), 'mc-cf-deps-'));
  // ⚠️ fetch 替身必须在 registerLauncherHandlers **之前**装：handler 构造的
  // LauncherService 会把当时的全局 fetch 固定下来（同 launcher-deps-compat）。
  h.fetchMock = vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(4),
      text: async () => '',
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', h.fetchMock);
  registerLauncherHandlers();
  new InstanceRegistry(join(h.userData, 'mc-launcher')).create({
    versionId: MC,
    name: INSTANCE,
    loader: 'neoforge',
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  rmSync(h.userData, { recursive: true, force: true });
});

beforeEach(() => {
  h.filesByIdsCalls.length = 0;
  h.getModCalls.length = 0;
  h.projectFiles = {};
  h.byId = {};
  h.fetchMock.mockClear();
});

describe('CF 列表行下载（LAUNCHER_DOWNLOAD_MOD）的前置提示', () => {
  it('只报必需前置，可选的 MezzConfigGUI 不报；jar 真的落盘', async () => {
    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'cf_238222',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });

    expect(res.error ?? null).toBeNull();
    expect(res.ok).toBe(true);
    expect(res.missingDependencies).toEqual(['MezzConfig（cf:1689768）']);
    expect(existsSync(join(gameDir(), 'mods', 'jei-26.3-neoforge-31.15.0.79.jar'))).toBe(true);
    // 名字是真的查过的（不是硬拼 id）
    expect(h.getModCalls).toContain(1689768);
  });

  it('一个依赖都没有时**不**报前置（老实现会报"需手动安装"）', async () => {
    const res = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'cf_424242',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });

    expect(res.ok).toBe(true);
    expect(res.missingDependencies).toBeUndefined();
    expect(existsSync(join(gameDir(), 'mods', 'lone-1.0.jar'))).toBe(true);
  });

  /**
   * 源站发新构建时**旧 jar 必须被删掉**。
   *
   * 实测（2026-10-18）：JEI 的 `.79` 与 `.81` 两个 jar 并排躺在 `mods/` 里，
   * NeoForge 启动直接 `Duplicate mod` 拒启动 —— 用户看到的却是"下载成功"。
   * 换版本时文件名不同，光靠覆盖写盘救不了，得靠下载账本把旧的那份删掉。
   */
  it('同一项目换版本：旧的 .79 被删掉，只剩新的 .81（否则 Duplicate mod 拒启动）', async () => {
    const first = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'cf_238222',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });
    expect(first.ok).toBe(true);
    const modsDir = join(gameDir(), 'mods');
    expect(existsSync(join(modsDir, 'jei-26.3-neoforge-31.15.0.79.jar'))).toBe(true);

    // 源站现在给的是下一个构建（文件名不同）
    h.projectFiles[238222] = [
      {
        id: 9222000,
        displayName: '31.15.0.81 for NeoForge 26.3',
        fileName: 'jei-26.3-neoforge-31.15.0.81.jar',
        fileLength: 4,
        downloadUrl: 'https://edge.forgecdn.net/files/9222/000/jei-26.3-neoforge-31.15.0.81.jar',
        gameVersions: ['26.3'],
        modLoaderNames: ['NeoForge'],
        fileDate: '2026-10-18T09:16:28.000Z',
        releaseType: 1,
        dependencies: [],
      },
    ];

    const second = await invoke(LAUNCHER_DOWNLOAD_MOD, {
      modId: 'cf_238222',
      targetInstance: INSTANCE,
      contentKind: 'mod',
    });
    expect(second.ok).toBe(true);

    // 只有新构建留下（其余文件：前面用例下的 lone-1.0.jar 是别的项目，不该被牵连）
    const jei = readdirSync(modsDir).filter((f) => f.startsWith('jei-'));
    expect(jei).toEqual(['jei-26.3-neoforge-31.15.0.81.jar']);
    expect(existsSync(join(modsDir, 'lone-1.0.jar'))).toBe(true);
  });
});

describe('CF 详情页按 URL 下载（LAUNCHER_DOWNLOAD_URL）的前置提示', () => {
  it('从下载地址反推文件 id（9221/721 → 9221721）再核对必需前置', async () => {
    const res = await invoke(LAUNCHER_DOWNLOAD_URL, {
      url: 'https://edge.forgecdn.net/files/9221/721/jei-26.3-neoforge-31.15.0.79.jar',
      filename: 'jei-26.3-neoforge-31.15.0.79.jar',
      targetInstance: INSTANCE,
      contentKind: 'mod',
      modId: 'cf_238222',
    });

    expect(res.ok).toBe(true);
    expect(h.filesByIdsCalls).toEqual([[9221721]]);
    expect(res.missingDependencies).toEqual(['MezzConfig（cf:1689768）']);
  });

  it('尾三位带前导零的地址也算得对（10000/005 → 10000005），且无依赖就静默', async () => {
    const res = await invoke(LAUNCHER_DOWNLOAD_URL, {
      url: 'https://edge.forgecdn.net/files/10000/005/lone-1.0.jar',
      filename: 'lone-1.0.jar',
      targetInstance: INSTANCE,
      contentKind: 'mod',
      modId: 'cf_424242',
    });

    expect(res.ok).toBe(true);
    expect(h.filesByIdsCalls).toEqual([[10000005]]);
    expect(res.missingDependencies).toBeUndefined();
  });

  it('地址里没有 CF 文件 id 时如实说"未核对"，不猜也不假报缺前置', async () => {
    const res = await invoke(LAUNCHER_DOWNLOAD_URL, {
      url: 'https://cdn.example.com/whatever/x.jar',
      filename: 'x.jar',
      targetInstance: INSTANCE,
      contentKind: 'mod',
      modId: 'cf_238222',
    });

    expect(res.ok).toBe(true);
    expect(res.missingDependencies).toEqual(['（下载地址里没有 CurseForge 文件 id，前置未核对）']);
  });
});
