/**
 * 持久化任务队列（设计文档 §14：并发的持久化任务队列思想，v3.1）
 *
 * - 队列文件为指定目录下的 JSONL（默认 queue.jsonl），每次变更原子重写
 *  （写 tmp → rename，§14 原子性），进程崩溃不丢已提交任务；
 * - recover()：进程重启后把 running 恢复为 queued，返回恢复数量；
 * - 优先级：数字越小越先出队，同优先级按 enqueuedAt 先后（FIFO）；
 * - cancel(id)：queued / running → cancelled，调用方轮询/执行前检查即可；
 * - 并发上限由调用方控制（同时 dequeue N 个执行），本类只保证数据结构正确；
 * - 纯文件 + 内存，无 Electron 依赖。
 *
 * 仅 node: 内置模块，零第三方依赖。
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type FileTaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface FileTaskError {
  category: string;
  message: string;
  retryable?: boolean;
}

export interface FileTask<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  /** 优先级，数字越小越先出队，默认 0。 */
  priority: number;
  state: FileTaskState;
  enqueuedAt: string;
  /** 已被 dequeue 的次数（用于调用方限次重试）。 */
  attempts: number;
  error?: FileTaskError;
}

export interface EnqueueInput<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  priority?: number;
}

function compareTasks(a: FileTask<unknown>, b: FileTask<unknown>): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt < b.enqueuedAt ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 文件持久化任务队列。先 init()（加载已有队列文件），再使用。
 * 并发上限由调用方控制：需要并行 N 个就 dequeue N 次。
 */
export class FileTaskQueue<T = unknown> {
  private readonly dir: string;
  private readonly file: string;
  private readonly tasks = new Map<string, FileTask<T>>();

  constructor(dir: string, fileName = 'queue.jsonl') {
    this.dir = dir;
    this.file = join(dir, fileName);
  }

  /** 队列文件路径（便于调用方/测试断言）。 */
  get filePath(): string {
    return this.file;
  }

  get size(): number {
    return this.tasks.size;
  }

  /** 加载队列文件（不存在则视为空队列）。 */
  async init(): Promise<void> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf-8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    this.tasks.clear();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue; // 损坏行跳过，保证重启可恢复
      }
      if (!isRecord(parsed) || typeof parsed['id'] !== 'string') continue;
      const task = parsed as unknown as FileTask<T>;
      if (typeof task.kind !== 'string' || typeof task.state !== 'string') continue;
      this.tasks.set(task.id, task);
    }
  }

  /** 入队（id 重复抛错）。 */
  async enqueue(input: EnqueueInput<T>): Promise<FileTask<T>> {
    if (!input.id) throw new Error('任务 id 不能为空');
    if (!input.kind) throw new Error('任务 kind 不能为空');
    if (this.tasks.has(input.id)) throw new Error(`任务已存在: ${input.id}`);
    const task: FileTask<T> = {
      id: input.id,
      kind: input.kind,
      payload: input.payload,
      priority: input.priority ?? 0,
      state: 'queued',
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
    };
    this.tasks.set(task.id, task);
    await this.persist();
    return { ...task };
  }

  /**
   * 取出优先级最高的一个 queued 任务并标记为 running（attempts + 1）。
   * 无可取任务返回 null。调用方控制并发：并行 N 个就调用 N 次。
   */
  async dequeue(): Promise<FileTask<T> | null> {
    let best: FileTask<T> | null = null;
    for (const t of this.tasks.values()) {
      if (t.state !== 'queued') continue;
      if (!best || compareTasks(t, best) < 0) best = t;
    }
    if (!best) return null;
    best.state = 'running';
    best.attempts += 1;
    await this.persist();
    return { ...best };
  }

  /** 标记完成（未知 id 抛错）。 */
  async complete(id: string): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`任务不存在: ${id}`);
    t.state = 'done';
    await this.persist();
  }

  /** 标记失败并记录错误（未知 id 抛错）。 */
  async fail(id: string, error?: FileTaskError): Promise<void> {
    const t = this.tasks.get(id);
    if (!t) throw new Error(`任务不存在: ${id}`);
    t.state = 'failed';
    if (error !== undefined) t.error = error;
    await this.persist();
  }

  /**
   * 取消任务：queued / running → cancelled。
   * 返回 true 表示生效；未知 id 或已终态（done/failed/cancelled）返回 false。
   */
  async cancel(id: string): Promise<boolean> {
    const t = this.tasks.get(id);
    if (!t) return false;
    if (t.state !== 'queued' && t.state !== 'running') return false;
    t.state = 'cancelled';
    await this.persist();
    return true;
  }

  /**
   * 进程重启后恢复：running → queued。返回恢复数量。
   * 无变化时不写文件。
   */
  async recover(): Promise<number> {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.state === 'running') {
        t.state = 'queued';
        n += 1;
      }
    }
    if (n > 0) await this.persist();
    return n;
  }

  get(id: string): FileTask<T> | undefined {
    const t = this.tasks.get(id);
    return t ? { ...t } : undefined;
  }

  /** 按出队顺序列出任务（可按 state 过滤）。 */
  list(state?: FileTaskState): FileTask<T>[] {
    const out: FileTask<T>[] = [];
    for (const t of this.tasks.values()) {
      if (state !== undefined && t.state !== state) continue;
      out.push({ ...t });
    }
    out.sort(compareTasks);
    return out;
  }

  /** 等待执行的任务数（state === queued）。 */
  pendingCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) {
      if (t.state === 'queued') n += 1;
    }
    return n;
  }

  /** 全量重写队列文件（tmp → rename 原子替换）。 */
  private async persist(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const lines = [...this.tasks.values()].map((t) => JSON.stringify(t)).join('\n');
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, lines.length > 0 ? `${lines}\n` : '', 'utf-8');
    await rename(tmp, this.file);
  }
}
