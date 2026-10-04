import { z } from 'zod';

/**
 * 进程托管的 IPC 契约（外壳层，§7.1 / §7.4 / §10.2）。
 *
 * **只有只读通道**：列被托管进程 / 读状态快照 / 读日志尾部。
 * 刻意**不**暴露「直接启动 / 停止」通道——启动服务端属 X 类任务，
 * 必须先经内核的确认闸门弹窗（§10.6「执行/写实例目录外 → 必须弹窗确认」）。
 * 若绕过内核直接给渲染层一个 spawn 通道，等于把 §10.6 的闸门作废。
 *
 * 同理**不**暴露「触发自动重启 / 触发控制台注入」通道（§7.1 新增两项能力）：
 * 这两件事都是有副作用的执行类操作，一旦能从渲染层直接点火，§10.6 就形同虚设。
 * 渲染层只能**读**它们的状态（快照里的 autoRestart* 与 lastCommandOutcome），
 * 是否执行永远由主进程侧的 confirm 闸门与用户实际点过的那个「启动」按钮决定。
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
