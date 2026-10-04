/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain } from 'electron';
import { ModrinthApiClient, CurseForgeApiClient } from '@mc-creator/core';
import { loadCurseForgeConfig, saveCurseForgeConfig } from '../curseforge-config.js';
import {
  MODRINTH_SEARCH,
  MODRINTH_VERSIONS,
  ModrinthSearchRequest,
  ModrinthVersionsRequest,
  CURSEFORGE_SEARCH,
  CURSEFORGE_FILES,
  LOAD_CURSEFORGE_CONFIG,
  SAVE_CURSEFORGE_CONFIG,
  CurseForgeSearchRequest,
  CurseForgeFilesRequest,
  CurseForgeConfigSchema,
  type ModrinthSearchRes,
  type ModrinthVersionsRes,
  type CurseForgeSearchRes,
  type CurseForgeFilesRes,
} from '../../shared/ipc-channels.js';

export function registerMarketHandlers(): void {
  // === Modrinth 搜索（P25）：主进程转发 API 调用，避免渲染进程 CORS ===
  const modrinthClient = new ModrinthApiClient();

  ipcMain.handle(MODRINTH_SEARCH, async (_e, raw: unknown): Promise<ModrinthSearchRes> => {
    const req = ModrinthSearchRequest.parse(raw);
    const searchOpts: { loader?: string; mcVersion?: string; limit?: number } = {
      limit: req.limit,
    };
    if (req.loader !== undefined) searchOpts.loader = req.loader;
    if (req.mcVersion !== undefined) searchOpts.mcVersion = req.mcVersion;
    const hits = await modrinthClient.search(req.query, searchOpts);
    return { hits };
  });

  ipcMain.handle(MODRINTH_VERSIONS, async (_e, raw: unknown): Promise<ModrinthVersionsRes> => {
    const req = ModrinthVersionsRequest.parse(raw);
    const versionOpts: { loader?: string; mcVersion?: string } = {};
    if (req.loader !== undefined) versionOpts.loader = req.loader;
    if (req.mcVersion !== undefined) versionOpts.mcVersion = req.mcVersion;
    const versions = await modrinthClient.getVersions(req.projectId, versionOpts);
    return { versions };
  });

  // === CurseForge 搜索（P29：与 P25 Modrinth 共同构成资源市场，需 API key） ===
  // 每次调用从 config 读 apiKey → new CurseForgeApiClient；apiKey 为空时 client 内部抛错透传给渲染进程
  ipcMain.handle(LOAD_CURSEFORGE_CONFIG, async () => {
    return loadCurseForgeConfig();
  });

  ipcMain.handle(SAVE_CURSEFORGE_CONFIG, async (_e, raw: unknown) => {
    const req = CurseForgeConfigSchema.parse(raw);
    await saveCurseForgeConfig(req);
    return { ok: true };
  });

  ipcMain.handle(CURSEFORGE_SEARCH, async (_e, raw: unknown): Promise<CurseForgeSearchRes> => {
    const req = CurseForgeSearchRequest.parse(raw);
    const { apiKey } = loadCurseForgeConfig();
    const client = new CurseForgeApiClient(apiKey);
    const searchOpts: { loader?: string; mcVersion?: string; limit?: number } = {
      limit: req.limit,
    };
    if (req.loader !== undefined) searchOpts.loader = req.loader;
    if (req.mcVersion !== undefined) searchOpts.mcVersion = req.mcVersion;
    const hits = await client.search(req.query, searchOpts);
    return { hits };
  });

  ipcMain.handle(CURSEFORGE_FILES, async (_e, raw: unknown): Promise<CurseForgeFilesRes> => {
    const req = CurseForgeFilesRequest.parse(raw);
    const { apiKey } = loadCurseForgeConfig();
    const client = new CurseForgeApiClient(apiKey);
    const fileOpts: { loader?: string; mcVersion?: string } = {};
    if (req.loader !== undefined) fileOpts.loader = req.loader;
    if (req.mcVersion !== undefined) fileOpts.mcVersion = req.mcVersion;
    const files = await client.getFiles(req.modId, fileOpts);
    return { files };
  });
}
