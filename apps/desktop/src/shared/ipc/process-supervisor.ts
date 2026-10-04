import { z } from 'zod';

/**
 * 进程托管的 IPC 契约（外壳层，§7.1 / §7.4 / §10.2）。
 *
 * **只有只读通道**：列被托管进程 / 读状态快照 / 读日志尾部。
 * 刻意**不**暴露「直接启动 / 停止」通道——启动服务端属 X 类任务，
 * 必须先经内核的确认闸门弹窗（§10.6「执行/写实例目录外 → 必须弹窗确认」）。
 * 若绕过内核直接给渲染层一个 spawn 通道，等于把 §10.6 的闸门作废。
 */

// === 进程托管：只读查询通道 ===
// 通道名常量统一放在 ./channels.ts（与 PROJECT_CHANGED 等一致），本文件只放 schema/类型，
// 避免同一个名字被 barrel 导出两次。

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
