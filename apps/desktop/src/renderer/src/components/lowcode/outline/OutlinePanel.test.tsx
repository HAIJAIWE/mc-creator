import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlinePanel } from './OutlinePanel';
import type { CompileResult } from '../../../lib/compileNodeGraph.js';
import { ModSpec } from '@mc-creator/shared';

// Create a mock graph that can be used by both the hook and getState
const mockGraph = {
  nodes: [
    {
      id: 'item_1',
      type: 'item',
      position: { x: 100, y: 100 },
      data: { label: '铁剑', itemId: 'iron_sword', note: '主手武器' },
      selected: false,
      ports: [],
    },
    {
      id: 'block_2',
      type: 'block',
      position: { x: 200, y: 200 },
      data: { label: '工作台', blockId: 'crafting_table', note: '' },
      selected: false,
      ports: [],
    },
    {
      id: 'event_3',
      type: 'event',
      position: { x: 300, y: 300 },
      data: { label: '右键方块', eventType: 'player_right_click_block', note: '' },
      selected: false,
      ports: [],
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  modId: 'test_mod',
  subgraphs: {},
  version: 1,
};

// Mock store state
const mockStoreState = {
  graph: mockGraph,
  selectedNodeId: null,
  selectNode: vi.fn(),
  removeNode: vi.fn(),
  duplicateNode: vi.fn().mockReturnValue('new_id'),
  toggleCollapse: vi.fn(),
  updateNode: vi.fn(),
};

// Mock the stores - need to mock both the hook and the static getState
vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: Object.assign(
    vi.fn((selector) => selector(mockStoreState)),
    { getState: vi.fn(() => mockStoreState) },
  ),
}));

vi.mock('../../../store/debugger-store.js', () => ({
  useDebuggerStore: vi.fn((selector) =>
    selector({
      state: null,
      breakpoints: new Map(),
    }),
  ),
}));

vi.mock('../../../store/outline-selection-store.js', () => ({
  useOutlineSelection: vi.fn(() => ({
    outlineSelectedId: null,
    focusedIndex: 0,
    handleSelect: vi.fn(),
    navigate: vi.fn(),
    collapseAll: vi.fn(),
    expandAllContainers: vi.fn(),
    isExpanded: vi.fn(() => true),
  })),
}));

vi.mock('../../../store/outline-filter-store.js', () => ({
  useOutlineFilter: vi.fn(() => ({
    filteredNodes: mockGraph.nodes,
    stats: { total: 3, filtered: 3, errors: 1, warnings: 1 },
    searchQuery: '',
    setSearchQuery: vi.fn(),
    clearFilters: vi.fn(),
  })),
}));

vi.mock('../../useToast.js', () => ({
  useToast: vi.fn(() => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}));

// ModSpec 有二十多个带默认值的数组字段，这里直接过一遍 zod schema 拿到合法最小实例，
// 避免在测试里手写一遍结构（也顺带校验 schema 本身可用）。
const emptySpec = ModSpec.parse({ modId: 'test_mod', name: 'Test Mod' });

const mockCompileResult: CompileResult = {
  spec: emptySpec,
  errors: ['物品节点 item_1 编译失败：缺少材质'],
  warnings: ['方块节点 block_2 没有设置硬度'],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutlinePanel', () => {
  it('renders node list with correct labels', () => {
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={vi.fn()}
        onRenameNode={vi.fn()}
      />,
    );

    expect(screen.getByText('铁剑')).toBeInTheDocument();
    expect(screen.getByText('工作台')).toBeInTheDocument();
    expect(screen.getByText('右键方块')).toBeInTheDocument();
  });

  it('shows error and warning indicators', () => {
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={vi.fn()}
        onRenameNode={vi.fn()}
      />,
    );

    // Check for error indicator (红色 alert-circle)
    const errorIcon = screen.getByLabelText('编译错误');
    expect(errorIcon).toBeInTheDocument();

    // Check for warning indicator (黄色 alert-triangle)
    const warningIcon = screen.getByLabelText('编译警告');
    expect(warningIcon).toBeInTheDocument();
  });

  it('filters nodes by search query', () => {
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={vi.fn()}
        onRenameNode={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    fireEvent.change(searchInput, { target: { value: '铁剑' } });

    expect(screen.getByText('铁剑')).toBeInTheDocument();
    expect(screen.queryByText('工作台')).not.toBeInTheDocument();
    expect(screen.queryByText('右键方块')).not.toBeInTheDocument();
  });

  it('calls onFocusNode when node is clicked', () => {
    const onFocusNode = vi.fn();
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={onFocusNode}
        onRenameNode={vi.fn()}
      />,
    );

    const nodeItem = screen.getByText('铁剑').closest('[role="treeitem"]');
    fireEvent.click(nodeItem!);

    expect(onFocusNode).toHaveBeenCalledWith('item_1');
  });

  it('shows empty state when no nodes match', () => {
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={vi.fn()}
        onRenameNode={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索节点（名称/类型/ID）');
    fireEvent.change(searchInput, { target: { value: '不存在的节点' } });

    expect(screen.getByText('没有匹配的节点')).toBeInTheDocument();
  });

  it('displays node count stats', () => {
    render(
      <OutlinePanel
        compileResult={mockCompileResult}
        onFocusNode={vi.fn()}
        onRenameNode={vi.fn()}
      />,
    );

    expect(screen.getByText('3 / 3 个节点')).toBeInTheDocument();
  });
});
