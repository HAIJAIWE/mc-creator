import type { CompleteOptions, ModelProvider, StreamChunk } from './types.js';

/** 测试用 mock：返回预设响应，支持流式分片 */
export class MockProvider implements ModelProvider {
  readonly id = 'mock';
  readonly capabilities = { toolCalling: true, vision: false, streaming: true };
  constructor(private response: string) {}

  async complete(_prompt: string, _opts?: CompleteOptions): Promise<string> {
    return this.response;
  }

  async *stream(_prompt: string, _opts?: CompleteOptions): AsyncIterable<StreamChunk> {
    const tokens = this.response.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      yield { delta: tokens[i] + ' ', done: false };
    }
    yield { delta: '', done: true };
  }
}
