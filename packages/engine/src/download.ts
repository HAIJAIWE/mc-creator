/**
 * 下载引擎 · 单文件下载（设计文档 §4.2 / §13.3 / §14，v3.1）
 *
 * 对照与改进：
 * - 反面教材 apps/desktop/src/main/launcher-service.ts 74-87：
 *   无超时、无断点续传、全量读进内存、无哈希校验 → 本模块逐项改进。
 * - 正面范本 packages/core/src/modrinth/api-client.ts：
 *   10s 超时 + AbortSignal 超时 + 仅 5xx/429/网络错误重试 + 指数退避。
 *
 * 特性：
 * - 超时：AbortSignal.timeout（默认 10s），超时按网络错误重试；
 * - 重试：仅 5xx / 429 / 网络错误重试，退避 300ms / 600ms（300 * (attempt + 1)）；
 * - 断点续传：dest 同目录 `<name>.part`，按已下载长度发 Range；
 *   206 续写 / 200（不支持 Range）从头重下 / 416 删掉 .part 后重试；
 * - 校验：sha256 / sha512，不匹配删除 .part 并抛 validation 错误；
 * - 原子落盘：.part 写完 → 校验 → rename（§14 原子性，旧 dest 不会被半成品覆盖）；
 * - 流式写入 + onProgress(done, total)，长度未知时 total 为 0；
 * - 错误统一为 ClassifiedError { category, message, retryable }（§14 错误分类）。
 *
 * 仅 node: 内置模块，零第三方依赖，无 Electron 依赖。
 */

import { createHash } from 'node:crypto';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

/** §14 错误分类（与 packages/contract ClassifiedError 同形，本包零依赖故本地定义）。 */
export interface ClassifiedError {
  category: 'network' | 'validation' | 'version' | 'disk' | 'permission' | 'unknown';
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface DownloadOptions {
  /** 单次尝试超时毫秒数，默认 10000（对齐 api-client 正面范本）。 */
  timeoutMs?: number;
  /** 失败后重试次数（不含首次），默认 2。仅 5xx / 429 / 网络错误重试。 */
  retries?: number;
  /** 期望 sha256 十六进制（大小写不限），提供则必校验。 */
  sha256?: string;
  /** 期望 sha512 十六进制（大小写不限），提供则必校验。 */
  sha512?: string;
  /** 进度回调（done 已下载字节，total 总字节，未知时为 0）。 */
  onProgress?: (done: number, total: number) => void;
  /** 调用方取消信号；被取消时抛 retryable=false 的 network 错误，不重试。 */
  signal?: AbortSignal;
  /** 可注入 fetch（测试用），默认全局 fetch。 */
  fetchImpl?: typeof fetch;
}

export interface DownloadResult {
  /** 最终文件路径（即传入的 dest）。 */
  path: string;
  /** 最终文件字节数。 */
  bytes: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 仅 5xx / 429 可重试（对齐 api-client：4xx 直接抛错）。 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function networkError(message: string, retryable: boolean, code?: string): ClassifiedError {
  const err: ClassifiedError = { category: 'network', message, retryable };
  if (code !== undefined) err.code = code;
  return err;
}

function isClassified(value: unknown): value is ClassifiedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'category' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  );
}

function toClassifiedError(err: unknown, userSignal?: AbortSignal): ClassifiedError {
  if (isClassified(err)) return err;
  if (err instanceof Error) {
    // AbortSignal.timeout 抛出的错误在不同环境下 name 可能为 'AbortError'、'TimeoutError' 或 'AbortError: The operation was aborted due to timeout'
    const isTimeoutAbort = err.name === 'AbortError' ||
      err.name === 'TimeoutError' ||
      /timeout/i.test(err.message);
    if (isTimeoutAbort) {
      if (userSignal?.aborted) {
        return networkError('下载已取消', false, 'ABORTED');
      }
      return networkError(`下载超时: ${err.message}`, true, 'TIMEOUT');
    }
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') {
      const disk: ClassifiedError = { category: 'disk', message: err.message, retryable: false };
      if (code !== undefined) disk.code = code;
      return disk;
    }
    if (code === 'EACCES' || code === 'EPERM') {
      const perm: ClassifiedError = {
        category: 'permission',
        message: err.message,
        retryable: false,
      };
      if (code !== undefined) perm.code = code;
      return perm;
    }
    // 落盘路径本身有问题（父目录不存在 / 文件名非法 / 路径过长）不是网络故障：
    // 归到 network+retryable 会白白重试满额并把「文件名非法」伪装成「网络错误」，
    // 把排障方向带偏（§14 错误分类：retryable 必须真的值得重试）。
    if (code === 'ENOENT' || code === 'ENAMETOOLONG' || code === 'EINVAL' || code === 'EISDIR') {
      const path: ClassifiedError = {
        category: 'validation',
        message: `落盘路径不可用（${code}）: ${err.message}`,
        retryable: false,
      };
      path.code = code;
      return path;
    }
    const net: ClassifiedError = { category: 'network', message: err.message, retryable: true };
    if (typeof code === 'string') net.code = code;
    return net;
  }
  return { category: 'unknown', message: String(err), retryable: false };
}

/**
 * 组合超时信号与调用方取消信号。
 * 优先使用 AbortSignal.timeout（任务要求的写法），有调用方信号时用 AbortSignal.any 合并；
 * 运行环境缺失 AbortSignal.any 时回退为手动转发。
 */
function buildSignal(
  timeoutMs: number,
  user?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!user) return { signal: timeoutSignal, dispose: () => undefined };
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn.call(AbortSignal, [user, timeoutSignal]), dispose: () => undefined };
  }
  const ctrl = new AbortController();
  const forward = (): void => ctrl.abort();
  if (user.aborted || timeoutSignal.aborted) {
    ctrl.abort();
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

/** 从 206 Content-Range 或 Content-Length 推算总长度，未知返回 0。 */
function parseTotal(res: Response, base: number): number {
  if (res.status === 206) {
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const m = /\/(\d+)\s*$/.exec(contentRange);
      if (m) {
        const total = Number(m[1]);
        if (Number.isFinite(total) && total >= 0) return total;
      }
    }
  }
  const len = res.headers.get('content-length');
  if (len) {
    const n = Number(len);
    if (Number.isFinite(n) && n >= 0) return base + n;
  }
  return 0;
}

/** 分块读文件算哈希（不大对象进内存）。 */
async function hashFile(path: string, algorithm: 'sha256' | 'sha512'): Promise<string> {
  const hash = createHash(algorithm);
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length);
      if (bytesRead === 0) break;
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    await fh.close();
  }
  return hash.digest('hex');
}

async function verifyHash(
  path: string,
  sha256: string | undefined,
  sha512: string | undefined,
  url: string,
): Promise<void> {
  if (sha256) {
    const actual = await hashFile(path, 'sha256');
    if (actual.toLowerCase() !== sha256.toLowerCase()) {
      await rm(path, { force: true });
      const err: ClassifiedError = {
        category: 'validation',
        message: `sha256 校验失败（期望 ${sha256}，实际 ${actual}）: ${url}`,
        code: 'HASH_MISMATCH',
        retryable: false,
      };
      throw err;
    }
  }
  if (sha512) {
    const actual = await hashFile(path, 'sha512');
    if (actual.toLowerCase() !== sha512.toLowerCase()) {
      await rm(path, { force: true });
      const err: ClassifiedError = {
        category: 'validation',
        message: `sha512 校验失败（期望 ${sha512}，实际 ${actual}）: ${url}`,
        code: 'HASH_MISMATCH',
        retryable: false,
      };
      throw err;
    }
  }
}

async function attemptOnce(
  url: string,
  dest: string,
  tmp: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  opts: DownloadOptions,
): Promise<DownloadResult> {
  let start = 0;
  try {
    const st = await stat(tmp);
    start = st.size;
  } catch {
    start = 0;
  }

  const headers: Record<string, string> = {};
  if (start > 0) headers['Range'] = `bytes=${start}-`;

  const { signal, dispose } = buildSignal(timeoutMs, opts.signal);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { headers, redirect: 'follow', signal });
    } catch (err) {
      throw toClassifiedError(err, opts.signal);
    }

    if (res.status === 416) {
      // Range 越界（如远端文件变小）：删掉 .part，外层按可重试处理后从头下。
      await rm(tmp, { force: true });
      throw networkError(`服务器拒绝 Range 请求（HTTP 416）: ${url}`, true, 'HTTP_416');
    }
    if (res.status === 401 || res.status === 403) {
      const err: ClassifiedError = {
        category: 'permission',
        message: `下载被拒绝（HTTP ${res.status}）: ${url}`,
        code: `HTTP_${res.status}`,
        retryable: false,
      };
      throw err;
    }
    if (isRetryableStatus(res.status)) {
      throw networkError(
        `服务器错误（HTTP ${res.status}）: ${url}`,
        true,
        `HTTP_${res.status}`,
      );
    }
    if (!res.ok) {
      const err: ClassifiedError = {
        category: 'validation',
        message: `下载失败（HTTP ${res.status}）: ${url}`,
        code: `HTTP_${res.status}`,
        retryable: false,
      };
      throw err;
    }

    // 206 且本地有 .part → 续写；否则（200 / 无 .part）从头写。
    const resumed = res.status === 206 && start > 0;
    const base = resumed ? start : 0;
    const total = parseTotal(res, base);

    const fh = await open(tmp, resumed ? 'a' : 'w');
    let done = base;
    opts.onProgress?.(done, total);
    try {
      if (res.body !== null) {
        const body = res.body as unknown as AsyncIterable<Uint8Array>;
        for await (const chunk of body) {
          const buf = Buffer.from(chunk);
          await fh.write(buf);
          done += buf.length;
          opts.onProgress?.(done, total);
        }
      }
    } catch (err) {
      throw toClassifiedError(err, opts.signal);
    } finally {
      await fh.close();
    }
    opts.onProgress?.(done, total);

    await verifyHash(tmp, opts.sha256, opts.sha512, url);

    const st = await stat(tmp);
    await rename(tmp, dest);
    return { path: dest, bytes: st.size };
  } finally {
    dispose();
  }
}

/**
 * 下载单个文件到 dest（原子落盘 + 断点续传 + 超时重试 + 哈希校验）。
 * @throws ClassifiedError 形状 { category, message, retryable }（另附 code）。
 */
export async function downloadFile(
  url: string,
  dest: string,
  opts: DownloadOptions = {},
): Promise<DownloadResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const tmp = `${dest}.part`;
  await mkdir(dirname(dest), { recursive: true });

  let lastError: ClassifiedError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await attemptOnce(url, dest, tmp, fetchImpl, timeoutMs, opts);
    } catch (err) {
      const ce = toClassifiedError(err, opts.signal);
      lastError = ce;
      if (!ce.retryable || attempt >= retries) throw ce;
      // 指数退避 300ms / 600ms（对齐 api-client：300 * (attempt + 1））。
      await sleep(300 * (attempt + 1));
    }
  }
  throw (
    lastError ?? {
      category: 'unknown',
      message: `下载失败: ${url}`,
      retryable: false,
    }
  );
}
