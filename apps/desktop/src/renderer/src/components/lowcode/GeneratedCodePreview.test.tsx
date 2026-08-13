// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, act } from '@testing-library/react';
import type { NodeGraph, FileNode, ModSpec } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useModStore } from '../../store/mod-store.js';

/**
 * GeneratedCodePreview 测试
 *
 * mock 策略：
 * - @mc-creator/core：替换 FabricAdapter，让 translate 返回固定 FileNode[]
 * - ../../lib/compileNodeGraph.js：替换 compileNodeGraph，便于控制 spec/warnings/errors
 * - @monaco-editor/react：用占位 div 显示 value（避免 jsdom 加载真实 Monaco）
 *
 * 使用 vi.hoisted 在 mock 工厂外创建 spy 句柄，便于在每个 it 中重新设置返回值。
 */

// 在 vi.mock 工厂外创建 spy 句柄（hoist 到文件顶部，工厂内可安全引用）
const hoisted = vi.hoisted(() => ({
  compileNodeGraphMock: vi.fn(),
  fabricAdapterTranslateMock: vi.fn(),
}));

// mock @mc-creator/core：替换 FabricAdapter
vi.mock('@mc-creator/core/generators/mod/fabric-adapter.js', () => ({
  FabricAdapter: class MockFabricAdapter {
    // 实例属性：new FabricAdapter().translate === hoisted.fabricAdapterTranslateMock
    translate = hoisted.fabricAdapterTranslateMock;
  },
}));

// mock compileNodeGraph：从测试路径相对（useDebouncedCompile.ts 的 ./compileNodeGraph.js
// 解析到同一绝对路径，因此 mock 在此路径生效）
vi.mock('../../lib/compileNodeGraph.js', () => ({
  compileNodeGraph: hoisted.compileNodeGraphMock,
}));

// mock @monaco-editor/react：用占位组件代替真实 Monaco（async 工厂避开 hoist 循环依赖）
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  type MockEditorProps = {
    value?: string;
    onChange?: (value: string | undefined) => void;
    language?: string;
    theme?: string;
    options?: unknown;
    height?: string | number;
  };
  const MockEditor = (props: MockEditorProps) => {
    return React.createElement(
      'div',
      {
        className: 'monaco-editor',
        'data-testid': 'monaco-editor',
        'data-language': props.language,
      },
      React.createElement('textarea', {
        'aria-label': 'Monaco 编辑器内容',
        value: props.value ?? '',
        onChange: (e: { target: { value: string } }) => props.onChange?.(e.target.value),
        readOnly: true,
      }),
    );
  };
  // 默认导出与 lazy(() => import('@monaco-editor/react')) 兼容
  return { default: MockEditor };
});

import { GeneratedCodePreview } from './GeneratedCodePreview.js';

// === 测试 fixtures ===

const EMPTY_GRAPH: NodeGraph = {
  version: 1,
  modId: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

const SIMPLE_GRAPH: NodeGraph = {
  version: 1,
  modId: 'demo_mod',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    {
      id: 'item_1',
      type: 'item',
      position: { x: 0, y: 0 },
      data: {
        kind: 'item',
        nodeId: 'item_1',
        label: '测试物品',
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
        itemId: 'test_item',
        displayName: '测试物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      },
      ports: [],
      selected: false,
    },
  ],
  edges: [],
  subgraphs: {},
};

const DEMO_SPEC: ModSpec = {
  modId: 'demo_mod',
  version: '1.0.0',
  name: 'demo_mod',
  description: '测试用 spec',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  lootTables: [],
  advancements: [],
  tags: [],
  functions: [],
  recipes: [],
  entities: [],
  machines: [],
  customCode: [],
  multiblocks: [],
  fluids: [],
  biomes: [],
  dimensions: [],
  guis: [],
  structures: [],
  eventHandlers: [],
  conditions: [],
  actions: [],
  procedures: [],
};

const DEMO_FILES: FileNode[] = [
  {
    path: 'src/main/java/com/example/demo_mod/DemoModMod.java',
    content: 'package com.example.demo_mod;\npublic class DemoModMod {}',
  },
  {
    path: 'src/main/resources/fabric.mod.json',
    content: '{\n  "id": "demo_mod"\n}',
  },
  {
    path: 'build.gradle',
    content: "plugins { id 'fabric-loom' }\n",
  },
];

beforeEach(() => {
  // 使用 fake timers 控制防抖延迟
  vi.useFakeTimers();

  // 重置 spy
  hoisted.compileNodeGraphMock.mockReset();
  hoisted.fabricAdapterTranslateMock.mockReset();

  // 重置 store 到空图
  useNodeGraphStore.setState({
    graph: EMPTY_GRAPH,
    selectedNodeId: null,
    selectedEdgeId: null,
    undoStack: [],
    redoStack: [],
    compileResult: null,
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
  vi.useRealTimers();
  cleanup();
  vi.clearAllMocks();
});

/**
 * 辅助：推进防抖定时器并 flush microtasks（让 Monaco lazy import 完成）。
 * 默认 delay=500ms 与 useDebouncedCompile 默认值一致。
 */
async function flushDebounce(delay = 500) {
  await act(async () => {
    vi.advanceTimersByTime(delay);
  });
  // 额外 flush 一次 microtask，确保 lazy import resolve 后的 re-render 已提交
  await act(async () => {});
}

describe('GeneratedCodePreview', () => {
  it('1. 渲染冒烟：空图时显示无生成文件或等待编译', async () => {
    // 空图 → compileNodeGraph 返回 errors（模拟缺 modId 的真实行为）
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: ['节点图缺少 modId，无法编译'],
    });

    render(<GeneratedCodePreview />);

    // 根节点 role=application + aria-label
    expect(screen.getByRole('application', { name: '生成代码预览' })).toBeTruthy();

    await flushDebounce();

    // 编译完成后应显示错误条 + 无生成文件
    expect(screen.getByRole('alert', { name: '编译错误' })).toBeTruthy();
    expect(screen.getByText('无生成文件')).toBeTruthy();
  });

  it('2. mock @mc-creator/core 的 FabricAdapter 返回固定 FileNode[]', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await flushDebounce();

    // FabricAdapter.translate 被调用一次
    expect(hoisted.fabricAdapterTranslateMock).toHaveBeenCalledTimes(1);
    // 工具栏显示 3 文件
    expect(screen.getByLabelText('生成文件数').textContent).toContain('3 文件');
  });

  it('3. mock @monaco-editor/react 用占位组件渲染', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await flushDebounce();

    // Monaco mock 占位组件出现（lazy import 已 resolve）
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeTruthy();
    // 默认选中第一个文件，语言为 java
    expect(editor.getAttribute('data-language')).toBe('java');
  });

  it('4. 文件列表显示所有生成文件并按分组组织', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await flushDebounce();

    const tree = screen.getByRole('tree', { name: '生成文件列表' });
    // 三个文件均出现
    expect(within(tree).getByText('DemoModMod.java')).toBeTruthy();
    expect(within(tree).getByText('fabric.mod.json')).toBeTruthy();
    expect(within(tree).getByText('build.gradle')).toBeTruthy();
    // 三个 treeitem
    expect(within(tree).getAllByRole('treeitem').length).toBe(3);
    // 按分组组织（Java 源码 / 资源与配置 / 构建脚本）
    expect(screen.getByRole('group', { name: 'Java 源码' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '资源与配置' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '构建脚本' })).toBeTruthy();
  });

  it('5. 点击文件项切换 Monaco 内容与语言', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await flushDebounce();

    // 默认选中第一个文件 DemoModMod.java
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('DemoModMod');
    expect(screen.getByTestId('monaco-editor').getAttribute('data-language')).toBe('java');

    // 点击 fabric.mod.json
    const tree = screen.getByRole('tree', { name: '生成文件列表' });
    fireEvent.click(within(tree).getByText('fabric.mod.json'));

    // Monaco 内容与语言更新
    expect((screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement).value).toContain(
      '"id": "demo_mod"',
    );
    expect(screen.getByTestId('monaco-editor').getAttribute('data-language')).toBe('json');

    // fabric.mod.json 项被选中（aria-selected=true），DemoModMod.java 不再选中
    const items = within(tree).getAllByRole('treeitem');
    const jsonItem = items.find((t) => t.textContent?.includes('fabric.mod.json'));
    const javaItem = items.find((t) => t.textContent?.includes('DemoModMod.java'));
    expect(jsonItem?.getAttribute('aria-selected')).toBe('true');
    expect(javaItem?.getAttribute('aria-selected')).toBe('false');
  });

  it('6. 编译错误时显示错误条 role=alert（前 3 条 + 剩余计数）', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [
        '错误1：缺少 modId',
        '错误2：物品 id 无效',
        '错误3：方块 id 无效',
        '错误4：多余错误',
      ],
    });
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await flushDebounce();

    const alert = screen.getByRole('alert', { name: '编译错误' });
    expect(alert).toBeTruthy();
    // 前 3 条显示
    expect(alert.textContent).toContain('错误1');
    expect(alert.textContent).toContain('错误2');
    expect(alert.textContent).toContain('错误3');
    // 第 4 条不直接显示，但有剩余计数
    expect(alert.textContent).not.toContain('错误4：多余错误');
    expect(alert.textContent).toContain('还有 1 个错误');
  });

  it('7. 编译状态徽章在通过/警告/错误三种状态下显示对应文案', async () => {
    // 7a. 全通过（无警告、无错误、有文件）
    hoisted.compileNodeGraphMock.mockReturnValueOnce({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValueOnce(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });
    const { unmount: unmount1 } = render(<GeneratedCodePreview />);
    await flushDebounce();
    expect(screen.getByRole('status', { name: '编译通过，生成 3 个文件' })).toBeTruthy();
    unmount1();

    // 7b. 警告（有警告、无错误）
    hoisted.compileNodeGraphMock.mockReturnValueOnce({
      spec: DEMO_SPEC,
      warnings: ['警告1：物品缺少纹理'],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValueOnce(DEMO_FILES);
    const { unmount: unmount2 } = render(<GeneratedCodePreview />);
    await flushDebounce();
    expect(screen.getByRole('status', { name: '编译通过，但有 1 个警告' })).toBeTruthy();
    unmount2();

    // 7c. 错误（有错误，FabricAdapter 不应被调用）
    // 清空调用历史：前面的 7a/7b 已调用过 FabricAdapter，这里要验证"本次未调用"
    hoisted.fabricAdapterTranslateMock.mockClear();
    hoisted.compileNodeGraphMock.mockReturnValueOnce({
      spec: DEMO_SPEC,
      warnings: [],
      errors: ['错误1：编译失败'],
    });
    const { unmount: unmount3 } = render(<GeneratedCodePreview />);
    await flushDebounce();
    expect(screen.getByRole('status', { name: '编译失败：1 个错误' })).toBeTruthy();
    // 出错时不应调用 FabricAdapter
    expect(hoisted.fabricAdapterTranslateMock).not.toHaveBeenCalled();
    unmount3();
  });

  it('8. 防抖延迟：graph 变化后 delay ms 内不编译，到点后才触发', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);

    // 立即检查：编译中状态，compileNodeGraph 尚未调用
    expect(screen.getByText('编译中...')).toBeTruthy();
    expect(hoisted.compileNodeGraphMock).not.toHaveBeenCalled();

    // 推进 499ms：仍未编译（防抖延迟未到）
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(hoisted.compileNodeGraphMock).not.toHaveBeenCalled();

    // 推进剩余 1ms（共 500ms）：编译触发
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(hoisted.compileNodeGraphMock).toHaveBeenCalledTimes(1);
  });

  it('9. 编辑模式：readOnly=false 时默认可编辑并写回', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview readOnly={false} />);

    // 等待编译完成
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // readOnly=false 默认进入编辑态（按钮文本"✎ 编辑中"，aria-label 为切换到只读预览）
    const toggleBtn = screen.getByLabelText('切换到只读预览');
    expect(toggleBtn).toBeTruthy();

    // Monaco textarea 可编辑：输入触发 onChange → 写回 store
    const textarea = screen.getByLabelText('Monaco 编辑器内容');
    fireEvent.change(textarea, { target: { value: '// edited' } });
    // 编辑内容合并到展示（编辑中）
    const updated = useModStore.getState().files.find((f) => f.path === DEMO_FILES[0].path);
    expect(updated?.content).toBe('// edited');

    // 切回只读：按钮变为"切换到编辑模式"
    fireEvent.click(toggleBtn);
    expect(screen.getByLabelText('切换到编辑模式')).toBeTruthy();
  });

  it('10. 只读模式（默认）：无编辑切换按钮', async () => {
    hoisted.compileNodeGraphMock.mockReturnValue({
      spec: DEMO_SPEC,
      warnings: [],
      errors: [],
    });
    hoisted.fabricAdapterTranslateMock.mockReturnValue(DEMO_FILES);
    useNodeGraphStore.setState({ graph: SIMPLE_GRAPH });

    render(<GeneratedCodePreview />);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByLabelText('切换到编辑模式')).toBeNull();
  });
});
