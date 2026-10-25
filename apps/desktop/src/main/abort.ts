/**
 * 取消安装用的协作式中断工具。
 *
 * 只做三件事：造一个带 `AbortError` 名字的错误、在关键点检查信号、
 * 把「不认 signal 的 Promise」接到 signal 上。**不**自己保存状态 ——
 * 每个安装请求一个 `AbortController`，生命周期由调用方管。
 */

/** 统一的取消错误。`name` 必须叫 `AbortError`，`isAbortError` 才认得出。 */
export function abortError(message = '操作已取消'): Error {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/** 是不是取消。`fetch` 抛的是 `DOMException`，也走这里。 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** 已经取消就立刻抛，不要再往下走（尤其别再写盘）。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/**
 * 给不认 signal 的 Promise 加取消：signal 一响就 reject，原 Promise 继续跑但
 * 结果被丢弃。用于元数据请求这类没有副作用的调用 —— 有写盘副作用的必须
 * 真正把 signal 传到底层，不能只 race。
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** 可取消的 sleep。重试退避期间用户点取消不该还要等满 10 秒。 */
export async function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  if (!signal) {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
