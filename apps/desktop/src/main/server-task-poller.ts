/**
 * 定时任务轮询器（§7.4 定时另一半，外壳侧，backlog R2c）。
 *
 * 职责边界（与内核的分工）：
 * - 内核 `run_due_tasks` 已做完三件事：挑出到期任务、推进账本（一次性标 done /
 *   周期重算 nextRun，失败也推进防毒丸）、**backup 文件动作直接做完**。
 * - 轮询器只做剩下的外壳动作：restart → supervisor.restartServer、
 *   stop → supervisor.stopServer、broadcast → supervisor.sendCommand、
 *   backup 只记录结果（绝不二次执行）、未知 action 记 unknown 跳过。
 *
 * 失败语义：全程 try/catch 永不抛；单条失败隔离（一条炸了其余照跑）；
 * 无 runtime / runRead 失败时返回 `{ ran: false }`。调用方（index.ts 启动链）
 * 把轮询器当增值功能，绝不因此拦住应用启动。
 *
 * 本模块零运行时导入（只有 `import type`）：`index.ts` 引用它不会拖进
 * electron 或任何副作用模块，单测可直接跑。
 */

import type { TaskResult } from '@mc-creator/contract';
import type { ProcessSupervisor } from './process-supervisor.js';

/** 轮询器需要的 supervisor 最小面（R2a 新增的三个公共方法）。 */
export type TaskPollerSupervisor = Pick<
  ProcessSupervisor,
  'restartServer' | 'stopServer' | 'sendCommand'
>;

/** 轮询器需要的运行时最小面（只要能跑 R 类 kind）。 */
export interface TaskPollerRuntime {
  runRead(kind: string, payload?: unknown): Promise<TaskResult>;
}

export interface TaskPollerOptions {
  getRuntime: () => TaskPollerRuntime | null | undefined;
  supervisor: TaskPollerSupervisor;
  /** 轮询间隔毫秒，默认 60000。 */
  intervalMs?: number;
  /** 时钟注入（毫秒时间戳来源）；提供时作为 payload.now（ISO）传给 run_due_tasks。 */
  now?: () => number;
  /** 每轮执行完的观察者（只在 ran=true 时调用；抛错会被吞掉，不影响结果）。 */
  onFired?: (fired: FiredOutcome[]) => void;
}

/** 内核 fired 条目的归一化视图（raw 保留原始字段，防内核加字段时丢信息）。 */
export interface DueTaskItem {
  taskId: string;
  serverId: string;
  action: string;
  raw: Record<string, unknown>;
}

/** 单条到期任务的外壳执行结果。 */
export interface FiredOutcome {
  taskId: string;
  serverId: string;
  action: string;
  ok: boolean;
  /** supervisor / 内核返回的原始结果（成功时）。 */
  detail?: unknown;
  /** 失败原因（结构化 error 或消息字符串）。 */
  error?: unknown;
  /** 未知 action 时为 true（跳过，未调 supervisor）。 */
  skipped?: boolean;
  /** skipped 时的说明（如 `unknown-action:foo`）。 */
  reason?: string;
}

export interface PollOnceResult {
  ran: boolean;
  /** ran=true 时本轮逐条执行结果（含 backup 记录与 unknown 跳过）。 */
  fired?: FiredOutcome[];
  /** ran=false 且是预期内空操作时（如无 runtime）。 */
  reason?: string;
  /** ran=false 且是失败时（runRead 失败 / 内部异常的消息或结构化 error）。 */
  error?: unknown;
}

export interface TaskPoller {
  /** 开始周期轮询（幂等：重复 start 不会起第二个 timer）。不做立即首轮。 */
  start(): void;
  /** 停止轮询（幂等：重复 stop 安全）。 */
  stop(): void;
  /** 跑一轮：run_due_tasks → 逐条分发。永不抛。 */
  pollOnce(): Promise<PollOnceResult>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v !== '' ? v : fallback;
}

function parseItem(item: unknown): DueTaskItem {
  const raw = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};
  return {
    taskId: str(raw['taskId'], 'unknown'),
    serverId: str(raw['serverId'], 'unknown'),
    action: str(raw['action'], 'unknown'),
    raw,
  };
}

/**
 * 创建定时轮询器（§7.4 定时另一半）。
 *
 * @param opts.getRuntime 取内核运行时；返回 null/undefined 时 pollOnce 安全空操作。
 * @param opts.supervisor 进程托管（R2a 的 restartServer / stopServer / sendCommand）。
 */
export function createTaskPoller(opts: TaskPollerOptions): TaskPoller {
  const { getRuntime, supervisor, onFired } = opts;
  const intervalMs = opts.intervalMs ?? 60000;
  const now = opts.now;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function dispatchOne(item: DueTaskItem): Promise<FiredOutcome> {
    const base = { taskId: item.taskId, serverId: item.serverId, action: item.action };
    try {
      switch (item.action) {
        case 'backup': {
          // backup 文件动作内核内已执行完毕：只记录结果，绝不二次执行。
          const err = item.raw['error'];
          if (err !== undefined && err !== null) {
            return { ...base, ok: false, detail: item.raw['result'] ?? null, error: err };
          }
          return { ...base, ok: true, detail: item.raw['result'] ?? null };
        }
        case 'restart': {
          const out = await supervisor.restartServer(item.serverId);
          const ok = out.ok === true;
          return ok
            ? { ...base, ok, detail: out }
            : { ...base, ok, detail: out, error: out.reason ?? 'restart failed' };
        }
        case 'stop': {
          const out = await supervisor.stopServer(item.serverId);
          const ok = out.ok === true;
          return ok
            ? { ...base, ok, detail: out }
            : { ...base, ok, detail: out, error: out.reason ?? 'stop failed' };
        }
        case 'broadcast': {
          const message = typeof item.raw['message'] === 'string' ? item.raw['message'] : '';
          const out = await supervisor.sendCommand(item.serverId, message);
          const ok = out.delivered === true;
          return ok
            ? { ...base, ok, detail: out }
            : { ...base, ok, detail: out, error: out.reason ?? 'send failed' };
        }
        default: {
          return { ...base, ok: false, skipped: true, reason: `unknown-action:${item.action}` };
        }
      }
    } catch (e) {
      // 单条失败隔离：记错，不抛，不影响同轮其他条目。
      return { ...base, ok: false, error: msg(e) };
    }
  }

  async function pollOnce(): Promise<PollOnceResult> {
    try {
      const rt = getRuntime();
      if (rt === null || rt === undefined) {
        return { ran: false, reason: 'no-runtime' };
      }
      let res: TaskResult;
      try {
        res = await rt.runRead(
          'run_due_tasks',
          now !== undefined ? { now: new Date(now()).toISOString() } : {},
        );
      } catch (e) {
        return { ran: false, error: msg(e) };
      }
      if (!res.ok) {
        return { ran: false, error: res.error ?? 'run_due_tasks failed' };
      }
      const data =
        typeof res.data === 'object' && res.data !== null ? (res.data as { fired?: unknown }) : {};
      const list = Array.isArray(data.fired) ? data.fired : [];
      const fired: FiredOutcome[] = [];
      for (const rawItem of list) {
        try {
          fired.push(await dispatchOne(parseItem(rawItem)));
        } catch (e) {
          // 最后一道网（dispatchOne 本身不抛）：毒丸条目也只记错。
          fired.push({
            taskId: 'unknown',
            serverId: 'unknown',
            action: 'unknown',
            ok: false,
            error: msg(e),
          });
        }
      }
      try {
        onFired?.(fired);
      } catch {
        // 观察者异常不得影响轮询结果。
      }
      return { ran: true, fired };
    } catch (e) {
      return { ran: false, error: msg(e) };
    }
  }

  function start(): void {
    if (timer !== null) return;
    timer = setInterval(() => {
      void pollOnce();
    }, intervalMs);
    // 不阻塞退出：轮询器是增值后台任务，绝不能拖住 Electron / vitest 退出。
    const handle = timer as unknown as { unref?: () => void };
    if (typeof handle.unref === 'function') handle.unref();
  }

  function stop(): void {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  return { start, stop, pollOnce };
}
