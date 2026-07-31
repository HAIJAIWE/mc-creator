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

describe('getFieldSchemas（阶段 C 新节点）', () => {
  it('variable 含 varName/varType/value/isConstant 字段', () => {
    const fields = getFieldSchemas('variable');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('varName');
    expect(keys).toContain('varType');
    expect(keys).toContain('value');
    expect(keys).toContain('isConstant');
  });

  it('subgraph 含 subgraphName 字段', () => {
    const fields = getFieldSchemas('subgraph');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('subgraphName');
  });

  it('loop 含 loopType/condition/loopVarName/loopVarType 字段', () => {
    const fields = getFieldSchemas('loop');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('loopType');
    expect(keys).toContain('condition');
    expect(keys).toContain('loopVarName');
    expect(keys).toContain('loopVarType');
  });

  it('loop init/update/iterable 字段有条件显示', () => {
    const fields = getFieldSchemas('loop');
    const initField = fields.find((f) => f.key === 'init');
    expect(initField?.condition).toBeDefined();
    const iterableField = fields.find((f) => f.key === 'iterable');
    expect(iterableField?.condition).toBeDefined();
  });
});

describe('getFieldSchemas（P0-1 codeLock 公共字段）', () => {
  it('非 comment 节点包含 codeLocked segmented 字段', () => {
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
      'variable',
      'subgraph',
      'loop',
    ] as const;
    for (const kind of kinds) {
      const fields = getFieldSchemas(kind);
      const codeLocked = fields.find((f) => f.key === 'codeLocked');
      expect(codeLocked, `${kind} 应包含 codeLocked`).toBeDefined();
      expect(codeLocked?.type).toBe('segmented');
      expect(codeLocked?.options).toEqual(['false', 'true']);
    }
  });

  it('comment 节点不包含 codeLocked（excludeKinds 过滤）', () => {
    const fields = getFieldSchemas('comment');
    const keys = fields.map((f) => f.key);
    expect(keys).not.toContain('codeLocked');
    expect(keys).not.toContain('lockedCode');
  });

  it('非 comment 节点包含 lockedCode code 字段', () => {
    const fields = getFieldSchemas('item');
    const lockedCode = fields.find((f) => f.key === 'lockedCode');
    expect(lockedCode).toBeDefined();
    expect(lockedCode?.type).toBe('code');
    expect(lockedCode?.language).toBe('java');
  });

  it('lockedCode 字段有条件显示：codeLocked=true 时才显示', () => {
    const fields = getFieldSchemas('item');
    const lockedCode = fields.find((f) => f.key === 'lockedCode');
    expect(lockedCode?.condition).toBeDefined();
    expect(lockedCode?.condition?.field).toBe('codeLocked');
    expect(lockedCode?.condition?.equals).toBe('true');
  });

  it('codeLocked 与 lockedCode 都标记 excludeKinds: ["comment"]', () => {
    const fields = getFieldSchemas('item');
    const codeLocked = fields.find((f) => f.key === 'codeLocked');
    const lockedCode = fields.find((f) => f.key === 'lockedCode');
    expect(codeLocked?.excludeKinds).toEqual(['comment']);
    expect(lockedCode?.excludeKinds).toEqual(['comment']);
  });
});
