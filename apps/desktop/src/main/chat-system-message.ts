/**
 * P12 chat 模式工具调用增强：根据 context 构建增强 system message。
 *
 * 独立模块（不依赖 electron），方便单元测试。
 *
 * - 无 context 时返回默认 system message（保持向后兼容）。
 * - 有 context 时拼接项目类型 / 用户描述 / spec 摘要到 system message，
 *   让 chat 模式能感知项目上下文，提供更精准的建议。
 *
 * 注意：specSummary 是渲染进程预生成的简短摘要，避免传完整 JSON 消耗 token。
 *
 * 项目类型文案统一取自 `shared/generator-descriptors.ts`（WP5 单一数据源），
 * 不再维护独立的标签表。
 */

import { getGeneratorDescriptor } from '../shared/generator-descriptors.js';
import { formatRagSection } from '@mc-creator/core';

/** 默认 system message（无 context 时使用） */
export const DEFAULT_CHAT_SYSTEM_MESSAGE =
  '你是 Minecraft 内容创作专家助手，帮助用户创作 Minecraft 内容。简洁回答。';

/** ChatStreamRequest 的 context 字段类型 */
export interface ChatStreamContext {
  generatorType: string | undefined;
  description: string | undefined;
  specSummary: string | undefined;
}

/**
 * RAG 引用（buildChatSystemMessage 的第二个参数形态）。
 * 与 core RagHit 结构兼容（title/snippet/source），score/url 可有可无。
 */
export interface RagCitation {
  title: string;
  snippet: string;
  source: string;
}

/**
 * 根据 context 构建增强 system message。
 *
 * - 无 context 时返回默认 system message。
 * - 有 context 时拼接项目类型 / 用户描述 / spec 摘要。
 * - 有 ragHits 时追加本地知识库片段（注明来源，要求模型引用时标注出处）。
 */
export function buildChatSystemMessage(context?: ChatStreamContext, ragHits?: RagCitation[]): string {
  if (!context && (!ragHits || ragHits.length === 0)) return DEFAULT_CHAT_SYSTEM_MESSAGE;

  const parts: string[] = [
    '你是 Minecraft 内容创作专家助手，帮助用户创作 Minecraft 内容。',
    '请基于用户当前项目上下文回答，简洁清晰，使用中文。',
  ];

  if (context?.generatorType) {
    const descriptor = getGeneratorDescriptor(context.generatorType);
    parts.push(
      descriptor
        ? `当前项目类型：${descriptor.label.zh}（${descriptor.description.zh}）。`
        : `当前项目类型：${context.generatorType}。`,
    );
  }

  if (context?.description) {
    parts.push(`用户对项目的描述：${context.description}`);
  }

  if (context?.specSummary) {
    parts.push(`当前 spec 摘要：\n${context.specSummary}`);
  }

  if (ragHits && ragHits.length > 0) {
    parts.push(formatRagSection(ragHits));
  }

  return parts.join('\n\n');
}
