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
 */

/** 项目类型 → 中文标签映射（与 ChatPanel 的 GENERATOR_LABELS 一致） */
const GENERATOR_LABELS: Record<string, string> = {
  mod: '模组',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  resource_pack: '资源包',
  skin: '皮肤',
  launcher: '启动器',
};

/** 默认 system message（无 context 时使用） */
export const DEFAULT_CHAT_SYSTEM_MESSAGE =
  '你是 Minecraft mod 专家助手，帮助用户设计 mod。简洁回答。';

/** ChatStreamRequest 的 context 字段类型 */
export interface ChatStreamContext {
  generatorType?: string;
  description?: string;
  specSummary?: string;
}

/**
 * 根据 context 构建增强 system message。
 *
 * - 无 context 时返回默认 system message。
 * - 有 context 时拼接项目类型 / 用户描述 / spec 摘要。
 */
export function buildChatSystemMessage(context?: ChatStreamContext): string {
  if (!context) return DEFAULT_CHAT_SYSTEM_MESSAGE;

  const parts: string[] = [
    '你是 Minecraft mod 专家助手，帮助用户设计 mod。',
    '请基于用户当前项目上下文回答，简洁清晰，使用中文。',
  ];

  if (context.generatorType) {
    const label = GENERATOR_LABELS[context.generatorType] || context.generatorType;
    parts.push(`当前项目类型：${label}。`);
  }

  if (context.description) {
    parts.push(`用户对项目的描述：${context.description}`);
  }

  if (context.specSummary) {
    parts.push(`当前 spec 摘要：\n${context.specSummary}`);
  }

  return parts.join('\n\n');
}
