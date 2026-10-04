import { resolve, dirname, extname } from 'node:path';
import * as fs from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { dialog } from 'electron';
import { PATH_MANAGER, ensureDir, isSafePath, PROJECT_SCOPED } from './path-manager.js';
import { FileError, Result, ok, err, mapFsError, LARGE_FILE_THRESHOLD, CHUNK_SIZE } from './file-error.js';
import type { FileMetaWithHash } from './file-error.js';

// ============================================================
// 类型定义
// ============================================================

export type { FileMetaWithHash } from './file-error.js';

/** 进度回调类型 */
export interface ProgressCallback {
  (progress: { loaded: number; total: number; percentage: number }): void;
}

/** 写入大文件流式接口选项 */
export interface WriteLargeFileOptions {
  /** 分片大小（字节），默认 1MB，可通过 MC_CHUNK_SIZE 环境变量配置 */
  chunkSize?: number;
  /** 进度回调 */
  onProgress?: ProgressCallback;
  /** 预期总大小（用于进度计算），可选 */
  expectedSize?: number;
  /** 预期 MD5 校验和（写入完成后校验），可选 */
  expectedHash?: string;
}

/** 读取大文件流式接口选项 */
export interface ReadLargeFileOptions {
  /** 分片大小（字节），默认 1MB，可通过 MC_CHUNK_SIZE 环境变量配置 */
  chunkSize?: number;
  /** 进度回调 */
  onProgress?: ProgressCallback;
}

/** 目录项 */
export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number | undefined;
  children: DirEntry[] | undefined;
}

/** 创建目录结果 */
export interface MakeDirResult {
  success: boolean;
  path: string;
  error?: string;
}

/** 删除结果 */
export interface DeleteResult {
  success: boolean;
  path: string;
  error?: string;
}

/** 重命名/移动结果 */
export interface RenameResult {
  success: boolean;
  from: string;
  to: string;
  error?: string;
}

/** 统一的编码选项 */
export type ReadEncoding = 'utf8' | 'utf16le' | 'latin1' | 'base64' | null;

/** 文件扩展名分类 */
export const MOD_EXTENSIONS = new Set(['.jar', '.json', '.yml', '.yaml']);
export const RESOURCE_PACK_EXT = '.zip';

// ============================================================
// FileManager 类
// ============================================================

/**
 * Unified File Manager Service
 * 提供跨平台、安全的文件系统操作，支撑 Mod/Modpack/资源包 等目录管理
 * 所有 public 方法均为 async，返回 Promise<Result<T, FileError>>
 */
export class FileManager {
  private constructor() {}

  private static instance: FileManager | null = null;

  public static getInstance(): FileManager {
    if (!FileManager.instance) {
      FileManager.instance = new FileManager();
    }
    return FileManager.instance;
  }

  // ==========================================================
  // 内部辅助方法
  // ============================================================

  /** 安全路径检查 */
  private checkSafePath(path: string): Result<void, FileError> {
    if (!isSafePath(path)) {
      return err({ code: 'INVALID_PATH', path, message: `Invalid path: ${path}` });
    }
    return ok(undefined);
  }

  /** 解析完整路径 */
  private resolvePath(path: string): string {
    return resolve(path);
  }

  /** 读取文件内容（自动分片大文件） */
  private async readFileContent(path: string): Promise<Result<Buffer, FileError>> {
    try {
      const stats = await fs.stat(path);
      if (stats.size > LARGE_FILE_THRESHOLD) {
        // 大文件分片读取
        const chunks: Buffer[] = [];
        const fileHandle = await fs.open(path, 'r');
        try {
          let bytesRead = 0;
          const buffer = Buffer.alloc(CHUNK_SIZE);
          while (bytesRead < stats.size) {
            const { bytesRead: read } = await fileHandle.read(buffer, 0, CHUNK_SIZE, bytesRead);
            if (read === 0) break;
            chunks.push(buffer.subarray(0, read));
            bytesRead += read;
          }
        } finally {
          await fileHandle.close();
        }
        return ok(Buffer.concat(chunks));
      } else {
        const content = await fs.readFile(path);
        return ok(content);
      }
    } catch (e: any) {
      return err(mapFsError(e, path));
    }
  }

  /** 写入文件内容（自动分片大文件） */
  private async writeFileContent(path: string, content: Buffer | Uint8Array): Promise<Result<void, FileError>> {
    try {
      await ensureDir(dirname(path));
      if (content.length > LARGE_FILE_THRESHOLD) {
        // 大文件分片写入
        const fileHandle = await fs.open(path, 'w');
        try {
          let offset = 0;
          while (offset < content.length) {
            const chunk = content.subarray(offset, offset + CHUNK_SIZE);
            await fileHandle.write(chunk, 0, chunk.length, offset);
            offset += chunk.length;
          }
        } finally {
          await fileHandle.close();
        }
      } else {
        await fs.writeFile(path, content);
      }
      return ok(undefined);
    } catch (e: any) {
      return err(mapFsError(e, path));
    }
  }

  // ==========================================================
  // 目录浏览
  // ============================================================

  /** 列出目录内容（递归一层） */
  public async listDir(path: string): Promise<Result<DirEntry[], FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const entries: DirEntry[] = [];

      for (const item of items) {
        const itemPath = resolve(fullPath, item.name);
        try {
          const stats = await fs.stat(itemPath);
          entries.push({
            name: item.name,
            path: itemPath,
            type: item.isDirectory() ? 'directory' : 'file',
            size: item.isFile() ? stats.size : undefined,
            children: undefined,
          });
        } catch {
          // 忽略无法 stat 的条目
          entries.push({
            name: item.name,
            path: itemPath,
            type: item.isDirectory() ? 'directory' : 'file',
            size: undefined,
            children: undefined,
          });
        }
      }

      return ok(
        entries.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'directory' ? -1 : 1;
        })
      );
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /** 列出目录树（递归，支持深度限制） */
  public async listDirTree(path: string, maxDepth: number = -1): Promise<Result<DirEntry[], FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      const walk = async (dir: string, depth: number): Promise<DirEntry[]> => {
        if (maxDepth >= 0 && depth > maxDepth) return [];
        const items = await fs.readdir(dir, { withFileTypes: true });
        const entries: DirEntry[] = [];

        for (const item of items) {
          const itemPath = resolve(dir, item.name);
          try {
            const stats = await fs.stat(itemPath);
            const entry: DirEntry = {
              name: item.name,
              path: itemPath,
              type: item.isDirectory() ? 'directory' : 'file',
              size: item.isFile() ? stats.size : undefined,
              children: undefined,
            };
            if (item.isDirectory()) {
              entry.children = await walk(itemPath, depth + 1);
            }
            entries.push(entry);
          } catch {
            entries.push({
              name: item.name,
              path: itemPath,
              type: item.isDirectory() ? 'directory' : 'file',
              size: undefined,
              children: undefined,
            });
          }
        }

        return entries.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === 'directory' ? -1 : 1;
        });
      };

      return ok(await walk(fullPath, 0));
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /** 列出项目目录树（递归，支持深度限制） */
  public async listProjectTree(projectId: string, relPath: string = '', maxDepth: number = -1): Promise<Result<DirEntry[], FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.listDirTree(fullPath, maxDepth);
  }

  // ==========================================================
  // 文件读写
  // ============================================================

  /** 读取文本文件 */
  public async readText(path: string, encoding: ReadEncoding = 'utf8'): Promise<Result<string, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);
    const result = await this.readFileContent(fullPath);
    if (!result.ok) return result;

    try {
      const text = encoding === null || encoding === 'base64'
        ? result.value.toString('base64')
        : result.value.toString(encoding);
      return ok(text);
    } catch {
      return err({ code: 'UNKNOWN', message: 'Failed to decode file content' });
    }
  }

  /** 读取二进制文件并 base64 编码 */
  public async readBinaryBase64(path: string): Promise<Result<string, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);
    const result = await this.readFileContent(fullPath);
    if (!result.ok) return result;

    return ok(result.value.toString('base64'));
  }

  /** 写入文本文件（自动建目录） */
  public async writeText(path: string, content: string, encoding: ReadEncoding = 'utf8'): Promise<Result<void, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    let buffer: Buffer;
    try {
      if (encoding === 'base64') {
        buffer = Buffer.from(content, 'base64');
      } else {
        buffer = Buffer.from(content, encoding ?? 'utf8');
      }
    } catch {
      return err({ code: 'UNKNOWN', message: 'Failed to encode content' });
    }

    return this.writeFileContent(fullPath, buffer);
  }

  /** 写入二进制文件（自动建目录） */
  public async writeBinary(path: string, buffer: Buffer | Uint8Array): Promise<Result<void, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);
    return this.writeFileContent(fullPath, buffer);
  }

  // ============================================================
  // 大文件流式读写（分片传输，避免内存峰值）
  // ============================================================

  /**
   * 获取配置的分片大小（环境变量 MC_CHUNK_SIZE，默认 1MB）
   */
  private getChunkSize(customSize?: number): number {
    if (customSize) return customSize;
    const envSize = parseInt(process.env.MC_CHUNK_SIZE || '', 10);
    return Number.isFinite(envSize) && envSize > 0 ? envSize : CHUNK_SIZE;
  }

  /**
   * 流式写入大文件
   * @param path 目标文件路径
   * @param stream 可读流（Node.js Readable）
   * @param options 选项：chunkSize、onProgress、expectedSize、expectedHash
   * @returns 写入结果，包含最终元数据（size, mtime, hash）
   */
  public async writeLargeFile(
    path: string,
    stream: NodeJS.ReadableStream,
    options: WriteLargeFileOptions = {}
  ): Promise<Result<FileMetaWithHash, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);
    const chunkSize = this.getChunkSize(options.chunkSize);
    let totalBytes = 0;

    try {
      await ensureDir(dirname(fullPath));

      const writeStream = createWriteStream(fullPath, { highWaterMark: chunkSize });
      const { createHash } = await import('node:crypto');
      const hash = createHash('md5');

      // 监听写入进度
      writeStream.on('data', (chunk: Buffer | string) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buf.length;
        hash.update(buf);
        if (options.onProgress && options.expectedSize) {
          options.onProgress({
            loaded: totalBytes,
            total: options.expectedSize,
            percentage: Math.min(100, Math.round((totalBytes / options.expectedSize) * 100)),
          });
        }
      });

      // 使用 pipeline 确保背压处理
      await pipeline(stream, writeStream);

      // 校验 MD5
      const computedHash = hash.digest('hex');
      if (options.expectedHash && computedHash !== options.expectedHash) {
        return err({ code: 'UNKNOWN', message: `MD5 校验失败: 期望 ${options.expectedHash}, 实际 ${computedHash}` });
      }

      const stats = await fs.stat(fullPath);
      return ok({
        size: stats.size,
        mtime: stats.mtimeMs,
        isDirectory: false,
        hash: computedHash,
      });
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /**
   * 流式读取大文件并回调分片
   * @param path 源文件路径
   * @param onChunk 分片回调函数，参数为 Buffer 分片
   * @param options 选项：chunkSize、onProgress
   * @returns 读取完成后的元数据
   */
  public async readLargeFile(
    path: string,
    onChunk: (chunk: Buffer) => void | Promise<void>,
    options: ReadLargeFileOptions = {}
  ): Promise<Result<FileMetaWithHash, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);
    const chunkSize = this.getChunkSize(options.chunkSize);
    let totalBytes = 0;

    try {
      const stats = await fs.stat(fullPath);
      const fileSize = stats.size;

      const readStream = createReadStream(fullPath, { highWaterMark: chunkSize });
      const { createHash } = await import('node:crypto');
      const hash = createHash('md5');

      for await (const chunk of readStream) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buf);
        totalBytes += buf.length;
        await onChunk(buf);

        if (options.onProgress) {
          options.onProgress({
            loaded: totalBytes,
            total: fileSize,
            percentage: Math.round((totalBytes / fileSize) * 100),
          });
        }
      }

      return ok({
        size: fileSize,
        mtime: stats.mtimeMs,
        isDirectory: false,
        hash: hash.digest('hex'),
      });
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /**
   * 流式读取大文件并返回 AsyncIterable（便于 for await 循环）
   * @param path 源文件路径
   * @param options 选项：chunkSize
   * @returns AsyncIterable<Buffer> 分片迭代器
   */
  public async *readLargeFileIterable(
    path: string,
    options: ReadLargeFileOptions = {}
  ): AsyncIterable<Buffer> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) throw safeCheck.error;

    const fullPath = this.resolvePath(path);
    const chunkSize = this.getChunkSize(options.chunkSize);

    const readStream = createReadStream(fullPath, { highWaterMark: chunkSize });
    for await (const chunk of readStream) {
      yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    }
  }

  // ==========================================================
  // 文件元数据与冲突检测
  // ============================================================

  /**
   * 计算文件 MD5 hash（分片读取，不阻塞 Event Loop）
   */
  private async computeFileHash(filePath: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    const { createReadStream } = await import('node:fs');

    return new Promise<string>((resolveHash, reject) => {
      const hash = createHash('md5');
      const stream = createReadStream(filePath, { highWaterMark: 64 * 1024 }); // 64KB chunks

      stream.on('data', (chunk: Buffer | string) => {
        hash.update(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      stream.on('end', () => {
        resolveHash(hash.digest('hex'));
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * 获取文件元数据（mtime + size + MD5 hash）
   */
  public async getFileMeta(path: string): Promise<Result<FileMetaWithHash, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      const stats = await fs.stat(fullPath);
      const hash = await this.computeFileHash(fullPath);
      return ok({
        size: stats.size,
        mtime: stats.mtimeMs,
        isDirectory: false,
        hash,
      });
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /**
   * 带元数据校验的写入：写入前先获取服务端最新元数据，与预期对比
   * - 若不一致，返回 CONFLICT 错误（包含 serverMeta / localMeta）
   * - 若一致或未提供 expectedMeta，直接写入
   */
  public async writeTextWithMeta(
    path: string,
    content: string,
    expectedMeta?: FileMetaWithHash,
    encoding: ReadEncoding = 'utf8'
  ): Promise<Result<FileMetaWithHash, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    // 如果提供了预期元数据，先校验
    if (expectedMeta) {
      let serverMeta: FileMetaWithHash;
      try {
        const stats = await fs.stat(fullPath);
        const hash = await this.computeFileHash(fullPath);
        serverMeta = {
          size: stats.size,
          mtime: stats.mtimeMs,
          isDirectory: false,
          hash,
        };
      } catch (e: any) {
        if (e.code === 'ENOENT') {
          // 文件不存在，构造一个表示“不存在”的元数据
          serverMeta = {
            size: 0,
            mtime: 0,
            isDirectory: false,
            hash: 'd41d8cd98f00b204e9800998ecf8427e', // empty file MD5
          };
        } else {
          return err(mapFsError(e, fullPath));
        }
      }

      // 对比 mtime、size、hash（任一不一致即判定为冲突）
      if (
        serverMeta.mtime !== expectedMeta.mtime ||
        serverMeta.size !== expectedMeta.size ||
        serverMeta.hash !== expectedMeta.hash
      ) {
        return err({
          code: 'CONFLICT',
          path: fullPath,
          serverMeta,
          localMeta: expectedMeta,
          message: `File conflict detected: ${fullPath}`,
        });
      }
    }

    // 校验通过或无预期元数据，执行写入
    let buffer: Buffer;
    try {
      if (encoding === 'base64') {
        buffer = Buffer.from(content, 'base64');
      } else {
        buffer = Buffer.from(content, encoding ?? 'utf8');
      }
    } catch {
      return err({ code: 'UNKNOWN', message: 'Failed to encode content' });
    }

    const writeResult = await this.writeFileContent(fullPath, buffer);
    if (!writeResult.ok) return writeResult;

    // 返回写入后的最新元数据
    const stats = await fs.stat(fullPath);
    const hash = await this.computeFileHash(fullPath);
    return ok({
      size: stats.size,
      mtime: stats.mtimeMs,
      isDirectory: false,
      hash,
    });
  }

  // ==========================================================
  // 目录创建/删除
  // ============================================================

  /** 创建单级/多级目录 */
  public async makeDir(path: string): Promise<Result<MakeDirResult, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      await fs.mkdir(fullPath, { recursive: true });
      return ok({ success: true, path: fullPath });
    } catch (e: any) {
      return err(mapFsError(e, fullPath));
    }
  }

  /** 批量创建目录 */
  public async makeDirs(paths: string[]): Promise<Result<MakeDirResult[], FileError>> {
    const results: MakeDirResult[] = [];
    for (const p of paths) {
      const result = await this.makeDir(p);
      if (result.ok) {
        results.push(result.value);
      } else {
        const msg = 'message' in result.error ? result.error.message : 'Unknown error';
        results.push({ success: false, path: p, error: msg });
      }
    }
    return ok(results);
  }

  /** 删除文件或空目录 */
  public async deleteItem(path: string): Promise<Result<DeleteResult, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      await fs.access(fullPath);
      await fs.rm(fullPath, { recursive: false, force: true });
      return ok({ success: true, path: fullPath });
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return ok({ success: false, path: fullPath, error: 'Path does not exist' });
      }
      return err(mapFsError(e, fullPath));
    }
  }

  /** 删除整个目录（含所有子项） */
  public async deleteDir(path: string): Promise<Result<DeleteResult, FileError>> {
    const safeCheck = this.checkSafePath(path);
    if (!safeCheck.ok) return safeCheck;

    const fullPath = this.resolvePath(path);

    try {
      await fs.access(fullPath);
      await fs.rm(fullPath, { recursive: true, force: true });
      return ok({ success: true, path: fullPath });
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        return ok({ success: false, path: fullPath, error: 'Path does not exist' });
      }
      return err(mapFsError(e, fullPath));
    }
  }

  // ==========================================================
  // 重命名/移动
  // ============================================================

  /** 重命名/移动文件/目录 */
  public async renameItem(from: string, to: string): Promise<Result<RenameResult, FileError>> {
    const fromSafe = this.checkSafePath(from);
    if (!fromSafe.ok) return fromSafe;
    const toSafe = this.checkSafePath(to);
    if (!toSafe.ok) return toSafe;

    const fromFull = this.resolvePath(from);
    const toFull = this.resolvePath(to);

    try {
      const toDir = dirname(toFull);
      await fs.access(toDir).catch(async () => {
        if (toDir !== '') {
          await fs.mkdir(toDir, { recursive: true });
        }
      });

      await fs.rename(fromFull, toFull);
      return ok({ success: true, from: fromFull, to: toFull });
    } catch (e: any) {
      return err(mapFsError(e, fromFull));
    }
  }

  // ==========================================================
  // Mod/Modpack/资源包专用辅助
  // ============================================================

  /** 检查是否为 Mod 文件 */
  public isModFile(path: string): boolean {
    const ext = extname(path).toLowerCase();
    return MOD_EXTENSIONS.has(ext);
  }

  /** 获取文件扩展名 */
  public getExt(path: string): string {
    return extname(path);
  }

  /** 从 Mod 目录列出 Mod 清单 */
  public async listMods(): Promise<Result<{ id: string; name: string; version: string; loader: 'fabric' | 'neoforge' | 'unknown'; path: string }[], FileError>> {
    const modsDir = PATH_MANAGER.mods();
    const result: Array<{ id: string; name: string; version: string; loader: 'fabric' | 'neoforge' | 'unknown'; path: string }> = [];

    try {
      await fs.access(modsDir);
    } catch {
      return ok(result);
    }

    // 尝试读取 index.json
    const indexPath = resolve(modsDir, 'index.json');
    try {
      const indexText = await this.readText(indexPath);
      if (indexText.ok) {
        const index = JSON.parse(indexText.value);
        if (index.mods) {
          for (const [id, info] of Object.entries(index.mods)) {
            const infoObj = info as Record<string, unknown>;
            result.push({
              id,
              name: (infoObj.name as string) ?? id,
              version: (infoObj.version as string) ?? 'unknown',
              loader: (infoObj.loader as 'fabric' | 'neoforge' | 'unknown') ?? 'unknown',
              path: resolve(modsDir, id + ((infoObj.ext as string) ?? '.jar')),
            });
          }
          return ok(result.sort((a, b) => a.name.localeCompare(b.name)));
        }
      }
    } catch {
      // index.json 解析失败，退回到文件扫描
    }

    // 回退：直接扫描文件名
    try {
      const items = await fs.readdir(modsDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isFile() && this.isModFile(item.name)) {
          const id = item.name.replace(/\.[^/.]+$/, '');
          result.push({
            id,
            name: id,
            version: 'unknown',
            loader: 'unknown',
            path: resolve(modsDir, item.name),
          });
        }
      }
      return ok(result.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      return err(mapFsError(e, modsDir));
    }
  }

  /** 检查 Mod 是否已安装 */
  public async isModInstalled(modId: string): Promise<Result<boolean, FileError>> {
    const modsResult = await this.listMods();
    if (!modsResult.ok) return modsResult;
    return ok(modsResult.value.some((m) => m.id === modId));
  }

  /** 导入 Mod 文件（通过对话框选择） */
  public async importMod(): Promise<Result<{ success: boolean; path: string; error?: string }, FileError>> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择 Mod 文件',
      filters: [{ name: 'Mod Files', extensions: ['jar', 'json'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return ok({ success: false, path: '', error: 'User canceled' });
    }

    const selectedPath = result.filePaths[0];
    const fileName = selectedPath.split('/').pop() || 'unknown-mod';
    const targetPath = resolve(PATH_MANAGER.mods(), fileName);

    try {
      const content = await fs.readFile(selectedPath);
      await fs.writeFile(targetPath, content);
      return ok({ success: true, path: targetPath });
    } catch (e: any) {
      return err(mapFsError(e, selectedPath));
    }
  }

  /** 列出 Modpack 清单 */
  public async listModpacks(): Promise<Result<Array<{ id: string; name: string; mcVersion: string; description: string; path: string }>, FileError>> {
    const modpacksDir = PATH_MANAGER.modpacks();
    const result: Array<{ id: string; name: string; mcVersion: string; description: string; path: string }> = [];

    try {
      await fs.access(modpacksDir);
    } catch {
      return ok(result);
    }

    try {
      const items = await fs.readdir(modpacksDir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const packJsonPath = resolve(modpacksDir, item.name, 'pack.json');
          try {
            const packText = await this.readText(packJsonPath);
            if (packText.ok) {
              const packData = JSON.parse(packText.value);
              result.push({
                id: item.name,
                name: packData.name ?? item.name,
                mcVersion: packData.mcVersion ?? 'unknown',
                description: packData.description ?? '',
                path: resolve(modpacksDir, item.name),
              });
            } else {
              result.push({
                id: item.name,
                name: item.name,
                mcVersion: 'unknown',
                description: '',
                path: resolve(modpacksDir, item.name),
              });
            }
          } catch {
            result.push({
              id: item.name,
              name: item.name,
              mcVersion: 'unknown',
              description: '',
              path: resolve(modpacksDir, item.name),
            });
          }
        }
      }
      return ok(result.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      return err(mapFsError(e, modpacksDir));
    }
  }

  /** 创建新 Modpack */
  public async createModpack(name: string, mcVersion: string, description: string = ''): Promise<Result<MakeDirResult, FileError>> {
    const modpacksDir = PATH_MANAGER.modpacks();
    const newDir = resolve(modpacksDir, name);

    const dirResult = await this.makeDir(newDir);
    if (!dirResult.ok) return dirResult;

    const packJson = JSON.stringify({ name, mcVersion, description }, null, 2);
    const packPath = resolve(newDir, 'pack.json');
    const writeResult = await this.writeText(packPath, packJson);
    if (!writeResult.ok) return writeResult;

    return ok({ success: true, path: newDir });
  }

  /** 列出资源包 */
  public async listResourcePacks(): Promise<Result<Array<{ name: string; path: string; mcVersion?: string }>, FileError>> {
    const dir = PATH_MANAGER.resourcePacks();
    const result: Array<{ name: string; path: string; mcVersion?: string }> = [];

    try {
      await fs.access(dir);
    } catch {
      return ok(result);
    }

    try {
      const items = await fs.readdir(dir, { withFileTypes: true });
      for (const item of items) {
        if (item.isDirectory()) {
          const packPath = resolve(dir, item.name);
          if (this.isModFile(packPath) || item.name.toLowerCase().endsWith(RESOURCE_PACK_EXT)) {
            result.push({ name: item.name, path: packPath });
          }
        } else if (item.isFile() && item.name.toLowerCase().endsWith(RESOURCE_PACK_EXT)) {
          result.push({ name: item.name, path: resolve(dir, item.name) });
        }
      }
      return ok(result.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e: any) {
      return err(mapFsError(e, dir));
    }
  }

  /** 导入资源包 */
  public async importResourcePack(): Promise<Result<{ success: boolean; path: string; error?: string }, FileError>> {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      title: '选择资源包 (.zip)',
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return ok({ success: false, path: '', error: 'User canceled' });
    }

    const selectedPath = result.filePaths[0];
    const fileName = selectedPath.split('/').pop() || 'resource-pack';
    const targetPath = resolve(PATH_MANAGER.resourcePacks(), fileName);

    try {
      const content = await fs.readFile(selectedPath);
      await fs.writeFile(targetPath, content);
      return ok({ success: true, path: targetPath });
    } catch (e: any) {
      return err(mapFsError(e, selectedPath));
    }
  }

  // ==========================================================
  // 项目感知便捷方法（自动拼接 PROJECT_SCOPED 路径）
  // ============================================================

  /** 获取项目工作区根目录 */
  public getProjectWorkspace(projectId: string): string {
    return PROJECT_SCOPED.workspace(projectId);
  }

  /** 列出项目目录（相对路径） */
  public async listProjectDir(projectId: string, relPath: string = ''): Promise<Result<DirEntry[], FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.listDir(fullPath);
  }

  /** 读取项目文件（相对路径） */
  public async readProjectFile(projectId: string, relPath: string, encoding?: ReadEncoding): Promise<Result<string, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.readText(fullPath, encoding);
  }

  /** 写入项目文件（相对路径，自动建目录） */
  public async writeProjectFile(projectId: string, relPath: string, content: string, encoding?: ReadEncoding): Promise<Result<void, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.writeText(fullPath, content, encoding);
  }

  /** 获取项目文件元数据（相对路径） */
  public async getProjectFileMeta(projectId: string, relPath: string): Promise<Result<FileMetaWithHash, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.getFileMeta(fullPath);
  }

  /** 带元数据校验的项目文件写入（相对路径） */
  public async writeProjectFileWithMeta(
    projectId: string,
    relPath: string,
    content: string,
    expectedMeta?: FileMetaWithHash,
    encoding?: ReadEncoding
  ): Promise<Result<FileMetaWithHash, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.writeTextWithMeta(fullPath, content, expectedMeta, encoding);
  }

  /** 创建项目目录（相对路径） */
  public async makeProjectDir(projectId: string, relPath: string): Promise<Result<MakeDirResult, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.makeDir(fullPath);
  }

  /** 删除项目文件/目录（相对路径） */
  public async deleteProjectItem(projectId: string, relPath: string): Promise<Result<DeleteResult, FileError>> {
    const fullPath = resolve(PROJECT_SCOPED.workspace(projectId), relPath);
    return this.deleteItem(fullPath);
  }

  /** 获取项目输出目录 */
  public getProjectOutputDir(projectId: string): string {
    return PROJECT_SCOPED.output(projectId);
  }

  /** 获取项目构建缓存目录 */
  public getProjectBuildCacheDir(projectId: string): string {
    return PROJECT_SCOPED.buildCache(projectId);
  }

  /** 获取项目临时目录 */
  public getProjectTempDir(projectId: string): string {
    return PROJECT_SCOPED.temp(projectId);
  }

  /** 获取项目资源包目录 */
  public getProjectResourcePacksDir(projectId: string): string {
    return PROJECT_SCOPED.resourcePacks(projectId);
  }

  /** 获取项目 Mod 目录 */
  public getProjectModsDir(projectId: string): string {
    return PROJECT_SCOPED.mods(projectId);
  }

  /** 获取项目导出目录 */
  public getProjectExportsDir(projectId: string): string {
    return PROJECT_SCOPED.exports(projectId);
  }

  /** 确保项目所有标准子目录存在 */
  public async ensureProjectDirs(projectId: string): Promise<Result<void, FileError>> {
    const dirs = [
      PROJECT_SCOPED.workspace(projectId),
      PROJECT_SCOPED.output(projectId),
      PROJECT_SCOPED.buildCache(projectId),
      PROJECT_SCOPED.temp(projectId),
      PROJECT_SCOPED.resourcePacks(projectId),
      PROJECT_SCOPED.mods(projectId),
      PROJECT_SCOPED.exports(projectId),
    ];
    for (const dir of dirs) {
      const result = await this.makeDir(dir);
      if (!result.ok) return result;
    }
    return ok(undefined);
  }
}

// 导出单例便捷访问
export const fileManager = FileManager.getInstance();

export default FileManager;