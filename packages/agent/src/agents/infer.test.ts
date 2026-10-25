/**
 * infer.ts（§10.0 推理网关接口层）单元测试。
 * 无真实网络、无 Electron：callModel/resolveKey 全为注入假件。
 */
import { describe, expect, it } from 'vitest';
import { createGateway, routeTier, type InferResponse } from './infer.js';

describe('routeTier 能力分级（§10.0）', () => {
  it('生成→strong，校验/摘要→cheap', () => {
    expect(routeTier({ kind: 'generate' })).toBe('strong');
    expect(routeTier({ kind: 'validate' })).toBe('cheap');
    expect(routeTier({ kind: 'summarize' })).toBe('cheap');
  });
});

describe('超预算转人工', () => {
  it('预估超 budget.maxTokens → BUDGET_EXCEEDED 且不调 callModel', async () => {
    let calls = 0;
    const gw = createGateway({
      resolveKey: () => 'k',
      callModel: async (): Promise<InferResponse> => {
        calls += 1;
        return { ok: true, text: 'should-not-happen' };
      },
    });
    const res = await gw.infer({
      messages: [{ role: 'user', content: 'x'.repeat(100) }],
      budget: { maxTokens: 1 },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('BUDGET_EXCEEDED');
    expect(res.error?.retryable).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('超时转人工', () => {
  it('callModel 悬挂 + timeoutMs 到期 → TIMEOUT', async () => {
    const gw = createGateway({
      resolveKey: () => 'k',
      callModel: () => new Promise<InferResponse>(() => {}),
    });
    const res = await gw.infer({
      messages: [{ role: 'user', content: 'hi' }],
      budget: { timeoutMs: 20 },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('TIMEOUT');
    expect(res.error?.retryable).toBe(false);
  });
});

describe('无 key 转人工', () => {
  it('resolveKey 为空 → NO_KEY 且不调 callModel、不重试', async () => {
    let calls = 0;
    const gw = createGateway({
      resolveKey: async () => null,
      callModel: async (): Promise<InferResponse> => {
        calls += 1;
        return { ok: true, text: 'should-not-happen' };
      },
    });
    const res = await gw.infer({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NO_KEY');
    expect(res.error?.retryable).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('重试只发生 1 次', () => {
  it('首次抛异常、第二次成功 → 共调用 2 次且成功返回', async () => {
    let calls = 0;
    const gw = createGateway({
      resolveKey: () => 'k',
      callModel: async (): Promise<InferResponse> => {
        calls += 1;
        if (calls === 1) throw new Error('transient-boom');
        return { ok: true, text: 'recovered' };
      },
    });
    const res = await gw.infer({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.ok).toBe(true);
    expect(res.text).toBe('recovered');
    expect(calls).toBe(2);
  });
});
