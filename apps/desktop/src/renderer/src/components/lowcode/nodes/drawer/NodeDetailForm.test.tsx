// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailForm } from './NodeDetailForm.js';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

describe('NodeDetailForm', () => {
  it('渲染 item 节点的所有字段', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);

    expect(screen.getByText('标签')).toBeTruthy();
    expect(screen.getByText('物品 ID')).toBeTruthy();
    expect(screen.getByText('稀有度')).toBeTruthy();
    expect(screen.getByText('最大堆叠')).toBeTruthy();
  });

  it('修改文本字段触发 updateField', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);

    // displayName 默认值是「新物品」
    const displayNameInput = screen.getByDisplayValue('新物品') as HTMLInputElement;
    fireEvent.change(displayNameInput, { target: { value: '修改后的物品' } });

    const draft = useDrawerStore.getState().draft as ItemNodeData;
    expect(draft.displayName).toBe('修改后的物品');
    expect(useDrawerStore.getState().dirty).toBe(true);
  });

  it('condition 字段根据 recipeType 显示/隐藏', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const { rerender } = render(<NodeDetailForm />);

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
