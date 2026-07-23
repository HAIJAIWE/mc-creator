// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { LowcodeWorkspace } from './LowcodeWorkspace.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';

/**
 * LowcodeWorkspace 测试：覆盖三栏渲染冒烟与键盘快捷键。
 *
 * 快捷键映射：
 * - Ctrl+Z：撤销
 * - Ctrl+Y 或 Ctrl+Shift+Z：重做
 * - Ctrl+D：复制选中节点
 * - Escape：取消选中
 *
 * 注意：React Flow 依赖 ResizeObserver，jsdom 不提供，需手动 polyfill。
 * Monaco 编辑器内（.monaco-editor）不应触发快捷键。
 */

beforeEach(() => {
  // 重置 store 到初始空状态
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
  });
  useEditorModeStore.setState({ mode: 'lowcode', lastSwitchAt: Date.now() });

  // jsdom polyfill
  if (Element.prototype.scrollIntoView === undefined) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  // React Flow 依赖 ResizeObserver，jsdom 不提供，需手动 polyfill
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  // DOMMatrix 用于 reactflow 的某些计算
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

describe('LowcodeWorkspace', () => {
  it('渲染冒烟：包含 NodePalette / NodeGraphEditor / 右侧工具栏', () => {
    render(<LowcodeWorkspace />);
    // NodePalette 有 role="search" + aria-label "节点库面板"
    expect(screen.getByRole('search', { name: /节点库面板/ })).toBeTruthy();
    // NodeGraphEditor 有 role="application" + aria-label "节点图画布"
    expect(screen.getByRole('application', { name: /节点图画布/ })).toBeTruthy();
    // NodeDetailDrawer 是覆盖层，默认不渲染（无节点被打开）
    // 注：OnboardingTour 也会渲染 role=dialog，故按 aria-label 精确匹配节点详情抽屉
    expect(screen.queryByRole('dialog', { name: '节点详情' })).toBeNull();
    // 右侧工具栏有全部折叠/展开按钮
    expect(screen.getByLabelText('全部折叠')).toBeTruthy();
    expect(screen.getByLabelText('全部展开')).toBeTruthy();
  });

  it('Ctrl+Z 触发 undo（先 commit + addNode，再 Ctrl+Z，验证 undoStack 减少）', () => {
    render(<LowcodeWorkspace />);
    // 准备：commit 当前空状态 + addNode，undoStack 应为 1
    // 注意：commit 必须在 addNode 之前调用，把「当前空图」压入 undoStack
    const { addNode, commit } = useNodeGraphStore.getState();
    commit();
    addNode('item', { x: 100, y: 100 });
    expect(useNodeGraphStore.getState().undoStack.length).toBe(1);
    expect(useNodeGraphStore.getState().graph.nodes.length).toBe(1);

    // 触发 Ctrl+Z
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false });

    // 验证 undo 已执行：undoStack 清空，graph 回到空，redoStack 长度为 1
    const state = useNodeGraphStore.getState();
    expect(state.undoStack.length).toBe(0);
    expect(state.graph.nodes.length).toBe(0);
    expect(state.redoStack.length).toBe(1);
  });

  it('Ctrl+Y 触发 redo', () => {
    render(<LowcodeWorkspace />);
    // 准备：commit + addNode + undo，redoStack 应为 1
    const { addNode, commit, undo } = useNodeGraphStore.getState();
    commit();
    addNode('item', { x: 100, y: 100 });
    undo();
    expect(useNodeGraphStore.getState().redoStack.length).toBe(1);
    expect(useNodeGraphStore.getState().graph.nodes.length).toBe(0);

    // 触发 Ctrl+Y
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true, shiftKey: false });

    // 验证 redo 已执行：redoStack 清空，graph 恢复 1 节点
    const state = useNodeGraphStore.getState();
    expect(state.redoStack.length).toBe(0);
    expect(state.graph.nodes.length).toBe(1);
  });

  it('Ctrl+Shift+Z 触发 redo（等价于 Ctrl+Y）', () => {
    render(<LowcodeWorkspace />);
    // 准备：commit + addNode + undo，redoStack 应为 1
    const { addNode, commit, undo } = useNodeGraphStore.getState();
    commit();
    addNode('block', { x: 50, y: 50 });
    undo();
    expect(useNodeGraphStore.getState().redoStack.length).toBe(1);
    expect(useNodeGraphStore.getState().graph.nodes.length).toBe(0);

    // 触发 Ctrl+Shift+Z
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });

    // 验证 redo 已执行
    const state = useNodeGraphStore.getState();
    expect(state.redoStack.length).toBe(0);
    expect(state.graph.nodes.length).toBe(1);
  });

  it('Ctrl+D 复制选中节点（先 addNode 选中，再 Ctrl+D，验证 nodes +1）', () => {
    render(<LowcodeWorkspace />);
    // 准备：addNode 会自动选中
    const { addNode } = useNodeGraphStore.getState();
    addNode('item', { x: 100, y: 100 });
    expect(useNodeGraphStore.getState().graph.nodes.length).toBe(1);
    expect(useNodeGraphStore.getState().selectedNodeId).not.toBeNull();

    // 触发 Ctrl+D
    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: false });

    // 验证节点已复制：nodes 长度变为 2，新节点被选中
    const state = useNodeGraphStore.getState();
    expect(state.graph.nodes.length).toBe(2);
    expect(state.selectedNodeId).not.toBeNull();
    // 新选中节点应不同于原节点
    const originalNode = state.graph.nodes.find((n) => n.position.x === 100);
    expect(originalNode).toBeTruthy();
    expect(state.selectedNodeId).not.toBe(originalNode!.id);
  });

  it('Escape 取消选中', () => {
    render(<LowcodeWorkspace />);
    // 准备：addNode 自动选中
    const { addNode } = useNodeGraphStore.getState();
    addNode('item', { x: 100, y: 100 });
    expect(useNodeGraphStore.getState().selectedNodeId).not.toBeNull();

    // 触发 Escape
    fireEvent.keyDown(window, { key: 'Escape' });

    // 验证已取消选中
    expect(useNodeGraphStore.getState().selectedNodeId).toBeNull();
  });

  it('在 Monaco 编辑器内不触发快捷键', () => {
    render(<LowcodeWorkspace />);
    // 准备：addNode + commit，undoStack 应为 1
    const { addNode, commit } = useNodeGraphStore.getState();
    addNode('item', { x: 100, y: 100 });
    commit();
    expect(useNodeGraphStore.getState().undoStack.length).toBe(1);

    // 模拟 Monaco 编辑器容器：创建带 .monaco-editor 类的元素并聚焦其内部 input
    const monacoContainer = document.createElement('div');
    monacoContainer.className = 'monaco-editor';
    const monacoInput = document.createElement('textarea');
    monacoContainer.appendChild(monacoInput);
    document.body.appendChild(monacoContainer);

    // 在 Monaco 内部触发 Ctrl+Z
    fireEvent.keyDown(monacoInput, { key: 'z', ctrlKey: true, shiftKey: false });

    // 验证 undo 没有被触发：undoStack 仍为 1，graph 仍有 1 个节点
    const state = useNodeGraphStore.getState();
    expect(state.undoStack.length).toBe(1);
    expect(state.graph.nodes.length).toBe(1);

    // 清理
    document.body.removeChild(monacoContainer);
  });

  it('只读模式不响应快捷键', () => {
    render(<LowcodeWorkspace readOnly />);
    // 只读模式下 NodePalette/工具栏不渲染，画布显示「只读预览模式」
    expect(screen.getByText('只读预览模式')).toBeTruthy();

    // 直接通过 store 修改状态后触发 Ctrl+Z，应无效果
    const { addNode, commit } = useNodeGraphStore.getState();
    addNode('item', { x: 100, y: 100 });
    commit();
    expect(useNodeGraphStore.getState().undoStack.length).toBe(1);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: false });

    // 只读模式下快捷键被忽略
    expect(useNodeGraphStore.getState().undoStack.length).toBe(1);
    expect(useNodeGraphStore.getState().graph.nodes.length).toBe(1);
  });

  it('撤销/重做按钮 title 含快捷键提示', () => {
    render(<LowcodeWorkspace />);
    expect(screen.getByTitle('撤销 (Ctrl+Z)')).toBeTruthy();
    expect(screen.getByTitle('重做 (Ctrl+Y)')).toBeTruthy();
  });
});
