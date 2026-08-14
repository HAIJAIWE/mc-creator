import { describe, it, expect } from 'vitest';
import { EnchantmentGenerator } from './enchantment-generator.js';
import { createDefaultRegistry } from '../index.js';

const validSpec = {
  packId: 'my_ench',
  packName: 'My Enchantments',
  description: '自定义附魔包',
  packFormat: 61,
  enchantments: [
    {
      id: 'fire_dash',
      name: '烈焰冲刺',
      description: '攻击时点燃敌人',
      maxLevel: 3,
      supportedItems: ['#minecraft:enchantable/sharp_weapon'],
      slots: ['mainhand'],
      weight: 5,
      effects: [
        { type: 'damage_bonus', amount: 2, target: 'undead' },
        { type: 'burning_time', amount: 1 },
      ],
    },
    {
      id: 'vampiric',
      name: '吸血',
      maxLevel: 5,
      supportedItems: ['minecraft:netherite_sword'],
      slots: ['mainhand'],
      weight: 10,
      minCostBase: 10,
      effects: [{ type: 'healing', amount: 1 }],
    },
  ],
  lang: {},
};

describe('EnchantmentGenerator', () => {
  const gen = new EnchantmentGenerator();

  it('type 字段为 enchantment', () => {
    expect(gen.type).toBe('enchantment');
  });

  it('loaders 仅含 vanilla', () => {
    expect(gen.loaders).toEqual(['vanilla']);
  });

  it('versions 为 1.21+ 且不含 1.20.x', () => {
    expect(gen.versions).toContain('1.21.11');
    expect(gen.versions).not.toContain('1.20.1');
  });

  it('生成 pack.mcmeta / 附魔文件 / 语言文件', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('pack.mcmeta');
    expect(paths).toContain('data/my_ench/enchantment/fire_dash.json');
    expect(paths).toContain('data/my_ench/enchantment/vampiric.json');
    expect(paths).toContain('assets/my_ench/lang/en_us.json');
    expect(paths).toContain('assets/my_ench/lang/zh_cn.json');
  });

  it('pack.mcmeta 的 pack_format 与描述', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const mcmeta = JSON.parse(result.files[0].content);
    expect(mcmeta.pack.pack_format).toBe(26);
    expect(mcmeta.pack.description).toBe('自定义附魔包');
  });

  it('附魔 JSON 结构完整（成本/栏位/权重/等级）', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('vampiric'))!;
    const json = JSON.parse(file.content);
    expect(json.max_level).toBe(5);
    expect(json.weight).toBe(10);
    expect(json.slots).toEqual(['mainhand']);
    expect(json.anvil_cost).toBe(1);
    expect(json.min_cost).toEqual({ base: 10, per_level: 8 });
    expect(json.max_cost).toEqual({ base: 9, per_level: 8 });
    expect(json.supported_items).toBe('minecraft:netherite_sword');
    expect(json.description.translate).toBe('enchantment.my_ench.vampiric');
  });

  it('damage_bonus undead 映射为 tagged 目标', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('fire_dash'))!;
    const json = JSON.parse(file.content);
    const damage = json.effects['minecraft:damage'][0];
    expect(damage.effect.type).toBe('minecraft:damage_bonus');
    expect(damage.effect.target).toEqual({ type: 'minecraft:tagged', tag: 'minecraft:undead' });
    expect(damage.effect.damage.value).toEqual({ type: 'minecraft:linear', base: 0, per_level: 2 });
  });

  it('burning_time 进入 post_attack 组并带双方 attacker', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('fire_dash'))!;
    const json = JSON.parse(file.content);
    const post = json.effects['minecraft:post_attack'][0];
    expect(post.effect.type).toBe('minecraft:burning_time');
    expect(post.enchanted).toBe('minecraft:attacker');
    expect(post.affected).toBe('minecraft:attacker');
  });

  it('healing 进入 post_attack 组', async () => {
    const ctx = { mcVersion: '1.21.1', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('vampiric'))!;
    const json = JSON.parse(file.content);
    expect(json.effects['minecraft:post_attack'][0].effect.type).toBe('minecraft:healing');
  });

  it('语言文件自动生成名称条目且用户 lang 可覆盖', async () => {
    const spec = {
      ...validSpec,
      lang: { zh_cn: { 'enchantment.my_ench.fire_dash': '覆盖名' } },
    };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    const zh = result.files.find((f) => f.path.endsWith('zh_cn.json'))!;
    const json = JSON.parse(zh.content);
    expect(json['enchantment.my_ench.fire_dash']).toBe('覆盖名');
    expect(json['enchantment.my_ench.vampiric']).toBe('吸血');
    expect(json['enchantment.my_ench.fire_dash.desc']).toBe('攻击时点燃敌人');
  });

  it('未指定 supportedItems 时兜底并给出 warning', async () => {
    const spec = {
      packId: 'p',
      packName: 'P',
      enchantments: [{ id: 'x', name: 'X', effects: [] }],
      lang: {},
    };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('x.json'))!;
    expect(JSON.parse(file.content).supported_items).toBe('#minecraft:enchantable/sharp_weapon');
    expect(result.warnings.some((w) => w.includes('supportedItems'))).toBe(true);
  });

  it('loot_bonus 缺 lootTable 时跳过并警告', async () => {
    const spec = {
      packId: 'p',
      packName: 'P',
      enchantments: [{ id: 'lucky', name: 'Lucky', effects: [{ type: 'loot_bonus', amount: 1 }] }],
      lang: {},
    };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('lucky.json'))!;
    expect(JSON.parse(file.content).effects).toBeUndefined();
    expect(result.warnings.some((w) => w.includes('lootTable'))).toBe(true);
  });

  it('低版本生成附魔 JSON 但给出兼容性 warning', async () => {
    const ctx = { mcVersion: '1.20.4', spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path.includes('enchantment/'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('1.21+'))).toBe(true);
  });

  it('自定义效果 customEffects 追加到指定组', async () => {
    const spec = {
      packId: 'p',
      packName: 'P',
      enchantments: [
        {
          id: 'custom',
          name: 'Custom',
          customEffects: [
            { group: 'minecraft:damage', effect: { effect: { type: 'minecraft:damage_bonus' } } },
          ],
        },
      ],
      lang: {},
    };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('custom.json'))!;
    const json = JSON.parse(file.content);
    expect(json.effects['minecraft:damage'][0]).toEqual({
      effect: { type: 'minecraft:damage_bonus' },
    });
  });

  it('空 enchantments 时仅 pack.mcmeta + lang 并给出 warning', async () => {
    const spec = { packId: 'p', packName: 'P', enchantments: [], lang: {} };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path.includes('enchantment/'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('enchantments 列表为空'))).toBe(true);
  });

  it('注册表可通过 createDefaultRegistry 获取 enchantment 生成器', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('enchantment')).toBeInstanceOf(EnchantmentGenerator);
  });

  it('supportedItems 多值时输出 JSON 数组', async () => {
    const spec = {
      packId: 'p',
      packName: 'P',
      enchantments: [
        {
          id: 'multi',
          name: 'Multi',
          supportedItems: ['minecraft:iron_sword', 'minecraft:diamond_sword'],
        },
      ],
      lang: {},
    };
    const ctx = { mcVersion: '1.21.1', spec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path.includes('multi.json'))!;
    expect(JSON.parse(file.content).supported_items).toEqual([
      'minecraft:iron_sword',
      'minecraft:diamond_sword',
    ]);
  });
});
