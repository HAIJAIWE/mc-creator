// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTabCounts, useTabStatus, type BaseTab } from './useTabCounts.js';

interface MockSpec {
  items: { id: string }[];
  blocks: { id: string }[];
  meta: { name: string };
}

type MockTab = 'items' | 'blocks' | 'meta' | 'export';

const TABS: BaseTab<MockTab>[] = [
  { key: 'items', label: '物品' },
  { key: 'blocks', label: '方块' },
  { key: 'meta', label: '元数据' },
  { key: 'export', label: '导出' },
];

const HIDE_COUNT = new Set<MockTab>(['meta', 'export']);

const countFn = (spec: MockSpec, key: MockTab): number | undefined => {
  if (key === 'items') return spec.items.length;
  if (key === 'blocks') return spec.blocks.length;
  return undefined;
};

describe('shared/useTabCounts', () => {
  describe('useTabCounts', () => {
    it('spec 为 null 时所有 count 为 undefined', () => {
      const { result } = renderHook(() => useTabCounts(TABS, null, countFn, HIDE_COUNT));
      const tabs = result.current;
      expect(tabs).toHaveLength(4);
      for (const t of tabs) {
        expect(t.count).toBeUndefined();
      }
    });

    it('正确计算非 hideCount tab 的 count', () => {
      const spec: MockSpec = {
        items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        blocks: [{ id: 'b1' }],
        meta: { name: 'test' },
      };
      const { result } = renderHook(() => useTabCounts(TABS, spec, countFn, HIDE_COUNT));
      const tabs = result.current;

      expect(tabs[0]).toEqual({
        key: 'items',
        label: '物品',
        icon: undefined,
        count: 3,
        hideCount: false,
      });
      expect(tabs[1]).toEqual({
        key: 'blocks',
        label: '方块',
        icon: undefined,
        count: 1,
        hideCount: false,
      });
    });

    it('hideCount tab 的 count 为 undefined 即使能算出 count', () => {
      const spec: MockSpec = {
        items: [{ id: 'a' }],
        blocks: [],
        meta: { name: 'test' },
      };
      const { result } = renderHook(() => useTabCounts(TABS, spec, countFn, HIDE_COUNT));
      const tabs = result.current;

      const metaTab = tabs.find((t) => t.key === 'meta');
      expect(metaTab?.hideCount).toBe(true);
      expect(metaTab?.count).toBeUndefined();
    });

    it('不传 hideCountOn 时所有 tab 都显示 count', () => {
      const spec: MockSpec = {
        items: [{ id: 'a' }],
        blocks: [],
        meta: { name: 'test' },
      };
      const { result } = renderHook(() => useTabCounts(TABS, spec, countFn));
      const tabs = result.current;

      // meta tab 也会调用 countFn，但 countFn 返回 undefined
      const metaTab = tabs.find((t) => t.key === 'meta');
      expect(metaTab?.hideCount).toBe(false);
      expect(metaTab?.count).toBeUndefined(); // countFn 对 meta 返回 undefined
    });

    it('countFn 返回 undefined 时不显示 count', () => {
      const spec: MockSpec = {
        items: [],
        blocks: [],
        meta: { name: 'test' },
      };
      const { result } = renderHook(() => useTabCounts(TABS, spec, countFn, HIDE_COUNT));
      const tabs = result.current;

      // blocks 的 count 是 0，应显示为 0（不是 undefined）
      const blocksTab = tabs.find((t) => t.key === 'blocks');
      expect(blocksTab?.count).toBe(0);
    });
  });

  describe('useTabStatus', () => {
    const statusFn = (
      spec: MockSpec,
      key: MockTab,
    ): { error?: number; warning?: number } | undefined => {
      if (key === 'items' && spec.items.length === 0) {
        return { error: 1, warning: 2 };
      }
      if (key === 'blocks') {
        return { warning: 3 };
      }
      return undefined;
    };

    it('spec 为 null 时不调用 statusFn，error/warning 为 undefined', () => {
      const { result } = renderHook(() => useTabStatus(TABS, null, countFn, statusFn, HIDE_COUNT));
      const tabs = result.current;
      for (const t of tabs) {
        expect(t.error).toBeUndefined();
        expect(t.warning).toBeUndefined();
      }
    });

    it('正确计算 error 和 warning', () => {
      const spec: MockSpec = {
        items: [], // 空 → error 1, warning 2
        blocks: [{ id: 'b1' }], // warning 3
        meta: { name: 'test' },
      };
      const { result } = renderHook(() => useTabStatus(TABS, spec, countFn, statusFn, HIDE_COUNT));
      const tabs = result.current;

      const itemsTab = tabs.find((t) => t.key === 'items');
      expect(itemsTab?.error).toBe(1);
      // error > 0 时 warning 不显示
      expect(itemsTab?.warning).toBeUndefined();

      const blocksTab = tabs.find((t) => t.key === 'blocks');
      expect(blocksTab?.error).toBeUndefined();
      expect(blocksTab?.warning).toBe(3);
    });

    it('error 为 0 时不显示 error，warning 为 0 时不显示 warning', () => {
      const spec: MockSpec = {
        items: [{ id: 'a' }], // 非空 → 无 error
        blocks: [],
        meta: { name: 'test' },
      };
      const statusFnZero = (): { error?: number; warning?: number } => ({
        error: 0,
        warning: 0,
      });
      const { result } = renderHook(() =>
        useTabStatus(TABS, spec, countFn, statusFnZero, HIDE_COUNT),
      );
      const tabs = result.current;

      for (const t of tabs) {
        expect(t.error).toBeUndefined();
        expect(t.warning).toBeUndefined();
      }
    });

    it('hideCount tab 仍然计算 error/warning（仅 count 被隐藏）', () => {
      const spec: MockSpec = {
        items: [],
        blocks: [],
        meta: { name: 'test' },
      };
      const statusFnMeta = (
        _spec: MockSpec,
        key: MockTab,
      ): { error?: number; warning?: number } | undefined => {
        if (key === 'meta') return { error: 5 };
        return undefined;
      };
      const { result } = renderHook(() =>
        useTabStatus(TABS, spec, countFn, statusFnMeta, HIDE_COUNT),
      );
      const tabs = result.current;

      const metaTab = tabs.find((t) => t.key === 'meta');
      // count 被 hideCount 隐藏
      expect(metaTab?.count).toBeUndefined();
      expect(metaTab?.hideCount).toBe(true);
      // 但 error 仍显示
      expect(metaTab?.error).toBe(5);
    });
  });
});
