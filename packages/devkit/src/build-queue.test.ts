/**
 * build-queue 单元测试（§8.2 并发构建队列）。
 * 不起真实 Gradle：fn 全部注入 fake promise，只验证排队语义。
 */
import { describe, expect, it } from 'vitest';
import { createBuildQueue } from './build-queue.js';

function deferred<T = string>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('build-queue（§8.2）', () => {
  it('串行通过：runQueued 透传返回值与异常，事后 pending/running 归零', async () => {
    const q = createBuildQueue();
    expect(q.pending).toBe(0);
    expect(q.running).toBe(0);
    await expect(q.runQueued(async () => 42)).resolves.toBe(42);
    await expect(q.runQueued(async () => 'ok')).resolves.toBe('ok');
    await expect(q.runQueued(async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(q.pending).toBe(0);
    expect(q.running).toBe(0);
  });

  it('超限排队：maxConcurrent=1 时第二个等第一个完（FIFO）', async () => {
    const q = createBuildQueue({ maxConcurrent: 1 });
    const order: string[] = [];
    const gate = deferred<void>();

    const first = q.runQueued(async () => {
      order.push('first-start');
      await gate.promise;
      order.push('first-end');
      return 'first';
    });
    // 让第一个先占住唯一的槽
    await new Promise((r) => setTimeout(r, 10));
    expect(q.running).toBe(1);

    const second = q.runQueued(async () => {
      order.push('second');
      return 'second';
    });
    await new Promise((r) => setTimeout(r, 10));
    // 第二个还在排队，没执行
    expect(order).toEqual(['first-start']);
    expect(q.pending).toBe(1);
    expect(q.running).toBe(1);

    gate.resolve();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second']);
    expect(q.pending).toBe(0);
    expect(q.running).toBe(0);
  });

  it('pending 超 32 直接抛错（fail-fast，不无限堆积）', async () => {
    const q = createBuildQueue({ maxConcurrent: 1 });
    const gate = deferred<void>();
    // 占住唯一的运行槽
    const holder = q.runQueued(() => gate.promise);
    await new Promise((r) => setTimeout(r, 10));
    expect(q.running).toBe(1);

    // 堆 32 个等待者：都不该抛
    const waiters: Array<Promise<string>> = [];
    for (let i = 0; i < 32; i++) {
      waiters.push(q.runQueued(async () => `w${i}`));
    }
    expect(q.pending).toBe(32);

    // 第 33 个等待者同步抛错
    expect(() => q.runQueued(async () => 'overflow')).toThrow(/溢出/);

    gate.resolve();
    await expect(holder).resolves.toBeUndefined();
    const values = await Promise.all(waiters);
    expect(values).toHaveLength(32);
    expect(values[0]).toBe('w0');
    expect(q.pending).toBe(0);
    expect(q.running).toBe(0);
  });
});
