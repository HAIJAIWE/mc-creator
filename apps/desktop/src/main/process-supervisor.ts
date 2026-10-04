/**
 * 外壳层进程托管服务（设计文档 §7.1 / §7.4）。
 *
 * 为什么内核不托管进程（§7.1 的硬约束，不是缺陷）：
 * 三个内核都只负责「把命令拼好 / 校验存在性」，真实执行归外壳：
 * - kernel-java `launch_instance` 只拼 JVM 参数与 cmd/args 返回，**不 spawn**
 *   （见 packages/kernel-java/src/kernel.ts launchInstance 末尾注释）；
 * - kernel-server `restart_server` / `stop_server` 只校验 server.properties 存在性，
 *   返回 `controlCommand: 'stop' | 'restart'`；
 * - kernel-server `deploy_plugin` 的 hotReload 只返回 `reloadCommand: '/reload confirm'`，
 *   RCON/控制台注入不自动发。
 * 理由：进程保活、崩溃重启、端口探测、RCON 口令管理属外壳职责（§7.1/§12），
 * 内核不该有这些副作用；且 mode:'sandbox' 下内核**永不 spawn**（§13.4）。
 * 本文件就是那个「外壳」：把内核返回的指令真正执行掉，并让这条链路可测。
 *
 * 命名说明（重要，勿误改）：本文件**刻意不叫** `launcher-service.ts`。
 * 该文件名已被 `apps/desktop/src/main/launcher-service.ts` 占用——那是
 * 迷你版 PCL2/HMCL「Minecraft 客户端下载 + 离线启动器」（下载 client.jar /
 * assets / libraries 后 spawn java），由 `ipc/launcher.ts` 在生产路径上使用，
 * 且有既有测试。两件事同名会造成严重误解，故本服务取名 process-supervisor（进程托管）。
 *
 * 依赖策略：只用 node: 内置（node:child_process / node:events / node:net），零新依赖。
 * 可注入点（spawn / taskkill / 端口探测 / 定时器 / 时钟）齐全，否则不可测——
 * 见 ./process-supervisor.test.ts（全部用假脚本进程，绝不真启动 Minecraft）。
 */

import {
  spawn as nodeSpawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as net from 'node:net';

/** 被托管进程的状态机取值（§7.4 长驻服务生命周期）。 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/**
 * 崩溃自动重启属 §7.1 明列的外壳职责，但**本轮不实现**（刻意留白，见报告「已知局限」）。
 * 后续加法（不动内核，保持「内核只返回指令」）：
 * 1. 在 onUnexpectedExit() 里，若 crashCount 未超上限则经 confirm（risk:'execute'，
 *    §10.6 启动服务端必须弹窗确认）后调用 launch()——crashed → starting 已是合法流转；
 * 2. 退避用注入的 schedule 做指数退避（1s/2s/4s…），上限 5 次；
 * 3. 达上限后保持 'crashed' 不再自动拉起，交给 UI 告警 + §7.4 端口健康检测。
 */

/** 默认日志环形缓冲行数：对齐 kernel-server `read_logs` 的「尾 200 行」语义。 */
export const DEFAULT_LOG_TAIL_LINES = 200;
/** 默认优雅停机宽限（对齐 kernel-server control_server 的 gracefulMs 默认 30000）。 */
export const DEFAULT_GRACEFUL_MS = 30_000;
/** 默认停机后等待端口释放的上限。 */
export const DEFAULT_PORT_WAIT_MS = 10_000;
/** 端口探测单次连接超时。 */
export const DEFAULT_PORT_PROBE_TIMEOUT_MS = 500;
/** 端口释放轮询间隔。 */
const PORT_POLL_INTERVAL_MS = 50;
/** 强杀后等退出的兜底上限；超时不再阻塞 stop()（宁可状态滞后也不挂住应用退出）。 */
const POST_KILL_EXIT_WAIT_MS = 2_000;
/** 正常退出后收尾日志的宽限（devkit/gradle.ts 同款：给 stdio 300ms 收尾）。 */
const LOG_GRACE_MS = 300;
/** 单行日志长度上限：超过就切块，防止无换行的超长输出撑爆内存。 */
const MAX_LINE_LENGTH = 8192;

/** 确认请求：与 kernel-java 的 ConfirmRequest 同形，外壳据此弹窗（§10.2 / §10.6）。 */
export interface ConfirmRequest {
  /** 任务 kind（与内核 TaskSpec.kind 一致，便于审计串联）。 */
  kind: string;
  /** 原始规格（外壳用于渲染影响面）。 */
  payload: unknown;
  /** 中文一行摘要，可直接作弹窗标题。 */
  summary: string;
  /** 风险等级：启动进程恒为 execute（§10.6「执行/写实例目录外 → 必须弹窗确认」）。 */
  risk: 'write' | 'execute';
}

/** 确认闸门；不提供则 launch/launchServer 永不 spawn（同内核「不传则 X 永远拒绝」语义）。 */
export type ConfirmFn = (req: ConfirmRequest) => Promise<boolean> | boolean;

/** 端口探测配置：停机后必须等端口真正释放（§7.1 端口检测）。 */
export interface PortSpec {
  host: string;
  port: number;
  /** 等待端口释放的上限，默认 DEFAULT_PORT_WAIT_MS；超时后状态照样回 stopped，但端口标记为未释放。 */
  waitMs?: number;
}

/** 执行 kernel `launch_instance` 返回的指令所需的规格（字段名对齐内核 data）。 */
export interface LaunchSpec {
  /** 托管键：内核侧的 instanceId（实例）或 serverId（服务端）。 */
  serverId: string;
  /** 内核 data.cmd（如 java 可执行路径）。 */
  cmd: string;
  /** 内核 data.args：一律数组参数，禁止 shell 拼接（§13.4 审计要求）。 */
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  /**
   * 是否经 shell 启动。仅 Windows 的 .bat 需要（devkit/gradle.ts 同款理由：
   * Windows 下只有 gradlew.bat，./gradlew 会 ENOENT）。
   * 默认 false——生产路径（java.exe）永远不用 shell。
   */
  shell?: boolean;
  /** 优雅停机时写入 stdin 的命令；null 表示退化为发信号。默认见 launch / launchServer。 */
  stopCommand?: string | null;
  /** 无 stdin 通道时的停止信号，默认 SIGTERM。 */
  stopSignal?: NodeJS.Signals;
  /** 优雅停机宽限，默认 DEFAULT_GRACEFUL_MS（可被 stop() 覆盖）。 */
  gracefulMs?: number;
  /** 停机后要等待释放的端口（§7.4 端口健康检测）。 */
  port?: PortSpec;
  /** mode='sandbox' 时永不 spawn（§13.4）。 */
  mode?: 'sandbox' | 'live';
  /** 确认弹窗展示的 kind，默认 'launch_instance'（launchServer 为 'start_server'）。 */
  taskKind?: string;
}

/** 托管服务端进程（deploy / restart 的实际执行者）所需的规格。 */
export interface ServerSpec extends LaunchSpec {
  /** 内核 data.serverDir；未显式给 cwd 时用它作工作目录。 */
  serverDir?: string;
  /**
   * 内核 deploy_plugin 返回的 reloadCommand（'/reload confirm'）。
   * 本服务只**记录**用于可观测，不自动注入控制台/RCON——§7.1 的控制台注入
   * 需要 RCON 口令与协议实现，不在本轮范围。
   */
  reloadCommand?: string;
}

/** 一次停机的结果报告（供 UI 与日志定位「为什么没停干净」）。 */
export interface StopReport {
  /** 是否在宽限期内自行退出（即真优雅停机）。 */
  graceful: boolean;
  /** 是否走了强杀兜底（taskkill /t /f 或 SIGKILL）。 */
  forced: boolean;
  /** 配置了端口但等待释放超时；未配置端口为 null。 */
  portTimedOut: boolean | null;
  at: string;
}

/** 进程状态快照（供 §3 status() 与 UI 消费，只读）。 */
export interface StatusSnapshot {
  serverId: string;
  state: ServerState;
  pid: number | null;
  /** ISO 时间戳；未启动过为 null。 */
  startedAt: string | null;
  /** 退出码（被信号杀死为 null）。crashed 时最有诊断价值。 */
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** 崩溃/停机时的日志尾部（环形缓冲，bounded）。 */
  lastLogLines: string[];
  /** 崩溃次数累计（重启同一 serverId 不清零，供退避策略使用）。 */
  crashCount: number;
  /** 最近一次停机报告；从未停机为 null。 */
  lastStop: StopReport | null;
  /** 最近一次停机后端口是否真正释放；未配置端口为 null。 */
  portReleased: boolean | null;
  cmd: string;
  args: string[];
  cwd: string | null;
  /** 仅记录，不自动执行（§7.1 控制台注入未做）。 */
  reloadCommand: string | null;
}

/** 一次停机的结果（LaunchedProcess.stop 的返回值；§7.4 端口等待「超时则报告」）。 */
export interface StopOutcome {
  serverId: string;
  /** 是否在宽限期内自行退出。 */
  graceful: boolean;
  /** 是否走了强杀兜底。 */
  forced: boolean;
  /** 强杀是否成功让进程退出（false = 连强杀都没退出，进程可能已成孤儿）。 */
  exited: boolean;
  /** 停机后端口是否真正释放；未配置端口为 null。 */
  portReleased: boolean | null;
  /** 配置了端口但等待超时 → true（此时应向用户报告「端口仍被占用」）。 */
  portTimedOut: boolean;
}

/** 启动后交给调用方的句柄。 */
export interface LaunchedProcess {
  serverId: string;
  pid: number;
  /** 进程已退出（正常或异常）时 resolve；永不 reject。 */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** 优雅停机（§7.4）：先写停止命令 / 发信号 → 等端口释放 → 超时才强杀。 */
  stop(options?: { gracefulMs?: number }): Promise<StopOutcome>;
  /** 该进程环形缓冲的日志尾部（只读）。 */
  logs(limit?: number): string[];
}

/** spawn 注入点。 */
export type SpawnFn = (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;
/** taskkill 注入点：返回退出码，0 视为成功。 */
export type TaskkillFn = (pid: number) => number | null;
/** 端口探测注入点：resolve(true) 表示端口可连接（仍被占用）。 */
export type PortProbeFn = (host: string, port: number, timeoutMs: number) => Promise<boolean>;
/** 定时器句柄。 */
export interface TimerHandle {
  cancel(): void;
}
/** 定时器注入点；默认实现内部 unref()，避免兜底 timer 拖住 vitest / Electron。 */
export type ScheduleFn = (fn: () => void, ms: number) => TimerHandle;

/** 服务选项：一切副作用与时钟都可注入，故本模块可测。 */
export interface ProcessSupervisorOptions {
  spawn?: SpawnFn;
  taskkill?: TaskkillFn;
  probePort?: PortProbeFn;
  schedule?: ScheduleFn;
  /**
   * 「保活」定时器注入点：只用于正常退出后 300ms 收尾日志这类**必须触发**的短定时器，
   * 默认实现不 unref（否则子进程已退出、事件循环排空时该回调可能永不执行，
   * 导致 exited 永不 resolve）。长定时器（宽限期/端口轮询）走 schedule，会 unref。
   */
  scheduleHold?: ScheduleFn;
  /** 日志环形缓冲行数，默认 DEFAULT_LOG_TAIL_LINES。 */
  logTailLines?: number;
  /** 时钟注入（ISO 时间戳来源）。 */
  now?: () => number;
  /** 端口探测单次连接超时，默认 DEFAULT_PORT_PROBE_TIMEOUT_MS。 */
  portProbeTimeoutMs?: number;
  /** shutdownAll 使用的优雅停机宽限（默认 2000ms：退出前不该等满 30s）。 */
  shutdownGracefulMs?: number;
  /** 平台判定注入（默认 process.platform），测试可强制走另一分支。 */
  platform?: NodeJS.Platform;
  /** 确认闸门（§10.6）。不提供则永不 spawn。 */
  confirm?: ConfirmFn;
}

/** 失败码：区分「非法流转 / 未确认 / 沙箱禁止 / spawn 失败 / 服务已关」，便于外壳与 UI 归类。 */
export type SupervisorErrorCode =
  'INVALID_STATE' | 'PERMISSION_DENIED' | 'SANDBOX_NO_SPAWN' | 'SPAWN_FAILED' | 'SERVICE_CLOSED';

/** 托管服务抛出的带码错误。 */
export class ProcessSupervisorError extends Error {
  constructor(
    message: string,
    readonly code: SupervisorErrorCode,
  ) {
    super(message);
    this.name = 'ProcessSupervisorError';
  }
}

/** 日志行事件负载。 */
export interface LogEvent {
  serverId: string;
  stream: 'stdout' | 'stderr';
  line: string;
  at: string;
}

/** 状态机允许的流转。非法流转在写状态前拒绝，避免出现「已 running 又被 launch」。 */
const LEGAL: Record<ServerState, readonly ServerState[]> = {
  stopped: ['starting'],
  starting: ['running', 'stopping', 'crashed', 'stopped'],
  running: ['stopping', 'crashed', 'stopped'],
  stopping: ['stopped', 'crashed'],
  // crashed → starting 合法：崩溃后由用户再次 launch 即为 restart（自动重启不在本轮）。
  crashed: ['starting', 'stopping'],
};

interface Entry {
  serverId: string;
  spec: LaunchSpec;
  cmd: string;
  args: string[];
  cwd: string | null;
  reloadCommand: string | null;
  child: ChildProcess | null;
  pid: number | null;
  state: ServerState;
  startedAt: number | null;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** 我方是否主动发起了停机——判定 crashed 的唯一依据（不看退出码）。 */
  stopRequested: boolean;
  forced: boolean;
  portReleased: boolean | null;
  lastStop: StopReport | null;
  crashCount: number;
  /** 环形缓冲（bounded）。 */
  lines: string[];
  /** stdout/stderr 共用的半行缓冲：两条流按到达顺序合并，切分才不会错位。 */
  pending: string;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  resolveExit: (r: { code: number | null; signal: NodeJS.Signals | null }) => void;
  exitedSettled: boolean;
  /** 并发 stop() 共享同一个 promise。 */
  stopPromise: Promise<StopOutcome> | null;
}

/** 轻量 deferred，避免 Promise.resolve 占位后再覆盖。 */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** 是否 thenable（用于确认闸门的失败关闭判定）。 */
function isThenable(v: unknown): v is Promise<boolean> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}

/** 默认 taskkill：杀整棵树（/t 子孙全杀，/f 强制）。 */
const defaultTaskkill: TaskkillFn = (pid) =>
  spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' }).status;

/**
 * 默认端口探测：真实 socket 连接（net.createConnection + 超时）。
 * 不用「child 已 exit」代替端口检测——进程退了但端口还在 TIME_WAIT 很常见。
 */
const defaultProbePort: PortProbeFn = (host, port, timeoutMs) =>
  new Promise<boolean>((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const finish = (open: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

/** 默认长定时器：显式 unref（devkit/gradle.ts 同款踩坑经验）。 */
const defaultSchedule: ScheduleFn = (fn, ms) => {
  const t = setTimeout(fn, ms);
  if (typeof t === 'object' && t !== null && 'unref' in t) t.unref();
  return { cancel: () => clearTimeout(t) };
};

/** 默认保活定时器：不 unref，保证「必须触发」的短回调一定会跑。 */
const defaultScheduleHold: ScheduleFn = (fn, ms) => {
  const t = setTimeout(fn, ms);
  return { cancel: () => clearTimeout(t) };
};

class Supervisor extends EventEmitter implements ProcessSupervisor {
  private readonly entries = new Map<string, Entry>();
  private readonly spawnFn: SpawnFn;
  private readonly taskkill: TaskkillFn;
  private readonly probePort: PortProbeFn;
  private readonly schedule: ScheduleFn;
  private readonly scheduleHold: ScheduleFn;
  private readonly tailLines: number;
  private readonly now: () => number;
  private readonly portProbeTimeoutMs: number;
  private readonly shutdownGracefulMs: number;
  private readonly platform: NodeJS.Platform;
  private readonly confirm: ConfirmFn | undefined;
  private shutdownPromise: Promise<void> | null = null;

  constructor(opts: ProcessSupervisorOptions = {}) {
    super();
    this.spawnFn = opts.spawn ?? ((cmd, args, options) => nodeSpawn(cmd, args, options));
    this.taskkill = opts.taskkill ?? defaultTaskkill;
    this.probePort = opts.probePort ?? defaultProbePort;
    this.schedule = opts.schedule ?? defaultSchedule;
    this.scheduleHold = opts.scheduleHold ?? defaultScheduleHold;
    this.tailLines = Math.max(1, opts.logTailLines ?? DEFAULT_LOG_TAIL_LINES);
    this.now = opts.now ?? Date.now;
    this.portProbeTimeoutMs = opts.portProbeTimeoutMs ?? DEFAULT_PORT_PROBE_TIMEOUT_MS;
    this.shutdownGracefulMs = opts.shutdownGracefulMs ?? 2_000;
    this.platform = opts.platform ?? process.platform;
    this.confirm = opts.confirm;
  }

  launch(spec: LaunchSpec): LaunchedProcess {
    return this.spawnManaged(spec, {
      // 客户端实例不该收到服务端控制台的 "stop" 文本；无 stdin 时退化为发信号。
      stopCommand: spec.stopCommand === undefined ? null : spec.stopCommand,
      taskKind: spec.taskKind ?? 'launch_instance',
      cwd: spec.cwd,
    });
  }

  launchServer(spec: ServerSpec): LaunchedProcess {
    return this.spawnManaged(spec, {
      // §7.4 停止：服务端控制台的 "stop" 是唯一的真优雅停机途径（先写 stdin 再等）。
      stopCommand: spec.stopCommand === undefined ? 'stop\n' : spec.stopCommand,
      taskKind: spec.taskKind ?? 'start_server',
      cwd: spec.cwd ?? spec.serverDir,
    });
  }

  status(serverId: string): StatusSnapshot | null {
    const e = this.entries.get(serverId);
    if (e === undefined) return null;
    return {
      serverId: e.serverId,
      state: e.state,
      pid: e.pid,
      startedAt: e.startedAt === null ? null : new Date(e.startedAt).toISOString(),
      exitCode: e.exitCode,
      exitSignal: e.exitSignal,
      lastLogLines: e.lines.slice(-this.tailLines),
      crashCount: e.crashCount,
      lastStop: e.lastStop,
      portReleased: e.portReleased,
      cmd: e.cmd,
      args: [...e.args],
      cwd: e.cwd,
      reloadCommand: e.reloadCommand,
    };
  }

  list(): Array<{ serverId: string; state: ServerState; pid: number | null }> {
    return [...this.entries.values()].map((e) => ({
      serverId: e.serverId,
      state: e.state,
      pid: e.pid,
    }));
  }

  logs(serverId: string, limit?: number): string[] {
    const e = this.entries.get(serverId);
    if (e === undefined) return [];
    const n = limit === undefined ? this.tailLines : Math.max(0, limit);
    return e.lines.slice(Math.max(0, e.lines.length - n));
  }

  async shutdownAll(): Promise<void> {
    // 幂等：重复调用共享同一个 promise，绝不重复 spawn / kill。
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    const alive = [...this.entries.values()].filter(
      (e) => e.state !== 'stopped' && e.state !== 'crashed',
    );
    this.shutdownPromise = (async () => {
      // allSettled：单个进程停不掉不能连带抛错，更不能产生未捕获异常。
      const settled = await Promise.allSettled(
        alive.map((e) => this.stopEntry(e, this.shutdownGracefulMs)),
      );
      for (const r of settled) {
        if (r.status === 'rejected') this.emit('supervisor-error', r.reason);
      }
    })();
    return this.shutdownPromise;
  }

  // ===== 内部实现 =====

  /**
   * 启动一个被托管进程。前置顺序刻意如此，每一步失败都是**零副作用**：
   * 1) 服务是否已关闭 2) 参数形状 3) 状态机是否允许 4) mode=sandbox 永不 spawn（§13.4）
   * 5) 确认闸门（§10.6；未确认 / 通道异常 / 返回 Promise → 不 spawn、不写文件、不建 entry）
   * 6) 才真正 spawn。
   */
  private spawnManaged(
    spec: LaunchSpec,
    defaults: { stopCommand: string | null; taskKind: string; cwd: string | undefined },
  ): LaunchedProcess {
    if (this.shutdownPromise !== null) {
      throw new ProcessSupervisorError(
        '服务已关闭（shutdownAll 已调用），不再接受新的启动',
        'SERVICE_CLOSED',
      );
    }
    if (typeof spec.serverId !== 'string' || spec.serverId === '') {
      throw new ProcessSupervisorError('spec.serverId 不能为空', 'INVALID_STATE');
    }
    if (typeof spec.cmd !== 'string' || spec.cmd === '') {
      throw new ProcessSupervisorError(
        'spec.cmd 不能为空（内核 launch_instance 返回的可执行）',
        'INVALID_STATE',
      );
    }
    if (!Array.isArray(spec.args) || spec.args.some((a) => typeof a !== 'string')) {
      throw new ProcessSupervisorError(
        'spec.args 必须是 string[]（一律数组参数，禁止 shell 拼接，§13.4）',
        'INVALID_STATE',
      );
    }
    if (spec.mode === 'sandbox') {
      throw new ProcessSupervisorError(
        `沙箱模式不 spawn：${spec.serverId}（§13.4 沙箱内代码永不自动加载进正式环境）`,
        'SANDBOX_NO_SPAWN',
      );
    }

    const existing = this.entries.get(spec.serverId);
    if (existing !== undefined && !LEGAL[existing.state].includes('starting')) {
      // 非法流转拒绝：已在 starting / running / stopping 时不允许再次 launch。
      throw new ProcessSupervisorError(
        `${spec.serverId} 当前状态 ${existing.state}，不允许 launch（需先 stop）`,
        'INVALID_STATE',
      );
    }

    // 把默认值落到解析后的规格上（launchServer 的 "stop"、serverDir→cwd）。
    const resolved: LaunchSpec = {
      ...spec,
      stopCommand: spec.stopCommand === undefined ? defaults.stopCommand : spec.stopCommand,
    };
    if (defaults.cwd !== undefined && resolved.cwd === undefined) resolved.cwd = defaults.cwd;
    const cwd = resolved.cwd ?? null;

    if (!this.requestConfirmation(resolved, defaults.taskKind, cwd)) {
      throw new ProcessSupervisorError(
        `用户未确认，拒绝启动 ${spec.serverId}（§10.6 启动服务端必须弹窗确认）`,
        'PERMISSION_DENIED',
      );
    }

    return this.doSpawn(resolved, cwd);
  }

  /**
   * 走确认闸门（§10.6）。任何「拿不准」都按未确认处理——宁可拒绝，绝不静默执行。
   * 注意：launch 是同步接口，异步确认（Electron dialog.showMessageBox 返回 Promise）
   * 必须由 IPC 层先 await 再调 launch；这里遇到 thenable 直接失败关闭。
   */
  private requestConfirmation(spec: LaunchSpec, taskKind: string, cwd: string | null): boolean {
    if (this.confirm === undefined) return false;
    const req: ConfirmRequest = {
      kind: taskKind,
      payload: { ...spec, cwd },
      summary: `启动 ${spec.serverId}：${this.describeCommand(spec.cmd, spec.args)}`,
      risk: 'execute',
    };
    try {
      const verdict = this.confirm(req);
      if (isThenable(verdict)) {
        // 吞掉 rejection，避免产生未处理拒绝；结果一律按「未确认」处理。
        verdict.then(
          () => undefined,
          () => undefined,
        );
        return false;
      }
      return verdict === true;
    } catch {
      // 确认通道自身异常按「未确认」处理（与 kernel-java executeWrite 同款）。
      return false;
    }
  }

  private describeCommand(cmd: string, args: string[]): string {
    const head = args.slice(0, 4).join(' ');
    return head === '' ? cmd : `${cmd} ${head}${args.length > 4 ? ' …' : ''}`;
  }

  private doSpawn(spec: LaunchSpec, cwd: string | null): LaunchedProcess {
    const args = [...spec.args];
    const previous = this.entries.get(spec.serverId);
    const d = deferred<{ code: number | null; signal: NodeJS.Signals | null }>();
    const entry: Entry = {
      serverId: spec.serverId,
      spec,
      cmd: spec.cmd,
      args,
      cwd,
      reloadCommand: this.readReloadCommand(spec),
      child: null,
      pid: null,
      state: 'stopped',
      startedAt: null,
      exitCode: null,
      exitSignal: null,
      stopRequested: false,
      forced: false,
      portReleased: null,
      lastStop: null,
      // 重启不清零 crashCount：崩溃自动重启的退避策略要靠它判断是否放弃（§7.1）。
      crashCount: previous?.crashCount ?? 0,
      // 日志也跨重启保留：崩溃后重启时，上一轮的尾部日志正是「为什么崩」的答案。
      // pending（半行）不保留——死进程留下的半行不该拼到新进程输出前面。
      lines: previous?.lines ?? [],
      pending: '',
      exited: d.promise,
      resolveExit: d.resolve,
      exitedSettled: false,
      stopPromise: null,
    };
    // 重启同一 serverId 时复用 entry，保留环形缓冲与 crashCount（可观测性不断线）。
    this.entries.set(entry.serverId, entry);

    const options: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      // 后台运行不弹黑框（§7.1「后台运行」）。
      windowsHide: true,
    };
    if (cwd !== null) options.cwd = cwd;
    if (spec.env !== undefined) options.env = { ...process.env, ...spec.env };
    if (spec.shell === true) options.shell = true;

    this.setState(entry, 'starting');
    let child: ChildProcess;
    try {
      child = this.spawnFn(spec.cmd, args, options);
    } catch (e) {
      this.finishExit(entry, null, null);
      this.setState(entry, 'crashed');
      throw new ProcessSupervisorError(`spawn 失败：${(e as Error).message}`, 'SPAWN_FAILED');
    }
    entry.child = child;
    entry.pid = child.pid ?? null;

    // 捕获日志：stdout/stderr 按到达顺序合并（§7.4 控制台流式 I/O）。
    child.stdout?.on('data', (chunk: Buffer) =>
      this.appendLog(entry, 'stdout', chunk.toString('utf8')),
    );
    child.stderr?.on('data', (chunk: Buffer) =>
      this.appendLog(entry, 'stderr', chunk.toString('utf8')),
    );
    // stdin 是优雅停机的通道；EPIPE 说明对端已死，吞掉避免未捕获异常。
    child.stdin?.on('error', () => undefined);

    // 以 'exit' 为准完成（Windows 下孙进程可能仍持有 stdio 管道，'close' 迟迟不来——
    // devkit/gradle.ts 的踩坑经验）；非我方停机时给 300ms 宽限收尾日志。
    child.on('exit', (code, signal) => {
      this.flushPending(entry);
      if (entry.stopRequested) {
        this.finishExit(entry, code, signal);
        // 停机路径的最终状态由 stopEntry 收尾（它还要等端口释放）。
        if (entry.state !== 'stopping') this.setState(entry, 'stopped');
        return;
      }
      const t = this.scheduleHold(() => {
        this.finishExit(entry, code, signal);
        this.onUnexpectedExit(entry);
      }, LOG_GRACE_MS);
      child.once('close', () => {
        t.cancel();
        this.finishExit(entry, code, signal);
        this.onUnexpectedExit(entry);
      });
    });
    child.on('error', (err: Error) => {
      // 如 java 缺失（ENOENT）：不等待退出事件，直接落 crashed，并把错误写进日志尾部。
      this.appendLog(entry, 'stderr', `spawn error: ${err.message}\n`);
      this.finishExit(entry, null, null);
      this.setState(entry, 'crashed');
    });

    entry.startedAt = this.now();
    if (child.pid !== undefined) this.setState(entry, 'running');
    else {
      child.once('spawn', () => {
        if (entry.state === 'starting') this.setState(entry, 'running');
      });
    }

    return {
      serverId: entry.serverId,
      pid: entry.pid ?? 0,
      exited: entry.exited,
      logs: (limit?: number) => this.logs(entry.serverId, limit),
      stop: (options?: { gracefulMs?: number }) => this.stopPublic(entry, options),
    };
  }

  /** 读 ServerSpec 上的 reloadCommand（只记录，不自动注入，§7.1）。 */
  private readReloadCommand(spec: LaunchSpec): string | null {
    const v = (spec as { reloadCommand?: unknown }).reloadCommand;
    return typeof v === 'string' && v !== '' ? v : null;
  }

  private setState(entry: Entry, next: ServerState): void {
    if (entry.state === next) return;
    if (!LEGAL[entry.state].includes(next)) {
      // 不静默吞掉：emit 出来让外壳/测试能发现流转 bug，但不中断 stop 链路。
      this.emit('invalid-transition', { serverId: entry.serverId, from: entry.state, to: next });
      return;
    }
    entry.state = next;
    const snap = this.status(entry.serverId);
    if (snap !== null) this.emit('state', snap);
  }

  private appendLog(entry: Entry, stream: 'stdout' | 'stderr', text: string): void {
    const at = new Date(this.now()).toISOString();
    entry.pending += text;
    let idx = entry.pending.indexOf('\n');
    while (idx !== -1) {
      const raw = entry.pending.slice(0, idx);
      entry.pending = entry.pending.slice(idx + 1);
      this.pushLine(entry, stream, raw.replace(/\r$/, ''), at);
      idx = entry.pending.indexOf('\n');
    }
    // 无换行的超长输出（如二进制误写进 stdout）不许把内存吃光，也不许留一行 50 万字符：
    // 超过单行上限就按固定块切出来当行，块大小即上限。
    while (entry.pending.length > MAX_LINE_LENGTH) {
      this.pushLine(entry, stream, entry.pending.slice(0, MAX_LINE_LENGTH), at);
      entry.pending = entry.pending.slice(MAX_LINE_LENGTH);
    }
  }

  /** 进程退出时把没换行的尾巴也算一行，否则最后一句会永远看不到。 */
  private flushPending(entry: Entry): void {
    if (entry.pending === '') return;
    const tail = entry.pending.replace(/\r$/, '');
    entry.pending = '';
    if (tail !== '') this.pushLine(entry, 'stdout', tail, new Date(this.now()).toISOString());
  }

  private pushLine(entry: Entry, stream: 'stdout' | 'stderr', line: string, at: string): void {
    entry.lines.push(line);
    // 环形缓冲：超上限丢最旧的行（bounded，供 read_logs 类只读查询）。
    if (entry.lines.length > this.tailLines) {
      entry.lines.splice(0, entry.lines.length - this.tailLines);
    }
    const evt: LogEvent = { serverId: entry.serverId, stream, line, at };
    this.emit('log', evt);
  }

  private finishExit(entry: Entry, code: number | null, signal: NodeJS.Signals | null): void {
    if (entry.exitedSettled) return;
    entry.exitedSettled = true;
    entry.exitCode = code;
    entry.exitSignal = signal;
    entry.resolveExit({ code, signal });
  }

  /**
   * 非预期退出 → crashed。
   * 判定依据是「非我方发起的停机」，**不看退出码**：退出码 0 的自行退出对长驻
   * 服务同样是非预期（用户没让我停）。退出码与日志尾部保留在快照里供诊断。
   */
  private onUnexpectedExit(entry: Entry): void {
    if (entry.stopRequested) return;
    if (entry.state === 'crashed' || entry.state === 'stopped') return;
    entry.crashCount += 1;
    this.setState(entry, 'crashed');
  }

  private stopPublic(entry: Entry, options?: { gracefulMs?: number }): Promise<StopOutcome> {
    if (entry.state === 'stopped' || entry.state === 'crashed') {
      // 进程已死：stop 是 no-op，且**不**改变 crashed 状态——崩溃证据要留给 UI。
      return Promise.resolve({
        serverId: entry.serverId,
        graceful: true,
        forced: false,
        exited: true,
        portReleased: null,
        portTimedOut: false,
      });
    }
    const gracefulMs = options?.gracefulMs ?? entry.spec.gracefulMs ?? DEFAULT_GRACEFUL_MS;
    if (entry.stopPromise !== null) return entry.stopPromise;
    entry.stopPromise = this.stopEntry(entry, gracefulMs);
    return entry.stopPromise;
  }

  private async stopEntry(entry: Entry, gracefulMs: number): Promise<StopOutcome> {
    entry.stopRequested = true;
    this.setState(entry, 'stopping');
    let exited = true;

    const child = entry.child;
    if (child !== null) {
      this.requestGracefulStop(entry, child);
      // 等宽限期；不退出则强杀整棵树（win taskkill /t /f，posix SIGTERM→SIGKILL）。
      if (!(await this.waitExit(entry, gracefulMs))) {
        entry.forced = true;
        this.killTree(entry);
        exited = await this.waitExit(entry, POST_KILL_EXIT_WAIT_MS);
      }
    }

    // 端口等待：进程退了但端口可能还在 TIME_WAIT，必须等真正释放（§7.1 端口检测）。
    const portOk = await this.waitPortRelease(entry);
    const configured = entry.spec.port !== undefined;
    entry.lastStop = {
      graceful: !entry.forced,
      forced: entry.forced,
      portTimedOut: configured ? !portOk : null,
      at: new Date(this.now()).toISOString(),
    };
    this.setState(entry, 'stopped');
    return {
      serverId: entry.serverId,
      graceful: !entry.forced,
      forced: entry.forced,
      exited,
      portReleased: entry.portReleased,
      portTimedOut: configured && !portOk,
    };
  }

  /**
   * 请求优雅停机（§7.4）。顺序：
   * 1) 首选写 stdin —— Minecraft 服务端控制台的 "stop" 是唯一的真优雅停机途径
   *    （跨平台都有效，因为不依赖信号语义）；
   * 2) 无 stdin 通道时退化为发信号；
   * 3) Windows + shell:true 时**不发信号**：那只会 TerminateProcess 掉 cmd.exe，
   *    把 .bat 拉起的孙进程留成孤儿（devkit/gradle.ts 踩过的坑），
   *    此时统一等宽限期耗尽后走 killTree（taskkill /t /f 杀整棵树）。
   */
  private requestGracefulStop(entry: Entry, child: ChildProcess): void {
    const stopCommand = entry.spec.stopCommand ?? null;
    const stdinWritable = stopCommand !== null && (child.stdin?.writable ?? false);
    const signalIsSafe = this.platform !== 'win32' || entry.spec.shell !== true;
    if (stdinWritable) {
      try {
        child.stdin?.write(stopCommand);
        return;
      } catch {
        /* 管道已断：退化为信号 */
      }
    }
    if (signalIsSafe) this.sendSignal(child, entry.spec.stopSignal ?? 'SIGTERM');
  }

  private sendSignal(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      child.kill(signal);
    } catch {
      /* 进程已退出 */
    }
  }

  /**
   * 杀整棵树。
   * Windows：taskkill /t /f（杀 cmd.exe + 孙进程）；失败回退 SIGTERM。
   * posix：SIGTERM → 500ms → SIGKILL（devkit/gradle.ts 同款）。
   */
  private killTree(entry: Entry): void {
    const child = entry.child;
    if (child === null) return;
    const pid = entry.pid;
    if (this.platform === 'win32' && pid !== null) {
      try {
        if (this.taskkill(pid) === 0) return;
      } catch {
        /* 回退信号 */
      }
      this.sendSignal(child, 'SIGTERM');
      return;
    }
    this.sendSignal(child, 'SIGTERM');
    const t = this.schedule(() => this.sendSignal(child, 'SIGKILL'), 500);
    // 进程若在 500ms 内已退出，无需再补刀。
    child.once('exit', () => t.cancel());
  }

  /** 等进程退出；返回 true=已退出，false=超时。 */
  private async waitExit(entry: Entry, ms: number): Promise<boolean> {
    if (entry.exitedSettled) return true;
    let timer: TimerHandle | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = this.schedule(() => resolve('timeout'), ms);
    });
    const outcome = await Promise.race([entry.exited.then(() => 'exited' as const), timeout]);
    timer?.cancel();
    return outcome === 'exited';
  }

  /** 轮询直到端口不可连接；返回是否已释放。 */
  private async waitPortRelease(entry: Entry): Promise<boolean> {
    const port = entry.spec.port;
    if (port === undefined) {
      entry.portReleased = null;
      return true;
    }
    const waitMs = Math.max(0, port.waitMs ?? DEFAULT_PORT_WAIT_MS);
    const step = Math.min(PORT_POLL_INTERVAL_MS, Math.max(1, waitMs));
    let elapsed = 0;
    for (;;) {
      const open = await this.probePort(port.host, port.port, this.portProbeTimeoutMs);
      if (!open) {
        entry.portReleased = true;
        return true;
      }
      if (elapsed >= waitMs) {
        entry.portReleased = false;
        return false;
      }
      elapsed += step;
      await this.sleep(step);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.schedule(resolve, ms);
    });
  }
}

/** 进程托管服务接口：launch 执行内核指令，status/list/logs 只读，shutdownAll 收尾。 */
export interface ProcessSupervisor extends EventEmitter {
  /** 执行 kernel launch_instance 返回的指令并托管进程。 */
  launch(spec: LaunchSpec): LaunchedProcess;
  /** 托管一个服务端进程（deploy / restart 的实际执行者）。 */
  launchServer(spec: ServerSpec): LaunchedProcess;
  /** 读进程状态快照（供 §3 status() 与 UI 消费）。 */
  status(serverId: string): StatusSnapshot | null;
  /** 列出所有被托管的进程。 */
  list(): Array<{ serverId: string; state: ServerState; pid: number | null }>;
  /** 只读：读日志尾部（环形缓冲，默认末尾 logTailLines 行）。 */
  logs(serverId: string, limit?: number): string[];
  /** 全部优雅停机（应用退出时调用）。幂等。 */
  shutdownAll(): Promise<void>;
}

/** 创建进程托管服务单例。 */
export function createProcessSupervisor(opts: ProcessSupervisorOptions = {}): ProcessSupervisor {
  return new Supervisor(opts);
}
