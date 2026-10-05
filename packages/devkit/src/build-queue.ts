/**
 * 并发构建队列（设计文档 §8.2：避免多个 Gradle 实例争抢内存）。
 *
 * 背景：job 内存上限默认 2048MB，两个并发构建就是 4GB+；Gradle daemon
 * 本就吃内存，直接并行起多个 Gradle 会互相挤占甚至 OOM。本队列做
 * 应用层限流：同时只放行 maxConcurrent 个构建，其余 FIFO 排队。
 *
 * 默认 maxConcurrent=2：Gradle daemon 本就吃内存，2 是保守值；
 * 既保留一点并行，又把最坏内存占用封顶在约 2×job 上限内。
 *
 * 契约：
 * - FIFO 公平：先调用者先拿到槽（JS 单线程下按同步入队顺序）。
 * - 本轮不做等待者取消：调用方已有 timeoutMs（见 gradle.ts
 *   DEFAULT_GRADLE_TIMEOUT_MS），等待取消不在本轮范围内。
 * - 等待队列上限溢出保护：等待者（pending）超过 32 直接抛错，
 *   fail-fast，不无限堆积。同步抛错（非挂起后超时）。
 */

export interface BuildQueueOptions {
  /** 同时可运行的最大构建数，默认 2。必须为 ≥1 的整数。 */
  maxConcurrent?: number;
}

export interface BuildQueue {
  /**
   * 把 fn 排进队列，拿到槽后执行，执行完（成功/失败都）释放槽。
   * 溢出（等待者已满）时同步抛错，不返回挂起的 Promise。
   */
  runQueued<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * 拿一个槽，返回释放函数。runQueued 即基于它实现。
   * 溢出时同样同步抛错。释放函数幂等（重复调用无副作用）。
   */
  acquire(): Promise<() => void>;
  /** 正在等待槽的任务数（不含已在运行的）。 */
  readonly pending: number;
  /** 已拿到槽正在运行的任务数。 */
  readonly running: number;
}

/** 等待队列上限：最多容纳 32 个等待者，第 33 个等待者直接抛错。 */
export const BUILD_QUEUE_MAX_PENDING = 32;

export function createBuildQueue(opts: BuildQueueOptions = {}): BuildQueue {
  const maxConcurrent = opts.maxConcurrent ?? 2;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error(`maxConcurrent 非法（需≥1 整数）: ${String(opts.maxConcurrent)}`);
  }
  let active = 0;
  const waiters: Array<{ grant: () => void }> = [];

  const pump = (): void => {
    while (active < maxConcurrent && waiters.length > 0) {
      const next = waiters.shift();
      if (next === undefined) break;
      active++;
      next.grant();
    }
  };

  function acquire(): Promise<() => void> {
    if (waiters.length >= BUILD_QUEUE_MAX_PENDING) {
      throw new Error(`构建队列溢出：等待者已达 ${BUILD_QUEUE_MAX_PENDING}，拒绝无限堆积（§8.2）`);
    }
    let grantResolve!: () => void;
    const granted = new Promise<void>((resolve) => {
      grantResolve = resolve;
    });
    waiters.push({ grant: grantResolve });
    pump();
    return granted.then(() => {
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active--;
        pump();
      };
    });
  }

  function runQueued<T>(fn: () => Promise<T>): Promise<T> {
    // 溢出检查在 acquire 内同步执行：此处不标 async，保证超限时同步抛错。
    const slot = acquire();
    return slot.then((release) => {
      let result: Promise<T>;
      try {
        result = fn();
      } catch (err) {
        release();
        throw err;
      }
      return result.then(
        (value) => {
          release();
          return value;
        },
        (err) => {
          release();
          throw err;
        },
      );
    });
  }

  return {
    runQueued,
    acquire,
    get pending(): number {
      return waiters.length;
    },
    get running(): number {
      return active;
    },
  };
}
