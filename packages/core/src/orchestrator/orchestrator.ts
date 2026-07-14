import { ModSpec, type ModSpec as ModSpecType } from '@mc-creator/shared';
import type { ModelProvider } from '../model-provider/types.js';

const MAX_RETRIES = 3;

/**
 * AI 编排器（规格 §2.4）：spec-first 流程的薄编排层。
 * 负责调用模型 → JSON Schema 校验 → 失败带错误回灌重试。
 */
export class Orchestrator {
  constructor(private provider: ModelProvider) {}

  async generateModSpec(description: string): Promise<ModSpecType> {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const prompt = this.buildPrompt(description, lastError);
      const raw = await this.provider.complete(prompt);
      const parsed = this.tryParse(raw);
      if (parsed.ok) {
        const result = ModSpec.safeParse(parsed.value);
        if (result.success) return result.data;
        lastError = result.error.message;
      } else {
        lastError = parsed.error;
      }
    }
    throw new Error(`ModSpec 校验失败（重试 ${MAX_RETRIES} 次）：${lastError}`);
  }

  private buildPrompt(desc: string, err: string): string {
    const base = `你是 Minecraft mod 规格生成器。根据描述生成 loader 无关的 ModSpec JSON。
描述：${desc}
只输出 JSON，不要解释。Schema：modId(小写下划线), version, name, description, items[], blocks[]。`;
    return err ? `${base}\n上次错误：${err}\n请修正。` : base;
  }

  private tryParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
    }
  }
}
