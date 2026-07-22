import { describe, it, expect } from 'vitest';
import { ItemNodeData, NodeGraph } from './node-graph-spec.js';

describe('BaseNodeData.collapsed', () => {
  it('默认 collapsed 为 false', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '测试',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
    });
    expect(item.collapsed).toBe(false);
  });

  it('可设置 collapsed 为 true', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '测试',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
      collapsed: true,
    });
    expect(item.collapsed).toBe(true);
  });

  it('旧 JSON 无 collapsed 字段时解析默认 false（向后兼容）', () => {
    const oldJson = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'n1',
          type: 'item',
          position: { x: 0, y: 0 },
          ports: [],
          selected: false,
          data: {
            nodeId: 'n1',
            label: '旧节点',
            kind: 'item',
            itemId: 'old',
            displayName: '旧物品',
          },
        },
      ],
      edges: [],
    };
    const graph = NodeGraph.parse(oldJson);
    expect(graph.nodes[0].data.collapsed).toBe(false);
  });
});
