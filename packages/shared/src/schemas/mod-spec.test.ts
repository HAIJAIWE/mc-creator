import { describe, it, expect } from 'vitest';
import { ModSpec, ItemSpec, BlockSpec, FoodSpec, ModDependencySpec } from './mod-spec.js';

describe('ModSpec schema', () => {
  it('最小合法 spec（仅 modId + name）填充默认值', () => {
    const r = ModSpec.parse({ modId: 'demo', name: 'Demo' });
    expect(r.version).toBe('1.0.0');
    expect(r.description).toBe('');
    expect(r.items).toEqual([]);
    expect(r.blocks).toEqual([]);
    expect(r.license).toBe('MIT');
    expect(r.authors).toEqual([]);
    expect(r.credits).toBe('');
    expect(r.dependencies).toEqual([]);
    expect(r.website).toBe('');
  });

  it('modId 格式校验：必须小写下划线数字', () => {
    expect(() => ModSpec.parse({ modId: 'Demo', name: 'x' })).toThrow();
    expect(() => ModSpec.parse({ modId: 'demo-mod', name: 'x' })).toThrow();
    expect(() => ModSpec.parse({ modId: 'demo mod', name: 'x' })).toThrow();
    expect(() => ModSpec.parse({ modId: '', name: 'x' })).toThrow();
    // 合法
    expect(() => ModSpec.parse({ modId: 'demo_mod', name: 'x' })).not.toThrow();
    expect(() => ModSpec.parse({ modId: 'demo123', name: 'x' })).not.toThrow();
  });

  it('完整 spec（含 items/blocks/dependencies）round-trip', () => {
    const input = {
      modId: 'my_mod',
      version: '2.0.0',
      name: 'My Mod',
      description: 'A test mod',
      license: 'Apache-2.0',
      authors: ['alice', 'bob'],
      credits: 'Thanks to community',
      website: 'https://example.com',
      items: [
        { id: 'ruby', name: 'Ruby', maxStackSize: 16, rarity: 'rare', maxDamage: 100, fuelTick: 0, lore: 'A shiny gem' },
        { id: 'apple_custom', name: 'Custom Apple', food: { hunger: 5, saturation: 0.8 } },
      ],
      blocks: [
        { id: 'ruby_block', name: 'Ruby Block', material: 'metal', hardness: 5.0, miningLevel: 2, lightLevel: 3, resistance: 30, soundType: 'metal', dropSelf: true },
      ],
      dependencies: [
        { modId: 'fabric_api', version: '>=0.100', mandatory: true },
      ],
    };
    const r = ModSpec.parse(input);
    expect(r.modId).toBe('my_mod');
    expect(r.version).toBe('2.0.0');
    expect(r.items).toHaveLength(2);
    expect(r.items[0].rarity).toBe('rare');
    expect(r.items[1].food?.hunger).toBe(5);
    expect(r.blocks[0].miningLevel).toBe(2);
    expect(r.dependencies[0].mandatory).toBe(true);
  });
});

describe('ItemSpec schema', () => {
  it('最小 item（id + name）填充默认值', () => {
    const r = ItemSpec.parse({ id: 'stick', name: 'Stick' });
    expect(r.maxStackSize).toBe(64);
    expect(r.rarity).toBe('common');
    expect(r.maxDamage).toBe(0);
    expect(r.fuelTick).toBe(0);
    expect(r.food).toBeUndefined();
    expect(r.lore).toBe('');
  });

  it('id 格式校验：小写下划线数字', () => {
    expect(() => ItemSpec.parse({ id: 'Stick', name: 'x' })).toThrow();
    expect(() => ItemSpec.parse({ id: 'stick-test', name: 'x' })).toThrow();
    expect(() => ItemSpec.parse({ id: 'stick mod', name: 'x' })).toThrow();
    expect(() => ItemSpec.parse({ id: 'stick', name: 'x' })).not.toThrow();
  });

  it('maxStackSize 范围 1-64', () => {
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', maxStackSize: 0 })).toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', maxStackSize: 65 })).toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', maxStackSize: 1 })).not.toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', maxStackSize: 64 })).not.toThrow();
  });

  it('rarity 枚举校验', () => {
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', rarity: 'legendary' })).toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', rarity: 'common' })).not.toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', rarity: 'epic' })).not.toThrow();
  });

  it('food 可选，提供时校验 hunger 0-20', () => {
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', food: { hunger: -1 } })).toThrow();
    expect(() => ItemSpec.parse({ id: 'x', name: 'x', food: { hunger: 21 } })).toThrow();
    const r = ItemSpec.parse({ id: 'x', name: 'x', food: { hunger: 10 } });
    expect(r.food?.hunger).toBe(10);
    expect(r.food?.saturation).toBe(0.6); // 默认 saturation
  });
});

describe('BlockSpec schema', () => {
  it('最小 block（id + name）填充默认值', () => {
    const r = BlockSpec.parse({ id: 'stone', name: 'Stone' });
    expect(r.material).toBe('wood');
    expect(r.hardness).toBe(1.5);
    expect(r.miningLevel).toBe(0);
    expect(r.lightLevel).toBe(0);
    expect(r.resistance).toBe(6.0);
    expect(r.soundType).toBe('stone');
    expect(r.dropSelf).toBe(true);
    expect(r.dropItem).toBe('');
  });

  it('miningLevel 范围 0-10', () => {
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', miningLevel: -1 })).toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', miningLevel: 11 })).toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', miningLevel: 0 })).not.toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', miningLevel: 10 })).not.toThrow();
  });

  it('lightLevel 范围 0-15', () => {
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', lightLevel: -1 })).toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', lightLevel: 16 })).toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', lightLevel: 15 })).not.toThrow();
  });

  it('material 枚举校验', () => {
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', material: 'water' })).toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', material: 'wood' })).not.toThrow();
    expect(() => BlockSpec.parse({ id: 'x', name: 'x', material: 'rock' })).not.toThrow();
  });

  it('dropSelf=false 时 dropItem 可指定掉落物', () => {
    const r = BlockSpec.parse({ id: 'x', name: 'x', dropSelf: false, dropItem: 'minecraft:stick' });
    expect(r.dropSelf).toBe(false);
    expect(r.dropItem).toBe('minecraft:stick');
  });
});

describe('FoodSpec schema', () => {
  it('hunger 整数 0-20，saturation 默认 0.6', () => {
    const r = FoodSpec.parse({ hunger: 8 });
    expect(r.hunger).toBe(8);
    expect(r.saturation).toBe(0.6);
  });

  it('hunger 超范围拒绝', () => {
    expect(() => FoodSpec.parse({ hunger: -1 })).toThrow();
    expect(() => FoodSpec.parse({ hunger: 21 })).toThrow();
    expect(() => FoodSpec.parse({ hunger: 1.5 })).toThrow(); // 必须整数
  });
});

describe('ModDependencySpec schema', () => {
  it('最小依赖（仅 modId）填充默认值', () => {
    const r = ModDependencySpec.parse({ modId: 'fabric_api' });
    expect(r.version).toBe('');
    expect(r.mandatory).toBe(true);
  });

  it('完整依赖 round-trip', () => {
    const r = ModDependencySpec.parse({ modId: 'fabric_api', version: '>=0.100', mandatory: false });
    expect(r.modId).toBe('fabric_api');
    expect(r.version).toBe('>=0.100');
    expect(r.mandatory).toBe(false);
  });
});
