/**
 * §5.4 整合包增量更新：判定「目标文件已经是期望内容」→ 跳过下载。
 *
 * 为什么需要：整合包动辄 2GB。修复前 installModpack 对 plans 里**每个**文件都
 * 无条件 downloadFile，等于每次更新都把整包重下一遍（「大整合包全量重下的体验
 * 不可接受」）。mrpack 的 `files[].hashes.sha512` 是格式要求的字段（见 mrpack.ts），
 * 正好能回答「本地这份已经是不是我要的那份」。
 *
 * 判定口径（保守优先：宁可多下一个字节，也不要「更新没生效」这种极难排查的 bug）：
 * 1. 计划没有 sha512（CurseForge manifest 本身不含哈希，直链要上层 API 解析后回填，
 *    回填可能不带哈希）→ **一律下载**。刻意**不**拿 size 兜底：size 相同不等于内容
 *    相同（同尺寸不同版本的 jar、等长但被构造过的文件都成立），误判跳过就是
 *    「更新没生效」，而且事后几乎无从查证。拿不到内容级证据就不猜。
 * 2. 期望值不是 128 位十六进制 → 不可能与任何本地文件匹配，不必读盘，直接下载，
 *    让 engine.verifyHash 照旧报 HASH_MISMATCH（保持原有失败语义不变）。
 * 3. 目标文件不存在 → 下载（首次安装 / 用户删了 / 上次下载失败）。
 * 4. 目标存在且流式 sha512 与期望一致 → 跳过下载，只登记产物（sha256 顺带算出）。
 * 5. 目标存在但 sha512 不一致 → 下载覆盖（本地被改 / 整合包换了版本）。
 * 6. 目标存在但读不出来（无权限 / 是目录 / 并发被删）→ 退化为下载：
 *    「读本地失败」不该让整次更新失败。
 *
 * 摘要一律 64KiB 分块流式计算（与 engine/src/download.ts 的 hashFile 同一口径）：
 * 内存占用与文件大小无关，2GB 的 jar 也不会被整块读进内存。一次读取同时算
 * sha256（产物哈希 §0.5）与 sha512（跳过判据），大包不必读两遍盘。
 */

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';

/** 单个文件的两种摘要（一次流式读取同时算出）。 */
export interface FileDigest {
  sha256: string;
  sha512: string;
}

/** 分块大小：哈希过程的内存上限 = 64KiB，与文件大小无关。 */
export const DIGEST_CHUNK_SIZE = 64 * 1024;

/** 合法 sha512 十六进制（512bit = 128 hex 位）。 */
const SHA512_HEX = /^[0-9a-f]{128}$/i;

/** 这一份为什么必须下载（便于回答「为什么又全量重下了」）。 */
export type DownloadReason =
  /** 目标不存在：首次安装 / 被用户删了 / 上次下载失败 */
  | 'absent'
  /** 目标存在但 sha512 与计划不一致：本地被改 / 整合包换版本 */
  | 'changed'
  /** 计划没有 sha512：无法证明本地已是期望内容（CurseForge 直链未回填哈希） */
  | 'no-expected-hash'
  /** 计划里的 sha512 格式非法：本地不可能匹配，交给引擎校验报错 */
  | 'invalid-expected-hash'
  /** 目标存在但读不出来：保守起见重新下载，不让整次更新失败 */
  | 'unreadable';

export type LocalVerdict =
  /** 本地已是期望内容：可跳过下载，sha256 直接用于产物哈希 */
  { kind: 'unchanged'; sha256: string } | { kind: 'download'; reason: DownloadReason };

/** 十六进制大小写不敏感比较（mrpack 是小写，上层回填的可能是大写）。 */
export function sameDigest(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** 分块流式算 sha256 + sha512（大文件不整块进内存）。返回小写十六进制。 */
export async function digestFile(filePath: string): Promise<FileDigest> {
  const sha256 = createHash('sha256');
  const sha512 = createHash('sha512');
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(DIGEST_CHUNK_SIZE);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length);
      if (bytesRead === 0) break;
      const chunk = buf.subarray(0, bytesRead);
      sha256.update(chunk);
      sha512.update(chunk);
    }
  } finally {
    await fh.close();
  }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('hex') };
}

/**
 * 判断目标文件是否已经是「计划里那份」，供 install_modpack 决定跳过还是下载。
 * 本函数**只读**：判定为 unchanged 时不碰目标文件，产物哈希由返回的 sha256 提供，
 * 因此跳过之后产物引用依然完整。
 */
export async function checkLocalFile(
  dest: string,
  expectedSha512: string | undefined,
): Promise<LocalVerdict> {
  if (expectedSha512 === undefined) {
    // 无内容级期望值 → 没有跳过依据，一律下载（见文件头第 1 条）。
    return { kind: 'download', reason: 'no-expected-hash' };
  }
  if (!SHA512_HEX.test(expectedSha512)) {
    // 非法期望值：任何本地文件都不可能匹配它，跳过读盘（省掉 2GB 的一次全读）。
    return { kind: 'download', reason: 'invalid-expected-hash' };
  }
  let isFile: boolean;
  try {
    isFile = (await stat(dest)).isFile();
  } catch {
    // 不存在 / 不可达 → 首次安装或已被删。
    return { kind: 'download', reason: 'absent' };
  }
  if (!isFile) {
    // 目录 / 设备文件 / 软链到目录：不是「一个已装好的 jar」，交给下载覆盖。
    return { kind: 'download', reason: 'changed' };
  }
  let digest: FileDigest;
  try {
    digest = await digestFile(dest);
  } catch {
    // 无权限 / 被并发删 / I/O 错误：读本地失败不该让整次更新失败，退化为下载。
    return { kind: 'download', reason: 'unreadable' };
  }
  if (!sameDigest(digest.sha512, expectedSha512)) {
    return { kind: 'download', reason: 'changed' };
  }
  // 逐字节相同的 sha512（碰撞概率可忽略）→ 跳过下载后产物与下载所得完全一致。
  return { kind: 'unchanged', sha256: digest.sha256 };
}
