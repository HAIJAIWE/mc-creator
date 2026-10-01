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

/**
 * ID 字段口径锁定。
 *
 * 定义型 ID（本 mod 自身内容标识）必须是 localId —— 编译器与 ModSpec 都要求裸 id，
 * 一旦退回 resourceId，编辑器会写入 `mod:x`，导致节点图存不下 / 生成失败。
 * 引用型 ID（指向其他 mod/原版）必须是 resourceId —— 必须带命名空间。
 *
 * 新增 ID 字段时必须先归类并同步本清单。
 */
describe('ID 字段口径锁定（localId=定义型 / resourceId=引用型）', () => {
  /** 定义型：本 mod 内容的标识 */
  const DEFINITION_IDS = [
    ['item', 'itemId'],
    ['block', 'blockId'],
    ['entity', 'entityId'],
    ['recipe', 'recipeId'],
    ['machine', 'machineId'],
    ['multiblock', 'structureId'],
    ['biome', 'biomeId'],
    ['dimension', 'dimensionId'],
    ['fluid', 'fluidId'],
    ['gui', 'guiId'],
  ] as const;

  /** 引用型：指向其他 mod / 原版物品 */
  const REFERENCE_IDS = [
    ['recipe', 'template'],
    ['recipe', 'base'],
    ['recipe', 'addition'],
    ['recipe', 'inputPotion'],
    ['recipe', 'ingredientItem'],
    ['recipe', 'outputPotion'],
  ] as const;

  it('定义型 ID 全部使用 localId', () => {
    for (const [kind, key] of DEFINITION_IDS) {
      const field = getFieldSchemas(kind).find((f) => f.key === key);
      expect(field, `${kind}.${key} 应存在`).toBeDefined();
      expect(field?.type, `${kind}.${key} 应为 localId`).toBe('localId');
    }
  });

  it('引用型 ID 全部使用 resourceId', () => {
    for (const [kind, key] of REFERENCE_IDS) {
      const field = getFieldSchemas(kind).find((f) => f.key === key);
      expect(field, `${kind}.${key} 应存在`).toBeDefined();
      expect(field?.type, `${kind}.${key} 应为 resourceId`).toBe('resourceId');
    }
  });

  it('variable 的物品/方块初始值是引用型（指向已有物品，非本 mod 标识）', () => {
    // value 按 varType 分支切换编辑器：int/double→number、string→text、boolean→segmented、item/block→resourceId
    const valueFields = getFieldSchemas('variable').filter((f) => f.key === 'value');
    const refValueFields = valueFields.filter((f) => f.type === 'resourceId');

    expect(refValueFields).toHaveLength(2);
    expect(refValueFields.map((f) => f.condition?.in?.[0]).sort()).toEqual(['block', 'item']);

    // 其余分支不得被当成 ID 校验（否则数字/文本初始值会被报格式错误）
    const nonIdValueFields = valueFields.filter((f) => f.type !== 'resourceId');
    expect(nonIdValueFields).toHaveLength(4);
    for (const f of nonIdValueFields) {
      expect(['number', 'text', 'segmented'], `${JSON.stringify(f.condition)}`).toContain(f.type);
    }
  });

  it('ID 字段总数恰好为 10 个 localId + 8 个 resourceId', () => {
    const kindsWithIdFields = [
      'item',
      'block',
      'entity',
      'recipe',
      'machine',
      'multiblock',
      'biome',
      'dimension',
      'fluid',
      'gui',
      'variable',
    ] as const;

    let localIdCount = 0;
    let resourceIdCount = 0;
    for (const kind of kindsWithIdFields) {
      for (const field of getFieldSchemas(kind)) {
        if (field.type === 'localId') localIdCount++;
        if (field.type === 'resourceId') resourceIdCount++;
      }
    }

    // 口径变更时请先更新本测试与 DEFINITION_IDS / REFERENCE_IDS 清单
    expect(localIdCount).toBe(10);
    expect(resourceIdCount).toBe(8);
  });
});
