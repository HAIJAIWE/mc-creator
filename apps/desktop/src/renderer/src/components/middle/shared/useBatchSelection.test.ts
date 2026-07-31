// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBatchSelection } from './useBatchSelection.js';

describe('shared/useBatchSelection', () => {
  it('初始状态：空 Set，size 0', () => {
    const { result } = renderHook(() => useBatchSelection<string>());
    expect(result.current.selected).toBeInstanceOf(Set);
    expect(result.current.size).toBe(0);
  });

  it('toggle 添加和移除项', () => {
    const { result } = renderHook(() => useBatchSelection<string>());

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected('a')).toBe(true);

    act(() => {
      result.current.toggle('a');
    });
    expect(result.current.size).toBe(0);
    expect(result.current.isSelected('a')).toBe(false);
  });

  it('toggle 多个不同项', () => {
    const { result } = renderHook(() => useBatchSelection<number>());

    act(() => {
      result.current.toggle(1);
      result.current.toggle(2);
      result.current.toggle(3);
    });
    expect(result.current.size).toBe(3);
    expect(result.current.isSelected(2)).toBe(true);
  });

  it('clear 清空所有选择', () => {
    const { result } = renderHook(() => useBatchSelection<string>());

    act(() => {
      result.current.toggle('a');
      result.current.toggle('b');
    });
    expect(result.current.size).toBe(2);

    act(() => {
      result.current.clear();
    });
    expect(result.current.size).toBe(0);
    expect(result.current.selected).toBeInstanceOf(Set);
  });

  it('setAll 一次性设置所有选择', () => {
    const { result } = renderHook(() => useBatchSelection<string>());

    act(() => {
      result.current.setAll(['x', 'y', 'z']);
    });
    expect(result.current.size).toBe(3);
    expect(result.current.isSelected('x')).toBe(true);
    expect(result.current.isSelected('y')).toBe(true);
    expect(result.current.isSelected('z')).toBe(true);
  });

  it('setAll 覆盖之前的选择', () => {
    const { result } = renderHook(() => useBatchSelection<string>());

    act(() => {
      result.current.toggle('a');
      result.current.toggle('b');
    });
    act(() => {
      result.current.setAll(['c']);
    });
    expect(result.current.size).toBe(1);
    expect(result.current.isSelected('a')).toBe(false);
    expect(result.current.isSelected('c')).toBe(true);
  });

  it('isSelected 对未选中项返回 false', () => {
    const { result } = renderHook(() => useBatchSelection<string>());
    expect(result.current.isSelected('nonexistent')).toBe(false);
  });

  it('支持对象作为 key（引用相等性）', () => {
    interface Item {
      id: number;
    }
    const { result } = renderHook(() => useBatchSelection<Item>());
    const item1: Item = { id: 1 };
    const item1Copy: Item = { id: 1 };

    act(() => {
      result.current.toggle(item1);
    });
    expect(result.current.isSelected(item1)).toBe(true);
    // 引用不同，即使内容相同也视为不同项
    expect(result.current.isSelected(item1Copy)).toBe(false);
  });

  it('selected Set 不可变引用（toggle 后是新 Set）', () => {
    const { result } = renderHook(() => useBatchSelection<string>());

    const initialSet = result.current.selected;
    act(() => {
      result.current.toggle('a');
    });
    // toggle 后应该是新 Set 实例
    expect(result.current.selected).not.toBe(initialSet);
  });
});
