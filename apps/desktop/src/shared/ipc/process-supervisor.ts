import { z } from 'zod';

/**
 * 进程托管的 IPC 契约（外壳层，§7.1 / §7.4 / §10.2）。
 *
 * 查询通道只读：列被托管进程 / 读状态快照 / 读日志尾部。
 *
 * 有副作用的通道只有两个，且都**必须经主进程原生确认闸门**（§10.6）：
 *   - `processLaunch`：启动服务端，cmd 从磁盘推导，不接受渲染层传 cmd；
 *   - `processStop`：停止已托管服务端，只接受 serverId，主进程先弹窗
 *     展示 PID/动作，确认后才写 `stop` 并等待退出。
 * 两者都**不**接受可执行文件或任意命令，因此不是"裸 spawn / kill 通道"。
 *
 * 仍**不**暴露「触发自动重启 / 触发控制台注入」通道：这两件事没有对应的
 * 用户动作入口，一旦能从渲染层直接点火，§10.6 就形同虚设。渲染层只能**读**
 * 它们的状态（快照里的 autoRestart* 与 lastCommandOutcome）。
 */

// === 进程托管：只读查询通道 ===
// 通道名常量统一放在 ./channels.ts（与 PROJECT_CHANGED 等一致），本文件只放 schema/类型，
// 避免同一个名字被 barrel 导出两次。

/**
 * 状态变更事件负载（渲染层**只消费**，不据此点火）。
 *
 * 为什么需要它：自动重启是有延迟的（默认 1s 起退避），若渲染层只能轮询
 * PROCESS_STATUS，UI 要等最多一个轮询周期才反映「正在重启 / 已放弃重启」。
 * 崩溃瞬间弹出告警恰恰是自动重启最该让人看见的时刻，等一秒再显示就丢了
 * 这个语义。
 *
 * 注意这是**通知**不是**命令**：收到它不代表渲染层该做什么，点火权仍在主进程
 * 的 confirm 闸门（§10.6）。UI 的正确用法是「收到 autoRestartExhausted →
 * 弹告警 + 提供一个走正常启动流程的按钮」。
 */
export interface ProcessStateEventT {
  serverId: string;
  /** 完整快照（与 ProcessStatusT 同形，字段只增不改） */
  status: ProcessStatusT;
  /** 事件类型，供 UI 区分「普通状态流转」与「值得打扰用户的告警」 */
  event:
    | 'state'
    | 'auto-restart-scheduled'
    | 'auto-restart-rejected'
    | 'auto-restart-exhausted'
    | 'invalid-transition';
}

/** 状态机取值（与 main/process-supervisor.ts 的 ServerState 一一对应）。 */
export const ProcessStateSchema = z.enum(['stopped', 'starting', 'running', 'stopping', 'crashed']);
export type ProcessStateT = z.infer<typeof ProcessStateSchema>;

/** 一次停机的报告（供 UI 说明「为什么没停干净」）。 */
export const ProcessStopReportSchema = z.object({
  graceful: z.boolean(),
  forced: z.boolean(),
  portTimedOut: z.boolean().nullable(),
  at: z.string(),
});
export type ProcessStopReportT = z.infer<typeof ProcessStopReportSchema>;

/** 一次控制台注入的结果（§7.1 / §7.4）；失败带明确原因，不静默丢。 */
export const ProcessSendOutcomeSchema = z.object({
  serverId: z.string(),
  delivered: z.boolean(),
  command: z.string(),
  reason: z.string().nullable(),
  code: z.string().nullable(),
  at: z.string(),
});
export type ProcessSendOutcomeT = z.infer<typeof ProcessSendOutcomeSchema>;

/** 进程状态快照：只读，字段与 main 侧 StatusSnapshot 对齐。 */
export const ProcessStatusSchema = z.object({
  serverId: z.string(),
  state: ProcessStateSchema,
  pid: z.number().nullable(),
  startedAt: z.string().nullable(),
  exitCode: z.number().nullable(),
  exitSignal: z.string().nullable(),
  lastLogLines: z.array(z.string()),
  crashCount: z.number(),
  lastStop: ProcessStopReportSchema.nullable(),
  portReleased: z.boolean().nullable(),
  cmd: z.string(),
  args: z.array(z.string()),
  cwd: z.string().nullable(),
  reloadCommand: z.string().nullable(),
  // 自动重启状态（§7.1）：UI 读它来决定要不要弹「已放弃自动重启」的告警。
  autoRestartEnabled: z.boolean(),
  autoRestartCount: z.number(),
  autoRestartExhausted: z.boolean(),
  autoRestartPending: z.boolean(),
  lastCommandOutcome: ProcessSendOutcomeSchema.nullable(),
});
export type ProcessStatusT = z.infer<typeof ProcessStatusSchema>;

// ===== 请求 / 响应 =====

export const ProcessListResponse = z.object({
  processes: z.array(
    z.object({
      serverId: z.string(),
      state: ProcessStateSchema,
      pid: z.number().nullable(),
    }),
  ),
});
export type ProcessListRes = z.infer<typeof ProcessListResponse>;

export const ProcessStatusRequest = z.object({
  serverId: z.string(),
});
export const ProcessStatusResponse = z.object({
  status: ProcessStatusSchema.nullable(),
});
export type ProcessStatusReq = z.infer<typeof ProcessStatusRequest>;
export type ProcessStatusRes = z.infer<typeof ProcessStatusResponse>;

/**
 * 启动服务端的请求（§10.6 X 类，必须弹窗确认）。
 *
 * **刻意不接受 cmd / args** —— supervisor 以当前用户权限 spawn，
 * 让渲染层自己指定可执行文件等于把任意程序执行权交给前端。
 * cmd 由主进程从磁盘上的服务端目录推导，再逐字展示在确认弹窗里。
 *
 * `serverId` 的合法性在主进程 `buildServerLaunchSpec` 里再判一次
 * （拒绝 `..` / 分隔符 / 盘符，与 kernel-server 同规则），
 * schema 这里只挡明显畸形的输入，不承担安全职责。
 */
export const ProcessLaunchRequest = z.object({
  serverId: z.string().min(1),
  /** Java 可执行文件；不传则用 `java`（走 PATH）。 */
  javaPath: z.string().optional(),
  /** JVM 堆，如 `2G`；不传用 `2G`。白名单在主进程侧再校验一次。 */
  memory: z.string().optional(),
});
export const ProcessLaunchResponse = z.object({
  ok: z.boolean(),
  /** 已托管时的进程 pid；未启动为 null。 */
  pid: z.number().nullable(),
  /** 用户在弹窗点了取消时为 true（区别于「失败」）。 */
  denied: z.boolean().optional(),
  error: z.string().nullable(),
});
export type ProcessLaunchReq = z.infer<typeof ProcessLaunchRequest>;
export type ProcessLaunchRes = z.infer<typeof ProcessLaunchResponse>;

/**
 * 停止服务端（X 类，§10.6 确认闸门）。
 *
 * 只接受 serverId：渲染层不能指定 PID 或命令。主进程从 supervisor 取
 * 当前托管进程，弹窗展示 serverId/PID/动作，确认后才发送 `stop`。
 */
export const ProcessStopRequest = z.object({
  serverId: z.string().min(1),
});
export const ProcessStopResponse = z.object({
  ok: z.boolean(),
  /** 用户在弹窗点了取消时为 true（区别于「停止失败」）。 */
  denied: z.boolean().optional(),
  error: z.string().nullable(),
  /** 停机报告；实例本就不在运行时为 null。 */
  stop: ProcessStopReportSchema.nullable(),
});
export type ProcessStopReq = z.infer<typeof ProcessStopRequest>;
export type ProcessStopRes = z.infer<typeof ProcessStopResponse>;

export const ProcessLogsRequest = z.object({
  serverId: z.string(),
  /** 读尾部 N 行；不传用服务默认环形缓冲上限（200，对齐内核 read_logs）。 */
  limit: z.number().optional(),
});
export const ProcessLogsResponse = z.object({
  lines: z.array(z.string()),
});
export type ProcessLogsReq = z.infer<typeof ProcessLogsRequest>;
export type ProcessLogsRes = z.infer<typeof ProcessLogsResponse>;

/** 流式日志事件负载。 */
export interface ProcessLogEventT {
  serverId: string;
  stream: 'stdout' | 'stderr';
  line: string;
  at: string;
}
