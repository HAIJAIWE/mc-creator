import { describe, it, expect } from 'vitest';
import { DatapackGenerator } from './datapack-generator.js';
import type { GeneratorContext, DatapackSpec } from '@mc-creator/shared';

function makeCtx(spec: Partial<DatapackSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_pack',
    spec: {
      modId: 'test_pack',
      version: '1.0.0',
      name: 'Test',
      description: '',
      items: [],
      blocks: [],
      ...spec,
    } as any,
    projectPath: '',
  };
}

describe('DatapackGenerator', () => {
  const gen = new DatapackGenerator();

  it('生成 pack.mcmeta', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      packName: 'My Pack',
      packFormat: 48,
    }));
    const meta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(meta).toBeDefined();
    expect(JSON.parse(meta!.content).pack.pack_format).toBe(48);
  });

  it('生成 shaped 配方', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      recipes: [{
        id: 'diamond_sword_upgrade',
        type: 'crafting_shaped',
        result: 'minecraft:diamond_sword',
        count: 1,
        pattern: [' D', 'D '],
        key: { D: ['minecraft:diamond'] },
      }],
    }));
    const recipe = result.files.find((f) => f.path === 'data/my_pack/recipe/diamond_sword_upgrade.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:crafting_shaped');
    expect(parsed.result.id).toBe('minecraft:diamond_sword');
  });

  it('生成函数 mcfunction', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      functions: [{
        id: 'tick',
        commands: ['say hello', 'give @s minecraft:diamond 1'],
      }],
    }));
    const func = result.files.find((f) => f.path === 'data/my_pack/function/tick.mcfunction');
    expect(func).toBeDefined();
    expect(func!.content).toContain('say hello');
    expect(func!.content).toContain('give @s minecraft:diamond 1');
  });

  it('生成标签', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      tags: [{
        id: 'custom_items',
        type: 'item',
        values: ['minecraft:diamond', 'minecraft:emerald'],
        replace: false,
      }],
    }));
    const tag = result.files.find((f) => f.path === 'data/my_pack/tags/item/custom_items.json');
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('minecraft:diamond');
  });

  it('buildCmd 为空（数据包不需编译）', async () => {
    const result = await gen.generate(makeCtx({ packId: 'p' }));
    expect(result.buildCmd).toBe('');
  });

  it('P10：生成战利品表 loot_tables（带子路径）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      lootTables: [
        {
          namespace: 'my_pack',
          path: 'blocks/custom_block',
          type: 'block',
          pools: [
            {
              rolls: 2,
              entries: [
                { name: 'my_pack:custom_item', weight: 3, count: 1 },
                { name: 'minecraft:stick', weight: 1, count: 2 },
              ],
            },
          ],
        },
      ],
    }));
    const loot = result.files.find(
      (f) => f.path === 'data/my_pack/loot_tables/block/blocks/custom_block.json',
    );
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.type).toBe('minecraft:block');
    expect(parsed.pools[0].rolls).toBe(2);
    expect(parsed.pools[0].entries).toHaveLength(2);
  });

  it('P10：生成战利品表（简单路径）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      lootTables: [
        {
          namespace: 'my_pack',
          path: 'custom_block',
          type: 'block',
          pools: [
            {
              rolls: 1,
              entries: [{ name: 'minecraft:diamond', weight: 1, count: 1 }],
            },
          ],
        },
      ],
    }));
    const loot = result.files.find(
      (f) => f.path === 'data/my_pack/loot_tables/block/custom_block.json',
    );
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.type).toBe('minecraft:block');
    expect(parsed.pools[0].rolls).toBe(1);
    expect(parsed.pools[0].entries[0].name).toBe('minecraft:diamond');
    expect(parsed.pools[0].entries[0].weight).toBe(1);
  });

  it('P10：生成 predicates', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      predicates: [
        {
          namespace: 'my_pack',
          path: 'has_diamond',
          condition: JSON.stringify({
            condition: 'minecraft:inventory_changed',
            items: ['minecraft:diamond'],
          }),
        },
      ],
    }));
    const pred = result.files.find(
      (f) => f.path === 'data/my_pack/predicates/has_diamond.json',
    );
    expect(pred).toBeDefined();
    const parsed = JSON.parse(pred!.content);
    expect(parsed.condition.condition).toBe('minecraft:inventory_changed');
  });

  it('P10：生成 itemTags', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      itemTags: [
        {
          namespace: 'my_pack',
          tag: 'custom_items',
          values: ['my_pack:ruby', 'my_pack:sapphire'],
          replace: false,
        },
      ],
    }));
    const tag = result.files.find(
      (f) => f.path === 'data/my_pack/tags/item/custom_items.json',
    );
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('my_pack:ruby');
    expect(parsed.replace).toBe(false);
  });

  it('P10：生成 blockTags', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      blockTags: [
        {
          namespace: 'my_pack',
          tag: 'custom_blocks',
          values: ['my_pack:ruby_block'],
          replace: true,
        },
      ],
    }));
    const tag = result.files.find(
      (f) => f.path === 'data/my_pack/tags/block/custom_blocks.json',
    );
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('my_pack:ruby_block');
    expect(parsed.replace).toBe(true);
  });

  it('P10：默认空新字段不产生额外文件', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
    }));
    expect(result.files).toHaveLength(1); // 仅 pack.mcmeta
  });
});
