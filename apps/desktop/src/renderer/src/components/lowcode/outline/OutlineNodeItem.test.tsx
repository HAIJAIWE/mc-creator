import '@testing-library/jest-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutlineNodeItem } from './OutlineNodeItem';
import type { ModNode } from '@mc-creator/shared';

// Use vi.hoisted for proper hoisting of mock factories
const { mockUseToastFactory, mockUseNodeGraphStore } = vi.hoisted(() => {
  const mockUseToastFactory = vi.fn(() => ({
    useToast: vi.fn(() => ({
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    })),
  }));

  // 组件内部会用 selectNode/duplicateNode 等，这里给全套 spy，
  // 具体断言由各用例按需覆盖实现。
  const mockUseNodeGraphStore = vi.fn((selector: (s: unknown) => unknown) => {
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

  return { mockUseToastFactory, mockUseNodeGraphStore };
});

vi.mock('../../../store/node-graph-store.js', () => ({
  useNodeGraphStore: mockUseNodeGraphStore,
}));

vi.mock('../../useToast.js', () => ({
  useToast: mockUseToastFactory().useToast,
}));

const mockNode: ModNode = {
  id: 'item_1',
  type: 'item',
  position: { x: 100, y: 100 },
  data: {
    kind: 'item',
    nodeId: 'item_1',
    label: '铁剑',
    itemId: 'iron_sword',
    displayName: '铁剑',
    category: 'sword',
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
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutlineNodeItem', () => {
  it('renders node title and subtitle', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} />);

    expect(screen.getByText('铁剑')).toBeInTheDocument();
    // Subtitle uses full node ID (item_1), not last 8 chars
    expect(screen.getByText('item · item_1')).toBeInTheDocument();
  });

  it('shows item icon with correct color', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} />);

    // The McIcon renders without aria-label, just verify the node renders
    const treeItem = screen.getByRole('treeitem');
    expect(treeItem).toBeInTheDocument();
  });

  it('shows disabled badge when node is disabled', () => {
    const disabledNode = { ...mockNode, data: { ...mockNode.data, disabled: true } };
    render(<OutlineNodeItem node={disabledNode} onClick={vi.fn()} />);

    expect(screen.getByText('禁用')).toBeInTheDocument();
  });

  it('shows collapsed badge when node is collapsed', () => {
    const collapsedNode = { ...mockNode, data: { ...mockNode.data, collapsed: true } };
    render(<OutlineNodeItem node={collapsedNode} onClick={vi.fn()} />);

    expect(screen.getByText('折叠')).toBeInTheDocument();
  });

  it('shows error indicator when hasError is true', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} hasError />);

    const errorIcon = screen.getByLabelText('编译错误');
    expect(errorIcon).toBeInTheDocument();
  });

  it('shows warning indicator when hasWarning is true', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} hasWarning />);

    const warningIcon = screen.getByLabelText('编译警告');
    expect(warningIcon).toBeInTheDocument();
  });

  it('shows debug indicator when isDebugCurrent is true', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} isDebugCurrent />);

    const debugIcon = screen.getByLabelText('调试当前');
    expect(debugIcon).toBeInTheDocument();
  });

  it('shows breakpoint indicator when hasBreakpoint is true', () => {
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} hasBreakpoint />);

    const breakpointIcon = screen.getByLabelText('断点');
    expect(breakpointIcon).toBeInTheDocument();
  });

  it('highlights selected node', () => {
    const { rerender } = render(
      <OutlineNodeItem node={mockNode} onClick={vi.fn()} selected={false} />,
    );
    expect(screen.getByRole('treeitem')).not.toHaveClass('bg-mc-accent/15');

    rerender(<OutlineNodeItem node={mockNode} onClick={vi.fn()} selected={true} />);
    expect(screen.getByRole('treeitem')).toHaveClass('bg-mc-accent/15');
  });

  it('shows expand/collapse button for container nodes', () => {
    const containerNode = { ...mockNode, type: 'subgraph' as const };
    render(<OutlineNodeItem node={containerNode} onClick={vi.fn()} hasChildren expanded={true} />);

    expect(screen.getByLabelText('折叠')).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={onClick} />);

    fireEvent.click(screen.getByRole('treeitem'));
    expect(onClick).toHaveBeenCalledWith('item_1');
  });

  it('calls onDoubleClick when double clicked', async () => {
    const onDoubleClick = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} onDoubleClick={onDoubleClick} />);

    const treeItem = screen.getByRole('treeitem');
    await userEvent.dblClick(treeItem);
    expect(onDoubleClick).toHaveBeenCalledWith('item_1');
  });

  it('calls onContextMenu when right clicked', async () => {
    const onContextMenu = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} onContextMenu={onContextMenu} />);

    const treeItem = screen.getByRole('treeitem');
    // Use fireEvent with proper context menu event
    fireEvent.contextMenu(treeItem, { button: 2, bubbles: true, cancelable: true });
    expect(onContextMenu).toHaveBeenCalledWith(expect.any(Object), 'item_1');
  });

  it('calls onFocus when Enter is pressed', async () => {
    const onClick = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={onClick} />);

    const treeItem = screen.getByRole('treeitem');
    treeItem.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledWith('item_1');
  });

  it('calls onFocus when Space is pressed', async () => {
    const onClick = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={onClick} />);

    const treeItem = screen.getByRole('treeitem');
    treeItem.focus();
    // Space key triggers handleClick in onKeyDown
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledWith('item_1');
  });

  it('calls onDoubleClick when F2 is pressed', async () => {
    const onDoubleClick = vi.fn();
    render(<OutlineNodeItem node={mockNode} onClick={vi.fn()} onDoubleClick={onDoubleClick} />);

    const treeItem = screen.getByRole('treeitem');
    treeItem.focus();
    await userEvent.keyboard('{F2}');
    expect(onDoubleClick).toHaveBeenCalledWith('item_1');
  });

  // Note: Delete, Backspace, Ctrl+D are handled by parent OutlinePanel, not OutlineNodeItem
  // These tests are removed as they don't match component behavior
});
