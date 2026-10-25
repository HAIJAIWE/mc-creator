/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain } from 'electron';
import { loadCurseForgeConfig, saveCurseForgeConfig } from '../credentials/curseforge-config.js';
import {
  createCurseForgeClient,
  createModrinthClient,
  createOfficialCurseForgeClient,
} from '../market-clients.js';
import { launcherDataDir } from '../launcher-dir.js';
import { sourcePreferenceStore } from '../download-sources.js';
import {
  MODRINTH_SEARCH,
  MODRINTH_VERSIONS,
  ModrinthSearchRequest,
  ModrinthVersionsRequest,
  CURSEFORGE_SEARCH,
  CURSEFORGE_FILES,
  CURSEFORGE_TEST_KEY,
  LOAD_CURSEFORGE_CONFIG,
  SAVE_CURSEFORGE_CONFIG,
  LOAD_SOURCE_PREFERENCE,
  SAVE_SOURCE_PREFERENCE,
  SourcePreferenceSchema,
  CurseForgeSearchRequest,
  CurseForgeFilesRequest,
  CurseForgeConfigSchema,
  CurseForgeTestKeyRequest,
  type CurseForgeTestKeyRes,
  type ModrinthSearchRes,
  type ModrinthVersionsRes,
  type CurseForgeSearchRes,
  type CurseForgeFilesRes,
} from '../../shared/ipc-channels.js';

export function registerMarketHandlers(): void {
  // === Modrinth 搜索（P25）：主进程转发 API 调用，避免渲染进程 CORS ===
  // 客户端**每个请求现造**（见 market-clients.ts）：根地址顺序来自下载源偏好，
  // 设置页改完立刻就生效，不留一个拿着旧偏好的长命实例。
  ipcMain.handle(MODRINTH_SEARCH, async (_e, raw: unknown): Promise<ModrinthSearchRes> => {
    const req = ModrinthSearchRequest.parse(raw);
    const searchOpts: { loader?: string; mcVersion?: string; limit?: number } = {
      limit: req.limit,
    };
    if (req.loader !== undefined) searchOpts.loader = req.loader;
    if (req.mcVersion !== undefined) searchOpts.mcVersion = req.mcVersion;
    const { hits } = await createModrinthClient().search(req.query, searchOpts);
    return { hits };
  });

  ipcMain.handle(MODRINTH_VERSIONS, async (_e, raw: unknown): Promise<ModrinthVersionsRes> => {
    const req = ModrinthVersionsRequest.parse(raw);
    const versionOpts: { loader?: string; mcVersion?: string } = {};
    if (req.loader !== undefined) versionOpts.loader = req.loader;
    if (req.mcVersion !== undefined) versionOpts.mcVersion = req.mcVersion;
    const versions = await createModrinthClient().getVersions(req.projectId, versionOpts);
    return { versions };
  });

  // === CurseForge 搜索（P29：与 P25 Modrinth 共同构成资源市场） ===
  // 每次调用从 config 读 apiKey → 现造 client。
  // ⚠️ **key 不是必需的了**：走国内镜像时镜像自带 key（PCL 就是这样），
  // 没配 key 的请求会跳过官方根落到镜像。候选顺序仍由「下载源」决定：
  // 镜像优先时用的是镜像的 key；只有轮到官方根时才带用户自己的 key，
  // 而且 key **不会**发给镜像（见 CurseForgeApiClient 的头注释）。
  ipcMain.handle(LOAD_CURSEFORGE_CONFIG, async () => {
    return loadCurseForgeConfig();
  });

  ipcMain.handle(SAVE_CURSEFORGE_CONFIG, async (_e, raw: unknown) => {
    const req = CurseForgeConfigSchema.parse(raw);
    // 去掉粘贴时常见的首尾空白：多一个空格会让官方 403，而且肉眼看不出来
    await saveCurseForgeConfig({ apiKey: req.apiKey.trim() });
    return { ok: true };
  });

  ipcMain.handle(CURSEFORGE_TEST_KEY, async (_e, raw: unknown): Promise<CurseForgeTestKeyRes> => {
    try {
      const req = CurseForgeTestKeyRequest.parse(raw);
      const apiKey = req.apiKey.trim();
      if (apiKey === '') return { ok: false, error: 'API Key 为空' };
      // 强制官方根：镜像优先时测镜像的 key 等于没测。这只是验证，不保存。
      const client = createOfficialCurseForgeClient(apiKey);
      await client.search('sodium', { limit: 1 });
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle(CURSEFORGE_SEARCH, async (_e, raw: unknown): Promise<CurseForgeSearchRes> => {
    const req = CurseForgeSearchRequest.parse(raw);
    const client = createCurseForgeClient();
    const searchOpts: { loader?: string; mcVersion?: string; limit?: number; sort: 'relevance' } = {
      limit: req.limit,
      // 面板自己会在客户端再排序（`CurseForgeSearchPanel` 的 sortBy），
      // 但"保持原顺序"那一档靠的就是源站顺序 —— 不传 `sortField` 时
      // CF 返回的顺序等于没排（见 `SORT_FIELDS`），所以这里按相关度要一份。
      sort: 'relevance',
    };
    if (req.loader !== undefined) searchOpts.loader = req.loader;
    if (req.mcVersion !== undefined) searchOpts.mcVersion = req.mcVersion;
    const { hits } = await client.search(req.query, searchOpts);
    return { hits };
  });

  ipcMain.handle(CURSEFORGE_FILES, async (_e, raw: unknown): Promise<CurseForgeFilesRes> => {
    const req = CurseForgeFilesRequest.parse(raw);
    const client = createCurseForgeClient();
    const fileOpts: { loader?: string; mcVersion?: string } = {};
    if (req.loader !== undefined) fileOpts.loader = req.loader;
    if (req.mcVersion !== undefined) fileOpts.mcVersion = req.mcVersion;
    const files = await client.getFiles(req.modId, fileOpts);
    return { files };
  });

  // === 下载源偏好（官方源 / 国内镜像） ===
  ipcMain.handle(LOAD_SOURCE_PREFERENCE, async () => {
    return sourcePreferenceStore(launcherDataDir()).read();
  });

  ipcMain.handle(SAVE_SOURCE_PREFERENCE, async (_e, raw: unknown) => {
    const pref = SourcePreferenceSchema.parse(raw);
    // 共享实例：写完之后 `LauncherService` 那边下一次下载就读到新顺序
    sourcePreferenceStore(launcherDataDir()).write(pref);
    return { ok: true };
  });
}
