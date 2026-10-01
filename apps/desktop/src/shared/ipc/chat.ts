import { z } from 'zod';

// === AI 聊天 ===
export const CHAT = 'ai:chat';

export const ChatRequest = z.object({ message: z.string().min(1) });
export const ChatResponse = z.object({ reply: z.string() });

export type ChatReq = z.infer<typeof ChatRequest>;
export type ChatRes = z.infer<typeof ChatResponse>;

// === 流式 AI 聊天 ===
export const CHAT_STREAM = 'ai:chatStream';
export const CHAT_STREAM_CHUNK = 'ai:chatStream:chunk'; // 主进程→渲染进程的事件

/**
 * P12 chat 模式工具调用增强：ChatStreamRequest 添加可选 context 字段，
 * 让 chat 模式能感知项目上下文（生成器类型 + 用户描述 + 当前 spec 摘要）。
 * 上下文由 main 进程拼接到 system message，不暴露原始 spec 给模型以外的用途。
 */
export const ChatStreamRequest = z.object({
  message: z.string().min(1),
  context: z
    .object({
      generatorType: z.string().optional(),
      description: z.string().optional(),
      /** spec 的简短摘要（避免传完整 JSON 消耗 token） */
      specSummary: z.string().optional(),
    })
    .optional(),
});
export type ChatStreamReq = z.infer<typeof ChatStreamRequest>;

// === AI 解释代码（流式） ===
export const EXPLAIN_CODE = 'ai:explainCode';
export const EXPLAIN_CODE_CHUNK = 'ai:explainCode:chunk';

export const ExplainCodeRequest = z.object({
  fileName: z.string().min(1),
  code: z.string().min(1),
  generatorType: z.string().optional(),
});
export type ExplainCodeReq = z.infer<typeof ExplainCodeRequest>;
// === 多模型对比（流式） ===
export const COMPARE_MODELS = 'ai:compareModels';
export const COMPARE_MODELS_CHUNK = 'ai:compareModels:chunk';

export const CompareModelsRequest = z.object({
  description: z.string().min(1),
  generatorType: z.string(),
  models: z
    .array(
      z.object({
        name: z.string(),
        modelId: z.string().min(1),
        baseURL: z.string().min(1),
        apiKey: z.string(),
      }),
    )
    .min(2)
    .max(3),
});
export type CompareModelsReq = z.infer<typeof CompareModelsRequest>;

// === AI 修复建议（流式） ===
export const AI_FIX_SUGGEST = 'ai:fixSuggest';
export const AI_FIX_SUGGEST_CHUNK = 'ai:fixSuggest:chunk';

export const AiFixSuggestRequest = z.object({
  buildLog: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
});
export type AiFixSuggestReq = z.infer<typeof AiFixSuggestRequest>;
