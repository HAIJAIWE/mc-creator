// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, act } from '@testing-library/react';
import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';
import { DebuggerPanel } from './DebuggerPanel.js';
import { useDebuggerStore } from '../../store/debugger-store.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

/**
 * DebuggerPanel 组件测试
 *
 * 覆盖：
 * - 渲染冒烟（空状态、有状态）
 * - 按钮点击触发 start / step / run / reset / stop
 * - 断点切换（基于 selectedNodeId）
 * - a11y 属性正确（role / aria-label / aria-live）
 * - 调用栈 / 变量 / 日志三栏正确显示
 * - onHighlightNode 回调被触发
 * - 按钮禁用状态
 */

// === 测试辅助函数（与 nodeGraphDebugger.test.ts 风格一致） ===

function createDefaultNodeData(kind: NodeKind): NodeData {
  const base = { nodeId: '', label: '', note: '', disabled: false };
  switch (kind) {
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'player_right_click_block',
        eventArgs: '{}',
      } as NodeData;
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        invert: false,
      } as NodeData;
    case 'action':
      return { ...base, kind: 'action', actionType: 'spawn_entity', actionArgs: '{}' } as NodeData;
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '// test',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      } as NodeData;
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'new_item',
        displayName: '新物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    default:
      return { ...base, kind: kind as NodeData['kind'] } as NodeData;
  }
}

function createDefaultPorts(kind: NodeKind): NodePort[] {
  switch (kind) {
    case 'event':
      return [
        {
          id: 'trigger',
          label: '触发',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'condition':
      return [
        {
          id: 'in',
          label: '输入',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'true',
          label: '真',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
        {
          id: 'false',
          label: '假',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'action':
      return [
        {
          id: 'in',
          label: '执行',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out',
          label: '完成',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    default:
      return [];
  }
}

function makeNode(id: string, kind: NodeKind, overrides?: Record<string, unknown>): ModNode {
  const baseData = createDefaultNodeData(kind);
  const merged = { ...baseData, ...overrides, nodeId: id } as NodeData;
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: merged,
    ports: createDefaultPorts(kind),
    selected: false,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  opts?: { sourceHandle?: string; kind?: ModEdge['kind'] },
): ModEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts?.sourceHandle,
    targetHandle: undefined,
    kind: opts?.kind ?? 'control',
    disabled: false,
  };
}

function makeGraph(nodes: ModNode[], edges: ModEdge[] = [], modId = 'test'): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

// === 测试 fixtures ===

const EMPTY_GRAPH: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

const EVENT_ONLY_GRAPH: NodeGraph = makeGraph([
  makeNode('n_event', 'event', { label: '右键方块' }),
]);

const FULL_CHAIN_GRAPH: NodeGraph = makeGraph(
  [
    makeNode('n_event', 'event', { label: '右键方块' }),
    makeNode('n_cond', 'condition', {
      label: '是否有物品',
      conditionType: 'custom',
      conditionArgs: '{"chance":0.5}',
    }),
    makeNode('n_action', 'action', { label: '生成实体' }),
  ],
  [
    makeEdge('e1', 'n_event', 'n_cond', { sourceHandle: 'trigger' }),
    makeEdge('e2', 'n_cond', 'n_action', { sourceHandle: 'true' }),
  ],
);

beforeEach(() => {
  // 重置 debugger store
  useDebuggerStore.setState({
    state: null,
    breakpoints: new Set<string>(),
    isRunning: false,
    isPaused: false,
  });
  // 重置 node-graph store（仅 selectedNodeId，不动 graph）
  useNodeGraphStore.setState({
    selectedNodeId: null,
    selectedEdgeId: null,
  });

  // jsdom polyfill
  if (Element.prototype.scrollIntoView === undefined) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DebuggerPanel', () => {
  it('1. 渲染冒烟：包含 region 容器与控制按钮组（空状态）', () => {
    render(<DebuggerPanel graph={EMPTY_GRAPH} />);

    // 顶层 role="region" aria-label="节点图调试器"
    const region = screen.getByRole('region', { name: '节点图调试器' });
    expect(region).toBeTruthy();

    // 控制按钮组
    const group = screen.getByRole('group', { name: '调试器控制' });
    expect(group).toBeTruthy();

    // 五个控制按钮
    expect(screen.getByLabelText('开始调试')).toBeTruthy();
    expect(screen.getByLabelText('单步执行')).toBeTruthy();
    expect(screen.getByLabelText('运行到断点')).toBeTruthy();
    expect(screen.getByLabelText('停止调试')).toBeTruthy();
    expect(screen.getByLabelText('重置调试器')).toBeTruthy();

    // 状态显示：未启动
    expect(screen.getByLabelText('调试器状态：未启动')).toBeTruthy();
  });

  it('2. 点击"开始"按钮触发 start，进入第一个 event 节点', () => {
    render(<DebuggerPanel graph={EVENT_ONLY_GRAPH} />);

    fireEvent.click(screen.getByLabelText('开始调试'));

    // store 应已初始化
    const state = useDebuggerStore.getState().state;
    expect(state).not.toBeNull();
    expect(state?.currentNodeId).toBe('n_event');
    expect(state?.visitedNodeIds).toEqual(['n_event']);

    // 状态显示变为"已暂停"
    expect(screen.getByLabelText('调试器状态：已暂停')).toBeTruthy();

    // 调用栈应显示 n_event
    const list = screen.getByRole('list', { name: '调用栈' });
    expect(list).toBeTruthy();
    expect(within(list).getByText(/右键方块/)).toBeTruthy();
  });

  it('3. 点击"单步"按钮触发 step，沿控制流推进', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    // 先开始
    fireEvent.click(screen.getByLabelText('开始调试'));
    expect(useDebuggerStore.getState().state?.currentNodeId).toBe('n_event');

    // 单步：评估 event，推进到 condition
    fireEvent.click(screen.getByLabelText('单步执行'));
    expect(useDebuggerStore.getState().state?.currentNodeId).toBe('n_cond');

    // 单步：评估 condition（chance → true），推进到 action
    fireEvent.click(screen.getByLabelText('单步执行'));
    expect(useDebuggerStore.getState().state?.currentNodeId).toBe('n_action');
  });

  it('4. 点击"运行"按钮触发 run，跑到结束（无断点）', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    fireEvent.click(screen.getByLabelText('开始调试'));
    fireEvent.click(screen.getByLabelText('运行到断点'));

    const state = useDebuggerStore.getState().state;
    expect(state?.finished).toBe(true);
    expect(state?.visitedNodeIds).toEqual(['n_event', 'n_cond', 'n_action']);

    // 状态显示"已结束"
    expect(screen.getByLabelText('调试器状态：已结束')).toBeTruthy();
  });

  it('5. 点击"重置"按钮触发 reset，回到初始状态', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    fireEvent.click(screen.getByLabelText('开始调试'));
    fireEvent.click(screen.getByLabelText('单步执行'));
    expect(useDebuggerStore.getState().state?.currentNodeId).toBe('n_cond');

    // 重置
    fireEvent.click(screen.getByLabelText('重置调试器'));
    const state = useDebuggerStore.getState().state;
    expect(state?.currentNodeId).toBe('n_event');
    expect(state?.visitedNodeIds).toEqual(['n_event']);
    expect(state?.traversedEdgeIds).toEqual([]);
  });

  it('6. 点击"停止"按钮触发 stop，清空状态', () => {
    render(<DebuggerPanel graph={EVENT_ONLY_GRAPH} />);

    fireEvent.click(screen.getByLabelText('开始调试'));
    expect(useDebuggerStore.getState().state).not.toBeNull();

    fireEvent.click(screen.getByLabelText('停止调试'));
    expect(useDebuggerStore.getState().state).toBeNull();
    // 状态显示回到"未启动"
    expect(screen.getByLabelText('调试器状态：未启动')).toBeTruthy();
  });

  it('7. 选中节点后点击"断点"按钮切换断点', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    // 模拟选中节点（用 act 包装以触发 React 重新渲染）
    act(() => {
      useNodeGraphStore.setState({ selectedNodeId: 'n_cond' });
    });

    // 按钮应显示"添加断点"
    const addBtn = screen.getByLabelText('为节点 n_cond 添加断点');
    expect(addBtn).toBeTruthy();

    fireEvent.click(addBtn);

    // 断点数应为 1
    expect(useDebuggerStore.getState().breakpoints.has('n_cond')).toBe(true);
    expect(screen.getByLabelText('已设置断点数：1')).toBeTruthy();

    // 再次点击移除
    const removeBtn = screen.getByLabelText('移除节点 n_cond 的断点');
    fireEvent.click(removeBtn);
    expect(useDebuggerStore.getState().breakpoints.has('n_cond')).toBe(false);
    expect(screen.getByLabelText('已设置断点数：0')).toBeTruthy();
  });

  it('8. a11y 属性：日志区域 aria-live=polite + aria-label=执行日志', () => {
    render(<DebuggerPanel graph={EVENT_ONLY_GRAPH} />);

    const logRegion = screen.getByLabelText('执行日志');
    expect(logRegion).toBeTruthy();
    expect(logRegion.getAttribute('aria-live')).toBe('polite');
  });

  it('9. onHighlightNode 回调在 currentNodeId 变化时触发', () => {
    const highlightSpy = vi.fn();
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} onHighlightNode={highlightSpy} />);

    // 初始：currentNodeId 为 null，应触发一次（null）
    expect(highlightSpy).toHaveBeenCalledWith(null);

    highlightSpy.mockClear();

    fireEvent.click(screen.getByLabelText('开始调试'));
    // 进入 event 后应触发 n_event
    expect(highlightSpy).toHaveBeenCalledWith('n_event');

    highlightSpy.mockClear();

    fireEvent.click(screen.getByLabelText('单步执行'));
    // 推进到 condition 后应触发 n_cond
    expect(highlightSpy).toHaveBeenCalledWith('n_cond');
  });

  it('10. 执行日志区域显示日志条目（开始 + 单步后）', () => {
    render(<DebuggerPanel graph={EVENT_ONLY_GRAPH} />);

    // 空状态显示"暂无日志"
    expect(screen.getByText('暂无日志')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('开始调试'));
    // 开始后应显示"进入"日志（动作标签 + 消息均含"进入"，用 getAllByText）
    const logRegion = screen.getByLabelText('执行日志');
    const enterElements = within(logRegion).getAllByText(/进入/);
    expect(enterElements.length).toBeGreaterThan(0);

    fireEvent.click(screen.getByLabelText('单步执行'));
    // 单步后应显示"执行"日志（event 评估）
    const executeElements = within(logRegion).getAllByText(/执行/);
    expect(executeElements.length).toBeGreaterThan(0);
  });

  it('11. 变量检查器显示已评估节点的输出变量', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    fireEvent.click(screen.getByLabelText('开始调试'));
    fireEvent.click(screen.getByLabelText('单步执行'));

    // event 节点应已评估，variables[n_event] 含 triggered: true
    // 变量环境区域显示所有已评估节点的 outputs
    const varRegion = screen.getByLabelText('变量环境');
    expect(varRegion.textContent).toContain('triggered');
    expect(varRegion.textContent).toContain('true');
  });

  it('12. 按钮禁用状态：未启动时单步/运行/停止/重置禁用，开始可用', () => {
    render(<DebuggerPanel graph={FULL_CHAIN_GRAPH} />);

    // 未启动：开始可用，其余禁用
    expect(screen.getByLabelText('开始调试').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('单步执行').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('运行到断点').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('停止调试').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('重置调试器').hasAttribute('disabled')).toBe(true);

    // 开始后：单步/运行/停止/重置可用，开始禁用
    fireEvent.click(screen.getByLabelText('开始调试'));
    expect(screen.getByLabelText('开始调试').hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText('单步执行').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('运行到断点').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('停止调试').hasAttribute('disabled')).toBe(false);
    expect(screen.getByLabelText('重置调试器').hasAttribute('disabled')).toBe(false);
  });
});
