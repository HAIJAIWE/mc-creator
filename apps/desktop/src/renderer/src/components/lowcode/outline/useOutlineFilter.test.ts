import { vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOutlineFilter, getNodeDisplayTitle, getNodeSearchText } from './useOutlineFilter';
import type { ModNode, CompileResult } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';

vi.mock('../../../store/node-graph-store.js');

const mockUseNodeGraphStore = useNodeGraphStore as vi.MockedFunction<typeof useNodeGraphStore>;

const mockNodes: ModNode[] = [
  {
    id: 'item_1',
    type: 'item',
    position: { x: 100, y: 100 },
    data: {
      kind: 'item',
      nodeId: 'item_1',
      label: '铁剑',
      itemId: 'iron_sword',
      displayName: '铁剑',
      category: 'equipment',
      maxStackSize: 1,
      maxDamage: 250,
      rarity: 'common',
      glow: false,
      disabled: false,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
      note: '主手武器',
    },
    selected: false,
    ports: [],
  },
  {
    id: 'block_2',
    type: 'block',
    position: { x: 200, y: 200 },
    data: {
      kind: 'block',
      nodeId: 'block_2',
      label: '工作台',
      blockId: 'crafting_table',
      displayName: '工作台',
      hardness: 2.5,
      blastResistance: 6.0,
      luminance: 0,
      transparent: false,
      solid: true,
      modelType: 'cube_all',
      isBlockEntity: false,
      disabled: true,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
      note: '',
    },
    selected: false,
    ports: [],
  },
  {
    id: 'event_3',
    type: 'event',
    position: { x: 300, y: 300 },
    data: {
      kind: 'event',
      nodeId: 'event_3',
      label: '右键方块',
      eventType: 'player_right_click_block',
      eventArgs: '{}',
      disabled: false,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
      note: '触发合成',
    },
    selected: false,
    ports: [],
  },
];

const mockCompileResult: CompileResult = {
  spec: null,
  errors: ['物品节点 item_1 编译失败：缺少材质'],
  warnings: ['方块节点 block_2 没有设置硬度'],
};

describe('useOutlineFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all nodes when no filters applied', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    expect(result.current.filteredNodes).toHaveLength(3);
    expect(result.current.stats.total).toBe(3);
    expect(result.current.stats.filtered).toBe(3);
  });

  it('filters by search query on label', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.setSearchQuery('铁剑');
    });

    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].id).toBe('item_1');
    expect(result.current.stats.filtered).toBe(1);
  });

  it('filters by search query on type', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.setSearchQuery('block');
    });

    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].id).toBe('block_2');
  });

  it('filters by search query on ID', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.setSearchQuery('item_1');
    });

    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].id).toBe('item_1');
  });

  it('filters by search query on note', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.setSearchQuery('触发合成');
    });

    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].id).toBe('event_3');
  });

  it('filters by type filter', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.toggleTypeFilter('item');
    });

    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].type).toBe('item');
  });

  it('filters by multiple type filters', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.toggleTypeFilter('item');
      result.current.toggleTypeFilter('block');
    });

    expect(result.current.filteredNodes).toHaveLength(2);
  });

  it('filters disabled nodes when showDisabled is false', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.toggleShowDisabled();
    });

    expect(result.current.filteredNodes).toHaveLength(2);
    expect(result.current.filteredNodes.find((n) => n.id === 'block_2')).toBeUndefined();
  });

  it('shows only error nodes when showErrors=true and showWarnings=false', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.toggleShowWarnings();
    });

    // Only item_1 has error, block_2 has warning, event_3 has neither
    // But showErrors is still true, so both error and non-error/non-warning should show
    // Actually with showWarnings=false, only nodes with errors should show
    expect(result.current.filteredNodes).toHaveLength(1);
    expect(result.current.filteredNodes[0].id).toBe('item_1');
  });

  it('clears all filters', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    act(() => {
      result.current.setSearchQuery('铁剑');
      result.current.toggleTypeFilter('item');
      result.current.toggleShowDisabled();
    });

    expect(result.current.filteredNodes.length).toBeLessThan(3);

    act(() => {
      result.current.clearFilters();
    });

    expect(result.current.filteredNodes).toHaveLength(3);
    expect(result.current.stats.filtered).toBe(3);
  });

  it('calculates correct stats', () => {
    const { result } = renderHook(() =>
      useOutlineFilter(mockNodes, mockCompileResult),
    );

    expect(result.current.stats.errors).toBe(1);
    expect(result.current.stats.warnings).toBe(1);
    expect(result.current.stats.disabled).toBe(1);
  });
});

describe('getNodeDisplayTitle', () => {
  it('returns label when present', () => {
    const title = getNodeDisplayTitle(mockNodes[0]);
    expect(title).toBe('铁剑');
  });

  it('returns displayName when label is empty', () => {
    const node = { ...mockNodes[0], data: { ...mockNodes[0].data, label: '' } };
    const title = getNodeDisplayTitle(node);
    expect(title).toBe('铁剑');
  });

  it('returns subgraphName for subgraph nodes', () => {
    const node = {
      ...mockNodes[0],
      type: 'subgraph' as const,
      data: { ...mockNodes[0].data, kind: 'subgraph', subgraphName: '我的子图' },
    };
    const title = getNodeDisplayTitle(node);
    expect(title).toBe('我的子图');
  });

  it('returns procedureName for procedure nodes', () => {
    const node = {
      ...mockNodes[0],
      type: 'procedure' as const,
      data: { ...mockNodes[0].data, kind: 'procedure', procedureName: 'myProc' },
    };
    const title = getNodeDisplayTitle(node);
    expect(title).toBe('myProc');
  });

  it('returns kind label as fallback', () => {
    const node = { ...mockNodes[0], data: { ...mockNodes[0].data, label: '', displayName: '' } };
    const title = getNodeDisplayTitle(node);
    expect(title).toBe('物品'); // NODE_METADATA label for 'item'
  });
});

describe('getNodeSearchText', () => {
  it('includes all searchable fields', () => {
    const text = getNodeSearchText(mockNodes[0]);
    expect(text).toContain('铁剑');
    expect(text).toContain('item_1');
    expect(text).toContain('item');
    expect(text).toContain('主手武器');
    expect(text).toContain('物品'); // meta label
    expect(text).toContain('武器/工具/食物/材料等可持物品'); // meta description
  });
});