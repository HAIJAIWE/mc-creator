import { z } from 'zod';

/**
 * AI 规格闭环通道（L2：prompt→真模型→spec JSON→校验→修复→合法 spec 落入编辑器）。
 *
 * 请求/应答均过 zod 白名单校验；kind 现阶段只支持 datapack，
 * 其他 kind 由主进程直接返回明确不支持错（不臆测产物形状）。
 */
export const AGENT_RUN_LOOP = 'agent:runLoop';

export const AgentRunLoopRequest = z.object({
  /** 用户原始需求（复用 AgentPanel description 输入）。 */
  prompt: z.string().min(1),
  /** 产物类别：L2 仅支持 datapack。 */
  kind: z.string().default('datapack'),
  /** 目标 MC 版本（拼入 versionContext，供 prompt 指令与 packFormat 对照）。 */
  mcVersion: z.string().default('1.21.11'),
  /** 最大修复轮次（默认 3，可配，上限 8 与 datapack 生成阶梯对齐）。 */
  maxAttempts: z.number().int().min(1).max(8).default(3),
});

export const AgentRunLoopTranscriptEntry = z.object({
  stage: z.enum(['generate', 'fix']),
  text: z.string(),
});

export const AgentRunLoopResponse = z.object({
  ok: z.boolean(),
  /** 合法 spec（ok:true 时必有；已过 DatapackSpec + validateDatapack 双校验）。 */
  spec: z.record(z.unknown()).optional(),
  /** 每次模型原文（不截断不改写，供 UI 折叠展示与问题排查）。 */
  transcript: z.array(AgentRunLoopTranscriptEntry).optional(),
  /** 失败计数（与 runClosedLoop 的 attempts 语义一致）。 */
  attempts: z.number().optional(),
  /** ok:false 时的中文原因（含校验 issues 原文或网关失败原因）。 */
  error: z.string().optional(),
});

export type AgentRunLoopReq = z.infer<typeof AgentRunLoopRequest>;
export type AgentRunLoopRes = z.infer<typeof AgentRunLoopResponse>;
