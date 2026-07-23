import { describe, it, expect, beforeEach } from 'vitest';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import type { NodeGraph, SubgraphDefinition, ModNode } from '@mc-creator/shared';

function makeItem(id: string): ModNode {
  return {
    id,
    type: 'item',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: id,
      note: '',
      disabled: false,
      kind: 'item',
      itemId: id,
      displayName: id,
      category: 'misc',
      maxStackSize: 64,
      maxDamage: 0,
      rarity: 'common',
      glow: false,
      collapsed: false,
      codeLocked: false,
    },
    ports: [],
    selected: false,
  };
}

describe('inlineSubgraphNodes', () => {
  beforeEach(() => {
    subgraphManager.clear();
  });

  it('返回 { graph, warnings }（不是交叉类型）', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result).toHaveProperty('graph');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('无子图节点时原样返回', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeItem('i1')],
      edges: [],
      subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('把子图节点内联展开为内部节点', () => {
    const innerSg: SubgraphDefinition = {
      id: 'sg_1',
      name: '内层',
      nodes: [makeItem('inner_1')],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(innerSg);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: '子图',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_1',
        subgraphName: '内层',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_1: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 子图节点被替换为内部节点（ID 加前缀防止与主图冲突）
    expect(result.graph.nodes.some((n) => n.id.endsWith('inner_1'))).toBe(true);
    expect(result.graph.nodes.find((n) => n.id === 's1')).toBeUndefined();
  });

  it('子图未找到时加 warning，保留原节点', () => {
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
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
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.graph.nodes).toHaveLength(1);
  });

  it('循环引用检测：子图引用自身时加 warning 不递归', () => {
    const sgDef: SubgraphDefinition = {
      id: 'sg_self',
      name: '自引用',
      nodes: [],
      edges: [],
      portMappings: [],
    };
    // 构造 sg_self 内部有一个 subgraph 节点引用 sg_self
    sgDef.nodes = [
      {
        id: 'inner_sg',
        type: 'subgraph',
        position: { x: 0, y: 0 },
        data: {
          nodeId: 'inner_sg',
          label: 'inner',
          note: '',
          disabled: false,
          kind: 'subgraph',
          subgraphId: 'sg_self',
          subgraphName: '',
          customTypeId: null,
          customFields: {},
          collapsed: false,
          codeLocked: false,
        },
        ports: [],
        selected: false,
      },
    ];
    subgraphManager.register(sgDef);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_self',
        subgraphName: '',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_self: sgDef },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.warnings.some((w) => w.includes('循环引用') || w.includes('cycle'))).toBe(true);
  });

  it('子图内部边在展开后被重映射并保留', () => {
    // 子图内部有两条边：inner_1 -> inner_2，inner_2 -> inner_3
    const innerNodes = [makeItem('inner_1'), makeItem('inner_2'), makeItem('inner_3')];
    const innerEdges = [
      {
        id: 'inner_e1',
        source: 'inner_1',
        target: 'inner_2',
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft' as const,
        disabled: false,
      },
      {
        id: 'inner_e2',
        source: 'inner_2',
        target: 'inner_3',
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft' as const,
        disabled: false,
      },
    ];
    const innerSg: SubgraphDefinition = {
      id: 'sg_edges',
      name: '有边子图',
      nodes: innerNodes,
      edges: innerEdges,
      portMappings: [],
    };
    subgraphManager.register(innerSg);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_edges',
        subgraphName: '有边子图',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_edges: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 3 个内部节点被展开
    expect(result.graph.nodes).toHaveLength(3);
    // 2 条内部边被保留
    expect(result.graph.edges).toHaveLength(2);
    // 边的 source/target 应能在新节点列表中找到（无冲突时保留原 ID）
    const nodeIds = new Set(result.graph.nodes.map((n) => n.id));
    for (const e of result.graph.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });

  it('主图边在子图展开后被保留', () => {
    // 主图有边：main_item -> sg_node（连到子图节点）
    const innerSg: SubgraphDefinition = {
      id: 'sg_main',
      name: '内层',
      nodes: [makeItem('inner_1')],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(innerSg);
    const mainItem = makeItem('main_item');
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_main',
        subgraphName: '内层',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const mainEdge = {
      id: 'main_e1',
      source: 'main_item',
      target: 's1',
      sourceHandle: 'out',
      targetHandle: 'in',
      kind: 'craft' as const,
      disabled: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [mainItem, sgNode],
      edges: [mainEdge],
      subgraphs: { sg_main: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 主图边被保留
    expect(result.graph.edges.some((e) => e.id === 'main_e1')).toBe(true);
    // 主图边仍然指向 s1（子图节点 ID），但 s1 已被替换为 inner_1
    // 这是一个已知局限：主图边可能指向已不存在的节点 ID
    // 但至少边本身不应丢失
    expect(result.graph.edges).toHaveLength(1);
  });

  it('子图节点 ID 与主图节点冲突时加前缀', () => {
    // 主图有节点 id=inner_1，子图内部也有节点 id=inner_1
    const innerSg: SubgraphDefinition = {
      id: 'sg_conflict',
      name: '冲突子图',
      nodes: [makeItem('inner_1')],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(innerSg);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_conflict',
        subgraphName: '冲突子图',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeItem('inner_1'), sgNode],
      edges: [],
      subgraphs: { sg_conflict: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 应有 2 个节点（主图 inner_1 + 子图 inner_1 加前缀）
    expect(result.graph.nodes).toHaveLength(2);
    // 不应有 ID 冲突
    const ids = result.graph.nodes.map((n) => n.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(2);
    // 子图内部节点应带前缀（不与主图 inner_1 冲突）
    expect(ids).toContain('inner_1');
    expect(ids.some((id) => id.startsWith('s1_') && id.endsWith('inner_1'))).toBe(true);
    // 冲突节点的 data.nodeId 也应同步更新
    const conflictNode = result.graph.nodes.find((n) => n.id.startsWith('s1_'));
    expect(conflictNode).toBeDefined();
    expect(conflictNode!.data.nodeId).toBe(conflictNode!.id);
  });

  it('嵌套子图递归展开（无冲突时保留原 ID）', () => {
    // 外层子图 sg_outer 包含节点 inner_a 和子图节点 sg_inner
    // sg_inner 引用 sg_inner_def，包含节点 inner_b
    const innerSgDef: SubgraphDefinition = {
      id: 'sg_inner_def',
      name: '最内层',
      nodes: [makeItem('inner_b')],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(innerSgDef);

    const sgInnerNode: ModNode = {
      id: 'sg_inner',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'sg_inner',
        label: 'inner sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_inner_def',
        subgraphName: '最内层',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };

    const outerSgDef: SubgraphDefinition = {
      id: 'sg_outer',
      name: '外层',
      nodes: [makeItem('inner_a'), sgInnerNode],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(outerSgDef);

    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_outer',
        subgraphName: '外层',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_outer: outerSgDef, sg_inner_def: innerSgDef },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 应展开为 2 个节点：inner_a 和 inner_b（无冲突，保留原 ID）
    expect(result.graph.nodes).toHaveLength(2);
    // 不应有 ID 冲突
    const ids = result.graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(2);
    // data.nodeId 与 id 一致
    for (const n of result.graph.nodes) {
      expect(n.data.nodeId).toBe(n.id);
    }
  });

  it('节点 data.nodeId 与节点 id 始终保持一致', () => {
    const innerSg: SubgraphDefinition = {
      id: 'sg_nodeid',
      name: 'nodeId 同步',
      nodes: [makeItem('inner_1')],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(innerSg);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_nodeid',
        subgraphName: 'nodeId 同步',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_nodeid: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // data.nodeId 应与 id 一致（避免后续编译引用旧 ID）
    for (const n of result.graph.nodes) {
      expect(n.data.nodeId).toBe(n.id);
    }
  });
});
