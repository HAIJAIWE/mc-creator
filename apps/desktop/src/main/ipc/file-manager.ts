import { ipcMain } from 'electron';
import { FileManager, ReadEncoding, FileMetaWithHash } from '../../main/file-manager.js';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { IPC } from '../../shared/ipc-channels.js';
import {
  FileWriteStreamStartReq,
  FileWriteStreamChunkReq,
  FileWriteStreamRes,
  FileReadStreamStartReq,
  FileReadStreamChunkRes,
} from '../../shared/ipc-channels.js';

// ============================================================
// Schema 定义（用于 Zod 校验，保证跨进程数据安全）
// ============================================================

/** 相对路径（相对于基准目录） */
const RelativePathSchema = z.string().min(1);

/** 项目 ID */
const ProjectIdSchema = z.string().min(1);

/** 读取文本请求 */
const ReadTextReq = z.object({ path: RelativePathSchema, encoding: z.string().optional().default('utf8') });

/** 写入文本请求 */
const WriteTextReq = z.object({ path: RelativePathSchema, content: z.string(), encoding: z.string().optional().default('utf8') });

/** 创建目录请求 */
const MakeDirReq = z.object({ path: RelativePathSchema });

/** 删除项目请求 */
const DeleteItemReq = z.object({ path: RelativePathSchema });

/** 重命名请求 */
const RenameReq = z.object({ from: RelativePathSchema, to: RelativePathSchema });

/** 列出目录请求 */
const ListDirReq = z.object({ path: RelativePathSchema });

/** 列出目录树请求（支持深度限制） */
const ListTreeReq = z.object({ path: RelativePathSchema, maxDepth: z.number().int().optional().default(-1) });

/** 项目感知：列出目录树请求 */
const ProjectListTreeReq = z.object({ projectId: ProjectIdSchema, path: z.string().optional().default(''), maxDepth: z.number().int().optional().default(-1) });

/** 检查是否为 Mod 文件 */
const IsModFileReq = z.object({ path: RelativePathSchema });

/** 创建 Modpack */
const CreateModpackReq = z.object({ name: z.string(), mcVersion: z.string(), description: z.string().optional() });

// ============================================================
// 项目感知 Schema（带 projectId）
// ============================================================

/** 项目感知：列出目录 */
const ProjectListDirReq = z.object({ projectId: ProjectIdSchema, path: z.string().optional().default('') });

/** 项目感知：读取文本 */
const ProjectReadTextReq = z.object({ projectId: ProjectIdSchema, path: RelativePathSchema, encoding: z.string().optional().default('utf8') });

/** 项目感知：写入文本 */
const ProjectWriteTextReq = z.object({ projectId: ProjectIdSchema, path: RelativePathSchema, content: z.string(), encoding: z.string().optional().default('utf8') });

/** 项目感知：创建目录 */
const ProjectMakeDirReq = z.object({ projectId: ProjectIdSchema, path: RelativePathSchema });

/** 项目感知：删除项目 */
const ProjectDeleteItemReq = z.object({ projectId: ProjectIdSchema, path: RelativePathSchema });

/** 项目感知：获取目录路径 */
const ProjectGetDirReq = z.object({ projectId: ProjectIdSchema });

/** 项目感知：确保标准目录存在 */
const ProjectEnsureDirsReq = z.object({ projectId: ProjectIdSchema });

// ============================================================
// 文件元数据 Schema
// ============================================================

/** 文件元数据 Schema (含 isDirectory，与 FileMetaWithHash 对齐) */
const FileMetaSchema = z.object({
  mtime: z.number(),
  size: z.number(),
  isDirectory: z.boolean(),
  hash: z.string(),
});

/** 获取文件元数据请求 */
const GetFileMetaReq = z.object({ path: RelativePathSchema });

/** 带元数据校验的写入请求 */
const WriteTextWithMetaReq = z.object({
  path: RelativePathSchema,
  content: z.string(),
  expectedMeta: FileMetaSchema.optional(),
  encoding: z.string().optional().default('utf8'),
});

/** 项目感知：获取文件元数据 */
const ProjectGetFileMetaReq = z.object({ projectId: ProjectIdSchema, path: RelativePathSchema });

/** 项目感知：带元数据校验的写入 */
const ProjectWriteTextWithMetaReq = z.object({
  projectId: ProjectIdSchema,
  path: RelativePathSchema,
  content: z.string(),
  expectedMeta: FileMetaSchema.optional(),
  encoding: z.string().optional().default('utf8'),
});

// ============================================================
// IPC Handler 注册
// ============================================================

function handleResult<T>(result: { ok: boolean; value?: T; error?: { message?: string; code?: string; path?: string; serverMeta?: FileMetaWithHash; localMeta?: FileMetaWithHash } }) {
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
  ipcMain.handle('file:listDir', async (_e, req: z.infer<typeof ListDirReq>) => {
    const result = await fm.listDir(req.path);
    return handleResult(result);
  });

  // --- 目录树浏览（全局路径，递归）---
  ipcMain.handle('file:listTree', async (_e, req: z.infer<typeof ListTreeReq>) => {
    const result = await fm.listDirTree(req.path, req.maxDepth);
    return handleResult(result);
  });

  // --- 文件读写（全局路径）---
  ipcMain.handle('file:readText', async (_e, req: z.infer<typeof ReadTextReq>) => {
    const result = await fm.readText(req.path, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  ipcMain.handle('file:readBinaryBase64', async (_e, req: { path: string }) => {
    const result = await fm.readBinaryBase64(req.path);
    return handleResult(result);
  });

  ipcMain.handle('file:writeText', async (_e, req: z.infer<typeof WriteTextReq>) => {
    const result = await fm.writeText(req.path, req.content, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // --- 目录管理（全局路径）---
  ipcMain.handle('file:makeDir', async (_e, req: z.infer<typeof MakeDirReq>) => {
    const result = await fm.makeDir(req.path);
    return handleResult(result);
  });

  ipcMain.handle('file:deleteItem', async (_e, req: z.infer<typeof DeleteItemReq>) => {
    const result = await fm.deleteItem(req.path);
    return handleResult(result);
  });

  ipcMain.handle('file:renameItem', async (_e, req: z.infer<typeof RenameReq>) => {
    const result = await fm.renameItem(req.from, req.to);
    return handleResult(result);
  });

  // --- Mod 相关 ---
  ipcMain.handle('file:isModFile', async (_e, req: z.infer<typeof IsModFileReq>) => {
    const result = fm.isModFile(req.path);
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

  ipcMain.handle('file:createModpack', async (_e, req: z.infer<typeof CreateModpackReq>) => {
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
  ipcMain.handle('file:project:listDir', async (_e, req: z.infer<typeof ProjectListDirReq>) => {
    const result = await fm.listProjectDir(req.projectId, req.path);
    return handleResult(result);
  });

  // 列出项目目录树（递归，支持深度限制）
  ipcMain.handle('file:project:listTree', async (_e, req: z.infer<typeof ProjectListTreeReq>) => {
    const result = await fm.listProjectTree(req.projectId, req.path, req.maxDepth);
    return handleResult(result);
  });

  // 读取项目文件
  ipcMain.handle('file:project:readText', async (_e, req: z.infer<typeof ProjectReadTextReq>) => {
    const result = await fm.readProjectFile(req.projectId, req.path, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // 写入项目文件
  ipcMain.handle('file:project:writeText', async (_e, req: z.infer<typeof ProjectWriteTextReq>) => {
    const result = await fm.writeProjectFile(req.projectId, req.path, req.content, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // 创建项目目录
  ipcMain.handle('file:project:makeDir', async (_e, req: z.infer<typeof ProjectMakeDirReq>) => {
    const result = await fm.makeProjectDir(req.projectId, req.path);
    return handleResult(result);
  });

  // 删除项目文件/目录
  ipcMain.handle('file:project:deleteItem', async (_e, req: z.infer<typeof ProjectDeleteItemReq>) => {
    const result = await fm.deleteProjectItem(req.projectId, req.path);
    return handleResult(result);
  });

  // 获取项目工作区根目录
  ipcMain.handle('file:project:getWorkspace', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectWorkspace(req.projectId);
    return { success: true, path };
  });

  // 获取项目输出目录
  ipcMain.handle('file:project:getOutputDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectOutputDir(req.projectId);
    return { success: true, path };
  });

  // 获取项目构建缓存目录
  ipcMain.handle('file:project:getBuildCacheDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectBuildCacheDir(req.projectId);
    return { success: true, path };
  });

  // 获取项目临时目录
  ipcMain.handle('file:project:getTempDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectTempDir(req.projectId);
    return { success: true, path };
  });

  // 获取项目资源包目录
  ipcMain.handle('file:project:getResourcePacksDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectResourcePacksDir(req.projectId);
    return { success: true, path };
  });

  // 获取项目 Mod 目录
  ipcMain.handle('file:project:getModsDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectModsDir(req.projectId);
    return { success: true, path };
  });

  // 获取项目导出目录
  ipcMain.handle('file:project:getExportsDir', async (_e, req: z.infer<typeof ProjectGetDirReq>) => {
    const path = fm.getProjectExportsDir(req.projectId);
    return { success: true, path };
  });

  // 确保项目标准子目录存在
  ipcMain.handle('file:project:ensureDirs', async (_e, req: z.infer<typeof ProjectEnsureDirsReq>) => {
    const result = await fm.ensureProjectDirs(req.projectId);
    return handleResult(result);
  });

  // ============================================================
  // 文件元数据与冲突检测
  // ============================================================

  // 获取文件元数据（全局路径）
  ipcMain.handle('file:getFileMeta', async (_e, req: z.infer<typeof GetFileMetaReq>) => {
    const result = await fm.getFileMeta(req.path);
    return handleResult(result);
  });

  // 带元数据校验的写入（全局路径）
  ipcMain.handle('file:writeTextWithMeta', async (_e, req: z.infer<typeof WriteTextWithMetaReq>) => {
    const result = await fm.writeTextWithMeta(req.path, req.content, req.expectedMeta, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // 获取项目文件元数据
  ipcMain.handle('file:project:getFileMeta', async (_e, req: z.infer<typeof ProjectGetFileMetaReq>) => {
    const result = await fm.getProjectFileMeta(req.projectId, req.path);
    return handleResult(result);
  });

  // 带元数据校验的项目文件写入
  ipcMain.handle('file:project:writeTextWithMeta', async (_e, req: z.infer<typeof ProjectWriteTextWithMetaReq>) => {
    const result = await fm.writeProjectFileWithMeta(req.projectId, req.path, req.content, req.expectedMeta, req.encoding as ReadEncoding);
    return handleResult(result);
  });

  // ============================================================
  // 大文件流式传输
  // ============================================================

  // 存储活跃的写入流会话
  const writeStreamSessions = new Map<string, {
    writeStream: import('node:fs').WriteStream;
    hash: any;
    totalBytes: number;
    expectedSize: number;
    expectedHash: string | undefined;
    projectId: string;
    path: string;
  }>();

  /**
   * 发起流式写入（主进程创建写入流，等待分片）
   */
  ipcMain.handle(IPC.FILE_PROJECT_WRITE_STREAM, async (e, req: FileWriteStreamStartReq): Promise<FileWriteStreamRes> => {
    const fm = FileManager.getInstance();
    const fullPath = fm['resolvePath'](fm['getProjectWorkspace'](req.projectId) + '/' + req.path);
    
    // 安全检查
    const safeCheck = fm['checkSafePath'](fullPath);
    if (!safeCheck.ok) {
      return { success: false, error: safeCheck.error.message };
    }

    const { ensureDir } = await import('../path-manager.js');
    await ensureDir(require('node:path').dirname(fullPath));

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
            resolve({ success: false, error: `MD5 校验失败: 期望 ${req.expectedHash}, 实际 ${computedHash}` });
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
  });

  /**
   * 接收流式写入分片（使用 handle 以便返回结果）
   */
  ipcMain.handle(IPC.FILE_PROJECT_WRITE_STREAM_CHUNK, async (_e, req: FileWriteStreamChunkReq): Promise<FileWriteStreamRes> => {
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
  });

  /**
   * 发起流式读取（主进程分片发送文件内容）
   */
  ipcMain.handle(IPC.FILE_PROJECT_READ_STREAM, async (e, req: FileReadStreamStartReq): Promise<{ success: boolean; error?: string }> => {
    const fm = FileManager.getInstance();
    const fullPath = fm['resolvePath'](fm['getProjectWorkspace'](req.projectId) + '/' + req.path);
    
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
  });
}