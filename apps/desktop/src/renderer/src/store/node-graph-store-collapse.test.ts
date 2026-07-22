import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeGraphStore } from './node-graph-store.js';

describe('useNodeGraphStore 折叠 actions', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('toggleCollapse 切换节点折叠状态', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(false);

    useNodeGraphStore.getState().toggleCollapse(id);
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(true);

    useNodeGraphStore.getState().toggleCollapse(id);
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(false);
  });

  it('collapseAll 折叠所有节点', () => {
    useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });

    useNodeGraphStore.getState().collapseAll();

    const nodes = useNodeGraphStore.getState().graph.nodes;
    expect(nodes.every((n) => n.data.collapsed)).toBe(true);
  });

  it('expandAll 展开所有节点', () => {
    useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
    useNodeGraphStore.getState().collapseAll();

    useNodeGraphStore.getState().expandAll();

    const nodes = useNodeGraphStore.getState().graph.nodes;
    expect(nodes.every((n) => !n.data.collapsed)).toBe(true);
  });
});
