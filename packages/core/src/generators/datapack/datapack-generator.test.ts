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
});
