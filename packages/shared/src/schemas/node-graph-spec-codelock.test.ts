import { describe, it, expect } from 'vitest';
import { ItemNodeData, NodeGraph } from './node-graph-spec.js';

describe('BaseNodeData.codeLocked', () => {
  it('默认 codeLocked 为 false', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '测试',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
    });
    expect(item.codeLocked).toBe(false);
    expect(item.lockedCode).toBeUndefined();
  });

  it('可设置 codeLocked=true + lockedCode', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '锁定物品',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
      codeLocked: true,
      lockedCode: 'public class TestItem { /* 用户手改 */ }',
    });
    expect(item.codeLocked).toBe(true);
    expect(item.lockedCode).toBe('public class TestItem { /* 用户手改 */ }');
  });

  it('codeLocked=true 但 lockedCode 缺省时 lockedCode 为 undefined（编译器应回退）', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '空锁定',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
      codeLocked: true,
    });
    expect(item.codeLocked).toBe(true);
    expect(item.lockedCode).toBeUndefined();
  });

  it('旧 JSON 无 codeLocked 字段时解析默认 false（向后兼容）', () => {
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
    expect(graph.nodes[0].data.codeLocked).toBe(false);
    expect(graph.nodes[0].data.lockedCode).toBeUndefined();
  });
});
