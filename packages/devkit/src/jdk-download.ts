/**
 * JDK 自动下载（设计文档 §8.1#1 / §5.1）。
 *
 * - 地址：Adoptium v3 API（公开文档）：
 *   https://api.adoptium.net/v3/binary/latest/{ver}/ga/{os}/{arch}/jdk/hotspot/normal/eclipse
 *   URL 拼装隔离在纯函数 adoptiumBinaryUrl 内并单测 —— API 若有出入只改这一个函数。
 * - 缓存：<cacheDir>/<大版本>/，内含 .ready 文件即视为已就绪（source='cache'），否则下载。
 * - 下载：全局 fetch（可注入 fetchImpl），单次超时默认 30s（JDK 包几百 MB，
 *   比 engine/download.ts 的 10s 放宽是刻意的）；重试策略对齐 engine/download.ts：
 *   仅 5xx / 429 / 网络错误重试（默认 2 次，退避 300ms / 600ms），4xx 直接抛。
 * - 解压：零第三方（devkit 依赖只有 contract + jobobject，不许 import shell/engine）。
 *   默认实现 extractZip 为最小 zip 解析（STORE/DEFLATE，经 node:zlib），含 ZipSlip
 *   拦截；tar.gz（gzip 魔数）抛明确不支持错 —— Windows（zip）是本期必经之路。
 *   调用方可注入 extract（测试 mock 解压层即走此口）。
 * - 错误：下载失败必须让调用方知道 —— 抛结构化 JdkDownloadError
 *   { category, message, retryable, code? }，与 engine/download.ts 的 ClassifiedError
 *   同形（category:'network' 可重试由 retryable 表达），不新造体系。
 */

import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export type AdoptiumOs = 'windows' | 'mac' | 'linux';
export type AdoptiumArch = 'x64' | 'aarch64';
export type JdkSource = 'cache' | 'download';

/** 错误分类与 engine/download.ts 的 ClassifiedError 同形，不新造体系。 */
export type JdkErrorCategory = 'network' | 'validation' | 'disk' | 'permission' | 'unknown';

export interface JdkDownloadError extends Error {
  category: JdkErrorCategory;
  retryable: boolean;
  code?: string;
}

export function jdkError(
  category: JdkErrorCategory,
  message: string,
  opts: { retryable?: boolean; code?: string } = {},
): JdkDownloadError {
  const err = new Error(message) as JdkDownloadError;
  err.name = 'JdkDownloadError';
  err.category = category;
  err.retryable = opts.retryable ?? category === 'network';
  if (opts.code !== undefined) err.code = opts.code;
  return err;
}

export function isJdkDownloadError(e: unknown): e is JdkDownloadError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'category' in e &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  );
}

/** 取 NodeJS.ErrnoException.code（string 才带，避免 exactOptionalPropertyTypes 传 undefined）。 */
function errnoCode(err: unknown): { code?: string } {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? { code } : {};
}

/** process.platform → Adoptium os 段；非法抛中文错。 */
export function currentAdoptiumOs(platform: NodeJS.Platform = process.platform): AdoptiumOs {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'mac';
  if (platform === 'linux') return 'linux';
  throw jdkError('validation', `不支持的操作系统（仅支持 Windows/macOS/Linux）: ${platform}`, {
    retryable: false,
    code: 'UNSUPPORTED_OS',
  });
}

/** process.arch → Adoptium arch 段（arm64 即 aarch64）；非法抛中文错。 */
export function currentAdoptiumArch(arch: string = process.arch): AdoptiumArch {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'aarch64';
  throw jdkError('validation', `不支持的 CPU 架构（仅支持 x64/aarch64）: ${arch}`, {
    retryable: false,
    code: 'UNSUPPORTED_ARCH',
  });
}

/**
 * 纯函数：拼 Adoptium v3 二进制下载地址（[待核实] API 若有出入只改这里）。
 * os/arch 省略时按本机 process.platform / process.arch 映射。
 */
export function adoptiumBinaryUrl(
  version: number,
  os: AdoptiumOs = currentAdoptiumOs(),
  arch: AdoptiumArch = currentAdoptiumArch(),
): string {
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw jdkError(
      'validation',
      `JDK 主版本号非法（需正整数，如 8/17/21/25）: ${String(version)}`,
      { retryable: false, code: 'INVALID_VERSION' },
    );
  }
  if (os !== 'windows' && os !== 'mac' && os !== 'linux') {
    throw jdkError('validation', `操作系统参数非法（仅支持 windows/mac/linux）: ${String(os)}`, {
      retryable: false,
      code: 'INVALID_OS',
    });
  }
  if (arch !== 'x64' && arch !== 'aarch64') {
    throw jdkError('validation', `架构参数非法（仅支持 x64/aarch64）: ${String(arch)}`, {
      retryable: false,
      code: 'INVALID_ARCH',
    });
  }
  return `https://api.adoptium.net/v3/binary/latest/${version}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;
}

export interface EnsureJdkOptions {
  /** JDK 主版本（如 8/17/21/25，通常由 javaVersionFor(mcVersion) 给出）。 */
  version: number;
  /** 缓存根目录；JDK 落在 <cacheDir>/<version>/。 */
  cacheDir: string;
  /** 可注入 fetch（测试用），默认全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 可注入解压（测试 mock 解压层即走此口），默认 extractZip（仅 zip）。 */
  extract?: (archivePath: string, destDir: string) => Promise<void>;
  /** 覆盖目标平台（默认按本机映射）；单测 URL 时显式传入可断网无关。 */
  os?: AdoptiumOs;
  arch?: AdoptiumArch;
  /** 重试次数（不含首次），默认 2；仅 5xx/429/网络错重试（对齐 engine/download.ts）。 */
  retries?: number;
  /** 单次下载超时毫秒数，默认 30000（JDK 包几百 MB，比 engine 的 10s 放宽是刻意的）。 */
  timeoutMs?: number;
  /** 调用方取消信号；被取消时抛 retryable=false 的 network 错误，不重试。 */
  signal?: AbortSignal;
}

export interface EnsureJdkResult {
  /** 可直接用作 JAVA_HOME 的目录（即 <cacheDir>/<version>/）。 */
  javaHome: string;
  /** 'cache' = 命中 .ready 标记；'download' = 本次下载解压。 */
  source: JdkSource;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function toJdkError(err: unknown, userSignal?: AbortSignal): JdkDownloadError {
  if (isJdkDownloadError(err)) return err;
  if (err instanceof Error) {
    const isAbort =
      err.name === 'AbortError' ||
      err.name === 'TimeoutError' ||
      /timeout|aborted|abort/i.test(err.message);
    if (isAbort) {
      if (userSignal?.aborted) {
        return jdkError('network', 'JDK 下载已取消', { retryable: false, code: 'ABORTED' });
      }
      return jdkError('network', `JDK 下载超时: ${err.message}`, {
        retryable: true,
        code: 'TIMEOUT',
      });
    }
    const code = (err as NodeJS.ErrnoException).code;
    // 其余 fetch 异常一律按网络错误处理（对齐 engine/download.ts：值得重试）。
    return jdkError('network', `JDK 下载网络错误: ${err.message}`, {
      retryable: true,
      ...(typeof code === 'string' ? { code } : {}),
    });
  }
  return jdkError('unknown', `JDK 下载失败: ${String(err)}`, { retryable: false });
}

/**
 * 组合超时信号与调用方取消信号（engine/download.ts 同款写法）。
 * 优先 AbortSignal.timeout，有调用方信号时用 AbortSignal.any 合并，缺失时手动转发。
 */
function buildSignal(
  timeoutMs: number,
  user?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (user === undefined) return { signal: timeoutSignal, dispose: () => undefined };
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn.call(AbortSignal, [user, timeoutSignal]), dispose: () => undefined };
  }
  const ctrl = new AbortController();
  const forward = (): void => ctrl.abort();
  if (user.aborted || timeoutSignal.aborted) {
    forward();
  } else {
    user.addEventListener('abort', forward, { once: true });
    timeoutSignal.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      user.removeEventListener('abort', forward);
      timeoutSignal.removeEventListener('abort', forward);
    },
  };
}

async function attemptOnce(
  url: string,
  tmpPath: string,
  fetchImpl: typeof fetch,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  const { signal, dispose } = buildSignal(opts.timeoutMs, opts.signal);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal });
    } catch (err) {
      throw toJdkError(err, opts.signal);
    }
    if (isRetryableStatus(res.status)) {
      throw jdkError('network', `JDK 下载服务器错误（HTTP ${res.status}）: ${url}`, {
        retryable: true,
        code: `HTTP_${res.status}`,
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw jdkError('permission', `JDK 下载被拒绝（HTTP ${res.status}）: ${url}`, {
        retryable: false,
        code: `HTTP_${res.status}`,
      });
    }
    // 校验 HTTP 200：Adoptium（跟随跳转后）应返回 200；其余 4xx/3xx 不值得重试。
    if (res.status !== 200) {
      throw jdkError('validation', `JDK 下载失败（HTTP ${res.status}）: ${url}`, {
        retryable: false,
        code: `HTTP_${res.status}`,
      });
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch (err) {
      throw toJdkError(err, opts.signal);
    }
    try {
      await writeFile(tmpPath, Buffer.from(bytes));
    } catch (err) {
      throw jdkError('disk', `JDK 压缩包落盘失败: ${(err as Error).message}`, {
        retryable: false,
        ...errnoCode(err),
      });
    }
  } finally {
    dispose();
  }
}

async function downloadToFile(
  url: string,
  tmpPath: string,
  fetchImpl: typeof fetch,
  opts: { retries: number; timeoutMs: number; signal?: AbortSignal },
): Promise<void> {
  let lastError: JdkDownloadError | null = null;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      await attemptOnce(url, tmpPath, fetchImpl, opts);
      return;
    } catch (err) {
      const ce = toJdkError(err, opts.signal);
      lastError = ce;
      if (!ce.retryable || attempt >= opts.retries) throw ce;
      // 指数退避 300ms / 600ms（对齐 engine/download.ts：300 * (attempt + 1)）。
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastError ?? jdkError('unknown', `JDK 下载失败: ${url}`, { retryable: false });
}

/** 魔数嗅探：Adoptium URL 本身不带扩展名。PK→zip；gzip→tar.gz；其余→unknown（交解压层报错）。 */
async function sniffArchiveKind(archivePath: string): Promise<'zip' | 'tar-gz' | 'unknown'> {
  const fh = await open(archivePath, 'r');
  try {
    const head = Buffer.alloc(4);
    const { bytesRead } = await fh.read(head, 0, 4, 0);
    if (bytesRead >= 2 && head[0] === 0x50 && head[1] === 0x4b) return 'zip'; // 'PK'
    if (bytesRead >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'tar-gz'; // gzip
    return 'unknown';
  } finally {
    await fh.close();
  }
}

/**
 * 取 JDK（主入口）：缓存命中直接返回，否则下载→解压→写 .ready。
 * @throws JdkDownloadError（{ category, message, retryable, code? }，调用方可直接透出）。
 */
export async function ensureJdk(opts: EnsureJdkOptions): Promise<EnsureJdkResult> {
  const { version } = opts;
  if (typeof version !== 'number' || !Number.isInteger(version) || version <= 0) {
    throw jdkError(
      'validation',
      `JDK 主版本号非法（需正整数，如 8/17/21/25）: ${String(version)}`,
      { retryable: false, code: 'INVALID_VERSION' },
    );
  }
  if (typeof opts.cacheDir !== 'string' || opts.cacheDir.trim() === '') {
    throw jdkError('validation', '缺少缓存目录（cacheDir 不能为空）', {
      retryable: false,
      code: 'CACHE_DIR_MISSING',
    });
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const extract = opts.extract ?? extractZip;
  // 参数校验抛出的中文错不应触发下载：os/arch 先解析（默认值按本机映射）。
  const os = opts.os ?? currentAdoptiumOs();
  const arch = opts.arch ?? currentAdoptiumArch();
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const destDir = join(opts.cacheDir, String(version));
  if (existsSync(join(destDir, '.ready'))) {
    return { javaHome: destDir, source: 'cache' };
  }

  const url = adoptiumBinaryUrl(version, os, arch);
  await mkdir(destDir, { recursive: true });
  const tmpPath = join(opts.cacheDir, `.jdk-${version}-${process.pid}-${Date.now()}.part`);
  try {
    await downloadToFile(url, tmpPath, fetchImpl, {
      retries,
      timeoutMs,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    const kind = await sniffArchiveKind(tmpPath);
    if (kind === 'tar-gz') {
      throw jdkError(
        'validation',
        '暂不支持 tar.gz 解压（当前仅支持 zip，即 Windows 通路）；macOS/Linux 请手动安装 JDK 并配置 JAVA_HOME',
        { retryable: false, code: 'UNSUPPORTED_ARCHIVE' },
      );
    }
    try {
      await extract(tmpPath, destDir);
    } catch (e) {
      // 半成品目录无 .ready，下次会重下；顺手清掉，避免残留干扰排障。
      await rm(destDir, { recursive: true, force: true });
      throw e;
    }
    // .ready = 已解压标记（含来源 URL 与时间，便于审计）。
    await writeFile(join(destDir, '.ready'), `${url}\n${new Date().toISOString()}\n`, 'utf8');
    return { javaHome: destDir, source: 'download' };
  } finally {
    await rm(tmpPath, { force: true });
  }
}

/* ------------------------------------------------------------------ *
 * 最小 zip 解压（零第三方，Windows 必经之路）
 * ------------------------------------------------------------------ */

const ZIP_LOCAL_SIG = 0x04034b50;
const ZIP_CENTRAL_SIG = 0x02014b50;
const ZIP_EOCD_SIG = 0x06054b50;
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
/** zip 炸弹兜底：条目数与解压后总字节上限（JDK 包约几百 MB，8 GiB 绰绰有余）。 */
const ZIP_MAX_ENTRIES = 200_000;
const ZIP_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  localOffset: number;
  isDir: boolean;
}

/** 定位 EOCD（注释最长 65535 字节，只扫尾部 65557 字节）；找不到返回 -1。 */
function findEocd(buf: Buffer): number {
  if (buf.length < 22) return -1;
  const tail = Math.min(buf.length, 65_535 + 22);
  for (let i = buf.length - 22; i >= buf.length - tail; i--) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) return i;
  }
  return -1;
}

function parseZipCentralDirectory(buf: Buffer, archivePath: string): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) {
    throw jdkError('validation', `不是有效的 zip 压缩包（未找到 EOCD）: ${archivePath}`, {
      retryable: false,
      code: 'ZIP_INVALID',
    });
  }
  const totalEntries = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);
  if (totalEntries > ZIP_MAX_ENTRIES) {
    throw jdkError(
      'validation',
      `zip 条目过多（${totalEntries}，疑似 zip 炸弹，已拦截）: ${archivePath}`,
      { retryable: false, code: 'ZIP_TOO_MANY_ENTRIES' },
    );
  }
  const dec = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== ZIP_CENTRAL_SIG) {
      throw jdkError('validation', `zip 中央目录截断或损坏: ${archivePath}`, {
        retryable: false,
        code: 'ZIP_INVALID',
      });
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    if (
      compSize === 0xff_ff_ff_ff ||
      buf.readUInt32LE(p + 24) === 0xff_ff_ff_ff ||
      localOffset === 0xff_ff_ff_ff
    ) {
      throw jdkError('validation', `不支持 zip64 压缩包: ${archivePath}`, {
        retryable: false,
        code: 'ZIP64_UNSUPPORTED',
      });
    }
    if ((flags & 0x1) !== 0) {
      throw jdkError('validation', `不支持加密的 zip 压缩包: ${archivePath}`, {
        retryable: false,
        code: 'ZIP_ENCRYPTED',
      });
    }
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compSize, localOffset, isDir: name.endsWith('/') });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** zip 条目名清洗（ZipSlip 防护：shell 包不可 import，此处独立实现）。 */
function toSafeRelPath(name: string, archivePath: string): string {
  const rel = name.replace(/\\/g, '/');
  const fail = (reason: string): never => {
    throw jdkError(
      'validation',
      `zip 条目非法（${reason}，已拦截）: ${name}（压缩包 ${archivePath}）`,
      {
        retryable: false,
        code: 'ZIP_SLIP',
      },
    );
  };
  if (rel === '' || rel === '/') fail('空路径');
  if (rel.startsWith('/')) fail('绝对路径');
  if (/^[a-zA-Z]:/.test(rel)) fail('盘符路径');
  if (rel.split('/').some((part) => part === '..')) fail('路径穿越');
  const cleaned = rel
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/');
  if (cleaned === '') fail('空路径');
  return cleaned;
}

/**
 * 默认解压实现：仅 zip（STORE/DEFLATE）。destDir 下按条目相对路径落盘；
 * 目录条目建目录，文件条目先建父目录再写。
 */
export async function extractZip(archivePath: string, destDir: string): Promise<void> {
  let buf: Buffer;
  try {
    buf = await readFile(archivePath);
  } catch (err) {
    throw jdkError('disk', `读取压缩包失败: ${(err as Error).message}`, {
      retryable: false,
      ...errnoCode(err),
    });
  }
  const entries = parseZipCentralDirectory(buf, archivePath);
  const resolvedDest = resolve(destDir);
  await mkdir(resolvedDest, { recursive: true });
  let totalBytes = 0;
  for (const entry of entries) {
    const rel = toSafeRelPath(entry.name, archivePath);
    // 二次兜底：join/resolve 后仍必须落在 destDir 内。
    const target = resolve(resolvedDest, ...rel.split('/'));
    if (target !== resolvedDest && !target.startsWith(resolvedDest + sep)) {
      throw jdkError('validation', `zip 条目越界（已拦截）: ${entry.name}`, {
        retryable: false,
        code: 'ZIP_SLIP',
      });
    }
    if (entry.isDir) {
      await mkdir(target, { recursive: true });
      continue;
    }
    // 中央目录的 compSize 是权威长度（local 头在 data-descriptor 标志下可能为 0），
    // 按它从 local 头之后切片即可，不受 flag bit 3 影响。
    const lp = entry.localOffset;
    if (lp + 30 > buf.length || buf.readUInt32LE(lp) !== ZIP_LOCAL_SIG) {
      throw jdkError('validation', `zip 局部头损坏: ${entry.name}（压缩包 ${archivePath}）`, {
        retryable: false,
        code: 'ZIP_INVALID',
      });
    }
    const dataStart = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const dataEnd = dataStart + entry.compSize;
    if (dataEnd > buf.length) {
      throw jdkError('validation', `zip 数据区越界: ${entry.name}（压缩包 ${archivePath}）`, {
        retryable: false,
        code: 'ZIP_INVALID',
      });
    }
    const comp = buf.subarray(dataStart, dataEnd);
    let raw: Buffer;
    if (entry.method === ZIP_METHOD_STORE) {
      raw = Buffer.from(comp);
    } else if (entry.method === ZIP_METHOD_DEFLATE) {
      try {
        raw = inflateRawSync(comp);
      } catch (err) {
        throw jdkError('validation', `zip 解压失败: ${entry.name}（${(err as Error).message}）`, {
          retryable: false,
          code: 'ZIP_INFLATE_FAILED',
        });
      }
    } else {
      throw jdkError('validation', `不支持的 zip 压缩方法（${entry.method}）: ${entry.name}`, {
        retryable: false,
        code: 'ZIP_METHOD_UNSUPPORTED',
      });
    }
    totalBytes += raw.length;
    if (totalBytes > ZIP_MAX_TOTAL_BYTES) {
      throw jdkError('validation', `zip 解压后过大（疑似 zip 炸弹，已拦截）: ${archivePath}`, {
        retryable: false,
        code: 'ZIP_TOO_LARGE',
      });
    }
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, raw);
    } catch (err) {
      throw jdkError('disk', `zip 落盘失败: ${(err as Error).message}`, {
        retryable: false,
        ...errnoCode(err),
      });
    }
  }
}
