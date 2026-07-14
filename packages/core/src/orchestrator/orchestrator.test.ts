import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { MockProvider } from '../model-provider/mock-provider.js';
import { ModSpec } from '@mc-creator/shared';

describe('Orchestrator', () => {
  it('首次输出合法即返回', async () => {
    const valid = JSON.stringify({ modId: 'demo', version: '1.0.0', name: 'Demo', items: [] });
    const o = new Orchestrator(new MockProvider(valid));
    const spec = await o.generateModSpec('做一个 demo mod');
    expect(ModSpec.safeParse(spec).success).toBe(true);
  });

  it('输出不合法时带错误重试，最终成功', async () => {
    // 第一次返回缺字段，第二次返回合法
    const responses = ['{"modId":"bad id"}', JSON.stringify({ modId: 'demo', name: 'Demo' })];
    let i = 0;
    const provider = { complete: async () => responses[i++] } as any;
    const o = new Orchestrator(provider);
    const spec = await o.generateModSpec('描述');
    expect((spec as any).modId).toBe('demo');
  });

  it('重试 3 次仍失败则抛错', async () => {
    const provider = { complete: async () => 'not json' } as any;
    const o = new Orchestrator(provider);
    await expect(o.generateModSpec('x')).rejects.toThrow(/校验失败/);
  });
});
