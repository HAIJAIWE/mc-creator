// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { LowcodeWorkspace } from './LowcodeWorkspace.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

/**
 * Task 27: LowcodeWorkspace 与 SubgraphWorkspace 集成测试
 *
 * 由于 vi.mock 会被 hoist 到文件顶部并影响整个测试文件，
 * 本测试单独成文件，避免破坏 LowcodeWorkspace.test.tsx 中依赖真实
 * NodeGraphEditor 渲染（role="application"）的现有测试。
 *
 * 这里把 NodeGraphEditor / SubgraphWorkspace 都 mock 成带 data-testid 的占位 div，
 * 仅验证 LowcodeWorkspace 的条件渲染逻辑：editingSubgraphId 非空时切到 SubgraphWorkspace。
 */
vi.mock('./NodeGraphEditor.js', () => ({
  NodeGraphEditor: () => <div data-testid="main-editor" />,
}));
vi.mock('./subgraph/SubgraphWorkspace.js', () => ({
  SubgraphWorkspace: () => <div data-testid="subgraph-workspace" />,
}));
// D10：mock useRecentGraphs，避免 mount 后异步 refresh 在 act 外触发 setState
vi.mock('../../lib/useRecentGraphs.js', () => ({
  useRecentGraphs: () => ({
    recent: [],
    refresh: () => {},
    remove: () => {},
    loading: false,
    error: null,
  }),
}));

describe('LowcodeWorkspace SubgraphWorkspace 集成', () => {
  beforeEach(() => {
    useNodeGraphStore.setState({
      graph: {
        version: 1,
        modId: '',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [],
        edges: [],
        subgraphs: {},
      },
      selectedNodeId: null,
      selectedEdgeId: null,
      undoStack: [],
      redoStack: [],
      editingSubgraphId: null,
    });

    // jsdom polyfill（React Flow 依赖）
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
    if (typeof globalThis.DOMMatrix === 'undefined') {
      globalThis.DOMMatrix = class {
        constructor() {}
        multiply() {
          return this;
        }
        inverse() {
          return this;
        }
        transformPoint() {
          return { x: 0, y: 0 };
        }
      } as unknown as typeof DOMMatrix;
    }
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('editingSubgraphId 为 null 时显示主编辑器', () => {
    useNodeGraphStore.setState({ editingSubgraphId: null });
    render(<LowcodeWorkspace />);
    expect(screen.getByTestId('main-editor')).toBeTruthy();
    expect(screen.queryByTestId('subgraph-workspace')).toBeNull();
  });

  it('editingSubgraphId 非 null 时显示 SubgraphWorkspace', () => {
    useNodeGraphStore.setState({ editingSubgraphId: 'sg_1' });
    render(<LowcodeWorkspace />);
    expect(screen.getByTestId('subgraph-workspace')).toBeTruthy();
    expect(screen.queryByTestId('main-editor')).toBeNull();
  });
});
