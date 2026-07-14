import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { CompleteOptions, ModelProvider, StreamChunk } from './types.js';

/** 模型配置（持久化存 UI 层，创建 provider 时传入） */
export interface AiModelConfig {
  /** 模型 ID，如 'gpt-4o-mini', 'deepseek-chat' */
  modelId: string;
  /** OpenAI 兼容的 base URL（默认 https://api.openai.com/v1） */
  baseURL: string;
  /** API Key */
  apiKey: string;
}

/**
 * 基于 Vercel AI SDK 的模型提供者（规格 §2.4）。
 * 用 @ai-sdk/openai 的 OpenAI 兼容接口，支持各家云端模型。
 */
export class VercelAiProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities = { toolCalling: true, vision: false, streaming: true };
  private readonly openai;

  constructor(config: AiModelConfig) {
    this.id = config.modelId;
    this.openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const { text } = await generateText({
      model: this.openai(this.id),
      prompt,
      system: opts?.system,
      maxTokens: opts?.maxTokens,
    });
    return text;
  }

  async *stream(prompt: string, opts?: CompleteOptions): AsyncIterable<StreamChunk> {
    const result = streamText({
      model: this.openai(this.id),
      prompt,
      system: opts?.system,
      maxTokens: opts?.maxTokens,
    });
    for await (const chunk of (await result).textStream) {
      yield { delta: chunk, done: false };
    }
    yield { delta: '', done: true };
  }
}
