import { vi, describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOutlineSelection } from './useOutlineSelection';
import type { ModNode } from '@mc-creator/shared';
import {
  ActionNodeData,
  ConditionNodeData,
  EventNodeData,
  SubgraphNodeData,
} from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';

vi.mock('../../../store/node-graph-store.js');

const mockUseNodeGraphStore = useNodeGraphStore as unknown as ReturnType<typeof vi.fn>;

/**
 * 给自动 mock 的 store 补上静态 getState。
 * Hook 内部的 getAncestorIds 走 useNodeGraphStore.getState().graph 读边，
 * 自动 mock 会把它变成返回 undefined 的 spy，必须显式提供。
 */
function setStoreState(state: Record<string, unknown>) {
  mockUseNodeGraphStore.mockImplementation((selector: (s: unknown) => unknown) => selector(state));
  (mockUseNodeGraphStore as unknown as { getState: () => unknown }).getState = () => state;
}

// 节点 data 走 zod schema 生成：BaseNodeData 上有二十多个带默认值的字段，
// 手写既冗长又容易与 schema 漂移；parse 一次即可得到合法最小实例。
const eventNode: ModNode = {
  id: 'event_1',
  type: 'event',
  position: { x: 100, y: 100 },
  data: EventNodeData.parse({
    kind: 'event',
    nodeId: 'event_1',
    label: '开始',
    eventType: 'tick',
    eventArgs: '{}',
  }),
  selected: false,
  ports: [],
};

const actionNode: ModNode = {
  id: 'action_2',
  type: 'action',
  position: { x: 200, y: 200 },
  data: ActionNodeData.parse({
    kind: 'action',
    nodeId: 'action_2',
    label: '生成实体',
    actionType: 'spawn_entity',
    actionArgs: '{}',
  }),
  selected: false,
  ports: [],
};

const conditionNode: ModNode = {
  id: 'condition_3',
  type: 'condition',
  position: { x: 300, y: 300 },
  data: ConditionNodeData.parse({
    kind: 'condition',
    nodeId: 'condition_3',
    label: '判断',
    conditionType: 'has_item',
    conditionArgs: '{}',
    invert: false,
  }),
  selected: false,
  ports: [],
};

const subgraphNode: ModNode = {
  id: 'subgraph_4',
  type: 'subgraph',
  position: { x: 400, y: 400 },
  data: SubgraphNodeData.parse({
    kind: 'subgraph',
    nodeId: 'subgraph_4',
    label: '子图',
    subgraphId: 'sg_1',
    subgraphName: '子图',
    customTypeId: null,
    customFields: {},
  }),
  selected: false,
  ports: [],
};

const mockNodes: ModNode[] = [eventNode, actionNode, conditionNode];

const mockEdges = [
  {
    id: 'edge_1',
    source: 'event_1',
    target: 'action_2',
    sourceHandle: 'out',
    targetHandle: 'in',
    kind: 'control' as const,
    disabled: false,
  },
  {
    id: 'edge_2',
    source: 'action_2',
    target: 'condition_3',
    sourceHandle: 'out',
    targetHandle: 'in',
    kind: 'control' as const,
    disabled: false,
  },
];

const mockGraph = {
  nodes: mockNodes,
  edges: mockEdges,
  viewport: { x: 0, y: 0, zoom: 1 },
  modId: 'test_mod',
  subgraphs: {},
  version: 1,
};

describe('useOutlineSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoreState({
      graph: mockGraph,
      selectedNodeId: null,
      selectNode: vi.fn(),
    });
  });

  it('returns initial state with no selection', () => {
    const { result } = renderHook(() => useOutlineSelection());

    expect(result.current.outlineSelectedId).toBeNull();
    expect(result.current.expandedPaths.size).toBe(0);
    expect(result.current.focusedIndex).toBe(-1);
  });

  it('syncs selection from store', () => {
    setStoreState({
      graph: mockGraph,
      selectedNodeId: 'action_2',
      selectNode: vi.fn(),
    });

    const { result } = renderHook(() => useOutlineSelection());

    // The hook should sync with store on mount
    expect(result.current.outlineSelectedId).toBe('action_2');
  });

  it('expands ancestor paths when node selected', () => {
    setStoreState({
      graph: mockGraph,
      selectedNodeId: 'condition_3',
      selectNode: vi.fn(),
    });

    const { result } = renderHook(() => useOutlineSelection());

    // condition_3's ancestors are action_2 and event_1
    expect(result.current.expandedPaths.has('action_2')).toBe(true);
    expect(result.current.expandedPaths.has('event_1')).toBe(true);
  });

  it('handleSelect calls selectNode and updates local state', () => {
    const selectNode = vi.fn();
    setStoreState({
      graph: mockGraph,
      selectedNodeId: null,
      selectNode,
    });

    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.handleSelect('action_2');
    });

    expect(selectNode).toHaveBeenCalledWith('action_2');
    expect(result.current.outlineSelectedId).toBe('action_2');
    expect(result.current.expandedPaths.has('event_1')).toBe(true); // ancestor
  });

  it('toggleExpanded adds/removes from expandedPaths', () => {
    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.toggleExpanded('event_1');
    });
    expect(result.current.expandedPaths.has('event_1')).toBe(true);

    act(() => {
      result.current.toggleExpanded('event_1');
    });
    expect(result.current.expandedPaths.has('event_1')).toBe(false);
  });

  it('isExpanded returns correct state', () => {
    const { result } = renderHook(() => useOutlineSelection());

    expect(result.current.isExpanded('event_1')).toBe(false);

    act(() => {
      result.current.toggleExpanded('event_1');
    });
    expect(result.current.isExpanded('event_1')).toBe(true);
  });

  it('expandPath adds multiple nodes', () => {
    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.expandPath(['event_1', 'action_2']);
    });
    expect(result.current.expandedPaths.has('event_1')).toBe(true);
    expect(result.current.expandedPaths.has('action_2')).toBe(true);
  });

  it('collapseAll clears all expanded paths', () => {
    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.expandPath(['event_1', 'action_2']);
    });
    expect(result.current.expandedPaths.size).toBe(2);

    act(() => {
      result.current.collapseAll();
    });
    expect(result.current.expandedPaths.size).toBe(0);
  });

  it('expandAllContainers expands container nodes', () => {
    const containerNodes = [...mockNodes, subgraphNode];

    setStoreState({
      graph: { ...mockGraph, nodes: containerNodes },
      selectedNodeId: null,
      selectNode: vi.fn(),
    });

    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.expandAllContainers();
    });
    expect(result.current.expandedPaths.has('subgraph_4')).toBe(true);
  });

  it('navigate up/down changes focusedIndex and selects node', () => {
    const selectNode = vi.fn();
    setStoreState({
      graph: mockGraph,
      selectedNodeId: null,
      selectNode,
    });

    const { result } = renderHook(() => useOutlineSelection());

    const visibleNodes = mockNodes;

    // Navigate down from -1 (should go to index 0)
    act(() => {
      result.current.navigate('down', visibleNodes);
    });
    expect(result.current.focusedIndex).toBe(0);
    expect(selectNode).toHaveBeenCalledWith('event_1');

    // Navigate down again
    act(() => {
      result.current.navigate('down', visibleNodes);
    });
    expect(result.current.focusedIndex).toBe(1);
    expect(selectNode).toHaveBeenCalledWith('action_2');

    // Navigate up
    act(() => {
      result.current.navigate('up', visibleNodes);
    });
    expect(result.current.focusedIndex).toBe(0);
    expect(selectNode).toHaveBeenCalledWith('event_1');
  });

  it('navigate left/right toggles expanded for container nodes', () => {
    const containerNodes = [...mockNodes, subgraphNode];

    setStoreState({
      graph: { ...mockGraph, nodes: containerNodes },
      selectedNodeId: null,
      selectNode: vi.fn(),
    });

    const { result } = renderHook(() => useOutlineSelection());

    const visibleNodes = containerNodes;

    // 聚焦到子图节点（index 3）。
    // 注意：首次 down 落在 index 0（不跳过第一项），4 个节点需按 4 次才能到 index 3。
    act(() => {
      result.current.navigate('down', visibleNodes);
      result.current.navigate('down', visibleNodes);
      result.current.navigate('down', visibleNodes);
      result.current.navigate('down', visibleNodes);
    });
    expect(result.current.focusedIndex).toBe(3);

    // Right should expand
    act(() => {
      result.current.navigate('right', visibleNodes);
    });
    expect(result.current.isExpanded('subgraph_4')).toBe(true);

    // Left should collapse
    act(() => {
      result.current.navigate('left', visibleNodes);
    });
    expect(result.current.isExpanded('subgraph_4')).toBe(false);
  });

  it('navigate enter selects current focused node', () => {
    const selectNode = vi.fn();
    setStoreState({
      graph: mockGraph,
      selectedNodeId: null,
      selectNode,
    });

    const { result } = renderHook(() => useOutlineSelection());

    const visibleNodes = mockNodes;

    act(() => {
      result.current.navigate('down', visibleNodes); // index 0
      result.current.navigate('enter', visibleNodes);
    });
    expect(selectNode).toHaveBeenCalledWith('event_1');
  });

  it('setFocusedIndex updates focused index', () => {
    const { result } = renderHook(() => useOutlineSelection());

    act(() => {
      result.current.setFocusedIndex(5);
    });
    expect(result.current.focusedIndex).toBe(5);
  });
});
