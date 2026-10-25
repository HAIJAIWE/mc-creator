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
import { sendRcon as defaultSendRcon, type RconSendFn } from './rcon-client.js';

/** 被托管进程的状态机取值（§7.4 长驻服务生命周期）。 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed';

/**
 * §7.1 明列的两项外壳职责，本文件现已实现（内核侧仍然只「返回指令」，一行没动）：
 *
 * 1. **崩溃自动重启**（指数退避）：非预期退出 → crashed → 若未超上限，则经 §10.6 确认
 *    闸门后按 1s/2s/4s… 退避自动 launch()（crashed → starting 本就是合法流转）。
 *    默认**关闭**（autoRestart=false）：自动重启是有副作用的行为，必须用户显式打开；
 *    用户 stop() 请求过的停机绝不触发重启；用户手动 launch() 视为「新一轮」并重置退避计数。
 * 2. **控制台注入**（§7.1 / §7.4）：sendCommand() 与 reloadCommand 自动注入都走
 *    **stdin 管道**——这是 Minecraft 服务端控制台的常规途径（BDS / Paper / Fabric 等），
 *    与优雅停机写 "stop" 是同一条路（requestGracefulStop 已在用）。
 *
 * **范围限制（刻意）：RCON 协议本文件不实现。**
 * RCON 需要口令管理（§7.1 把「RCON 口令」列为外壳职责）+ Minecraft 私有封包协议
 * （TCP + VarInt 长度前缀 + 口令握手 + 两种包类型），成本高且与本轮重点无关。
 * stdin 注入已覆盖「外壳自己 spawn 出来的服务端」这一主场景；后续接 RCON 的位置很明确：
 * 把 dispatchCommand() 的写入环节从「只认 stdin」扩成「stdin 优先 → 无 stdin 通道时
 * 退化为 RCON socket 写入」，对外的 SendOutcome 契约、§10.6 闸门与前置校验都可原样复用。
 */

/** 默认日志环形缓冲行数：对齐 kernel-server `read_logs` 的「尾 200 行」语义。 */
export const DEFAULT_LOG_TAIL_LINES = 200;
/** 默认优雅停机宽限（对齐 kernel-server control_server 的 gracefulMs 默认 30000）。 */
export const DEFAULT_GRACEFUL_MS = 30_000;
/** 默认停机后等待端口释放的上限。 */
export const DEFAULT_PORT_WAIT_MS = 10_000;
/** 端口探测单次连接超时。 */
export const DEFAULT_PORT_PROBE_TIMEOUT_MS = 500;
/** 崩溃自动重启的首次退避：后续按 2 的幂逐次翻倍（§7.1「1s/2s/4s…」）。 */
export const DEFAULT_RESTART_DELAY_MS = 1_000;
/** 单次退避的封顶：翻倍再翻也不会无限等，否则第 20 次就是十几分钟。 */
export const DEFAULT_MAX_RESTART_DELAY_MS = 30_000;
/** 连续崩溃上限：达上限后保持 'crashed' 不再自动拉起，交给 UI 告警（§7.1 / §7.4）。 */
export const DEFAULT_MAX_AUTO_RESTARTS = 5;
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
  /**
   * Source RCON 地址（§7.4 stdin 不可用时回退用）。
   * 无配置则不猜默认端口，保持原 STDIN_CLOSED 行为。
   */
  rcon?: { host: string; port: number };
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
   * 内核 deploy_plugin 返回的 reloadCommand（'/reload confirm'，hotReload:true 时才有）。
   * 默认只**记录**用于可观测（状态快照的 reloadCommand 字段）；
   * 只有外壳在创建服务时显式打开 `autoInjectReload`，才会在进程进入 running 后
   * 自动把它写进 stdin（§7.1 控制台注入）。仍然要过 §10.6 确认闸门。
   */
  reloadCommand?: string;
}

/** 一次控制台注入的结果（§7.1 / §7.4）。失败必须带明确原因，绝不静默丢。 */
export interface SendOutcome {
  serverId: string;
  /** 唯一为 true 的情形：确实把命令写进了子进程 stdin，或经 RCON 回退发送成功。 */
  delivered: boolean;
  /** 原样命令（未补换行），便于审计串联。 */
  command: string;
  /** 中文失败原因；delivered=true 时为 null。 */
  reason: string | null;
  code: SendErrorCode | null;
  /** 实际投递通道：stdin 成功为 'stdin'，RCON 回退成功为 'rcon'；失败时为 undefined。 */
  channel?: 'stdin' | 'rcon';
  at: string;
}

/** 注入失败码：UI 按 code 归类，reason 负责给人看。 */
export type SendErrorCode =
  /** 该 serverId 从未被托管。 */
  | 'NOT_MANAGED'
  /** 未获 §10.6 确认（或 confirm 未配置）：一个字节都没写进 stdin。 */
  | 'NOT_CONFIRMED'
  /** 进程已死（crashed / stopped）。 */
  | 'PROCESS_DEAD'
  /** stdin 管道不存在或已关闭（writableEnded / destroyed / 非 pipe）。 */
  | 'STDIN_CLOSED'
  /** 空命令。 */
  | 'EMPTY_COMMAND'
  /** 写入过程中管道报错（EPIPE 等）。 */
  | 'WRITE_FAILED'
  /** RCON 鉴权失败（口令错误或被拒绝）。 */
  | 'RCON_AUTH_FAILED'
  /** RCON 操作超时。 */
  | 'RCON_TIMEOUT'
  /** RCON 连接失败（连不上 / 握手前断开）。 */
  | 'RCON_CONN_FAILED'
  /** 服务已 shutdownAll。 */
  | 'SERVICE_CLOSED';

/** 自动重启达上限事件负载（§7.1：达上限保持 crashed，交给 UI 告警）。 */
export interface AutoRestartExhaustedEvent {
  serverId: string;
  /** 累计崩溃次数（跨重启不清零，可观测）。 */
  crashCount: number;
  /** 已自动重启次数。 */
  attempts: number;
  maxAutoRestarts: number;
  at: string;
}

/** 计划一次自动重启时的事件负载（让 UI 能显示「1 秒后重试」）。 */
export interface AutoRestartScheduledEvent {
  serverId: string;
  /** 第几次尝试（1 起）。 */
  attempt: number;
  delayMs: number;
  at: string;
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
  /** 内核 deploy_plugin 的 reloadCommand；仅在开自动注入时才会真的写进 stdin（§7.1）。 */
  reloadCommand: string | null;
  /** 崩溃自动重启是否已开启（默认 false，见 §7.1 副作用说明）。 */
  autoRestartEnabled: boolean;
  /** 连续自动重启次数；用户手动 launch() 后归零。 */
  autoRestartCount: number;
  /** 是否已达上限放弃自动重启（UI 应弹告警，§7.1）。 */
  autoRestartExhausted: boolean;
  /** 是否已挂起一次待触发的自动重启（UI 可据此显示倒计时）。 */
  autoRestartPending: boolean;
  /** 最近一次控制台注入结果（只读，UI 可直接展示失败原因）。 */
  lastCommandOutcome: SendOutcome | null;
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

/**
 * 按 id 启停的失败码（R2a：沿 SendOutcome / StopOutcome 的既有词汇，不新造体系）。
 */
export type ServerControlErrorCode =
  /** 该 serverId 从未被托管（先 launch/launchServer 才有 entry 可停可重启）。 */
  | 'SERVER_NOT_FOUND'
  /** 未获 §10.6 确认（restart）：原进程保持原状，一个字节都没动。 */
  | 'NOT_CONFIRMED'
  /** 服务已 shutdownAll：restart 会凭空起进程故拒绝（stop 只停不停起，不受影响）。 */
  | 'SERVICE_CLOSED'
  /** 旧进程已停，但 doSpawn 抛错（新进程没拉起来，停机报告仍在 stop 里）。 */
  | 'SPAWN_FAILED';

/**
 * restartServer / stopServer 的统一结构化结果（R2a：沿 SendOutcome 形状，永不抛裸异常）。
 * 成功时 `stop` 为停机阶段的报告（沿 StopOutcome）；无 entry / 未确认 / 已关闭时为 null。
 */
export interface ServerControlOutcome {
  serverId: string;
  ok: boolean;
  code: ServerControlErrorCode | null;
  /** 中文失败原因；ok=true 时为 null。 */
  reason: string | null;
  stop: StopOutcome | null;
  at: string;
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
  /**
   * 崩溃自动重启（§7.1）。默认 **false** —— 自动拉起进程是有副作用的行为，
   * 不能默认替用户做主（与 §10.6「执行类操作必须用户确认」同一取向）。
   * 开启后每次重启**仍然**要过 confirm 闸门，失败/未配置则保持 'crashed' 不拉起。
   */
  autoRestart?: boolean;
  /** 自动重启的首次退避，默认 DEFAULT_RESTART_DELAY_MS；后续按 2 的幂翻倍。 */
  restartDelayMs?: number;
  /** 单次退避封顶，默认 DEFAULT_MAX_RESTART_DELAY_MS。 */
  maxRestartDelayMs?: number;
  /** 连续崩溃上限，默认 DEFAULT_MAX_AUTO_RESTARTS；达上限 emit 'auto-restart-exhausted'。 */
  maxAutoRestarts?: number;
  /**
   * reloadCommand 自动注入控制台（§7.1）。默认 **false**，理由同 autoRestart：
   * 无确认的自动写控制台属于未授权副作用。开启后也仍走 confirm 闸门。
   */
  autoInjectReload?: boolean;
  /**
   * RCON 口令来源（§7.1 外壳职责：RCON 口令管理归外壳）。
   * 默认无 → 永不走 RCON 回退，保持今日行为。口令绝不落日志。
   */
  getRconPassword?: (serverId: string) => string | null | undefined;
  /** RCON 发送注入点（默认走真实 TCP；测试可注入 fake）。 */
  rconSend?: RconSendFn;
  /** RCON 单次操作超时毫秒（透传给 sendRcon，默认 5000ms）。 */
  rconTimeoutMs?: number;
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
  // crashed → starting 合法：崩溃后自动重启（§7.1）或用户再次 launch 都走这条边。
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
  /** 挂起的自动重启定时器（退避期间非 null）；停机/重启/关服时必须 cancel，否则定时器会在关服后复活进程。 */
  restartTimer: TimerHandle | null;
  /** 连续自动重启次数（退避计数；用户手动 launch 成功后归零，crashCount 不清零）。 */
  autoRestartCount: number;
  /** 是否已用尽自动重启次数（达上限后不再拉起，等 UI 告警）。 */
  autoRestartExhausted: boolean;
  /** 最近一次控制台注入结果（快照可观测，UI 直接展示失败原因）。 */
  lastCommandOutcome: SendOutcome | null;
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
  /** 崩溃自动重启开关（§7.1）；默认关，避免替用户做主。 */
  private readonly autoRestart: boolean;
  private readonly restartDelayMs: number;
  private readonly maxRestartDelayMs: number;
  private readonly maxAutoRestarts: number;
  /** reloadCommand 自动注入开关（§7.1）；默认关，同上。 */
  private readonly autoInjectReload: boolean;
  /** RCON 口令来源（§7.1）；默认无 → 永不回退。 */
  private readonly getRconPassword: ((serverId: string) => string | null | undefined) | undefined;
  /** RCON 发送实现（默认真实 TCP，测试可注入 fake）。 */
  private readonly rconSend: RconSendFn;
  /** RCON 单次超时（undefined = 用 rcon-client 默认 5s）。 */
  private readonly rconTimeoutMs: number | undefined;
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
    this.autoRestart = opts.autoRestart ?? false;
    this.restartDelayMs = Math.max(0, opts.restartDelayMs ?? DEFAULT_RESTART_DELAY_MS);
    this.maxRestartDelayMs = Math.max(
      this.restartDelayMs,
      opts.maxRestartDelayMs ?? DEFAULT_MAX_RESTART_DELAY_MS,
    );
    // 上限 0 视为「完全不自动重启」：显式表达"不要"，不静默退回默认值。
    this.maxAutoRestarts = Math.max(0, opts.maxAutoRestarts ?? DEFAULT_MAX_AUTO_RESTARTS);
    this.autoInjectReload = opts.autoInjectReload ?? false;
    this.getRconPassword = opts.getRconPassword;
    this.rconSend = opts.rconSend ?? defaultSendRcon;
    this.rconTimeoutMs = opts.rconTimeoutMs;
  }

  launch(spec: LaunchSpec): LaunchedProcess {
    this.resetRestartBackoff(spec.serverId);
    return this.spawnManaged(spec, {
      // 客户端实例不该收到服务端控制台的 "stop" 文本；无 stdin 时退化为发信号。
      stopCommand: spec.stopCommand === undefined ? null : spec.stopCommand,
      taskKind: spec.taskKind ?? 'launch_instance',
      cwd: spec.cwd,
    });
  }

  launchServer(spec: ServerSpec): LaunchedProcess {
    this.resetRestartBackoff(spec.serverId);
    return this.spawnManaged(spec, {
      // §7.4 停止：服务端控制台的 "stop" 是唯一的真优雅停机途径（先写 stdin 再等）。
      stopCommand: spec.stopCommand === undefined ? 'stop\n' : spec.stopCommand,
      taskKind: spec.taskKind ?? 'start_server',
      cwd: spec.cwd ?? spec.serverDir,
    });
  }

  /**
   * 用户手动 launch 视为「新一轮」：退避计数归零（§7.1）。
   * 为什么自动重启后要归零而 crashCount 不归零：crashCount 是**诊断事实**（这个 serverId
   * 一共崩过几次），跨轮次累计；而退避计数是**策略状态**（当前这一轮已经让了几次），
   * 用户主动介入说明他认为配置已改好，继续顶格退避没有意义。
   * 只在 spawnManaged 真正走通后才归零（校验失败/未确认则不该动策略状态）。
   */
  private resetRestartBackoff(serverId: string): void {
    const e = this.entries.get(serverId);
    if (e === undefined) return;
    e.autoRestartCount = 0;
    e.autoRestartExhausted = false;
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
      autoRestartEnabled: this.autoRestart,
      autoRestartCount: e.autoRestartCount,
      autoRestartExhausted: e.autoRestartExhausted,
      autoRestartPending: e.restartTimer !== null,
      lastCommandOutcome: e.lastCommandOutcome,
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

  /**
   * 按 id 重启被托管进程（R2a：只加公共方法，不加 IPC，轮询器是 R2b 的事）。
   *
   * 顺序刻意如此，每一步失败都是**结构化返回而非抛错**：
   * 1) 无 entry → SERVER_NOT_FOUND（沿 StopOutcome / 自有错误形状）；
   * 2) 已 shutdownAll → SERVICE_CLOSED（关服后绝不凭空起进程）；
   * 3) §10.6 确认（kind='restart_server'，与 runAutoRestart 同一道闸门）——
   *    未确认则 emit 'restart-rejected'（rejected 事件语义）并原样保留原进程；
   * 4) 复用停机路径优雅停（stopPublic：掐退避定时器 + 经 stopEntry 置 stopRequested，
   *    用户请求停机不触发自动重启）；
   * 5) 停机等待期间若应用开始退出 → 不再 doSpawn（SERVICE_CLOSED，停机报告仍带回）；
   * 6) doSpawn(entry.spec)：日志环形缓冲与 crashCount 跨重启保留；
   *    用户手动重启视为「新一轮」，退避计数归零（与 launch() 同策略）。
   */
  async restartServer(serverId: string): Promise<ServerControlOutcome> {
    const fail = (
      code: ServerControlErrorCode,
      reason: string,
      stop: StopOutcome | null = null,
    ): ServerControlOutcome => ({
      serverId,
      ok: false,
      code,
      reason,
      stop,
      at: new Date(this.now()).toISOString(),
    });
    const e = this.entries.get(serverId);
    if (e === undefined) {
      return fail('SERVER_NOT_FOUND', `未托管 ${serverId}，无法重启（先 launch/launchServer）`);
    }
    if (this.shutdownPromise !== null) {
      return fail('SERVICE_CLOSED', '服务已关闭，拒绝重启');
    }
    if (!this.requestConfirmation(e.spec, 'restart_server', e.cwd)) {
      this.emit('restart-rejected', {
        serverId,
        at: new Date(this.now()).toISOString(),
      });
      return fail('NOT_CONFIRMED', `用户未确认，拒绝重启 ${serverId}（§10.6）`);
    }
    const stop = await this.stopPublic(e);
    if (this.shutdownPromise !== null) {
      // 停机等待期间应用开始退出：不再拉新进程，否则关服后凭空多起一个。
      return fail('SERVICE_CLOSED', '停机期间服务已关闭，不再拉起新进程', stop);
    }
    try {
      this.doSpawn(e.spec, e.cwd);
    } catch (err) {
      return fail(
        'SPAWN_FAILED',
        `重启拉起失败：${err instanceof Error ? err.message : String(err)}`,
        stop,
      );
    }
    this.resetRestartBackoff(serverId);
    return {
      serverId,
      ok: true,
      code: null,
      reason: null,
      stop,
      at: new Date(this.now()).toISOString(),
    };
  }

  /**
   * 按 id 停止被托管进程（R2a：只加公共方法，不加 IPC）。
   * 复用停机路径：stopPublic 内部经 stopEntry 置 stopRequested（用户请求停机不触发
   * 自动重启，见文件头 §7.1 注释）并掐掉挂起的退避定时器；已 stopped / crashed
   * 时为 no-op 成功（崩溃证据保留，不改动状态）。
   */
  async stopServer(serverId: string): Promise<ServerControlOutcome> {
    const e = this.entries.get(serverId);
    if (e === undefined) {
      const miss: ServerControlOutcome = {
        serverId,
        ok: false,
        code: 'SERVER_NOT_FOUND',
        reason: `未托管 ${serverId}，无法停止`,
        stop: null,
        at: new Date(this.now()).toISOString(),
      };
      return miss;
    }
    const stop = await this.stopPublic(e);
    const done: ServerControlOutcome = {
      serverId,
      ok: true,
      code: null,
      reason: null,
      stop,
      at: new Date(this.now()).toISOString(),
    };
    return done;
  }

  async shutdownAll(): Promise<void> {
    // 幂等：重复调用共享同一个 promise，绝不重复 spawn / kill。
    if (this.shutdownPromise !== null) return this.shutdownPromise;
    // 关键：先掐掉所有挂起的自动重启退避定时器。
    // 否则关服流程走完之后，退避到期会在「服务已关闭」状态下仍尝试拉起进程——
    // 那等于应用退出时凭空多起一个 Minecraft（§7.1 的保活绝不能活过应用生命周期）。
    for (const e of this.entries.values()) this.cancelRestartTimer(e);
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
    // 复用 entry 前必须掐掉上一轮挂起的退避定时器：否则旧定时器到期会把
    // 「已经手工/自动重启过的新进程」再顶掉一次（两个 timer 抢同一个 serverId）。
    if (previous !== undefined) this.cancelRestartTimer(previous);
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
      // 退避计数也不清零：连续崩就该连续加倍，只有用户手动 launch 才归零（§7.1）。
      autoRestartCount: previous?.autoRestartCount ?? 0,
      autoRestartExhausted: previous?.autoRestartExhausted ?? false,
      // 日志也跨重启保留：崩溃后重启时，上一轮的尾部日志正是「为什么崩」的答案。
      // pending（半行）不保留——死进程留下的半行不该拼到新进程输出前面。
      lines: previous?.lines ?? [],
      pending: '',
      exited: d.promise,
      resolveExit: d.resolve,
      exitedSettled: false,
      stopPromise: null,
      restartTimer: null,
      lastCommandOutcome: previous?.lastCommandOutcome ?? null,
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

    entry.pid = child.pid ?? null;

    /**
     * spawn 失败（可执行文件不存在 / 不可执行）时，Node **同步**返回 pid=undefined，
     * 错误要到下一个 tick 才以 'error' 发出（上面那个监听器会兜住）。
     *
     * 实测（win32 / Node 24）：成功时 pid 是**同步**赋值的真实值，失败时为 undefined。
     * 因此 `pid === undefined` 是可靠的「没起来」信号，而不是需要等的竞态。
     *
     * 此前这里返回 `{ pid: 0 }`，而调用方无法区分「启动成功」与「根本没启动」——
     * 唯一的生产调用方（agent-host.ts:202）会照常打印「已拉起」。
     * 改为同步抛错，调用链上已有接收点：
     *   - `restartServer` → 已包 try/catch，映射为 SPAWN_FAILED
     *   - `startAgentHost`（index.ts）→ 已有 catch，会如实打印启动失败
     *
     * 位置在监听器**之后**是刻意的：先抛再挂监听器的话，随后到达的 'error'
     * 就没有监听者，EventEmitter 会抛未捕获异常掀翻主进程。
     */
    if (entry.pid === null) {
      this.finishExit(entry, null, null);
      this.setState(entry, 'crashed');
      throw new ProcessSupervisorError(
        `无法启动 ${spec.cmd}：可执行文件不存在或不可执行`,
        'SPAWN_FAILED',
      );
    }
    // 收窄到局部常量：返回值里的 pid 此后不可能是 0
    const pid: number = entry.pid;

    entry.startedAt = this.now();
    if (child.pid !== undefined) this.setState(entry, 'running');
    else {
      child.once('spawn', () => {
        if (entry.state === 'starting') this.setState(entry, 'running');
      });
    }

    // §7.1 控制台注入：reloadCommand 自动写 stdin。默认关闭，且仍走 §10.6 确认闸门。
    this.injectReloadOnStart(entry);

    return {
      serverId: entry.serverId,
      pid,
      exited: entry.exited,
      logs: (limit?: number) => this.logs(entry.serverId, limit),
      stop: (options?: { gracefulMs?: number }) => this.stopPublic(entry, options),
    };
  }

  /**
   * 读 ServerSpec 上的 reloadCommand（§7.1 控制台注入）。
   * 记录进 Entry 供快照观测；是否真的注入由 injectReloadOnStart 决定（默认不注入）。
   */
  private readReloadCommand(spec: LaunchSpec): string | null {
    const v = (spec as { reloadCommand?: unknown }).reloadCommand;
    return typeof v === 'string' && v !== '' ? v : null;
  }

  /**
   * 进程起来后按需注入 reloadCommand（§7.1 控制台注入）。
   * 三个前提缺一不可：开关打开、有 reloadCommand、有可写 stdin；
   * 并且注入本身再过一次 §10.6 确认（与手动 sendCommand 同一道闸门）。
   * 注入时机选在 spawn 之后：此刻 shell/服务端才真正开始读 stdin，早了会被丢掉。
   */
  private injectReloadOnStart(entry: Entry): void {
    if (!this.autoInjectReload) return;
    const cmd = entry.reloadCommand;
    if (cmd === null) return;
    // 故意不 await：launch 必须保持同步（内核 launch_instance 的返回形态是同步的），
    // 注入结果通过 lastCommandOutcome / 'command-sent' 事件异步可观测。
    void this.sendCommand(entry.serverId, cmd);
  }

  /**
   * 向托管进程的控制台注入一条命令（§7.1 / §7.4）。
   *
   * 走 stdin 管道，与优雅停机写 "stop" 是同一条机制——Minecraft 服务端
   * （BDS / Paper / Fabric 等）把 stdin 当控制台，跨平台都有效。
   *
   * 范围限制（重要）：这里**只做 stdin 注入**。RCON 协议（TCP 封包 + 口令握手）
   * 本轮不实现——它需要口令管理（§7.1 把 RCON 口令列为外壳职责）与 Minecraft 私有协议解析，
   * 成本高且不是本轮重点。后续接法：把 writeStdin 换成「stdin 优先 → 无 stdin 通道时退化
   * 为 RCON socket 写入」，确认闸门与失败码契约都可原样复用。
   *
   * §10.6 硬红线：未配置 confirm、confirm 返回非 true、返回 Promise（异步确认走不通）
   * 一律按「未确认」处理，**一个字节都不写进 stdin**（返回 NOT_CONFIRMED）。
   */
  async sendCommand(serverId: string, command: string): Promise<SendOutcome> {
    const e = this.entries.get(serverId);
    const finish = (
      ok: boolean,
      code: SendErrorCode | null,
      reason: string | null,
      channel?: 'stdin' | 'rcon',
    ): SendOutcome => {
      const outcome: SendOutcome = {
        serverId,
        delivered: ok,
        command,
        reason,
        code,
        at: new Date(this.now()).toISOString(),
      };
      // exactOptionalPropertyTypes 下不许显式赋 undefined：有值才挂字段。
      if (channel !== undefined) outcome.channel = channel;
      if (e !== undefined) e.lastCommandOutcome = outcome;
      this.emit('command-sent', outcome);
      return outcome;
    };

    if (e === undefined) {
      return finish(false, 'NOT_MANAGED', `未托管 ${serverId}，无法注入控制台命令`);
    }
    if (this.shutdownPromise !== null) {
      return finish(false, 'SERVICE_CLOSED', '服务已关闭，拒绝注入控制台命令');
    }
    if (typeof command !== 'string' || command.trim() === '') {
      return finish(false, 'EMPTY_COMMAND', '命令为空：拒绝向控制台写空白行');
    }
    const child = e.child;
    if (child === null || e.exitedSettled || e.state === 'stopped' || e.state === 'crashed') {
      return finish(false, 'PROCESS_DEAD', `${serverId} 进程已退出（当前 ${e.state}），无法注入`);
    }
    // §10.6：先过确认闸门，再碰 stdin。顺序反了就等于「先写后问」。
    if (!this.confirmCommand(serverId, command)) {
      return finish(false, 'NOT_CONFIRMED', `用户未确认，拒绝向 ${serverId} 注入命令（§10.6）`);
    }
    const written = this.writeStdin(child, command.endsWith('\n') ? command : `${command}\n`);
    if (!written) {
      // §7.4 回退：stdin 优先 → 无 stdin 通道时退化为 RCON。
      // 条件缺一不可：有口令来源且取到口令，且 spec 显式配了 rcon 主机端口；
      // 无 rcon 配置则保持原 outcome 不变（不猜默认端口）。
      const rconCfg = e.spec.rcon;
      const password = this.getRconPassword?.(serverId);
      if (rconCfg === undefined || password === undefined || password === null || password === '') {
        return finish(
          false,
          'STDIN_CLOSED',
          `${serverId} 的 stdin 通道不可用（未开管道或已关闭）；改用 RCON 需要口令管理，本服务暂不支持`,
        );
      }
      try {
        const opts: { host: string; port: number; password: string; command: string } & {
          timeoutMs?: number;
        } =
          this.rconTimeoutMs === undefined
            ? { host: rconCfg.host, port: rconCfg.port, password, command }
            : {
                host: rconCfg.host,
                port: rconCfg.port,
                password,
                command,
                timeoutMs: this.rconTimeoutMs,
              };
        await this.rconSend(opts);
        return finish(true, null, null, 'rcon');
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        const message = err instanceof Error ? err.message : String(err);
        if (code === 'RCON_AUTH_FAILED' || code === 'RCON_TIMEOUT' || code === 'RCON_CONN_FAILED') {
          return finish(false, code, message);
        }
        return finish(false, 'WRITE_FAILED', `RCON 发送失败：${message}`);
      }
    }
    return finish(true, null, null, 'stdin');
  }

  /** 控制台注入的确认请求（risk 恒为 execute：§10.6 执行类副作用）。 */
  private confirmCommand(serverId: string, command: string): boolean {
    if (this.confirm === undefined) return false;
    const req: ConfirmRequest = {
      kind: 'send_console_command',
      payload: { serverId, command },
      summary: `向 ${serverId} 控制台注入命令：${command}`,
      risk: 'execute',
    };
    try {
      const verdict = this.confirm(req);
      if (isThenable(verdict)) {
        verdict.then(
          () => undefined,
          () => undefined,
        );
        return false;
      }
      return verdict === true;
    } catch {
      return false;
    }
  }

  /** 写一行到子进程 stdin；管道不可用返回 false（EPIPE/未 pipe 都在这里收口）。 */
  private writeStdin(child: ChildProcess, line: string): boolean {
    const stdin = child.stdin;
    if (stdin === null || stdin === undefined) return false;
    // writableEnded/destroyed 都表示对端已走，写进去只会得到 EPIPE 或直接被静默丢弃。
    if (stdin.writableEnded === true || stdin.destroyed === true) return false;
    try {
      // 一条命令 = 一行：调用方已带尾换行就别再补一个，否则服务端控制台会看到空行。
      stdin.write(line);
      return true;
    } catch {
      return false;
    }
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
   *
   * 崩完全默认就到此为止（§7.1 达上限保持 crashed，交给 UI 告警 + §7.4 端口健康检测）；
   * 只有开了 autoRestart 且没超上限时，才按指数退避挂一次**待确认**的自动拉起。
   */
  private onUnexpectedExit(entry: Entry): void {
    if (entry.stopRequested) return;
    if (entry.state === 'crashed' || entry.state === 'stopped') return;
    entry.crashCount += 1;
    this.setState(entry, 'crashed');
    this.scheduleAutoRestart(entry);
  }

  /**
   * 挂一次带退避的自动重启（§7.1）。刻意不立刻重启：
   * - **默认关闭**（autoRestart=false）：进程被自动拉起是有副作用的行为，
   *   崩溃原因（比如磁盘满、配置写错）往往还在，不该在用户没表态前反复重试；
   * - 退避用注入的 schedule（测试用 fake schedule 手动触发，绝不 sleep 硬等）；
   * - 达上限只 emit 事件，不再拉起：把决定权交回 UI（告警 + 用户手动 launch）。
   * 真正 spawn 发生在退避到点之后、并且**过完 §10.6 确认闸门**（见 runAutoRestart）。
   */
  private scheduleAutoRestart(entry: Entry): void {
    if (!this.autoRestart) return;
    if (this.maxAutoRestarts <= 0) return;
    // 服务已关闭（应用正在退出）时绝不拉起：那会凭空多起一个 Minecraft。
    if (this.shutdownPromise !== null) return;
    if (entry.autoRestartCount >= this.maxAutoRestarts) {
      if (!entry.autoRestartExhausted) {
        entry.autoRestartExhausted = true;
        this.emit('auto-restart-exhausted', {
          serverId: entry.serverId,
          crashCount: entry.crashCount,
          attempts: entry.autoRestartCount,
          maxAutoRestarts: this.maxAutoRestarts,
          at: new Date(this.now()).toISOString(),
        } satisfies AutoRestartExhaustedEvent);
      }
      return;
    }
    const attempt = entry.autoRestartCount + 1;
    const delayMs = this.backoffDelayMs(attempt);
    entry.restartTimer = this.schedule(() => {
      // 先清句柄再干活：定时器已经触发，句柄不能再留着（否则 stop() 会去 cancel 一个死定时器）。
      entry.restartTimer = null;
      this.runAutoRestart(entry, attempt);
    }, delayMs);
    this.emit('auto-restart-scheduled', {
      serverId: entry.serverId,
      attempt,
      delayMs,
      at: new Date(this.now()).toISOString(),
    } satisfies AutoRestartScheduledEvent);
  }

  /**
   * 指数退避：第 n 次重启等 restartDelayMs * 2^(n-1)，封顶 maxRestartDelayMs。
   * 默认 1s/2s/4s/8s/16s；封顶 30s（否则翻倍下去第 10 次就是好几分钟，
   * 那不叫退避，那叫让用户以为程序死了）。
   * 乘法而不是位移：避免 n 很大时 1<<n 溢出成负数得到荒谬的负延迟。
   */
  private backoffDelayMs(attempt: number): number {
    const n = Math.max(1, attempt);
    const scaled = this.restartDelayMs * 2 ** (n - 1);
    if (!Number.isFinite(scaled)) return this.maxRestartDelayMs;
    return Math.min(scaled, this.maxRestartDelayMs);
  }

  /**
   * 退避到点，真正执行自动重启。
   * 必须再过一次 §10.6 确认（risk:'execute'）：自动重启同样是「执行进程」这类副作用，
   * 绝不能因为"之前批准过启动"就顺延批准每一次重启。
   */
  private runAutoRestart(entry: Entry, attempt: number): void {
    // 三道闸：服务已关 / 这份 entry 已被新一轮 launch 顶掉 / 我方已请求停机。
    // 任何一条成立都放弃：宁可少重启，也不要在用户已停止后偷偷把进程拉回来。
    if (this.shutdownPromise !== null) return;
    if (this.entries.get(entry.serverId) !== entry) return;
    if (entry.stopRequested) return;
    if (entry.state !== 'crashed') return;

    if (!this.requestConfirmation(entry.spec, 'restart_server', entry.cwd)) {
      // 未确认：保持 crashed（崩溃证据留给 UI），并计入这一轮尝试（否则会无限重试到上限）。
      entry.autoRestartCount = attempt;
      this.emit('auto-restart-rejected', {
        serverId: entry.serverId,
        attempt,
        at: new Date(this.now()).toISOString(),
      });
      return;
    }

    // 确认通过才记账：计数代表"真的试过几次"，未确认的那次不算重试额度用掉。
    entry.autoRestartCount = attempt;
    // crashed → starting 是合法流转（LEGAL 里已开这条边），所以直接复用 doSpawn：
    // 日志环形缓冲与 crashCount 自动跨重启保留（用户要能看到"上次为什么崩"）。
    //
    // 必须 try/catch：本函数可能从**定时器回调**进来（见 scheduleRestart），
    // 那条路径上没有外层 catch 兜着，抛出去就是未捕获异常 —— 主进程整体退出。
    // 同文件另外两条调用路径（restartServer / spawnManaged）都有接收点，
    // 只有这里裸奔。此处把它转成状态与事件，让 UI 能看见"自动重启也失败了"。
    try {
      this.doSpawn(entry.spec, entry.cwd);
    } catch (e) {
      this.appendLog(entry, 'stderr', `自动重启失败：${(e as Error).message}\n`);
      this.finishExit(entry, null, null);
      this.setState(entry, 'crashed');
      this.emit('auto-restart-rejected', {
        serverId: entry.serverId,
        attempt,
        at: new Date(this.now()).toISOString(),
        reason: (e as Error).message,
      });
    }
  }

  /** 掐掉挂起的自动重启（停机 / 手工重启 / 关服时都要调）。 */
  private cancelRestartTimer(entry: Entry): void {
    if (entry.restartTimer === null) return;
    entry.restartTimer.cancel();
    entry.restartTimer = null;
  }

  private stopPublic(entry: Entry, options?: { gracefulMs?: number }): Promise<StopOutcome> {
    // 用户主动停机 ⇒ 绝不允许退避定时器再把进程拉回来（§7.1）。
    // 这一句是"stop 不触发自动重启"的关键：onUnexpectedExit 里的 stopRequested 判断
    // 守住的是"退避已经触发之后"，这里守的是"退避还没到点"。
    this.cancelRestartTimer(entry);
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
  /**
   * 向托管进程的控制台注入命令（§7.1 / §7.4），走 stdin 管道。
   * 必须过 §10.6 确认闸门；失败返回明确 code，绝不静默丢。
   */
  sendCommand(serverId: string, command: string): Promise<SendOutcome>;
  /**
   * 按 id 重启被托管进程（R2a）：过 §10.6 确认 → 优雅停 → doSpawn。
   * 结构化返回（ServerControlOutcome），不抛裸异常；未确认时 emit 'restart-rejected'。
   */
  restartServer(serverId: string): Promise<ServerControlOutcome>;
  /**
   * 按 id 停止被托管进程（R2a）：复用停机路径（置 stopRequested，不触发自动重启）。
   * 结构化返回（ServerControlOutcome），不抛裸异常。
   */
  stopServer(serverId: string): Promise<ServerControlOutcome>;
  /** 全部优雅停机（应用退出时调用）。幂等。 */
  shutdownAll(): Promise<void>;
}

/** 创建进程托管服务单例。 */
export function createProcessSupervisor(opts: ProcessSupervisorOptions = {}): ProcessSupervisor {
  return new Supervisor(opts);
}
