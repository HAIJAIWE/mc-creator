/**
 * **最小 zip 读取器**（只读，不写）。
 *
 * ## 为什么自己写
 *
 * Node 有 `zlib.inflateRawSync`，但**没有** zip 容器解析。`.mrpack` 就是 zip，
 * 要读 `overrides/` 就必须能解开它。加一个依赖（yauzl / adm-zip / jszip）为了
 * 一个 200 行能写完、且只用到 ZIP 的一个子集的功能，不划算 —— 何况这个仓库
 * 的启动器侧是「纯 Node 原生实现，无第三方依赖」（见 launcher-service.ts 头注）。
 *
 * ## 范围：只支持「常规 zip」
 *
 * - 中央目录（不用 ZIP64 —— `.mrpack` 远达不到 4G / 65535 条目）
 * - 压缩方法 0（stored）与 8（deflate）—— 这两种占了现实世界 100%
 * - 不支持加密（`.mrpack` 不加密；遇到加密条目直接跳过并记录原因）
 *
 * 明确不支持的（遇到就**报错**而不是猜）：ZIP64、加密、多卷。
 * 静默跳过会让整合包「装完少了几个文件」而没人知道为什么。
 *
 * ## 安全：这是要写盘的
 *
 * 解出来的路径会直接落到 gameDir，所以必须挡：
 * - `../` / 绝对路径 / 盘符（`C:\`）—— 路径穿越
 * - 符号链接条目（external attributes 里 unix 模式是 symlink 的）—— 能指向盘外
 * - zip bomb（条目数 / 单文件 / 总量三重上限）
 *
 * 这些都不是理论风险：整合包是**任意第三方上传的 zip**。
 */

import { inflateRawSync } from 'node:zlib';

/** zip 条目（已按中央目录解析，尚未解压）。 */
export interface ZipEntry {
  /** zip 内的路径（已按 `posix` 规范化，但仍**未**验证安全性 —— 用 `safePath` 验）。 */
  name: string;
  /** 压缩后字节数。 */
  compressedSize: number;
  /** 解压后字节数（中央目录里给的值 —— 用它做上限判定，不给就信）。 */
  size: number;
  /** 压缩方法：0 = stored，8 = deflate。 */
  method: number;
  /** 本地文件头在 zip 内的偏移（中央目录给出的 `relative offset of local header`）。 */
  localOffset: number;
  /** 是否是目录。 */
  isDirectory: boolean;
  /** 是否加密（general purpose bit 0）。 */
  encrypted: boolean;
}

/** 上限。默认值按 `.mrpack` 的现实体量给（实测最大的整合包 < 200 MB）。 */
export interface ZipLimits {
  /** 条目数上限。 */
  maxEntries: number;
  /** 单个文件解压后大小上限。 */
  maxFileSize: number;
  /** 全部条目解压后总大小上限。 */
  maxTotalSize: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxFileSize: 128 * 1024 * 1024,
  maxTotalSize: 512 * 1024 * 1024,
};

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
/** ZIP64 结束记录 —— 出现即说明超出范围，不能当普通 zip 读。 */
const SIG_ZIP64_EOCD = 0x06064b50;

/** EOCD 的最大长度：22 字节固定 + 最多 65535 字节注释。 */
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_SIZE = 22 + 0xffff;

/** 从尾部倒着找 EOCD 签名（注释长度不固定，只能搜）。 */
function findEocd(buf: Buffer): number {
  const minStart = Math.max(0, buf.length - EOCD_MAX_SIZE);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * 解析中央目录。
 *
 * @throws 不是 zip / 是 ZIP64 / 条目超上限时抛错 —— 宁可明确失败，
 *   也不要「读出一半然后装出一个残缺的整合包」。
 */
export function readZipEntries(zip: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): ZipEntry[] {
  const eocd = findEocd(zip);
  if (eocd < 0) throw new Error('不是有效的 zip 文件（找不到中央目录）');

  // ZIP64：EOCD 之前紧挨着 0x06064b50 的记录。直接拒绝，别试图猜偏移。
  if (eocd >= 20 && zip.readUInt32LE(eocd - 20) === SIG_ZIP64_EOCD) {
    throw new Error('不支持 ZIP64 格式的 zip');
  }

  const totalEntries = zip.readUInt16LE(eocd + 10);
  if (totalEntries > limits.maxEntries) {
    throw new Error(`zip 条目过多：${totalEntries} > ${limits.maxEntries}`);
  }

  const entries: ZipEntry[] = [];
  let off = zip.readUInt32LE(eocd + 16);
  let totalSize = 0;

  for (let n = 0; n < totalEntries; n++) {
    if (off + 46 > zip.length || zip.readUInt32LE(off) !== SIG_CENTRAL) {
      throw new Error(`中央目录第 ${n} 项损坏`);
    }
    const flags = zip.readUInt16LE(off + 8);
    const method = zip.readUInt16LE(off + 10);
    const compressedSize = zip.readUInt32LE(off + 20);
    const size = zip.readUInt32LE(off + 24);
    const nameLen = zip.readUInt16LE(off + 28);
    const extraLen = zip.readUInt16LE(off + 30);
    const commentLen = zip.readUInt16LE(off + 32);
    const externalAttrs = zip.readUInt32LE(off + 38);
    const localOffset = zip.readUInt32LE(off + 42);
    const name = zip.subarray(off + 46, off + 46 + nameLen).toString('utf-8');

    // unix 权限在高 16 位。S_IFLNK = 0xA000 —— 符号链接能指向盘外，直接拒。
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) {
      throw new Error(`zip 含符号链接条目，拒绝解压: ${name}`);
    }

    const isDirectory = name.endsWith('/');
    if (!isDirectory) {
      totalSize += size;
      if (size > limits.maxFileSize) {
        throw new Error(`zip 内单个文件过大: ${name}（${size} > ${limits.maxFileSize}）`);
      }
      if (totalSize > limits.maxTotalSize) {
        throw new Error(`zip 解压后总量过大（> ${limits.maxTotalSize}）`);
      }
    }

    entries.push({
      name,
      compressedSize,
      size,
      method,
      localOffset,
      isDirectory,
      encrypted: (flags & 0x0001) !== 0,
    });

    off += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * 解出一个条目的内容。
 *
 * 用中央目录给的 `localOffset` 直接定位 —— **不做全文件扫描**。
 * 扫描版是 O(条目数 × 文件大小)，实测 `.mrpack` 3000 个条目就是几亿次
 * 比较，解一次要好几秒。
 */
export function readZipFile(
  zip: Buffer,
  entry: ZipEntry,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): Buffer {
  if (entry.isDirectory) return Buffer.alloc(0);
  if (entry.encrypted) throw new Error(`zip 条目已加密，无法读取: ${entry.name}`);

  const lo = entry.localOffset;
  if (lo + 30 > zip.length || zip.readUInt32LE(lo) !== SIG_LOCAL) {
    throw new Error(`本地文件头损坏: ${entry.name}`);
  }
  const nameLen = zip.readUInt16LE(lo + 26);
  const extraLen = zip.readUInt16LE(lo + 28);
  const localName = zip.subarray(lo + 30, lo + 30 + nameLen).toString('utf-8');
  // 中央目录与本地头的名字必须一致。不一致说明偏移被伪造或文件损坏 ——
  // 不校验的话会拿 A 的偏移去读 B 的数据。
  if (localName !== entry.name) {
    throw new Error(`本地文件头名字不符: ${entry.name} vs ${localName}`);
  }

  const dataStart = lo + 30 + nameLen + extraLen;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > zip.length) {
    throw new Error(`zip 条目数据越界: ${entry.name}`);
  }
  const raw = zip.subarray(dataStart, dataEnd);

  let out: Buffer;
  if (entry.method === 0) {
    out = Buffer.from(raw);
  } else if (entry.method === 8) {
    try {
      out = inflateRawSync(raw);
    } catch (e) {
      throw new Error(`解压失败: ${entry.name}（${(e as Error).message}）`);
    }
  } else {
    throw new Error(`不支持的压缩方法 ${entry.method}: ${entry.name}`);
  }

  // 中央目录里的 size 不可全信（可被伪造），解压后再核一次 —— 这是最后一道闸
  if (out.length > limits.maxFileSize) {
    throw new Error(`解压后单文件过大: ${entry.name}`);
  }
  return out;
}

/**
 * 把 zip 内路径规整成**可安全写盘**的相对路径。
 *
 * 返回 `null` 表示这个条目必须被拒绝（路径穿越 / 绝对路径 / 越界）。
 * 调用方要把 `null` 当成**安装失败**报告出来，不能静默跳过。
 *
 * 挡的几种：
 * - `../x`、`a/../../x` —— 目录穿越
 * - `/etc/passwd` —— 绝对路径（zip 里以 `/` 开头）
 * - `C:\Windows\...` —— 盘符
 * - `a\..\..\b` —— **反斜杠**：zip 规范用 `/`，但恶意/畸形打包器会给 `\`
 * - 空段 / `.` 段 —— 规整掉，不算错误
 */
export function safePath(name: string): string | null {
  // 先统一分隔符。Windows 上 `\` 是路径分隔符，`/` 也被 Node 认成，
  // 所以**只要见过一个反斜杠就必须当分隔符处理**，不能当普通字符。
  const unified = name.replace(/\\/g, '/');
  if (unified.startsWith('/')) return null; // 绝对路径
  if (/^[a-zA-Z]:/.test(unified)) return null; // 盘符

  const out: string[] = [];
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') continue; // 空段 / 当前目录
    if (seg === '..') return null; // 上跳 —— 一律拒绝，不做「弹回去」的解析
    out.push(seg);
  }
  if (out.length === 0) return null;
  return out.join('/');
}

/** 一遍读完 zip：返回 { 条目名 → 内容 }。 */
export function unzip(zip: Buffer, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const entry of readZipEntries(zip, limits)) {
    if (entry.isDirectory) continue;
    out.set(entry.name, readZipFile(zip, entry, limits));
  }
  return out;
}
