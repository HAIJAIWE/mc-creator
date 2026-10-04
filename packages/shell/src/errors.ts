/**
 * packages/shell · 错误分类与中文文案
 * 设计文档 §14（错误分类：网络 / 校验 / 版本 / 磁盘 / 权限 / 未知，
 * 每类对应独立文案与重试策略）+ §4.5（错误文案映射层）。
 *
 * 与 packages/contract 的协作：
 * - `ShellClassifiedError` 与 contract `ClassifiedError` 结构一致
 *   （category / message / code? / retryable?），可直接把本包产物
 *   传给内核 `TaskResult.error`，无需转换。
 * - `FileErrorDetail.code` 覆盖 apps/desktop `file-error.ts` 的主要码；
 *   桌面端 `PERMISSION_DENIED` 在此统一为 `PERMISSION`，
 *   对接旧代码时做一次码名映射即可（见 fileErrorCodeFromDesktop）。
 *
 * 纯模块：只用类型与字符串表，无 node: / Electron 依赖。
 */

/** §14 六分类（与 contract ClassifiedError.category 一致）。 */
export type ErrorCategory =
  | 'network'
  | 'validation'
  | 'version'
  | 'disk'
  | 'permission'
  | 'unknown';

/** 与 contract ClassifiedError 同构的分类错误。 */
export interface ShellClassifiedError {
  category: ErrorCategory;
  message: string;
  code?: string;
  retryable?: boolean;
}

/**
 * 文件错误码（§13.3 供应链校验 / §14 磁盘与权限）。
 * 桌面端 file-error.ts 用 `PERMISSION_DENIED`，此处收敛为 `PERMISSION`。
 */
export type FileErrorCode =
  | 'NOT_FOUND'
  | 'PERMISSION'
  | 'CONFLICT'
  | 'DISK_FULL'
  | 'INVALID_PATH'
  | 'UNKNOWN';

export interface FileErrorDetail {
  code: FileErrorCode;
  /** 出错路径（UNKNOWN 允许缺省）。 */
  path?: string;
  message: string;
}

/** 六分类中文标题（§4.5 文案映射层）。 */
export const CLASSIFIED_ERROR_ZH: Record<ErrorCategory, string> = {
  network: '网络错误',
  validation: '校验失败',
  version: '版本不匹配',
  disk: '磁盘错误',
  permission: '权限不足',
  unknown: '未知错误',
};

/** 六分类中文说明 + 重试建议。 */
export const CLASSIFIED_ERROR_DESC_ZH: Record<ErrorCategory, string> = {
  network: '网络错误，请检查网络连接后重试。',
  validation: '文件校验失败，下载内容可能已损坏，请重新下载。',
  version: '版本不匹配，请确认版本号后重试。',
  disk: '磁盘空间不足或写入失败，请清理磁盘后重试。',
  permission: '权限不足，请以有足够权限的方式运行后重试。',
  unknown: '发生未知错误，请查看日志后重试。',
};

/** 文件错误码中文标题。 */
export const FILE_ERROR_ZH: Record<FileErrorCode, string> = {
  NOT_FOUND: '文件不存在',
  PERMISSION: '没有访问权限',
  CONFLICT: '文件冲突',
  DISK_FULL: '磁盘空间不足',
  INVALID_PATH: '非法路径',
  UNKNOWN: '未知文件错误',
};

/** 分类 → 是否可重试（§14 每类对应独立重试策略）。 */
export const CATEGORY_RETRYABLE: Record<ErrorCategory, boolean> = {
  network: true,
  validation: true,
  version: false,
  disk: false,
  permission: false,
  unknown: false,
};

/** 分类中文标题。 */
export function classifiedTitle(category: ErrorCategory): string {
  return CLASSIFIED_ERROR_ZH[category];
}

/** 分类中文说明（含重试建议）。 */
export function classifiedMessage(category: ErrorCategory): string {
  return CLASSIFIED_ERROR_DESC_ZH[category];
}

/** 文件错误中文标题。 */
export function fileErrorTitle(code: FileErrorCode): string {
  return FILE_ERROR_ZH[code];
}

/** 文件错误中文文案（可选带路径）。 */
export function fileErrorMessage(code: FileErrorCode, path?: string): string {
  const title = FILE_ERROR_ZH[code];
  return path === undefined || path === '' ? title : `${title}：${path}`;
}

/** 分类错误完整中文文案（标题 + 说明）。 */
export function classifiedFullMessage(category: ErrorCategory): string {
  return `${CLASSIFIED_ERROR_ZH[category]}：${CLASSIFIED_ERROR_DESC_ZH[category]}`;
}

/** 构造分类错误（自动填充该分类的重试策略默认值）。 */
export function makeClassifiedError(
  category: ErrorCategory,
  message: string,
  code?: string,
  retryable?: boolean,
): ShellClassifiedError {
  return {
    category,
    message,
    ...(code === undefined ? {} : { code }),
    retryable: retryable ?? CATEGORY_RETRYABLE[category],
  };
}

/** Node.js fs 错误码 → 文件错误码（参考 desktop file-error.ts mapFsError）。 */
export function mapFsCodeToFileError(errnoCode: string | undefined): FileErrorCode {
  switch (errnoCode) {
    case 'ENOENT':
      return 'NOT_FOUND';
    case 'EACCES':
    case 'EPERM':
    case 'EISDIR':
      return 'PERMISSION';
    case 'ENOSPC':
    case 'EDQUOT':
      return 'DISK_FULL';
    case 'EINVAL':
    case 'ENAMETOOLONG':
    case 'ENOTDIR':
      return 'INVALID_PATH';
    case 'EEXIST':
      return 'CONFLICT';
    default:
      return 'UNKNOWN';
  }
}

/** Node.js 异常 → FileErrorDetail（含中文 message）。 */
export function toFileError(error: unknown, path?: string): FileErrorDetail {
  const errnoCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const code = mapFsCodeToFileError(errnoCode);
  return { code, ...(path === undefined ? {} : { path }), message: fileErrorMessage(code, path) };
}

/** 文件错误码 → §14 六分类。 */
export function fileErrorToCategory(code: FileErrorCode): ErrorCategory {
  switch (code) {
    case 'DISK_FULL':
      return 'disk';
    case 'PERMISSION':
      return 'permission';
    case 'NOT_FOUND':
    case 'INVALID_PATH':
    case 'CONFLICT':
      return 'validation';
    case 'UNKNOWN':
      return 'unknown';
  }
}

/**
 * 桌面端旧码名 → 本包码名（desktop `PERMISSION_DENIED` → `PERMISSION`，
 * 其余直通；未知码 → `UNKNOWN`）。
 */
export function fileErrorCodeFromDesktop(code: string): FileErrorCode {
  switch (code) {
    case 'NOT_FOUND':
    case 'CONFLICT':
    case 'DISK_FULL':
    case 'INVALID_PATH':
    case 'UNKNOWN':
      return code;
    case 'PERMISSION_DENIED':
      return 'PERMISSION';
    default:
      return 'UNKNOWN';
  }
}
