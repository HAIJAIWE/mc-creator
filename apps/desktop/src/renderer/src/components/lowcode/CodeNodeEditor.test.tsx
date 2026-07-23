// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CodeNodeEditor } from './CodeNodeEditor.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import type { CodeNodeData } from '@mc-creator/shared';

/**
 * CodeNodeEditor 测试：L2 混合模式 Monaco 编辑器面板
 *
 * 测试用例：
 * 1. nodeId 为 null 时不渲染
 * 2. nodeId 指向 code 节点时渲染 Monaco 编辑器 + 标题栏
 * 3. 关闭按钮触发 onClose 回调
 * 4. 编辑器内容变更触发 store 更新
 * 5. methodName/language 字段变更同步到 store
 *
 * Monaco 在 jsdom 中难以真实渲染，这里 mock 为 textarea（带 .monaco-editor 类，
 * 以兼容 LowcodeWorkspace 键盘快捷键对 Monaco 的判断）。
 */

// Mock @monaco-editor/react 为受控 textarea
vi.mock('@monaco-editor/react', () => ({
  default: ({
    value,
    onChange,
    language,
  }: {
    value: string;
    onChange?: (v: string | undefined) => void;
    language: string;
  }) => (
    <textarea
      data-testid="monaco-mock"
      data-language={language}
      className="monaco-editor"
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      aria-label="Monaco 编辑器"
    />
  ),
}));

// jsdom polyfill：React Flow / Monaco 依赖
beforeEach(() => {
  // 重置 store 到空状态
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

/** 在 store 中创建一个 code 节点，返回 nodeId */
function createCodeNode(overrides: Partial<CodeNodeData> = {}): string {
  const { addNode } = useNodeGraphStore.getState();
  return addNode('code', { x: 100, y: 100 }, overrides);
}

describe('CodeNodeEditor', () => {
  it('nodeId 为 null 时不渲染编辑器', () => {
    const onClose = vi.fn();
    const { container } = render(<CodeNodeEditor nodeId={null} onClose={onClose} />);
    // 不渲染任何对话框内容
    expect(container.firstChild).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('nodeId 指向 code 节点时渲染 Monaco 编辑器 + 标题栏（含节点 label）', () => {
    const onClose = vi.fn();
    const nodeId = createCodeNode({ label: '我的代码节点', code: 'return input;' });

    render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);

    // 标题栏显示节点 label
    expect(screen.getByText('我的代码节点')).toBeTruthy();
    // Monaco mock 编辑器渲染
    const editor = screen.getByTestId('monaco-mock');
    expect(editor).toBeTruthy();
    // 编辑器内容已从 store 同步（useEffect 在 render 后执行）
    expect((editor as HTMLTextAreaElement).value).toBe('return input;');
    // 关闭按钮存在
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });

  it('关闭按钮触发 onClose 回调', () => {
    const onClose = vi.fn();
    const nodeId = createCodeNode();

    render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('编辑器内容变更实时同步到 node-graph-store', () => {
    const onClose = vi.fn();
    const nodeId = createCodeNode({ code: 'original' });

    render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);

    const editor = screen.getByTestId('monaco-mock');
    // 模拟用户输入
    fireEvent.change(editor, { target: { value: 'new code content' } });

    // 验证 store 中节点的 code 字段已更新
    const state = useNodeGraphStore.getState();
    const node = state.graph.nodes.find((n) => n.id === nodeId);
    expect(node).toBeTruthy();
    expect(node!.data.kind).toBe('code');
    if (node!.data.kind === 'code') {
      expect(node!.data.code).toBe('new code content');
    }
  });

  it('methodName / language 字段变更同步到 store', () => {
    const onClose = vi.fn();
    const nodeId = createCodeNode({ methodName: 'process', language: 'java' });

    render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);

    // 修改方法名
    const methodInput = screen.getByDisplayValue('process');
    fireEvent.change(methodInput, { target: { value: 'handleCraft' } });

    // 修改语言
    const langSelect = screen.getByLabelText('语言');
    fireEvent.change(langSelect, { target: { value: 'kotlin' } });

    // 验证 store 同步
    const state = useNodeGraphStore.getState();
    const node = state.graph.nodes.find((n) => n.id === nodeId);
    expect(node).toBeTruthy();
    if (node!.data.kind === 'code') {
      expect(node!.data.methodName).toBe('handleCraft');
      expect(node!.data.language).toBe('kotlin');
    }
  });

  it('nodeId 指向非 code 节点时不渲染', () => {
    const onClose = vi.fn();
    // 创建一个 item 节点（非 code）
    const { addNode } = useNodeGraphStore.getState();
    const nodeId = addNode('item', { x: 50, y: 50 });

    const { container } = render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('底部状态栏显示当前语言与字符数', () => {
    const onClose = vi.fn();
    const nodeId = createCodeNode({ code: 'abc', language: 'java' });

    render(<CodeNodeEditor nodeId={nodeId} onClose={onClose} />);

    // 状态栏显示语言
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('java');
    // 状态栏显示字符数（"abc" = 3 字符）
    expect(screen.getByLabelText('字符数').textContent).toContain('3');
  });
});

describe('CodeNodeEditor import 快捷插入', () => {
  it('渲染 import 快捷插入按钮区域', () => {
    const nodeId = createCodeNode();
    render(<CodeNodeEditor nodeId={nodeId} onClose={() => {}} />);
    expect(screen.getByText(/import 快捷插入/)).toBeTruthy();
    expect(screen.getByText('Forge API')).toBeTruthy();
  });

  it('点击 Forge API 按钮插入 import 到代码顶部', () => {
    const nodeId = createCodeNode({ code: 'return input;' });
    render(<CodeNodeEditor nodeId={nodeId} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Forge API'));
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === nodeId)!;
    if (node.data.kind === 'code') {
      expect(node.data.code).toContain('import net.minecraftforge');
    }
  });
});
