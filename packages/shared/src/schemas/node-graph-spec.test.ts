import { describe, it, expect } from 'vitest';
import {
  NodeKind,
  VariableNodeData,
  SubgraphDefinition,
  SubgraphNodeData,
  SubgraphPortMapping,
  LoopNodeData,
  NodeGraph,
} from './node-graph-spec.js';

describe('NodeKind 扩展（阶段 C：variable）', () => {
  it('包含 variable', () => {
    expect(NodeKind.options).toContain('variable');
  });
});

describe('VariableNodeData', () => {
  it('常量 int 变量解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v1',
      label: '最大伤害',
      kind: 'variable',
      varName: 'MAX_DAMAGE',
      varType: 'int',
      value: 10,
      isConstant: true,
    });
    expect(v.varType).toBe('int');
    expect(v.isConstant).toBe(true);
    expect(v.value).toBe(10);
  });

  it('变量 string 解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v2',
      label: '玩家名',
      kind: 'variable',
      varName: 'playerName',
      varType: 'string',
      value: 'Steve',
      isConstant: false,
    });
    expect(v.isConstant).toBe(false);
  });

  it('varName 必须是合法标识符', () => {
    expect(() =>
      VariableNodeData.parse({
        nodeId: 'v3',
        label: 'x',
        kind: 'variable',
        varName: '1invalid',
        varType: 'int',
        value: 0,
        isConstant: false,
      }),
    ).toThrow();
  });

  it('varType 必须在枚举内', () => {
    expect(() =>
      VariableNodeData.parse({
        nodeId: 'v4',
        label: 'x',
        kind: 'variable',
        varName: 'x',
        varType: 'float',
        value: 0,
        isConstant: false,
      }),
    ).toThrow();
  });

  it('默认 isConstant=false', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v5',
      label: 'x',
      kind: 'variable',
      varName: 'x',
      varType: 'int',
      value: 0,
    });
    expect(v.isConstant).toBe(false);
  });
});

describe('NodeKind 扩展（阶段 C：subgraph）', () => {
  it('包含 subgraph', () => {
    expect(NodeKind.options).toContain('subgraph');
  });
});

describe('SubgraphPortMapping', () => {
  it('用 direction/type 字段（不是 kind/dataType）', () => {
    const m = SubgraphPortMapping.parse({
      internalPortId: 'in_1',
      externalPortId: 'input',
      label: '材料',
      direction: 'in',
      type: 'item_stack',
    });
    expect(m.direction).toBe('in');
    expect(m.type).toBe('item_stack');
  });

  it('direction 只接受 in/out', () => {
    expect(() =>
      SubgraphPortMapping.parse({
        internalPortId: 'x',
        externalPortId: 'y',
        label: 'z',
        direction: 'input',
        type: 'item_stack',
      }),
    ).toThrow();
  });
});

describe('SubgraphDefinition', () => {
  it('最小子图解析（portMappings 默认空数组）', () => {
    const sg = SubgraphDefinition.parse({
      id: 'sg_1',
      name: '合成铁剑',
      nodes: [],
      edges: [],
    });
    expect(sg.name).toBe('合成铁剑');
    expect(sg.portMappings).toEqual([]);
  });

  it('portMappings 在 SubgraphDefinition 内', () => {
    const sg = SubgraphDefinition.parse({
      id: 'sg_1',
      name: 'x',
      nodes: [],
      edges: [],
      portMappings: [
        {
          internalPortId: 'in_1',
          externalPortId: 'input',
          label: '材料',
          direction: 'in',
          type: 'item_stack',
        },
        {
          internalPortId: 'out_1',
          externalPortId: 'output',
          label: '产物',
          direction: 'out',
          type: 'item_stack',
        },
      ],
    });
    expect(sg.portMappings).toHaveLength(2);
  });
});

describe('SubgraphNodeData', () => {
  it('引用子图解析', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n1',
      label: '我的合成',
      kind: 'subgraph',
      subgraphId: 'sg_1',
      subgraphName: '合成铁剑',
      customTypeId: null,
    });
    expect(n.subgraphId).toBe('sg_1');
    expect(n.customTypeId).toBeNull();
  });

  it('customTypeId 非空时表示自定义节点', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n2',
      label: '自定义合成台',
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:custom_crafter',
    });
    expect(n.customTypeId).toBe('mymod:custom_crafter');
  });

  it('默认 subgraphId/subgraphName 为空字符串，customTypeId 为 null', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n3',
      label: 'x',
      kind: 'subgraph',
    });
    expect(n.subgraphId).toBe('');
    expect(n.subgraphName).toBe('');
    expect(n.customTypeId).toBeNull();
  });

  it('customFields 默认空对象，可存储自定义节点字段值', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n4',
      label: 'x',
      kind: 'subgraph',
      customTypeId: 'mymod:crafter',
      customFields: { speed: 10, name: 'fast' },
    });
    expect(n.customFields).toEqual({ speed: 10, name: 'fast' });
  });
});

describe('NodeKind 扩展（阶段 C：loop）', () => {
  it('包含 loop', () => {
    expect(NodeKind.options).toContain('loop');
  });
});

describe('LoopNodeData', () => {
  it('forEach 循环解析', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l1',
      label: '遍历物品',
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'itemList',
    });
    expect(l.loopType).toBe('forEach');
    expect(l.iterable).toBe('itemList');
  });

  it('for 循环解析（init/condition/update）', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l2',
      label: '计数循环',
      kind: 'loop',
      loopType: 'for',
      init: 'int i = 0',
      condition: 'i < 10',
      update: 'i++',
      loopVarName: 'i',
      loopVarType: 'int',
    });
    expect(l.init).toBe('int i = 0');
    expect(l.condition).toBe('i < 10');
  });

  it('while 循环解析', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l3',
      label: 'while',
      kind: 'loop',
      loopType: 'while',
      condition: 'running',
      loopVarName: '',
      loopVarType: 'int',
    });
    expect(l.loopType).toBe('while');
  });

  it('init/update/iterable/bodySubgraphId 可选', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l4',
      label: 'x',
      kind: 'loop',
      loopType: 'while',
      condition: 'true',
      loopVarName: '',
      loopVarType: 'int',
    });
    expect(l.init).toBeUndefined();
    expect(l.bodySubgraphId).toBeUndefined();
  });
});

describe('NodeGraph.subgraphs 字段', () => {
  it('默认空对象（向后兼容旧 JSON）', () => {
    const graph = NodeGraph.parse({
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
    });
    expect(graph.subgraphs).toEqual({});
  });

  it('可解析 subgraphs 字段', () => {
    const graph = NodeGraph.parse({
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: { sg_1: { id: 'sg_1', name: '测试', nodes: [], edges: [], portMappings: [] } },
    });
    expect(Object.keys(graph.subgraphs)).toEqual(['sg_1']);
  });
});
