// ============================================================
// 统一错误类型定义
// ============================================================

/** 文件元数据（基础版，用于目录项等） */
export interface FileMeta {
  size: number;
  mtime: number;
  isDirectory: boolean;
}

/** 文件元数据（含哈希，用于冲突检测） */
export interface FileMetaWithHash extends FileMeta {
  hash: string;
}

/** 统一文件错误类型 */
export type FileError =
  | { code: 'NOT_FOUND'; path: string; message: string }
  | { code: 'PERMISSION_DENIED'; path: string; message: string }
  | {
      code: 'CONFLICT';
      path: string;
      serverMeta: FileMetaWithHash;
      localMeta: FileMetaWithHash;
      message: string;
    }
  | { code: 'DISK_FULL'; path: string; message: string }
  | { code: 'INVALID_PATH'; path: string; message: string }
  | { code: 'UNKNOWN'; message: string };

/** Result 类型：成功或失败 */
export type Result<T, E = FileError> = { ok: true; value: T } | { ok: false; error: E };

/** 创建成功 Result */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** 创建失败 Result */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/** 从 Node.js 错误码映射到 FileError */
export function mapFsError(error: NodeJS.ErrnoException, path: string): FileError {
  switch (error.code) {
    case 'ENOENT':
      return { code: 'NOT_FOUND', path, message: `File not found: ${path}` };
    case 'EACCES':
    case 'EPERM':
      return { code: 'PERMISSION_DENIED', path, message: `Permission denied: ${path}` };
    case 'ENOSPC':
      return { code: 'DISK_FULL', path, message: `Disk full: ${path}` };
    case 'EINVAL':
    case 'ENAMETOOLONG':
      return { code: 'INVALID_PATH', path, message: `Invalid path: ${path}` };
    case 'EEXIST':
      return {
        code: 'CONFLICT',
        path,
        message: `File already exists: ${path}`,
        serverMeta: {
          size: 0,
          mtime: 0,
          isDirectory: false,
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
        },
        localMeta: {
          size: 0,
          mtime: 0,
          isDirectory: false,
          hash: 'd41d8cd98f00b204e9800998ecf8427e',
        },
      };
    default:
      return { code: 'UNKNOWN', message: error.message };
  }
}

/** 判断是否为大文件（> 10MB） */
export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

/** 分片读取配置 */
export const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
