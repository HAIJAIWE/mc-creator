/**
 * packages/shell · 文件原子写
 * 设计文档 §14（原子性：下载 → 临时目录 → 校验 → 原子重命名；失败可回滚）
 * + §4.2（文件原子写：临时目录 → 校验 → 原子重命名）。
 *
 * 参考 apps/desktop project-store.ts writeProjectFile 的 tmp+rename 写法，
 * 在此补齐生产级缺口：同目录 tmp（rename 同分区原子）、fsync 落盘、
 * 父目录自动创建、Windows 长路径 `\\?\` 处理、可选 sha256。
 *
 * 纯函数模块：只用 node: 内置模块，无 Electron 依赖。
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface AtomicWriteOptions {
  /** 文本写入编码（data 为 string 时使用），默认 'utf8'。 */
  encoding?: BufferEncoding;
  /** 写入文件 mode，默认 0o666（受 umask 影响）。 */
  mode?: number;
  /** tmp 落盘前是否 fsync，默认 true。 */
  fsync?: boolean;
  /** 是否返回写入内容的 sha256（§0.5 产物哈希约束），默认 false。 */
  hash?: boolean;
}

export interface AtomicWriteResult {
  /** 解析后的目标绝对路径。 */
  path: string;
  /** options.hash 为 true 时返回（hex 小写）。 */
  sha256?: string;
}

/**
 * Windows 扩展长度路径（§14 长路径：统一走 `\\?\`）。
 * 非 Windows 原样返回；已带前缀的不重复添加；
 * UNC（`\\server\share`）按规范转为 `\\?\UNC\server\share`。
 */
export function toExtendedLengthPath(p: string): string {
  if (process.platform !== 'win32') return p;
  if (p.startsWith('\\\\?\\')) return p;
  if (p.startsWith('\\\\')) return `\\\\?\\UNC\\${p.slice(2)}`;
  return `\\\\?\\${p}`;
}

/** 计算 sha256（hex），string 按 encoding 编码。 */
export function sha256Hex(data: string | Uint8Array, encoding: BufferEncoding = 'utf8'): string {
  const buf = typeof data === 'string' ? Buffer.from(data, encoding) : data;
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * 原子写文件：父目录自动创建 → 同目录 tmp 写入 → fsync → rename。
 * tmp 与目标同目录，保证 rename 不跨分区、具备原子性；
 * 失败时清理 tmp 残留后抛出原错（§14 失败可回滚）。
 */
export async function writeFileAtomic(
  targetPath: string,
  data: string | Uint8Array,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const { encoding = 'utf8', mode, fsync = true, hash = false } = options;
  const resolved = resolve(targetPath);
  const parent = dirname(resolved);
  await mkdir(toExtendedLengthPath(parent), { recursive: true });

  const tmpPath = `${resolved}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
  const tmpLong = toExtendedLengthPath(tmpPath);
  try {
    await writeFile(tmpLong, data, mode === undefined ? { encoding } : { encoding, mode });
    if (fsync) {
      const handle = await open(tmpLong, 'r+');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    await rename(tmpLong, toExtendedLengthPath(resolved));
  } catch (e) {
    await rm(tmpLong, { force: true }).catch(() => undefined);
    throw e;
  }

  return hash
    ? { path: resolved, sha256: sha256Hex(data, encoding) }
    : { path: resolved };
}
