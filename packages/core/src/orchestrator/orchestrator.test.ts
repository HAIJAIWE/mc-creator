import { describe, it, expect } from 'vitest';
import { Orchestrator, formatSpecIssues } from './orchestrator.js';
import { MockProvider } from '../model-provider/mock-provider.js';
import { ModSpec, DataEnchantmentSpec } from '@mc-creator/shared';

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

describe('Orchestrator.generateSpecByType', () => {
  it('enchantment 类型：合法输出直接返回且通过 schema 校验', async () => {
    const valid = JSON.stringify({
      packId: 'ench_pack',
      packName: '测试附魔',
      enchantments: [
        {
          id: 'test_boost',
          name: '测试增强',
          maxLevel: 3,
          effects: [{ type: 'damage_bonus', amount: 2 }],
        },
      ],
    });
    const o = new Orchestrator(new MockProvider(valid));
    const spec = await o.generateSpecByType('一个测试附魔', 'enchantment');
    expect(DataEnchantmentSpec.safeParse(spec).success).toBe(true);
  });

  it('behavior_item 类型：合法输出直接返回', async () => {
    const valid = JSON.stringify({
      packId: 'item_pack',
      packName: '测试物品',
      items: [
        {
          id: 'magic_sword',
          name: '魔法剑',
          category: 'weapons',
          attackDamage: 7,
          primaryColor: '#ff0000',
        },
      ],
    });
    const o = new Orchestrator(new MockProvider(valid));
    const spec = await o.generateSpecByType('一把魔法剑', 'behavior_item');
    expect((spec as any).items[0].id).toBe('magic_sword');
  });

  it('behavior_entity 类型：合法输出直接返回', async () => {
    const valid = JSON.stringify({
      packId: 'entity_pack',
      packName: '测试实体',
      entities: [
        {
          id: 'goblin',
          name: '哥布林',
          health: 20,
          attackDamage: 3,
          hostile: true,
          goals: [{ type: 'melee', priority: 3, speedMultiplier: 1 }],
          mainColor: '#4a7c2f',
        },
      ],
    });
    const o = new Orchestrator(new MockProvider(valid));
    const spec = await o.generateSpecByType('一个哥布林怪物', 'behavior_entity');
    expect((spec as any).entities[0].id).toBe('goblin');
  });

  it('输出不合法时带错误回灌重试并成功', async () => {
    const responses = [
      '{"packName":"缺 packId"}',
      JSON.stringify({ packId: 'a1', packName: '补全' }),
    ];
    let i = 0;
    const provider = { complete: async () => responses[i++] } as any;
    const o = new Orchestrator(provider);
    const spec = await o.generateSpecByType('补全', 'enchantment');
    expect((spec as any).packId).toBe('a1');
  });

  it('不支持的生成器类型抛错', async () => {
    const o = new Orchestrator(new MockProvider('{}'));
    await expect(o.generateSpecByType('x', 'unknown' as never)).rejects.toThrow(
      /不支持的生成器类型/,
    );
  });
});

describe('formatSpecIssues', () => {
  it('拼接前 3 条问题并附总数', () => {
    const error = DataEnchantmentSpec.safeParse({}).error!;
    // packId / packName 缺失
    expect(formatSpecIssues(error)).toContain('packId');
    expect(formatSpecIssues(error)).toContain('packName');
  });
});
