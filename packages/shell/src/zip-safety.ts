/**
 * packages/shell · 压缩包安全
 * 设计文档 §13.1：所有解压必须校验条目路径（拒绝绝对路径与 `../` 逃逸，
 * 即 zip-slip）、限制解压后总大小与文件数（防压缩炸弹）、拒绝符号链接。
 *
 * 本模块提供“解压前校验”纯函数，供后续 JSZip / yauzl 等解压实现调用：
 * 先对每个条目调 `assertSafeEntry`，再对条目清单调 `checkZipLimits`，
 * 两步都通过后再落盘。
 *
 * 纯模块：只用字符串与数值运算，无 node: / Electron 依赖。
 */

export type ZipSafetyCode =
  | 'ABSOLUTE_PATH'
  | 'TRAVERSAL'
  | 'SYMLINK'
  | 'TOO_MANY_ENTRIES'
  | 'TOTAL_TOO_LARGE'
  | 'RATIO_TOO_HIGH';

export class ZipSafetyError extends Error {
  readonly code: ZipSafetyCode;
  readonly entry?: string;

  constructor(code: ZipSafetyCode, message: string, entry?: string) {
    super(message);
    this.name = 'ZipSafetyError';
    this.code = code;
    if (entry !== undefined) this.entry = entry;
  }
}

/** 代码中文文案（§4.5 文案映射层）。 */
export const ZIP_SAFETY_ZH: Record<ZipSafetyCode, string> = {
  ABSOLUTE_PATH: '压缩包条目为绝对路径，已拒绝',
  TRAVERSAL: '压缩包条目试图逃逸目标目录，已拒绝',
  SYMLINK: '压缩包条目为符号链接，已拒绝',
  TOO_MANY_ENTRIES: '压缩包文件数量超过上限，已拒绝',
  TOTAL_TOO_LARGE: '压缩包解压后总大小超过上限，已拒绝',
  RATIO_TOO_HIGH: '压缩包解压比异常（疑似压缩炸弹），已拒绝',
};

/** 供 JSZip 解压前校验的条目形态（调用方自行从 JSZip 对象映射）。 */
export interface ZipEntryLike {
  /** 包内原始路径（`/` 或 `\` 分隔均可）。 */
  name: string;
  /** 解压后大小（字节）。 */
  size: number;
  /** 压缩后大小（字节，用于解压比；未知可缺省）。 */
  compressedSize?: number;
  /** 是否符号链接（JSZip：由 unix mode / symlink 属性判定后传入）。 */
  isSymlink?: boolean;
}

export interface ZipLimits {
  /** 最大条目数，默认 10000。 */
  maxEntries: number;
  /** 解压后总大小上限（字节），默认 2GB。 */
  maxTotalSize: number;
  /** 解压比上限（总解压 / 总压缩），默认 100。 */
  maxRatio: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10000,
  maxTotalSize: 2 * 1024 * 1024 * 1024,
  maxRatio: 100,
};

const DRIVE_SEGMENT_RE = /^[a-zA-Z]:$/;

/**
 * unix mode 是否符号链接（S_IFLNK = 0o120000）。
 * JSZip 调用方可取 `(entry.unixDosPermissions >>> 16)` 传入判定。
 */
export function isSymlinkUnixMode(mode: number): boolean {
  return (mode & 0o170000) === 0o120000;
}

/**
 * 校验单个条目路径，返回归一化后的相对路径（`/` 分隔）。
 * 拒绝：空名 / NUL 字节 / 绝对路径（含盘符与 UNC）/ `..` 逃逸 / 符号链接。
 */
export function assertSafeEntry(name: string, opts: { isSymlink?: boolean } = {}): string {
  if (opts.isSymlink === true) {
    throw new ZipSafetyError('SYMLINK', `${ZIP_SAFETY_ZH.SYMLINK}：${name}`, name);
  }
  if (name === '' || name.includes('\0')) {
    throw new ZipSafetyError('TRAVERSAL', `${ZIP_SAFETY_ZH.TRAVERSAL}：${JSON.stringify(name)}`, name);
  }
  if (name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) {
    throw new ZipSafetyError('ABSOLUTE_PATH', `${ZIP_SAFETY_ZH.ABSOLUTE_PATH}：${name}`, name);
  }
  const unified = name.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:\//.test(unified)) {
    throw new ZipSafetyError('ABSOLUTE_PATH', `${ZIP_SAFETY_ZH.ABSOLUTE_PATH}：${name}`, name);
  }
  const segments = unified.split('/');
  for (const seg of segments) {
    if (seg === '..' || DRIVE_SEGMENT_RE.test(seg)) {
      throw new ZipSafetyError('TRAVERSAL', `${ZIP_SAFETY_ZH.TRAVERSAL}：${name}`, name);
    }
  }
  const normalized = segments.filter((s) => s !== '' && s !== '.').join('/');
  if (normalized === '' || normalized.startsWith('..')) {
    throw new ZipSafetyError('TRAVERSAL', `${ZIP_SAFETY_ZH.TRAVERSAL}：${name}`, name);
  }
  return normalized;
}

/** 批量校验：任一条目非法即抛（携带首个非法条目）。 */
export function assertSafeEntries(entries: ZipEntryLike[]): string[] {
  return entries.map((e) =>
    e.isSymlink === undefined
      ? assertSafeEntry(e.name)
      : assertSafeEntry(e.name, { isSymlink: e.isSymlink }),
  );
}

export interface ZipLimitsReport {
  count: number;
  totalSize: number;
  totalCompressed: number;
  ratio: number;
}

/**
 * 压缩炸弹限额检查（条目数 / 总大小 / 解压比）。
 * ratio 仅在调用方提供了压缩后大小时判定（totalCompressed > 0），
 * 否则跳过比值项（条目数与总大小两项仍生效）。
 */
export function checkZipLimits(
  entries: ZipEntryLike[],
  limits: Partial<ZipLimits> = {},
): ZipLimitsReport {
  const { maxEntries, maxTotalSize, maxRatio } = { ...DEFAULT_ZIP_LIMITS, ...limits };
  const count = entries.length;
  if (count > maxEntries) {
    throw new ZipSafetyError(
      'TOO_MANY_ENTRIES',
      `${ZIP_SAFETY_ZH.TOO_MANY_ENTRIES}（${count} > ${maxEntries}）`,
    );
  }
  let totalSize = 0;
  let totalCompressed = 0;
  let hasCompressed = false;
  for (const e of entries) {
    totalSize += e.size;
    if (e.compressedSize !== undefined) {
      totalCompressed += e.compressedSize;
      hasCompressed = true;
    }
  }
  if (totalSize > maxTotalSize) {
    throw new ZipSafetyError(
      'TOTAL_TOO_LARGE',
      `${ZIP_SAFETY_ZH.TOTAL_TOO_LARGE}（${totalSize} > ${maxTotalSize}）`,
    );
  }
  const ratio = hasCompressed ? totalSize / Math.max(totalCompressed, 1) : 1;
  if (hasCompressed && ratio > maxRatio) {
    throw new ZipSafetyError(
      'RATIO_TOO_HIGH',
      `${ZIP_SAFETY_ZH.RATIO_TOO_HIGH}（${ratio.toFixed(1)} > ${maxRatio}）`,
    );
  }
  return { count, totalSize, totalCompressed, ratio };
}
