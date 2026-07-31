import { describe, it, expect } from 'vitest';
import { BehaviorPackGenerator } from './behavior-pack-generator.js';
import { createDefaultRegistry } from '../index.js';

const validSpec = {
  packId: 'bp_pack',
  packName: 'BP Pack',
  description: '行为包测试',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: {
    name: 'My Behavior Pack',
    description: '一个测试行为包',
    uuid: '12345678-1234-1234-1234-123456789abc',
    version: [1, 0, 0],
    min_engine_version: [1, 21, 0],
  },
  dependencies: [],
  entities: [],
  recipes: [],
  lootTables: [],
};

describe('BehaviorPackGenerator', () => {
  const gen = new BehaviorPackGenerator();

  it('type 字段为 behavior_pack', () => {
    expect(gen.type).toBe('behavior_pack');
  });

  it('loaders 包含 fabric / neoforge', () => {
    expect(gen.loaders).toEqual(['fabric', 'neoforge']);
    expect(gen.loaders).toHaveLength(2);
  });

  it('versions 包含 1.21.11 与 1.21.1', () => {
    expect(gen.versions).toContain('1.21.11');
    expect(gen.versions).toContain('1.21.1');
  });

  it('空 spec（无 entities/recipes/loot）只生成 manifest.json', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('manifest.json');
    expect(result.warnings).toEqual([]);
  });

  it('manifest.json 含 header uuid / modules / dependencies', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.format_version).toBe(2);
    expect(parsed.header.name).toBe('My Behavior Pack');
    expect(parsed.header.description).toBe('一个测试行为包');
    expect(parsed.header.uuid).toBe('12345678-1234-1234-1234-123456789abc');
    expect(parsed.header.version).toEqual([1, 0, 0]);
    expect(parsed.header.min_engine_version).toEqual([1, 21, 0]);
    expect(parsed.modules).toHaveLength(1);
    expect(parsed.modules[0].type).toBe('data');
    expect(parsed.modules[0].uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(parsed.dependencies).toEqual([]);
  });

  it('header.uuid 为空时 manifest.json 自动生成 uuid v4', async () => {
    const spec = { ...validSpec, header: { ...validSpec.header, uuid: '' } };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.header.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('含 entity 时生成 entities/<id>.json', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:test_mob',
          components: { 'minecraft:health': { value: 20, max: 20 } },
          events: { 'minecraft:become_angry': { add: { component_groups: ['angry'] } } },
          description_groups: [],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const entity = result.files.find((f) => f.path === 'entities/test_mob.json');
    expect(entity).toBeDefined();
    const parsed = JSON.parse(entity!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:entity'].description.identifier).toBe('bp_pack:test_mob');
    expect(parsed['minecraft:entity'].description.is_spawnable).toBe(true);
    expect(parsed['minecraft:entity'].description.is_summonable).toBe(true);
    expect(parsed['minecraft:entity'].components['minecraft:health'].value).toBe(20);
    expect(parsed['minecraft:entity'].events['minecraft:become_angry']).toBeDefined();
  });

  it('含 entity 且 events 为空时不输出 events 字段', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:simple_mob',
          components: { 'minecraft:health': { value: 10 } },
          events: {},
          description_groups: [],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const entity = result.files.find((f) => f.path === 'entities/simple_mob.json');
    expect(entity).toBeDefined();
    const parsed = JSON.parse(entity!.content);
    expect(parsed['minecraft:entity'].events).toBeUndefined();
  });

  it('含 shaped_crafting recipe 时生成 recipes/<id>.json', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:diamond_sword',
          type: 'shaped_crafting',
          result: 'minecraft:diamond_sword',
          count: 1,
          pattern: ['D', 'D', 'S'],
          key: { D: ['minecraft:diamond'], S: ['minecraft:stick'] },
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/diamond_sword.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:recipe_shaped'].description.identifier).toBe('bp_pack:diamond_sword');
    expect(parsed['minecraft:recipe_shaped'].tags).toEqual(['crafting_table']);
    expect(parsed['minecraft:recipe_shaped'].pattern).toEqual(['D', 'D', 'S']);
    expect(parsed['minecraft:recipe_shaped'].result.item).toBe('minecraft:diamond_sword');
    expect(parsed['minecraft:recipe_shaped'].result.count).toBe(1);
  });

  it('含 shapeless_crafting recipe 时使用 minecraft:recipe_shapeless', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:shapeless_test',
          type: 'shapeless_crafting',
          result: 'minecraft:stick',
          count: 4,
          items: ['minecraft:oak_planks'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/shapeless_test.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed['minecraft:recipe_shapeless']).toBeDefined();
    expect(parsed['minecraft:recipe_shapeless'].ingredients).toEqual([
      { item: 'minecraft:oak_planks' },
    ]);
    expect(parsed['minecraft:recipe_shapeless'].result.count).toBe(4);
  });

  it('含 furnace recipe 时使用 minecraft:recipe_furnace', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:furnace_test',
          type: 'furnace',
          result: 'minecraft:iron_ingot',
          count: 1,
          items: ['minecraft:iron_ore'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/furnace_test.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed['minecraft:recipe_furnace']).toBeDefined();
    expect(parsed['minecraft:recipe_furnace'].tags).toEqual(['furnace']);
    expect(parsed['minecraft:recipe_furnace'].input).toBe('minecraft:iron_ore');
    expect(parsed['minecraft:recipe_furnace'].output).toBe('minecraft:iron_ingot');
  });

  it('含 loot_table 时生成 loot_tables/<path>.json', async () => {
    const spec = {
      ...validSpec,
      lootTables: [
        {
          path: 'entities/zombie',
          pools: [
            {
              rolls: 1,
              entries: [
                { type: 'item', name: 'minecraft:rotten_flesh', weight: 1, count: 1 },
                { type: 'item', name: 'minecraft:iron_ingot', weight: 2, count: 1 },
              ],
            },
          ],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const loot = result.files.find((f) => f.path === 'loot_tables/entities/zombie.json');
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:loot_table'].pools).toHaveLength(1);
    expect(parsed['minecraft:loot_table'].pools[0].rolls).toBe(1);
    expect(parsed['minecraft:loot_table'].pools[0].entries).toHaveLength(2);
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].type).toBe('minecraft:item');
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].name).toBe('minecraft:rotten_flesh');
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].weight).toBe(1);
  });

  it('含完整 spec（entity + recipe + loot）时生成 4 个文件', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:mob',
          components: {},
          events: {},
          description_groups: [],
        },
      ],
      recipes: [
        {
          identifier: 'bp_pack:r',
          type: 'shaped_crafting',
          result: 'minecraft:dirt',
          count: 1,
          pattern: ['D'],
          key: { D: ['minecraft:diamond'] },
        },
      ],
      lootTables: [
        {
          path: 'chests/test',
          pools: [{ rolls: 1, entries: [] }],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(4);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'entities/mob.json',
      'loot_tables/chests/test.json',
      'manifest.json',
      'recipes/r.json',
    ]);
  });

  it('buildCmd 为空字符串（行为包不需编译）', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.buildCmd).toBe('');
  });

  it('createDefaultRegistry 已注册 behavior_pack generator', () => {
    const registry = createDefaultRegistry();
    const g = registry.get('behavior_pack');
    expect(g).toBeDefined();
    expect(g!.type).toBe('behavior_pack');
  });

  it('通过 registry 生成 behavior_pack 也能成功', async () => {
    const registry = createDefaultRegistry();
    const g = registry.get('behavior_pack');
    expect(g).toBeDefined();
    const ctx = { spec: validSpec } as any;
    const result = await g!.generate(ctx);
    expect(result.files).toHaveLength(1); // 空 spec 只生成 manifest.json
  });
});
