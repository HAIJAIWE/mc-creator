// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NodeDetailDrawer } from './NodeDetailDrawer.js';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

describe('NodeDetailDrawer', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  /** D10：flush 表单内异步副作用（ResourceIdEditor 的 listExternalMods） */
  async function flushAsync() {
    await act(async () => {});
  }

  it('抽屉关闭时不渲染', async () => {
    const { container } = render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开抽屉时渲染标题 + 表单 + 按钮', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('保存')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.getByText('物品 ID')).toBeTruthy();
  });

  it('点击保存触发 saveDraft', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    // P2 修复：设置合法的 itemId（modid:path 格式），通过 resourceId 校验
    useDrawerStore.getState().updateField('itemId', 'mc:new_item');
    // 设置 label 通过 required 校验
    useDrawerStore.getState().updateField('label', '测试物品');

    render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();
    fireEvent.click(screen.getByText('保存'));

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('点击取消触发 cancelDraft（dirty 时确认后丢弃修改）', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('displayName', '临时修改');
    // #18 修复：取消按钮统一走 handleClose，dirty 时先弹确认，确认后丢弃草稿
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();
    fireEvent.click(screen.getByText('取消'));

    expect(useDrawerStore.getState().open).toBe(false);
    // 节点 displayName 应未被保存（仍为默认值「新物品」）
    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect((node.data as ItemNodeData).displayName).toBe('新物品');
  });

  it('显示编译消息（错误/警告）', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const messages = [
      { type: 'error' as const, nodeId: id, message: '物品 ID 重复' },
      { type: 'warning' as const, nodeId: id, message: '建议设置显示名' },
    ];

    render(<NodeDetailDrawer compileMessages={messages} />);
    await flushAsync();

    expect(screen.getByText('物品 ID 重复')).toBeTruthy();
    expect(screen.getByText('建议设置显示名')).toBeTruthy();
  });

  it('Esc 键关闭抽屉（触发 cancelDraft）', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('dirty 时显示未保存提示', async () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('displayName', '修改了');

    render(<NodeDetailDrawer compileMessages={[]} />);
    await flushAsync();
    expect(screen.getByText('未保存')).toBeTruthy();
  });
});
