import { describe, it, expect } from 'vitest';
import { BehaviorItemGenerator } from './behavior-item-generator.js';
import { createDefaultRegistry } from '../index.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const validSpec = {
  packId: 'my_items',
  packName: 'My Items',
  description: '自定义物品包',
  packFormat: 2,
  items: [
    {
      id: 'fire_sword',
      name: '烈焰之剑',
      category: 'weapons',
      attackDamage: 8,
      attackSpeed: 1.6,
      durability: 1561,
      enchantable: 15,
      foils: true,
      primaryColor: '#e74c3c',
      secondaryColor: '#c0392b',
    },
    {
      id: 'iron_helmet',
      name: '铁盔',
      category: 'equipment',
      armor: { protection: 2, slot: 'head' },
      durability: 165,
      primaryColor: '#95a5a6',
    },
    {
      id: 'obsidian_pickaxe',
      name: '黑曜石镐',
      category: 'tools',
      attackDamage: 3,
      tool: { level: 4, efficiency: 8 },
      durability: 2500,
      primaryColor: '#2c3e50',
    },
  ],
  lang: {},
};

describe('BehaviorItemGenerator', () => {
  const gen = new BehaviorItemGenerator();

  it('type 字段为 behavior_item', () => {
    expect(gen.type).toBe('behavior_item');
  });

  it('生成 manifest / items / 纹理 / 语言文件', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const paths = result.files.map((f) => f.path);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('items/fire_sword.json');
    expect(paths).toContain('items/iron_helmet.json');
    expect(paths).toContain('textures/items/fire_sword.png');
    expect(paths).toContain('texts/zh_CN.lang');
    expect(paths).toContain('texts/en_US.lang');
  });

  it('manifest 包含行为包模块与 UUID', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const manifest = JSON.parse(result.files[0].content);
    expect(manifest.format_version).toBe(2);
    expect(manifest.modules[0].type).toBe('data');
    expect(manifest.header.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifest.header.min_engine_version).toEqual([1, 21, 0]);
  });

  it('武器物品带 damage/speed/durability/enchantable/foil 组件', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'items/fire_sword.json')!;
    const json = JSON.parse(file.content);
    expect(json['minecraft:item'].description.identifier).toBe('my_items:fire_sword');
    expect(json['minecraft:item'].description.category).toBe('weapons');
    const c = json['minecraft:item'].components;
    expect(c['minecraft:damage']).toEqual({ value: 8 });
    expect(c['minecraft:speed']).toEqual({ value: 1.6 });
    expect(c['minecraft:durability']).toEqual({ max_durability: 1561 });
    expect(c['minecraft:enchantable']).toEqual({ value: 15 });
    expect(c['minecraft:foil']).toEqual({});
  });

  it('盔甲物品带 armor + wearable + repairable 组件', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'items/iron_helmet.json')!;
    const c = JSON.parse(file.content)['minecraft:item'].components;
    expect(c['minecraft:armor']).toEqual({ protection: 2 });
    expect(c['minecraft:wearable']).toEqual({ slot: 'slot.armor.head' });
    expect(c['minecraft:repairable']).toBeDefined();
  });

  it('工具物品带 tool 规则与等级标签', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'items/obsidian_pickaxe.json')!;
    const c = JSON.parse(file.content)['minecraft:item'].components;
    expect(c['minecraft:tool'].rules).toHaveLength(4);
    expect(c['minecraft:tool'].rules[0].speed).toBe(8);
    expect(c['minecraft:tags']).toEqual({ tags: ['minecraft:is_diamond'] });
  });

  it('纹理是合法 PNG（base64 解码后带 PNG 签名）', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'textures/items/fire_sword.png')!;
    const decoded = Buffer.from(file.content, 'base64');
    expect(decoded.subarray(0, 8)).toEqual(PNG_SIG);
  });

  it('语言文件包含物品名称且用户 lang 可覆盖', async () => {
    const spec = {
      ...validSpec,
      lang: { zh_CN: { 'item.my_items:fire_sword': '覆盖名' } },
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const zh = result.files.find((f) => f.path === 'texts/zh_CN.lang')!;
    expect(zh.content).toContain('item.my_items:fire_sword=覆盖名');
    expect(zh.content).toContain('item.my_items:iron_helmet=铁盔');
  });

  it('无盔甲时不含 wearable/armor', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'items/fire_sword.json')!;
    const c = JSON.parse(file.content)['minecraft:item'].components;
    expect(c['minecraft:wearable']).toBeUndefined();
    expect(c['minecraft:armor']).toBeUndefined();
  });

  it('customComponents 追加并覆盖同名组件给出 warning', async () => {
    const spec = {
      packId: 'p',
      packName: 'P',
      items: [
        {
          id: 'custom_item',
          name: 'Custom',
          attackDamage: 3,
          primaryColor: '#ffffff',
          customComponents: [
            { 'minecraft:damage': { value: 99 } },
            { 'minecraft:stackable_by_player': { value: 16 } },
          ],
        },
      ],
      lang: {},
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const file = result.files.find((f) => f.path === 'items/custom_item.json')!;
    const c = JSON.parse(file.content)['minecraft:item'].components;
    expect(c['minecraft:damage']).toEqual({ value: 99 });
    expect(c['minecraft:stackable_by_player']).toEqual({ value: 16 });
    expect(result.warnings.some((w) => w.includes('覆盖了组件'))).toBe(true);
  });

  it('空 items 时无物品文件并给出 warning', async () => {
    const spec = { packId: 'p', packName: 'P', items: [], lang: {} };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path.startsWith('items/'))).toBe(false);
    expect(result.warnings.some((w) => w.includes('items 列表为空'))).toBe(true);
  });

  it('注册表可获取 behavior_item 生成器', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('behavior_item')).toBeInstanceOf(BehaviorItemGenerator);
  });
});
