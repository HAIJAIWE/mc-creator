import { describe, it, expect } from 'vitest';
import { getPorts } from './portSchemas.js';
import type {
  NodeData,
  VariableNodeData,
  SubgraphNodeData,
  LoopNodeData,
  NodeGraph,
} from '@mc-creator/shared';

function makeData(kind: NodeData['kind']): NodeData {
  const base = {
    nodeId: 'n1',
    label: 'test',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    formatVersion: 1,
  };
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

describe('getPorts（阶段 C 新节点）', () => {
  it('variable 端口标签随 varName 变化', () => {
    const data: VariableNodeData = {
      nodeId: 'v1',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'MAX_DAMAGE',
      varType: 'int',
      value: 10,
      isConstant: true,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    };
    const ports = getPorts(data);
    expect(ports).toHaveLength(1);
    expect(ports[0]!.label).toBe('MAX_DAMAGE');
    expect(ports[0]!.direction).toBe('out');
    expect(ports[0]!.multiple).toBe(true);
  });

  it('variable 端口 type 随 varType 变化', () => {
    const data: VariableNodeData = {
      nodeId: 'v1',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'x',
      varType: 'string',
      value: '',
      isConstant: false,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    };
    const ports = getPorts(data);
    expect(ports[0]!.type).toBe('string');
  });

  it('subgraph 端口从 graph.subgraphs 的 portMappings 生成', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1',
      label: '子图',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: 'sg_1',
      subgraphName: '测试',
      customTypeId: null,
      customFields: {},
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    };
    // getPorts 第二参数可选传 graph（含 subgraphs）
    const graph = {
      version: 1 as const,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: {
        sg_1: {
          id: 'sg_1',
          name: '测试',
          nodes: [],
          edges: [],
          portMappings: [
            {
              internalPortId: 'in_1',
              externalPortId: 'input',
              label: '材料',
              direction: 'in' as const,
              type: 'item_stack' as const,
            },
            {
              internalPortId: 'out_1',
              externalPortId: 'output',
              label: '产物',
              direction: 'out' as const,
              type: 'item_stack' as const,
            },
          ],
        },
      },
    } as NodeGraph;
    const ports = getPorts(data, graph);
    expect(ports).toHaveLength(2);
    expect(ports.find((p) => p.id === 'input')?.label).toBe('材料');
    expect(ports.find((p) => p.id === 'output')?.direction).toBe('out');
  });

  it('subgraph 子图未找到时返回空数组', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: 'missing',
      subgraphName: '',
      customTypeId: null,
      customFields: {},
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    };
    expect(getPorts(data)).toEqual([]);
  });

  it('loop 端口含 loop_var/body/done，loop_var 标签随 loopVarName 变化', () => {
    const data: LoopNodeData = {
      nodeId: 'l1',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'items',
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    };
    const ports = getPorts(data);
    expect(ports.find((p) => p.id === 'loop_var')?.label).toBe('item');
    expect(ports.find((p) => p.id === 'body')).toBeDefined();
    expect(ports.find((p) => p.id === 'done')).toBeDefined();
  });
});
