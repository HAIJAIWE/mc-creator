import { describe, it, expect } from 'vitest';
import { getPorts } from './portSchemas.js';
import type { NodeData } from '@mc-creator/shared';

function makeData(kind: NodeData['kind']): NodeData {
  const base = { nodeId: 'n1', label: 'test', note: '', disabled: false, collapsed: false };
  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'test',
        displayName: 'Test',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: 'test',
        displayName: 'Test',
        hardness: 1,
        blastResistance: 3,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      } as NodeData;
    case 'recipe':
      return {
        ...base,
        kind: 'recipe',
        recipeId: 'test',
        recipeType: 'crafting_shaped',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      } as NodeData;
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        invert: false,
      } as NodeData;
    case 'comment':
      return { ...base, kind: 'comment', text: '', color: 'yellow' } as NodeData;
    default:
      return { ...base, kind } as NodeData;
  }
}

describe('getPorts', () => {
  it('item 节点返回 1 个输出端口', () => {
    const ports = getPorts(makeData('item'));
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('out');
    expect(ports[0].direction).toBe('out');
    expect(ports[0].type).toBe('item_stack');
  });

  it('recipe 节点返回 2 个端口（材料输入 + 产物输出）', () => {
    const ports = getPorts(makeData('recipe'));
    expect(ports).toHaveLength(2);
    const inPort = ports.find((p) => p.direction === 'in');
    const outPort = ports.find((p) => p.direction === 'out');
    expect(inPort?.id).toBe('in');
    expect(inPort?.multiple).toBe(true);
    expect(outPort?.id).toBe('out');
  });

  it('condition 节点返回 3 个端口（输入 + true/false 输出）', () => {
    const ports = getPorts(makeData('condition'));
    expect(ports).toHaveLength(3);
    expect(ports.filter((p) => p.direction === 'out')).toHaveLength(2);
    expect(ports.find((p) => p.id === 'true')).toBeDefined();
    expect(ports.find((p) => p.id === 'false')).toBeDefined();
  });

  it('comment 节点返回空端口列表', () => {
    const ports = getPorts(makeData('comment'));
    expect(ports).toHaveLength(0);
  });

  it('machine 节点返回 3 个端口', () => {
    const data = makeData('machine');
    const ports = getPorts(data);
    expect(ports).toHaveLength(3);
    expect(ports.filter((p) => p.direction === 'in')).toHaveLength(2);
    expect(ports.filter((p) => p.direction === 'out')).toHaveLength(1);
  });
});
