/**
 * 整合包 IPC：依赖自动解析 + 版本冲突检测 + mrpack 导出。
 *
 * - modpack:resolve：逐 mod 拉取版本元数据（Modrinth/CurseForge），锁定 fileId/versionNumber，
 *   生成依赖图；网络失败且 allowCache 时用 userData/modpack-cache 缓存降级。
 * - modpack:checkConflicts：纯本地冲突检测（无网络，读 ModEntry 自带 gameVersions/loaders/dependencies）。
 * - modpack:exportMrpack：按 Modrinth 规范打包 .mrpack（modrinth.index.json + overrides/）；
 *   大 zip（>1MB）经项目 exports 目录 + 进度事件分片上报，复用已有 file:project:writeStream 语义
 *   （此处主进程直写并推送 MODPACK_EXPORT_PROGRESS，渲染侧进度条消费；不改 FileManager 核心 API）。
 */
import { app, dialog, ipcMain } from 'electron';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import JSZip from 'jszip';
import { writeFileAtomic } from '@mc-creator/shell';
import { ModpackSpec } from '@mc-creator/shared';
import {
  resolveFromMetadata,
  detectConflicts,
  buildMrpackPlan,
  modrinthToMetadata,
  curseforgeToMetadata,
  type VersionMetadata,
} from '@mc-creator/core';
import { createCurseForgeClient, createModrinthClient } from '../market-clients.js';
import { FileManager } from '../file-manager.js';
import {
  MODPACK_RESOLVE,
  MODPACK_CHECK_CONFLICTS,
  MODPACK_EXPORT_MRPACK,
  MODPACK_EXPORT_PROGRESS,
  ModpackResolveRequest,
  ModpackCheckConflictsRequest,
  ModpackExportMrpackRequest,
  type ModpackResolveRes,
  type ModpackCheckConflictsRes,
  type ModpackExportMrpackRes,
} from '../../shared/ipc-channels.js';

/** 流式导出阈值：zip 超过此大小即分片上报进度（复用 writeStream 语义） */
const MRPACK_STREAM_THRESHOLD = 1 * 1024 * 1024;
const MRPACK_CHUNK = 512 * 1024;

function cacheDir(): string {
  return join(app.getPath('userData'), 'modpack-cache');
}

function cacheKey(mods: Array<{ projectId: string }>, mcVersion: string, loader: string): string {
  const h = createHash('md5')
    .update(JSON.stringify({ mods: mods.map((m) => m.projectId).sort(), mcVersion, loader }))
    .digest('hex');
  return `resolve-${h}.json`;
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  try {
    await writeFileAtomic(join(cacheDir(), key), JSON.stringify(payload));
  } catch {
    // 缓存写失败不阻断主流程
  }
}

async function readCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await readFile(join(cacheDir(), key), 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function registerModpackHandlers(): void {
  // === 依赖自动解析 ===
  ipcMain.handle(MODPACK_RESOLVE, async (_e, raw: unknown): Promise<ModpackResolveRes> => {
    const req = ModpackResolveRequest.parse(raw);
    const key = cacheKey(req.mods, req.mcVersion, req.loader);
    const metadataByProject: Record<string, VersionMetadata[]> = {};
    const nameByProject: Record<string, string> = {};
    for (const m of req.mods) {
      if (m.name) nameByProject[m.projectId] = m.name;
    }
    const modrinth = createModrinthClient();
    let networkFailed = false;

    for (const m of req.mods) {
      try {
        if (/^\d+$/.test(m.projectId)) {
          const client = createCurseForgeClient();
          const files = await client.getFiles(Number(m.projectId), {
            loader: req.loader,
            mcVersion: req.mcVersion,
          });
          metadataByProject[m.projectId] = files.map((f) =>
            curseforgeToMetadata(Number(m.projectId), {
              id: f.id,
              displayName: f.displayName,
              fileName: f.fileName,
              fileLength: f.fileLength,
              downloadUrl: f.downloadUrl,
              gameVersions: f.gameVersions,
              modLoaderNames: f.modLoaderNames,
              ...(f.hashes !== undefined ? { hashes: f.hashes } : {}),
              ...(f.dependencies !== undefined ? { dependencies: f.dependencies } : {}),
            }),
          );
        } else {
          const versions = await modrinth.getVersions(m.projectId, {
            loader: req.loader,
            mcVersion: req.mcVersion,
          });
          metadataByProject[m.projectId] = versions.map((v) =>
            modrinthToMetadata({
              id: v.id,
              project_id: v.project_id,
              version_number: v.version_number,
              name: v.name,
              game_versions: v.game_versions ?? (req.mcVersion ? [req.mcVersion] : []),
              loaders: v.loaders ?? (req.loader ? [req.loader] : []),
              dependencies: v.dependencies ?? [],
              files: v.files.map((f) => ({
                url: f.url,
                filename: f.filename,
                primary: f.primary,
                size: f.size,
                ...(f.hashes ? { hashes: f.hashes } : {}),
              })),
            }),
          );
        }
      } catch (err) {
        networkFailed = true;
        // 单 mod 失败不阻断其他 mod；无缓存时 resolveFromMetadata 会记为 unresolved
        metadataByProject[m.projectId] = metadataByProject[m.projectId] ?? [];
        void err;
      }
    }

    const allEmpty = Object.values(metadataByProject).every((l) => l.length === 0);
    if (networkFailed || allEmpty) {
      if (req.allowCache) {
        const cached = await readCache<ModpackResolveRes>(key);
        if (cached) {
          return { ...cached, fromCache: true };
        }
      }
    }

    const result = resolveFromMetadata(
      {
        mods: req.mods.map((m) => ({
          projectId: m.projectId,
          ...(m.name !== undefined ? { name: m.name } : {}),
        })),
        mcVersion: req.mcVersion,
        loader: req.loader,
      },
      metadataByProject,
      nameByProject,
    );
    const res: ModpackResolveRes = {
      resolved: result.resolved,
      graph: result.graph,
      conflicts: result.conflicts,
      unresolved: result.unresolved,
      warnings: result.warnings,
      fromCache: false,
    };
    if (!networkFailed && result.resolved.length > 0) {
      await writeCache(key, res);
    }
    return res;
  });

  // === 纯本地冲突检测 ===
  ipcMain.handle(
    MODPACK_CHECK_CONFLICTS,
    async (_e, raw: unknown): Promise<ModpackCheckConflictsRes> => {
      const req = ModpackCheckConflictsRequest.parse(raw);
      const conflicts = detectConflicts(req.mods, req.mcVersion, req.loader);
      return { conflicts };
    },
  );

  // === mrpack 导出 ===
  ipcMain.handle(
    MODPACK_EXPORT_MRPACK,
    async (e, raw: unknown): Promise<ModpackExportMrpackRes> => {
      const req = ModpackExportMrpackRequest.parse(raw);
      const parsed = ModpackSpec.safeParse(req.spec);
      if (!parsed.success) {
        throw new Error(
          `modpack Spec 校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        );
      }
      const spec = parsed.data;
      const plan = buildMrpackPlan(spec);
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      const defaultName = req.defaultName || `${spec.packId}-${spec.packVersion}.mrpack`;

      const zip = new JSZip();
      zip.file('modrinth.index.json', JSON.stringify(plan.indexJson, null, 2));
      // overrides/ 必需：即使为空也放 README 占位，保证解压即有目录
      if (plan.overrideFiles.length === 0) {
        zip.file(
          'overrides/README.txt',
          `此目录存放整合包的配置文件覆盖。\n整合包: ${spec.packName} v${spec.packVersion}\nMC: ${spec.mcVersion} / ${spec.loader} ${spec.loaderVersion}\n`,
        );
      } else {
        for (const o of plan.overrideFiles) {
          zip.file(`overrides/${o.path}`, o.content);
        }
      }
      if (plan.serverOverrideFiles.length > 0) {
        zip.file(
          'server-overrides/README.txt',
          '服务端覆盖文件（非 mrpack 标准，随包附带，需手动分发到服务端）。\n',
        );
        for (const o of plan.serverOverrideFiles) {
          zip.file(`server-overrides/${o.path}`, o.content);
        }
      }

      const fileCount = Object.keys(zip.files).length;
      const buf = await zip.generateAsync({ type: 'nodebuffer' });
      const totalBytes = buf.length;
      const usedStream = totalBytes > MRPACK_STREAM_THRESHOLD;
      const sendProgress = (loaded: number, currentFile: string, done = false): void => {
        try {
          e.sender.send(MODPACK_EXPORT_PROGRESS, {
            requestId,
            loaded,
            total: totalBytes,
            percentage: totalBytes === 0 ? 100 : Math.round((loaded / totalBytes) * 100),
            currentFile,
            done,
          });
        } catch {
          // 渲染窗口已关闭时忽略
        }
      };

      // 大文件：先分片落到项目 exports 目录（复用 writeStream 分片语义并上报进度），
      // 再弹保存对话框复制到用户所选路径；小文件直接弹框保存。
      let stagedPath: string | null = null;
      if (req.projectId) {
        try {
          const fm = FileManager.getInstance();
          const exportsDir = fm.getProjectExportsDir(req.projectId);
          await mkdir(exportsDir, { recursive: true });
          stagedPath = join(exportsDir, defaultName);
          if (usedStream) {
            // 分片写入并上报进度（与 file:project:writeStream 相同的 512KB 分片节奏）
            const { open } = await import('node:fs/promises');
            const fh = await open(stagedPath, 'w');
            try {
              let loaded = 0;
              for (let off = 0; off < buf.length; off += MRPACK_CHUNK) {
                const chunk = buf.subarray(off, off + MRPACK_CHUNK);
                await fh.write(chunk);
                loaded += chunk.length;
                sendProgress(loaded, defaultName, false);
              }
            } finally {
              await fh.close();
            }
          } else {
            await writeFileAtomic(stagedPath, buf);
            sendProgress(totalBytes, defaultName, false);
          }
        } catch {
          stagedPath = null;
        }
      } else if (usedStream) {
        // 无项目时仍需进度事件：按分片节奏空转上报，保证进度条一致
        let loaded = 0;
        for (let off = 0; off < buf.length; off += MRPACK_CHUNK) {
          loaded = Math.min(buf.length, off + MRPACK_CHUNK);
          sendProgress(loaded, defaultName, false);
        }
      }

      const picked = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: 'Modrinth Pack', extensions: ['mrpack'] }],
      });
      if (picked.canceled || !picked.filePath) {
        sendProgress(totalBytes, defaultName, true);
        return {
          ok: false,
          canceled: true,
          savedPath: null,
          fileCount,
          totalBytes,
          usedStream,
          warnings: plan.warnings,
        };
      }
      // 用户选了路径：优先复用已分片落盘的暂存（避免二次大内存拷贝）
      if (stagedPath && stagedPath !== picked.filePath) {
        try {
          const { copyFile } = await import('node:fs/promises');
          await copyFile(stagedPath, picked.filePath);
        } catch {
          await writeFileAtomic(picked.filePath, buf);
        }
      } else if (!stagedPath) {
        await writeFileAtomic(picked.filePath, buf);
      }
      sendProgress(totalBytes, defaultName, true);
      return {
        ok: true,
        canceled: false,
        savedPath: picked.filePath,
        fileCount,
        totalBytes,
        usedStream,
        warnings: plan.warnings,
      };
    },
  );
}
