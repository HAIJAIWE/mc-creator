import { describe, it, expect, beforeEach } from 'vitest';
import { useDrawerStore } from './drawer-store.js';
import { useNodeGraphStore } from './node-graph-store.js';

describe('useDrawerStore 草稿模式', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('openDrawer 深拷贝节点 data 到 draft', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    expect(useDrawerStore.getState().open).toBe(true);
    expect(useDrawerStore.getState().nodeId).toBe(id);
    const graph = useNodeGraphStore.getState().graph;
    expect(useDrawerStore.getState().draft).toEqual(graph.nodes[0].data);
    expect(useDrawerStore.getState().draft).not.toBe(graph.nodes[0].data);
  });

  it('updateField 修改草稿字段', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    useDrawerStore.getState().updateField('itemId', 'changed_id');

    expect((useDrawerStore.getState().draft as { itemId: string }).itemId).toBe('changed_id');
    expect(useDrawerStore.getState().dirty).toBe(true);
  });

  it('saveDraft 写回 store 并关闭抽屉', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('itemId', 'saved_id');

    useDrawerStore.getState().saveDraft();

    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect((node.data as { itemId: string }).itemId).toBe('saved_id');
    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('cancelDraft 丢弃草稿', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('itemId', 'temp');

    useDrawerStore.getState().cancelDraft();

    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect((node.data as { itemId: string }).itemId).toBe('new_item');
    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('closeDrawer 重置状态', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    useDrawerStore.getState().closeDrawer();

    expect(useDrawerStore.getState().open).toBe(false);
    expect(useDrawerStore.getState().nodeId).toBe(null);
    expect(useDrawerStore.getState().draft).toBe(null);
  });

  it('openDrawer 节点不存在时不打开', () => {
    useDrawerStore.getState().openDrawer('nonexistent');
    expect(useDrawerStore.getState().open).toBe(false);
  });
});
