import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VercelAiProvider } from './vercel-ai-provider.js';

// Mock Vercel AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (modelId: string) => modelId,
}));

import { generateText, streamText } from 'ai';

describe('VercelAiProvider', () => {
  const config = {
    modelId: 'test-model',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'test-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('complete 调用 generateText 返回文本', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '{"modId":"test"}' } as any);
    const provider = new VercelAiProvider(config);
    const result = await provider.complete('生成 mod');
    expect(result).toBe('{"modId":"test"}');
    expect(generateText).toHaveBeenCalled();
  });

  it('stream 返回流式片段', async () => {
    const chunks = ['hello', ' ', 'world'];
    const asyncIter = (async function* () {
      for (const c of chunks) yield c;
    })();
    vi.mocked(streamText).mockResolvedValue({ textStream: asyncIter } as any);
    const provider = new VercelAiProvider(config);
    const collected: string[] = [];
    for await (const chunk of provider.stream('test')) {
      if (!chunk.done) collected.push(chunk.delta);
    }
    expect(collected.join('')).toBe('hello world');
  });

  it('id 等于 config.modelId', () => {
    const provider = new VercelAiProvider(config);
    expect(provider.id).toBe('test-model');
  });
});
