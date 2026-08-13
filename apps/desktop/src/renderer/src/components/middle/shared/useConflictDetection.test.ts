// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useConflictDetection, type ConflictGroup } from './useConflictDetection.js';
import { findDuplicates } from './utils.js';

interface FakeSpec {
  items: { id: string }[];
  blocks: { id: string }[];
}

const GROUPS: ConflictGroup<FakeSpec>[] = [
  {
    key: 'duplicateItemIds',
    label: '物品 ID 重复',
    detect: (s) => findDuplicates(s.items, (i) => i.id),
  },
  {
    key: 'duplicateBlockIds',
    label: '方块 ID 重复',
    detect: (s) => findDuplicates(s.blocks, (b) => b.id),
  },
];

describe('shared/useConflictDetection', () => {
  it('spec 为 null 时各字段为空且计数为 0', () => {
    const { result } = renderHook(() => useConflictDetection(null, GROUPS));
    expect(result.current.conflicts).toEqual({ duplicateItemIds: [], duplicateBlockIds: [] });
    expect(result.current.totalConflicts).toBe(0);
    expect(result.current.conflictList).toEqual([
      { label: '物品 ID 重复', count: 0 },
      { label: '方块 ID 重复', count: 0 },
    ]);
  });

  it('无重复时计数为 0', () => {
    const spec: FakeSpec = { items: [{ id: 'a' }, { id: 'b' }], blocks: [{ id: 'x' }] };
    const { result } = renderHook(() => useConflictDetection(spec, GROUPS));
    expect(result.current.conflicts.duplicateItemIds).toEqual([]);
    expect(result.current.totalConflicts).toBe(0);
  });

  it('检测出各组重复并汇总总数', () => {
    const spec: FakeSpec = {
      items: [{ id: 'a' }, { id: 'a' }, { id: 'b' }],
      blocks: [{ id: 'x' }, { id: 'x' }, { id: 'x' }],
    };
    const { result } = renderHook(() => useConflictDetection(spec, GROUPS));
    expect(result.current.conflicts.duplicateItemIds).toEqual([{ id: 'a', count: 2 }]);
    expect(result.current.conflicts.duplicateBlockIds).toEqual([{ id: 'x', count: 3 }]);
    expect(result.current.totalConflicts).toBe(2);
    expect(result.current.conflictList).toEqual([
      { label: '物品 ID 重复', count: 1 },
      { label: '方块 ID 重复', count: 1 },
    ]);
  });
});
