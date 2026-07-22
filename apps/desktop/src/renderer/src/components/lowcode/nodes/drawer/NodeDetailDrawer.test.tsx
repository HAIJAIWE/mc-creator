// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailDrawer } from './NodeDetailDrawer.js';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../../store/drawer-store.js';

describe('NodeDetailDrawer', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('抽屉关闭时不渲染', () => {
    const { container } = render(<NodeDetailDrawer compileMessages={[]} />);
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('打开抽屉时渲染标题 + 表单 + 按钮', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText('保存')).toBeTruthy();
    expect(screen.getByText('取消')).toBeTruthy();
    expect(screen.getByText('物品 ID')).toBeTruthy();
  });

  it('点击保存触发 saveDraft', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.click(screen.getByText('保存'));

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('点击取消触发 cancelDraft（不保存修改）', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('displayName', '临时修改');

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.click(screen.getByText('取消'));

    expect(useDrawerStore.getState().open).toBe(false);
    // 节点 displayName 应未被保存（仍为默认值「新物品」）
    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect(node.data.displayName).toBe('新物品');
  });

  it('显示编译消息（错误/警告）', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const messages = [
      { type: 'error' as const, nodeId: id, message: '物品 ID 重复' },
      { type: 'warning' as const, nodeId: id, message: '建议设置显示名' },
    ];

    render(<NodeDetailDrawer compileMessages={messages} />);

    expect(screen.getByText('物品 ID 重复')).toBeTruthy();
    expect(screen.getByText('建议设置显示名')).toBeTruthy();
  });

  it('Esc 键关闭抽屉（触发 cancelDraft）', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('dirty 时显示未保存提示', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('displayName', '修改了');

    render(<NodeDetailDrawer compileMessages={[]} />);
    expect(screen.getByText('未保存')).toBeTruthy();
  });
});
