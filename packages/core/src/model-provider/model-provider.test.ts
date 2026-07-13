import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock-provider.js';

describe('MockProvider', () => {
  it('complete 返回预设响应', async () => {
    const p = new MockProvider('hello world');
    expect(await p.complete('anything')).toBe('hello world');
  });

  it('stream 分片输出并以 done 结束', async () => {
    const p = new MockProvider('a b c');
    const chunks = [];
    for await (const c of p.stream('x')) chunks.push(c);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(chunks.map((c) => c.delta).join('').trim()).toBe('a b c');
  });
});
