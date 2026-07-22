import { describe, it, expect } from 'vitest';
import { getFieldSchemas } from './fieldSchemas.js';

describe('getFieldSchemas', () => {
  it('item 节点返回 itemId/displayName/rarity/maxStackSize 等字段', () => {
    const fields = getFieldSchemas('item');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('itemId');
    expect(keys).toContain('displayName');
    expect(keys).toContain('rarity');
    expect(keys).toContain('maxStackSize');
    expect(keys).toContain('maxDamage');
    expect(keys).toContain('category');
    expect(keys).toContain('glow');
  });

  it('block 节点返回 blockId/hardness/blastResistance 等字段', () => {
    const fields = getFieldSchemas('block');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('blockId');
    expect(keys).toContain('hardness');
    expect(keys).toContain('blastResistance');
    expect(keys).toContain('luminance');
    expect(keys).toContain('isBlockEntity');
  });

  it('recipe 节点返回 recipeType/outputCount/cookTime 等字段', () => {
    const fields = getFieldSchemas('recipe');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('recipeType');
    expect(keys).toContain('outputCount');
    expect(keys).toContain('cookTime');
  });

  it('comment 节点返回 text/color 字段', () => {
    const fields = getFieldSchemas('comment');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('text');
    expect(keys).toContain('color');
  });

  it('所有节点类型都包含公共字段 label/note', () => {
    const kinds = [
      'item',
      'block',
      'entity',
      'recipe',
      'machine',
      'multiblock',
      'event',
      'condition',
      'action',
      'code',
      'comment',
    ] as const;
    for (const kind of kinds) {
      const fields = getFieldSchemas(kind);
      const keys = fields.map((f) => f.key);
      expect(keys).toContain('label');
      expect(keys).toContain('note');
    }
  });

  it('item 的 rarity 字段是 dropdown 类型含 4 个选项', () => {
    const fields = getFieldSchemas('item');
    const rarity = fields.find((f) => f.key === 'rarity');
    expect(rarity?.type).toBe('dropdown');
    expect(rarity?.options).toEqual(['common', 'uncommon', 'rare', 'epic']);
  });

  it('item 的 glow 字段是 segmented 类型', () => {
    const fields = getFieldSchemas('item');
    const glow = fields.find((f) => f.key === 'glow');
    expect(glow?.type).toBe('segmented');
  });
});
