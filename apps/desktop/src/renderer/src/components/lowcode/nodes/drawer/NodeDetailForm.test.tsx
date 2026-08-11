// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { NodeDetailForm } from './NodeDetailForm.js';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

/** D10：flush 表单内异步副作用（ResourceIdEditor 的 listExternalMods） */
async function flushAsync() {
  await act(async () => {});
}

describe('NodeDetailForm', () => {
  it('渲染 item 节点的所有字段', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    expect(screen.getByText('标签')).toBeTruthy();
    expect(screen.getByText('物品 ID')).toBeTruthy();
    expect(screen.getByText('稀有度')).toBeTruthy();
    expect(screen.getByText('最大堆叠')).toBeTruthy();
  });

  it('修改文本字段触发 updateField', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    // displayName 默认值是「新物品」
    const displayNameInput = screen.getByDisplayValue('新物品') as HTMLInputElement;
    fireEvent.change(displayNameInput, { target: { value: '修改后的物品' } });

    const draft = useDrawerStore.getState().draft as ItemNodeData;
    expect(draft.displayName).toBe('修改后的物品');
    expect(useDrawerStore.getState().dirty).toBe(true);
  });

  it('condition 字段根据 recipeType 显示/隐藏', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const { rerender } = render(<NodeDetailForm />);
    await flushAsync();

    // cookTime 有 condition: recipeType in [smelting, blasting, smoking]
    // 默认 recipeType 是 crafting_shaped，应不显示 cookTime
    expect(screen.queryByText('烧制时间')).toBeNull();

    // 切换 recipeType 到 smelting（通过 displayValue 找到 select）
    const typeSelect = screen.getByDisplayValue('crafting_shaped') as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: 'smelting' } });

    rerender(<NodeDetailForm />);
    expect(screen.getByText('烧制时间')).toBeTruthy();
  });
});

// ============================================================
// P0-1 codeLock UI：抽屉集成测试
// ============================================================
describe('NodeDetailForm codeLock 集成', () => {
  it('item 节点抽屉显示「锁定代码」字段', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    expect(screen.getByText('锁定代码')).toBeTruthy();
  });

  it('comment 节点抽屉不显示「锁定代码」字段（excludeKinds 过滤）', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('comment', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    expect(screen.queryByText('锁定代码')).toBeNull();
    expect(screen.queryByText('锁定代码内容')).toBeNull();
  });

  it('codeLocked=false 时不显示 lockedCode 编辑器', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    // 默认 codeLocked=false，lockedCode 字段应不显示
    expect(screen.queryByText('锁定代码内容')).toBeNull();
    expect(screen.queryByLabelText('锁定代码内容')).toBeNull();
  });

  it('点击「锁定代码」切换到 true 后显示 lockedCode 编辑器', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const { rerender } = render(<NodeDetailForm />);
    await flushAsync();

    // 切换 codeLocked 到 true（用 aria-label 精确定位，避免与 glow 的 'true' 冲突）
    fireEvent.click(screen.getByLabelText('锁定代码: true'));

    rerender(<NodeDetailForm />);

    // lockedCode 字段应显示，textarea 应可访问
    expect(screen.getByText('锁定代码内容')).toBeTruthy();
    expect(screen.getByLabelText('锁定代码内容')).toBeTruthy();
  });

  it('切换 codeLocked 后 draft.codeLocked 为 boolean true（非字符串）', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);
    await flushAsync();

    fireEvent.click(screen.getByLabelText('锁定代码: true'));

    const draft = useDrawerStore.getState().draft as ItemNodeData;
    expect(draft.codeLocked).toBe(true);
    expect(typeof draft.codeLocked).toBe('boolean');
  });

  it('编辑 lockedCode 文本框更新 draft.lockedCode', async () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const { rerender } = render(<NodeDetailForm />);
    await flushAsync();

    // 先切换 codeLocked 到 true
    fireEvent.click(screen.getByLabelText('锁定代码: true'));
    rerender(<NodeDetailForm />);

    // 编辑 lockedCode textarea
    const textarea = screen.getByLabelText('锁定代码内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'public static final int X = 1;' } });

    const draft = useDrawerStore.getState().draft as ItemNodeData;
    expect(draft.lockedCode).toBe('public static final int X = 1;');
  });
});
