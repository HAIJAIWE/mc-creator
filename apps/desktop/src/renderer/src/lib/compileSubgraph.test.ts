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
    // 子图节点被替换为内部节点
    expect(result.graph.nodes.some((n) => n.id.startsWith('inner_1'))).toBe(true);
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
});
