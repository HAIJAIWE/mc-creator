import { ipcMain } from 'electron';
import { FileManager, ReadEncoding, FileMetaWithHash } from '../../main/file-manager.js';
import { createHash } from 'node:crypto';
import { IPC } from '../../shared/ipc-channels.js';
import {
  FileWriteStreamStartReq,
  FileWriteStreamChunkReq,
  FileWriteStreamRes,
  FileReadStreamStartReq,
  FileReadStreamChunkRes,
} from '../../shared/ipc-channels.js';
import { validateProjectId, validateMaxDepth, validateRelativePath } from '../validation.js';

// ============================================================
// IPC 入参 TypeScript 类型定义
// ============================================================
// 注意：这些类型**仅用于编译期类型检查，不做运行时校验**。
// 运行时校验在各 IPC handler 入口处通过 validateProjectId / validateMaxDepth /
// validateRelativePath 等函数显式执行（见 registerFileManagerHandlers 内部）。
// 之前的 Zod schema 版本（误导性注释："用于 Zod 校验"）已移除，因为它们从未被 `.parse()` 调用，
// 无法提供任何运行时保护，反而会让维护者误以为有校验在生效。

/** 相对路径（相对于基准目录），非空字符串 */
type RelativePath = string;

/** 项目 ID：非空、仅允许 a-z A-Z 0-9 _ - */
type ProjectId = string;

/** 读取文本请求 */
interface ReadTextReq {
  path: RelativePath;
  encoding?: string;
}

/** 写入文本请求 */
interface WriteTextReq {
  path: RelativePath;
  content: string;
  encoding?: string;
}

/** 创建目录请求 */
interface MakeDirReq {
  path: RelativePath;
}

/** 删除项目请求 */
interface DeleteItemReq {
  path: RelativePath;
}

/** 重命名请求 */
interface RenameReq {
  from: RelativePath;
  to: RelativePath;
}

/** 列出目录请求 */
interface ListDirReq {
  path: RelativePath;
}

/** 列出目录树请求（支持深度限制） */
interface ListTreeReq {
  path: RelativePath;
  maxDepth?: number;
}

/** 项目感知：列出目录树请求 */
interface ProjectListTreeReq {
  projectId: ProjectId;
  path?: string;
  maxDepth?: number;
}

/** 检查是否为 Mod 文件 */
interface IsModFileReq {
  path: RelativePath;
}

/** 创建 Modpack */
interface CreateModpackReq {
  name: string;
  mcVersion: string;
  description?: string;
}

// ============================================================
// 项目感知类型（带 projectId）
// ============================================================

/** 项目感知：列出目录 */
interface ProjectListDirReq {
  projectId: ProjectId;
  path?: string;
}

/** 项目感知：读取文本 */
interface ProjectReadTextReq {
  projectId: ProjectId;
  path: RelativePath;
  encoding?: string;
}

/** 项目感知：写入文本 */
interface ProjectWriteTextReq {
  projectId: ProjectId;
  path: RelativePath;
  content: string;
  encoding?: string;
}

/** 项目感知：创建目录 */
interface ProjectMakeDirReq {
  projectId: ProjectId;
  path: RelativePath;
}

/** 项目感知：删除项目 */
interface ProjectDeleteItemReq {
  projectId: ProjectId;
  path: RelativePath;
}

/** 项目感知：获取目录路径 */
interface ProjectGetDirReq {
  projectId: ProjectId;
}

/** 项目感知：确保标准目录存在 */
interface ProjectEnsureDirsReq {
  projectId: ProjectId;
}

// ============================================================
// 文件元数据类型
// ============================================================

/** 文件元数据 (含 isDirectory，与 FileMetaWithHash 对齐) */
interface FileMetaSchema {
  mtime: number;
  size: number;
  isDirectory: boolean;
  hash: string;
}

/** 获取文件元数据请求 */
interface GetFileMetaReq {
  path: RelativePath;
}

/** 带元数据校验的写入请求 */
interface WriteTextWithMetaReq {
  path: RelativePath;
  content: string;
  expectedMeta?: FileMetaSchema;
  encoding?: string;
}

/** 项目感知：获取文件元数据 */
interface ProjectGetFileMetaReq {
  projectId: ProjectId;
  path: RelativePath;
}

/** 项目感知：带元数据校验的写入 */
interface ProjectWriteTextWithMetaReq {
  projectId: ProjectId;
  path: RelativePath;
  content: string;
  expectedMeta?: FileMetaSchema;
  encoding?: string;
}

// ============================================================
// IPC Handler 注册
// ============================================================

/** 统一的错误返回格式（与 handleResult 风格一致） */
function validationError(message: string) {
  return { success: false, error: message };
}

function handleResult<T>(result: {
  ok: boolean;
  value?: T;
  error?: {
    message?: string;
    code?: string;
    path?: string;
    serverMeta?: FileMetaWithHash;
    localMeta?: FileMetaWithHash;
  };
}) {
  if (result.ok) {
    return { success: true, data: result.value };
  }
  if (result.error?.code === 'CONFLICT') {
    return {
      success: false,
      error: result.error.message ?? 'File conflict',
      conflict: true,
      serverMeta: result.error.serverMeta,
      localMeta: result.error.localMeta,
    };
  }
  return { success: false, error: result.error?.message ?? 'Unknown error' };
}

export function registerFileManagerHandlers(): void {
  const fm = FileManager.getInstance();

  // --- 目录浏览（全局路径）---
  ipcMain.handle('file:listDir', async (_e, req: ListDirReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.listDir(pathCheck.value);
    return handleResult(result);
  });

  // --- 目录树浏览（全局路径，递归）---
  ipcMain.handle('file:listTree', async (_e, req: ListTreeReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const depthCheck = validateMaxDepth(req.maxDepth);
    if (!depthCheck.ok) return validationError(depthCheck.error);
    const result = await fm.listDirTree(pathCheck.value, depthCheck.value);
    return handleResult(result);
  });

  // --- 文件读写（全局路径）---
  ipcMain.handle('file:readText', async (_e, req: ReadTextReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.readText(pathCheck.value, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  ipcMain.handle('file:readBinaryBase64', async (_e, req: { path: string }) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.readBinaryBase64(pathCheck.value);
    return handleResult(result);
  });

  ipcMain.handle('file:writeText', async (_e, req: WriteTextReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.writeText(pathCheck.value, req.content, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // --- 目录管理（全局路径）---
  ipcMain.handle('file:makeDir', async (_e, req: MakeDirReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.makeDir(pathCheck.value);
    return handleResult(result);
  });

  ipcMain.handle('file:deleteItem', async (_e, req: DeleteItemReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.deleteItem(pathCheck.value);
    return handleResult(result);
  });

  ipcMain.handle('file:renameItem', async (_e, req: RenameReq) => {
    const fromCheck = validateRelativePath(req.from);
    if (!fromCheck.ok) return validationError(fromCheck.error);
    const toCheck = validateRelativePath(req.to);
    if (!toCheck.ok) return validationError(toCheck.error);
    const result = await fm.renameItem(fromCheck.value, toCheck.value);
    return handleResult(result);
  });

  // --- Mod 相关 ---
  ipcMain.handle('file:isModFile', async (_e, req: IsModFileReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = fm.isModFile(pathCheck.value);
    return { success: true, isMod: result };
  });

  ipcMain.handle('file:listMods', async () => {
    const result = await fm.listMods();
    return handleResult(result);
  });

  ipcMain.handle('file:isModInstalled', async (_e, req: { modId: string }) => {
    const result = await fm.isModInstalled(req.modId);
    return handleResult(result);
  });

  ipcMain.handle('file:importMod', async () => {
    const result = await fm.importMod();
    return handleResult(result);
  });

  // --- Modpack 相关 ---
  ipcMain.handle('file:listModpacks', async () => {
    const result = await fm.listModpacks();
    return handleResult(result);
  });

  ipcMain.handle('file:createModpack', async (_e, req: CreateModpackReq) => {
    const result = await fm.createModpack(req.name, req.mcVersion, req.description);
    return handleResult(result);
  });

  // --- 资源包相关 ---
  ipcMain.handle('file:listResourcePacks', async () => {
    const result = await fm.listResourcePacks();
    return handleResult(result);
  });

  ipcMain.handle('file:importResourcePack', async () => {
    const result = await fm.importResourcePack();
    return handleResult(result);
  });

  // ============================================================
  // 项目感知通道（自动锚定到项目工作区）
  // ============================================================

  // 列出项目目录
  ipcMain.handle('file:project:listDir', async (_e, req: ProjectListDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path ?? '');
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.listProjectDir(projectIdCheck.value, pathCheck.value);
    return handleResult(result);
  });

  // 列出项目目录树（递归，支持深度限制）
  ipcMain.handle('file:project:listTree', async (_e, req: ProjectListTreeReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path ?? '');
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const depthCheck = validateMaxDepth(req.maxDepth);
    if (!depthCheck.ok) return validationError(depthCheck.error);
    const result = await fm.listProjectTree(
      projectIdCheck.value,
      pathCheck.value,
      depthCheck.value,
    );
    return handleResult(result);
  });

  // 读取项目文件
  ipcMain.handle('file:project:readText', async (_e, req: ProjectReadTextReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.readProjectFile(
      projectIdCheck.value,
      pathCheck.value,
      req.encoding as ReadEncoding,
    );
    return handleResult(result);
  });

  // 写入项目文件
  ipcMain.handle('file:project:writeText', async (_e, req: ProjectWriteTextReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.writeProjectFile(
      projectIdCheck.value,
      pathCheck.value,
      req.content,
      req.encoding as ReadEncoding,
    );
    return handleResult(result);
  });

  // 创建项目目录
  ipcMain.handle('file:project:makeDir', async (_e, req: ProjectMakeDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.makeProjectDir(projectIdCheck.value, pathCheck.value);
    return handleResult(result);
  });

  // 删除项目文件/目录
  ipcMain.handle('file:project:deleteItem', async (_e, req: ProjectDeleteItemReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.deleteProjectItem(projectIdCheck.value, pathCheck.value);
    return handleResult(result);
  });

  // 获取项目工作区根目录
  ipcMain.handle('file:project:getWorkspace', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectWorkspace(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目输出目录
  ipcMain.handle('file:project:getOutputDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectOutputDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目构建缓存目录
  ipcMain.handle('file:project:getBuildCacheDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectBuildCacheDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目临时目录
  ipcMain.handle('file:project:getTempDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectTempDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目资源包目录
  ipcMain.handle('file:project:getResourcePacksDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectResourcePacksDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目 Mod 目录
  ipcMain.handle('file:project:getModsDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectModsDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 获取项目导出目录
  ipcMain.handle('file:project:getExportsDir', async (_e, req: ProjectGetDirReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const path = fm.getProjectExportsDir(projectIdCheck.value);
    return { success: true, path };
  });

  // 确保项目标准子目录存在
  ipcMain.handle('file:project:ensureDirs', async (_e, req: ProjectEnsureDirsReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const result = await fm.ensureProjectDirs(projectIdCheck.value);
    return handleResult(result);
  });

  // ============================================================
  // 文件元数据与冲突检测
  // ============================================================

  // 获取文件元数据（全局路径）
  ipcMain.handle('file:getFileMeta', async (_e, req: GetFileMetaReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.getFileMeta(pathCheck.value);
    return handleResult(result);
  });

  // 带元数据校验的写入（全局路径）
  ipcMain.handle('file:writeTextWithMeta', async (_e, req: WriteTextWithMetaReq) => {
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.writeTextWithMeta(
      pathCheck.value,
      req.content,
      req.expectedMeta,
      req.encoding as ReadEncoding,
    );
    return handleResult(result);
  });

  // 获取项目文件元数据
  ipcMain.handle('file:project:getFileMeta', async (_e, req: ProjectGetFileMetaReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.getProjectFileMeta(projectIdCheck.value, pathCheck.value);
    return handleResult(result);
  });

  // 带元数据校验的项目文件写入
  ipcMain.handle('file:project:writeTextWithMeta', async (_e, req: ProjectWriteTextWithMetaReq) => {
    const projectIdCheck = validateProjectId(req.projectId);
    if (!projectIdCheck.ok) return validationError(projectIdCheck.error);
    const pathCheck = validateRelativePath(req.path);
    if (!pathCheck.ok) return validationError(pathCheck.error);
    const result = await fm.writeProjectFileWithMeta(
      projectIdCheck.value,
      pathCheck.value,
      req.content,
      req.expectedMeta,
      req.encoding as ReadEncoding,
    );
    return handleResult(result);
  });

  // ============================================================
  // 大文件流式传输
  // ============================================================

  // 存储活跃的写入流会话
  const writeStreamSessions = new Map<
    string,
    {
      writeStream: import('node:fs').WriteStream;
      hash: import('node:crypto').Hash;
      totalBytes: number;
      expectedSize: number;
      expectedHash: string | undefined;
      projectId: string;
      path: string;
    }
  >();

  /**
   * 发起流式写入（主进程创建写入流，等待分片）
   */
  ipcMain.handle(
    IPC.FILE_PROJECT_WRITE_STREAM,
    async (e, req: FileWriteStreamStartReq): Promise<FileWriteStreamRes> => {
      const fm = FileManager.getInstance();
      const projectIdCheck = validateProjectId(req.projectId);
      if (!projectIdCheck.ok) return { success: false, error: projectIdCheck.error };
      const fullPath = fm['resolvePath'](
        fm['getProjectWorkspace'](projectIdCheck.value) + '/' + req.path,
      );

      // 安全检查
      const safeCheck = fm['checkSafePath'](fullPath);
      if (!safeCheck.ok) {
        return { success: false, error: safeCheck.error.message };
      }

      const { ensureDir } = await import('../path-manager.js');
      const { dirname } = await import('node:path');
      await ensureDir(dirname(fullPath));

      const chunkSize = req.chunkSize || 1024 * 1024;
      const { createWriteStream } = await import('node:fs');
      const writeStream = createWriteStream(fullPath, { highWaterMark: chunkSize });
      const hash = createHash('md5');
      let totalBytes = 0;

      return new Promise<FileWriteStreamRes>((resolve, reject) => {
        writeStream.on('data', (chunk: Buffer | string) => {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buf.length;
          hash.update(buf);
        });

        writeStream.on('error', (err) => {
          writeStreamSessions.delete(req.requestId);
          reject(err);
        });

        writeStream.on('finish', async () => {
          writeStreamSessions.delete(req.requestId);
          try {
            const computedHash = hash.digest('hex');
            if (req.expectedHash && computedHash !== req.expectedHash) {
              resolve({
                success: false,
                error: `MD5 校验失败: 期望 ${req.expectedHash}, 实际 ${computedHash}`,
              });
              return;
            }
            const { stat } = await import('node:fs/promises');
            const stats = await stat(fullPath);
            resolve({
              success: true,
              meta: {
                size: stats.size,
                mtime: stats.mtimeMs,
                isDirectory: false,
                hash: computedHash,
              },
            });
          } catch (err) {
            resolve({ success: false, error: (err as Error).message });
          }
        });

        writeStreamSessions.set(req.requestId, {
          writeStream,
          hash,
          totalBytes,
          expectedSize: req.totalSize,
          expectedHash: req.expectedHash,
          projectId: req.projectId,
          path: req.path,
        });
      });
    },
  );

  /**
   * 接收流式写入分片（使用 handle 以便返回结果）
   */
  ipcMain.handle(
    IPC.FILE_PROJECT_WRITE_STREAM_CHUNK,
    async (_e, req: FileWriteStreamChunkReq): Promise<FileWriteStreamRes> => {
      const session = writeStreamSessions.get(req.requestId);
      if (!session) {
        return { success: false, error: `会话不存在: ${req.requestId}` };
      }

      try {
        const chunkBuffer = Buffer.from(req.data, 'base64');
        const written = session.writeStream.write(chunkBuffer);

        // 如果写入缓冲区满了，等待 drain
        if (!written) {
          await new Promise<void>((resolve, reject) => {
            session.writeStream.once('drain', resolve);
            session.writeStream.once('error', reject);
          });
        }

        // 如果是最后一个分片，结束写入流
        if (req.isLast) {
          session.writeStream.end();
        }

        return { success: true };
      } catch (err) {
        session.writeStream.destroy(err as Error);
        writeStreamSessions.delete(req.requestId);
        return { success: false, error: (err as Error).message };
      }
    },
  );

  /**
   * 发起流式读取（主进程分片发送文件内容）
   */
  ipcMain.handle(
    IPC.FILE_PROJECT_READ_STREAM,
    async (e, req: FileReadStreamStartReq): Promise<{ success: boolean; error?: string }> => {
      const fm = FileManager.getInstance();
      const projectIdCheck = validateProjectId(req.projectId);
      if (!projectIdCheck.ok) return { success: false, error: projectIdCheck.error };
      const fullPath = fm['resolvePath'](
        fm['getProjectWorkspace'](projectIdCheck.value) + '/' + req.path,
      );

      // 安全检查
      const safeCheck = fm['checkSafePath'](fullPath);
      if (!safeCheck.ok) {
        return { success: false, error: safeCheck.error.message };
      }

      try {
        const { stat } = await import('node:fs/promises');
        const { createReadStream } = await import('node:fs');
        const stats = await stat(fullPath);
        const chunkSize = req.chunkSize || 1024 * 1024;

        const readStream = createReadStream(fullPath, { highWaterMark: chunkSize });

        let chunkIndex = 0;
        let totalBytes = 0;

        for await (const chunk of readStream) {
          const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += chunkBuffer.length;

          e.sender.send(IPC.FILE_PROJECT_READ_STREAM_CHUNK, {
            requestId: req.requestId,
            chunkIndex,
            data: chunkBuffer.toString('base64'),
            isLast: totalBytes >= stats.size,
            progress: {
              loaded: totalBytes,
              total: stats.size,
              percentage: Math.round((totalBytes / stats.size) * 100),
            },
          } satisfies FileReadStreamChunkRes);

          chunkIndex++;
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    },
  );
}
