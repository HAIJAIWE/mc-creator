import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeGraphStore } from './node-graph-store.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { NodeGraph, NodeKind, NodeData } from '@mc-creator/shared';

// 重置用的初始空图（与 store 内 EMPTY_GRAPH 结构一致）
const EMPTY_GRAPH: NodeGraph = {
  version: 1,
  modId: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

// 每个测试前用于重置 store 的初始状态
const initialState = {
  graph: EMPTY_GRAPH,
  selectedNodeId: null as string | null,
  selectedEdgeId: null as string | null,
  undoStack: [] as NodeGraph[],
  redoStack: [] as NodeGraph[],
};

// 全部 11 种节点类型
const ALL_KINDS: NodeKind[] = [
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
];

describe('node-graph-store', () => {
  beforeEach(() => {
    // 每次重置到初始状态
    useNodeGraphStore.setState(initialState);
  });

  // ============================================================
  // 1. 初始状态
  // ============================================================
  describe('初始状态', () => {
    it('默认 graph 有空的 nodes/edges 数组', () => {
      const { graph } = useNodeGraphStore.getState();
      expect(graph.nodes).toEqual([]);
      expect(graph.edges).toEqual([]);
    });

    it('默认 modId 为空字符串', () => {
      expect(useNodeGraphStore.getState().graph.modId).toBe('');
    });

    it('默认 viewport 为原点且 zoom=1', () => {
      expect(useNodeGraphStore.getState().graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });

    it('默认 graph.version 为 1', () => {
      expect(useNodeGraphStore.getState().graph.version).toBe(1);
    });

    it('selectedNodeId/selectedEdgeId 为 null', () => {
      const s = useNodeGraphStore.getState();
      expect(s.selectedNodeId).toBeNull();
      expect(s.selectedEdgeId).toBeNull();
    });

    it('undoStack/redoStack 为空数组', () => {
      const s = useNodeGraphStore.getState();
      expect(s.undoStack).toEqual([]);
      expect(s.redoStack).toEqual([]);
    });
  });

  // ============================================================
  // 2. addNode
  // ============================================================
  describe('addNode', () => {
    it('返回新节点 id（字符串）', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    });

    it('调用后 graph.nodes.length +1', () => {
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
      useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
    });

    it('新节点 type 与传入 kind 一致', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.id).toBe(id);
      expect(node.type).toBe('item');
    });

    it('新节点 data.kind 与传入 kind 一致', () => {
      useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.data.kind).toBe('item');
    });

    it('新节点 position 为传入值', () => {
      useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.position).toEqual({ x: 100, y: 200 });
    });

    it('新节点 data.nodeId 与节点 id 一致', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.data.nodeId).toBe(id);
    });

    it('新节点有 ports（由 createDefaultPorts 生成）', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(Array.isArray(node.ports)).toBe(true);
      // item 应有 1 个 out 端口
      expect(node.ports).toHaveLength(1);
      expect(node.ports[0]!.id).toBe('out');
      expect(node.ports[0]!.direction).toBe('out');
      expect(node.ports[0]!.type).toBe('item_stack');
    });

    it('新节点 selected 字段为 false', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.selected).toBe(false);
    });

    it('新节点自动被选中（selectedNodeId === 新 id）', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(useNodeGraphStore.getState().selectedNodeId).toBe(id);
    });

    it('所有 11 种节点类型都能正确添加', () => {
      for (const kind of ALL_KINDS) {
        useNodeGraphStore.setState(initialState);
        const id = useNodeGraphStore.getState().addNode(kind, { x: 0, y: 0 });
        const node = useNodeGraphStore.getState().graph.nodes[0]!;
        expect(node.type).toBe(kind);
        expect(node.data.kind).toBe(kind);
        expect(node.id).toBe(id);
        expect(node.data.nodeId).toBe(id);
      }
    });

    it('comment 节点 ports 为空数组', () => {
      useNodeGraphStore.getState().addNode('comment', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.ports).toEqual([]);
    });

    it('recipe 节点有 2 个端口（in 和 out）', () => {
      useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.ports).toHaveLength(2);
      const portIds = node.ports.map((p) => p.id).sort();
      expect(portIds).toEqual(['in', 'out']);
    });

    it('machine 节点有 3 个端口', () => {
      useNodeGraphStore.getState().addNode('machine', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.ports).toHaveLength(3);
    });

    it('condition 节点有 3 个端口（in/true/false）', () => {
      useNodeGraphStore.getState().addNode('condition', { x: 0, y: 0 });
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.ports).toHaveLength(3);
      const portIds = node.ports.map((p) => p.id).sort();
      expect(portIds).toEqual(['false', 'in', 'true']);
    });

    it('连续 addNode 生成不同的 id', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(id1).not.toBe(id2);
    });

    it('partial 参数可覆盖默认 data', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 }, {
        label: '自定义标签',
      } as Partial<NodeData>);
      const node = useNodeGraphStore.getState().graph.nodes[0]!;
      expect(node.data.label).toBe('自定义标签');
      expect(node.id).toBe(id);
    });
  });

  // ============================================================
  // 3. updateNode
  // ============================================================
  describe('updateNode', () => {
    it('更新节点 label', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().updateNode(id, { label: '新标签' } as Partial<NodeData>);
      const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(node.data.label).toBe('新标签');
    });

    it('更新节点 note', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().updateNode(id, { note: '备注内容' } as Partial<NodeData>);
      const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(node.data.note).toBe('备注内容');
    });

    it('更新节点 disabled', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().updateNode(id, { disabled: true } as Partial<NodeData>);
      const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(node.data.disabled).toBe(true);
    });

    it('只更新目标节点，不影响其他节点', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
      useNodeGraphStore.getState().updateNode(id1, { label: 'item标签' } as Partial<NodeData>);
      const node2 = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id2)!;
      expect(node2.data.label).toBe(''); // block 默认 label 为 ''
    });

    it('保留未覆盖的字段', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const before = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      const originalItemId = before.data.kind === 'item' ? before.data.itemId : undefined;
      useNodeGraphStore.getState().updateNode(id, { label: '新标签' } as Partial<NodeData>);
      const after = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(after.data.label).toBe('新标签');
      expect(after.data.kind).toBe('item');
      if (after.data.kind === 'item') {
        expect(after.data.itemId).toBe(originalItemId);
      }
    });

    it('对不存在的 nodeId 安全（不抛错）', () => {
      expect(() =>
        useNodeGraphStore.getState().updateNode('nonexistent', { label: 'x' } as Partial<NodeData>),
      ).not.toThrow();
    });
  });

  // ============================================================
  // 4. removeNode
  // ============================================================
  describe('removeNode', () => {
    it('removeNode 后 graph.nodes.length -1', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
      useNodeGraphStore.getState().removeNode(id);
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });

    it('删除节点同时删除相连的边', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
        disabled: false,
      });
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(1);

      useNodeGraphStore.getState().removeNode(id1);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(0);
    });

    it('删除作为 target 的节点也清除相关边', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().removeNode(id2);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(0);
    });

    it('删除节点不影响不相连的边', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const id3 = useNodeGraphStore.getState().addNode('item', { x: 200, y: 0 });
      useNodeGraphStore.getState().addEdge({
        source: id2,
        target: id3,
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().removeNode(id1);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(1);
    });

    it('删除当前选中节点时清空 selectedNodeId', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(useNodeGraphStore.getState().selectedNodeId).toBe(id);
      useNodeGraphStore.getState().removeNode(id);
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
    });

    it('删除非选中节点不影响 selectedNodeId', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
      // 此时 selectedNodeId 是 id2（最后添加的）
      useNodeGraphStore.getState().removeNode(id1);
      expect(useNodeGraphStore.getState().selectedNodeId).toBe(id2);
    });

    it('删除不存在的 nodeId 安全（不抛错）', () => {
      expect(() => useNodeGraphStore.getState().removeNode('nonexistent')).not.toThrow();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });
  });

  // ============================================================
  // 5. duplicateNode
  // ============================================================
  describe('duplicateNode', () => {
    it('返回新 id（字符串，与原 id 不同）', () => {
      const originalId = useNodeGraphStore.getState().addNode('item', { x: 10, y: 20 });
      const newId = useNodeGraphStore.getState().duplicateNode(originalId);
      expect(newId).not.toBeNull();
      expect(newId).not.toBe(originalId);
      expect(typeof newId).toBe('string');
    });

    it('调用后 graph.nodes.length +1', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().duplicateNode(id);
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(2);
    });

    it('新节点 type 与原节点相同', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      const newNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === newId)!;
      expect(newNode.type).toBe('item');
      expect(newNode.data.kind).toBe('item');
    });

    it('新节点 data.nodeId 与新 id 一致（不是原 id）', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      const newNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === newId)!;
      expect(newNode.data.nodeId).toBe(newId);
      expect(newNode.data.nodeId).not.toBe(id);
    });

    it('新节点 position 偏移 +40,+40', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 100, y: 200 });
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      const newNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === newId)!;
      expect(newNode.position).toEqual({ x: 140, y: 240 });
    });

    it('新节点 label 加 " 副本" 后缀', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().updateNode(id, { label: 'MyItem' } as Partial<NodeData>);
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      const newNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === newId)!;
      expect(newNode.data.label).toBe('MyItem 副本');
    });

    it('新节点自动被选中', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      expect(useNodeGraphStore.getState().selectedNodeId).toBe(newId);
    });

    it('新节点 selected 字段为 false', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const newId = useNodeGraphStore.getState().duplicateNode(id);
      const newNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === newId)!;
      expect(newNode.selected).toBe(false);
    });

    it('对不存在的 nodeId 返回 null', () => {
      const result = useNodeGraphStore.getState().duplicateNode('nonexistent');
      expect(result).toBeNull();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });
  });

  // ============================================================
  // 6. moveNode
  // ============================================================
  describe('moveNode', () => {
    it('更新节点 position', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().moveNode(id, { x: 500, y: 600 });
      const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(node.position).toEqual({ x: 500, y: 600 });
    });

    it('完全替换 position（不是合并）', () => {
      const id = useNodeGraphStore.getState().addNode('item', { x: 100, y: 100 });
      useNodeGraphStore.getState().moveNode(id, { x: 50, y: 50 });
      const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
      expect(node.position).toEqual({ x: 50, y: 50 });
    });

    it('只更新目标节点，不影响其他节点', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('item', { x: 100, y: 100 });
      useNodeGraphStore.getState().moveNode(id1, { x: 500, y: 600 });
      const node2 = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id2)!;
      expect(node2.position).toEqual({ x: 100, y: 100 });
    });

    it('对不存在的 nodeId 安全（不抛错）', () => {
      expect(() =>
        useNodeGraphStore.getState().moveNode('nonexistent', { x: 0, y: 0 }),
      ).not.toThrow();
    });
  });

  // ============================================================
  // 7. selectNode / selectEdge
  // ============================================================
  describe('selectNode / selectEdge', () => {
    it('selectNode 设置 selectedNodeId', () => {
      useNodeGraphStore.getState().selectNode('n1');
      expect(useNodeGraphStore.getState().selectedNodeId).toBe('n1');
    });

    it('selectNode(null) 清空 selectedNodeId', () => {
      useNodeGraphStore.getState().selectNode('n1');
      useNodeGraphStore.getState().selectNode(null);
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
    });

    it('selectNode 同时清空 selectedEdgeId', () => {
      useNodeGraphStore.getState().selectEdge('e1');
      useNodeGraphStore.getState().selectNode('n1');
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('selectEdge 设置 selectedEdgeId', () => {
      useNodeGraphStore.getState().selectEdge('e1');
      expect(useNodeGraphStore.getState().selectedEdgeId).toBe('e1');
    });

    it('selectEdge(null) 清空 selectedEdgeId', () => {
      useNodeGraphStore.getState().selectEdge('e1');
      useNodeGraphStore.getState().selectEdge(null);
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('selectEdge 同时清空 selectedNodeId', () => {
      useNodeGraphStore.getState().selectNode('n1');
      useNodeGraphStore.getState().selectEdge('e1');
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
    });
  });

  // ============================================================
  // 8. addEdge / updateEdge / removeEdge
  // ============================================================
  describe('addEdge / updateEdge / removeEdge', () => {
    it('addEdge 后 graph.edges.length +1 并返回 id', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
        disabled: false,
      });
      expect(typeof edgeId).toBe('string');
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(1);
      expect(useNodeGraphStore.getState().graph.edges[0]!.id).toBe(edgeId);
    });

    it('addEdge 保留传入的 source/target/handle/kind', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
        disabled: false,
        label: '产物',
      });
      const edge = useNodeGraphStore.getState().graph.edges.find((e) => e.id === edgeId)!;
      expect(edge.source).toBe(id1);
      expect(edge.target).toBe(id2);
      expect(edge.sourceHandle).toBe('out');
      expect(edge.targetHandle).toBe('in');
      expect(edge.kind).toBe('craft');
      expect(edge.label).toBe('产物');
    });

    it('连续 addEdge 生成不同的 id', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const e1 = useNodeGraphStore
        .getState()
        .addEdge({ source: id1, target: id2, kind: 'craft', disabled: false });
      const e2 = useNodeGraphStore
        .getState()
        .addEdge({ source: id1, target: id2, kind: 'data', disabled: false });
      expect(e1).not.toBe(e2);
    });

    it('updateEdge 修改 label', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().updateEdge(edgeId, { label: '100 FE/t' });
      const edge = useNodeGraphStore.getState().graph.edges.find((e) => e.id === edgeId)!;
      expect(edge.label).toBe('100 FE/t');
    });

    it('updateEdge 修改 disabled', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().updateEdge(edgeId, { disabled: true });
      const edge = useNodeGraphStore.getState().graph.edges.find((e) => e.id === edgeId)!;
      expect(edge.disabled).toBe(true);
    });

    it('removeEdge 后 graph.edges.length -1', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().removeEdge(edgeId);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(0);
    });

    it('removeEdge 当前选中的边时清空 selectedEdgeId', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('recipe', { x: 100, y: 0 });
      const edgeId = useNodeGraphStore.getState().addEdge({
        source: id1,
        target: id2,
        kind: 'craft',
        disabled: false,
      });
      useNodeGraphStore.getState().selectEdge(edgeId);
      useNodeGraphStore.getState().removeEdge(edgeId);
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('updateEdge 对不存在的 edgeId 安全', () => {
      expect(() =>
        useNodeGraphStore.getState().updateEdge('nonexistent', { label: 'x' }),
      ).not.toThrow();
    });

    it('removeEdge 对不存在的 edgeId 安全', () => {
      expect(() => useNodeGraphStore.getState().removeEdge('nonexistent')).not.toThrow();
    });
  });

  // ============================================================
  // 9. 撤销/重做（undo/redo/commit）
  // ============================================================
  describe('撤销/重做（undo/redo/commit）', () => {
    it('初始 undoStack/redoStack 为空', () => {
      const s = useNodeGraphStore.getState();
      expect(s.undoStack).toHaveLength(0);
      expect(s.redoStack).toHaveLength(0);
    });

    it('commit 后 undoStack +1', () => {
      useNodeGraphStore.getState().commit();
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(1);
    });

    it('commit 清空 redoStack', () => {
      // 先制造一个非空 redoStack
      useNodeGraphStore.setState({ redoStack: [EMPTY_GRAPH] });
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(1);

      useNodeGraphStore.getState().commit();
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(0);
    });

    it('commit 最多保留 50 步历史', () => {
      // 制造 51 次 commit
      for (let i = 0; i < 51; i++) {
        useNodeGraphStore.getState().commit();
      }
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(50);
    });

    it('undo 恢复到之前状态', () => {
      // commit 当前空图
      useNodeGraphStore.getState().commit();
      // 添加节点
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
      // undo 应回到空图
      useNodeGraphStore.getState().undo();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(0);
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(1);
    });

    it('redo 重新前进', () => {
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().undo();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);

      useNodeGraphStore.getState().redo();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(1);
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(0);
    });

    it('undo 清空 selectedNodeId/selectedEdgeId', () => {
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      expect(useNodeGraphStore.getState().selectedNodeId).not.toBeNull();

      useNodeGraphStore.getState().undo();
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('redo 清空 selectedNodeId/selectedEdgeId', () => {
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().undo();
      // 设置非空以验证 redo 会清空
      useNodeGraphStore.getState().selectNode('anything');
      useNodeGraphStore.getState().redo();
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('完整流程：commit → 修改 → undo → redo → undo', () => {
      // 初始空图
      useNodeGraphStore.getState().commit();
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
      // 现在应该有 2 个节点
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(2);

      // undo：回到 1 个节点
      useNodeGraphStore.getState().undo();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
      expect(useNodeGraphStore.getState().graph.nodes[0]!.id).toBe(id1);

      // 再 undo：回到 0 个节点
      useNodeGraphStore.getState().undo();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });

    it('undo 空栈时安全不抛错', () => {
      expect(() => useNodeGraphStore.getState().undo()).not.toThrow();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });

    it('redo 空栈时安全不抛错', () => {
      expect(() => useNodeGraphStore.getState().redo()).not.toThrow();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
    });
  });

  // ============================================================
  // 10. clear
  // ============================================================
  describe('clear', () => {
    it('清空所有节点和边', () => {
      const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const id2 = useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
      useNodeGraphStore
        .getState()
        .addEdge({ source: id1, target: id2, kind: 'data', disabled: false });
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(2);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(1);

      useNodeGraphStore.getState().clear();
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(0);
      expect(useNodeGraphStore.getState().graph.edges).toHaveLength(0);
    });

    it('清空 selectedNodeId/selectedEdgeId', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().selectEdge('e1');
      useNodeGraphStore.getState().clear();
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('清空 undoStack/redoStack', () => {
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().commit();
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(2);
      useNodeGraphStore.getState().clear();
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(0);
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(0);
    });

    it('保留 modId 不被清空', () => {
      useNodeGraphStore.getState().setModId('my-mod');
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().clear();
      expect(useNodeGraphStore.getState().graph.modId).toBe('my-mod');
    });

    it('重置 viewport 到默认值', () => {
      useNodeGraphStore.getState().setViewport({ x: 99, y: 99, zoom: 0.1 });
      useNodeGraphStore.getState().clear();
      expect(useNodeGraphStore.getState().graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });
  });

  // ============================================================
  // 11. loadGraph
  // ============================================================
  describe('loadGraph', () => {
    it('替换 store.graph', () => {
      const newGraph: NodeGraph = {
        version: 1,
        modId: 'loaded-mod',
        viewport: { x: 10, y: 20, zoom: 2 },
        nodes: [
          {
            id: 'loaded_1',
            type: 'item',
            position: { x: 5, y: 5 },
            data: {
              nodeId: 'loaded_1',
              kind: 'item',
              label: '载入的物品',
              note: '',
              disabled: false,
              collapsed: false,
              codeLocked: false,
              itemId: 'loaded_item',
              displayName: '载入物品',
              category: 'misc',
              maxStackSize: 32,
              maxDamage: 0,
              rarity: 'rare',
              glow: true,
            },
            ports: [],
            selected: false,
          },
        ],
        edges: [],
        subgraphs: {},
      };

      useNodeGraphStore.getState().loadGraph(newGraph);
      const { graph } = useNodeGraphStore.getState();
      expect(graph).toBe(newGraph); // 直接替换引用
      expect(graph.nodes).toHaveLength(1);
      expect(graph.nodes[0]!.id).toBe('loaded_1');
      expect(graph.modId).toBe('loaded-mod');
      expect(graph.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
    });

    it('清空 selectedNodeId/selectedEdgeId', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().selectEdge('e1');
      useNodeGraphStore.getState().loadGraph({ ...EMPTY_GRAPH, modId: 'new' });
      expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
      expect(useNodeGraphStore.getState().selectedEdgeId).toBeNull();
    });

    it('清空 undoStack/redoStack', () => {
      useNodeGraphStore.getState().commit();
      useNodeGraphStore.getState().commit();
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(2);

      useNodeGraphStore.getState().loadGraph({ ...EMPTY_GRAPH, modId: 'new' });
      expect(useNodeGraphStore.getState().undoStack).toHaveLength(0);
      expect(useNodeGraphStore.getState().redoStack).toHaveLength(0);
    });

    it('载入带边的图', () => {
      const newGraph: NodeGraph = {
        version: 1,
        modId: 'edge-mod',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 'n_a',
            type: 'item',
            position: { x: 0, y: 0 },
            data: {
              nodeId: 'n_a',
              kind: 'item',
              label: 'A',
              note: '',
              disabled: false,
              collapsed: false,
              codeLocked: false,
              itemId: 'a_item',
              displayName: 'A',
              category: 'misc',
              maxStackSize: 64,
              maxDamage: 0,
              rarity: 'common',
              glow: false,
            },
            ports: [],
            selected: false,
          },
          {
            id: 'n_b',
            type: 'recipe',
            position: { x: 100, y: 0 },
            data: {
              nodeId: 'n_b',
              kind: 'recipe',
              label: 'B',
              note: '',
              disabled: false,
              collapsed: false,
              codeLocked: false,
              recipeId: 'b_recipe',
              recipeType: 'crafting_shaped',
              outputCount: 1,
              cookTime: 200,
              experience: 0,
              pattern: [],
            },
            ports: [],
            selected: false,
          },
        ],
        edges: [
          {
            id: 'e_1',
            source: 'n_a',
            target: 'n_b',
            kind: 'craft',
            disabled: false,
          },
        ],
        subgraphs: {},
      };

      useNodeGraphStore.getState().loadGraph(newGraph);
      const { graph } = useNodeGraphStore.getState();
      expect(graph.nodes).toHaveLength(2);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]!.id).toBe('e_1');
    });
  });

  // ============================================================
  // 12. setViewport / setModId
  // ============================================================
  describe('setViewport / setModId', () => {
    it('setViewport 更新 graph.viewport', () => {
      useNodeGraphStore.getState().setViewport({ x: 10, y: 20, zoom: 0.5 });
      expect(useNodeGraphStore.getState().graph.viewport).toEqual({ x: 10, y: 20, zoom: 0.5 });
    });

    it('setViewport 完全替换 viewport', () => {
      useNodeGraphStore.getState().setViewport({ x: 100, y: 200, zoom: 2 });
      useNodeGraphStore.getState().setViewport({ x: 1, y: 2, zoom: 0.1 });
      expect(useNodeGraphStore.getState().graph.viewport).toEqual({ x: 1, y: 2, zoom: 0.1 });
    });

    it('setModId 更新 graph.modId', () => {
      useNodeGraphStore.getState().setModId('my-mod');
      expect(useNodeGraphStore.getState().graph.modId).toBe('my-mod');
    });

    it('setModId 不影响其他字段', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      useNodeGraphStore.getState().setModId('new-mod');
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
      expect(useNodeGraphStore.getState().graph.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    });

    it('setViewport 不影响 nodes/edges', () => {
      useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
      const nodesBefore = useNodeGraphStore.getState().graph.nodes;
      useNodeGraphStore.getState().setViewport({ x: 1, y: 1, zoom: 1 });
      expect(useNodeGraphStore.getState().graph.nodes).toBe(nodesBefore); // 引用不变
      expect(useNodeGraphStore.getState().graph.nodes).toHaveLength(1);
    });
  });
});

// ============================================================
// 阶段 C：createDefaultNodeData/Ports 新节点 + 子图/自定义节点
// ============================================================

describe('createDefaultNodeData/Ports（阶段 C 新节点）', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' },
    });
  });

  it('addNode variable 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('variable', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('variable');
    if (node.data.kind === 'variable') {
      expect(node.data.varName).toBe('var1');
      expect(node.data.varType).toBe('int');
      expect(node.data.isConstant).toBe(false);
    }
    expect(node.ports).toHaveLength(1);
    expect(node.ports[0]!.direction).toBe('out');
  });

  it('addNode subgraph 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('subgraph', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('subgraph');
    if (node.data.kind === 'subgraph') {
      expect(node.data.subgraphId).toBe('');
      expect(node.data.customTypeId).toBeNull();
    }
  });

  it('addNode loop 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('loop', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('loop');
    if (node.data.kind === 'loop') {
      expect(node.data.loopType).toBe('for');
      expect(node.data.loopVarName).toBe('i');
    }
    expect(node.ports.some((p) => p.id === 'loop_var')).toBe(true);
    expect(node.ports.some((p) => p.id === 'body')).toBe(true);
    expect(node.ports.some((p) => p.id === 'done')).toBe(true);
  });
});

describe('encapsulateSubgraph', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' },
    });
  });

  it('把选中节点封装为子图，返回新 SubgraphNode id', () => {
    const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const id2 = useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([id1, id2], '我的子图');
    expect(sgNodeId).not.toBeNull();
    const sgNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === sgNodeId)!;
    expect(sgNode.data.kind).toBe('subgraph');
    if (sgNode.data.kind === 'subgraph') {
      expect(sgNode.data.subgraphName).toBe('我的子图');
    }
    // 原节点移出主图
    expect(useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id1)).toBeUndefined();
    expect(useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id2)).toBeUndefined();
    // 子图注册到 graph.subgraphs
    expect(Object.keys(useNodeGraphStore.getState().graph.subgraphs)).toHaveLength(1);
  });

  it('空节点列表返回 null', () => {
    expect(useNodeGraphStore.getState().encapsulateSubgraph([], 'x')).toBeNull();
  });
});

describe('setEditingSubgraphId + editingSubgraphId', () => {
  it('setEditingSubgraphId 设置/清除', () => {
    useNodeGraphStore.getState().setEditingSubgraphId('sg_1');
    expect(useNodeGraphStore.getState().editingSubgraphId).toBe('sg_1');
    useNodeGraphStore.getState().setEditingSubgraphId(null);
    expect(useNodeGraphStore.getState().editingSubgraphId).toBeNull();
  });
});

describe('addCustomNode', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' },
    });
  });

  it('注册 schema 后 addCustomNode 创建带 customTypeId 的 subgraph 节点', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: '合成台',
      description: '',
      icon: '',
      color: 'mc-code',
      ports: [],
      fields: [],
      codeTemplate: '',
    });
    const id = useNodeGraphStore.getState().addCustomNode('mymod:crafter', { x: 50, y: 50 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('subgraph');
    if (node.data.kind === 'subgraph') {
      expect(node.data.customTypeId).toBe('mymod:crafter');
      expect(node.data.subgraphName).toBe('合成台');
    }
  });

  it('未注册的 typeId 抛错', () => {
    expect(() =>
      useNodeGraphStore.getState().addCustomNode('unregistered', { x: 0, y: 0 }),
    ).toThrow();
  });
});
