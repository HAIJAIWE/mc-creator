import { vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { OutlinePanel } from './OutlinePanel';
import type { CompileResult } from '@mc-creator/shared';

// Mock the store
vi.mock('../../../store/node-graph-store.js');
vi.mock('../../../store/debugger-store.js');
vi.mock('../../useToast.js', () => ({
  useToast: vi.fn(() => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}));

const mockUseNodeGraphStore = useNodeGraphStore as vi.MockedFunction<typeof useNodeGraphStore>;

describe('OutlinePanel', () => {
  const mockNodes = [
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
  ];

  const mockGraph = {
    nodes: mockNodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    modId: 'test_mod',
    subgraphs: {},
    version: 1,
  };

  const mockCompileResult: CompileResult = {
    spec: null,
    errors: ['物品节点 item_1 编译失败：缺少材质'],
    warnings: ['方块节点 block_2 没有设置硬度'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseNodeGraphStore.mockImplementation((selector) => {
      const state = {
        graph: mockGraph,
        selectedNodeId: null,
        selectNode: vi.fn(),
        removeNode: vi.fn(),
        duplicateNode: vi.fn().mockReturnValue('new_id'),
        toggleCollapse: vi.fn(),
        updateNode: vi.fn(),
      };
      return selector(state);
    });
  });

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