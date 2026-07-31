// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MiddlePanel } from './MiddlePanel.js';
import { useModStore } from '../../store/mod-store.js';
import { useSpecHistoryStore } from '../../store/spec-history-store.js';
import { useEditorModeStore } from '../../store/editor-mode-store.js';

/**
 * MiddlePanel 测试：覆盖 tab 切换、命令面板、键盘快捷键、L3 模式分支。
 *
 * 默认 generatorType=mod + spec=null，ModPreviewPanel 渲染 EmptyState，
 * 不会触发复杂数据流，便于隔离测试调度器行为。
 *
 * 当 editor mode 切到 purecode 时，「低代码」tab 内容分支会渲染 PurecodeWorkspace，
 * 内部使用 @monaco-editor/react —— jsdom 无法加载真实 monaco，故 mock 为简单 div。
 */
vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  const MockEditor = (props: {
    value?: string;
    onChange?: (value: string | undefined) => void;
    language?: string;
  }) => {
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
      }),
    );
  };
  return { default: MockEditor };
});

let mcApiMock: Record<string, ReturnType<typeof vi.fn>>;

beforeEach(() => {
  // 重置 store
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: null,
    files: [],
    previousFiles: [],
    selectedFile: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
  });
  useSpecHistoryStore.setState({ versions: [], currentIndex: -1 });
  // 重置编辑模式到默认 lowcode（避免上一个测试切到 purecode 后影响后续测试）
  useEditorModeStore.setState({ mode: 'lowcode', lastSwitchAt: Date.now() });

  // mock window.mcApi（MiddlePanel 的 Ctrl+S 会调 saveFile）
  mcApiMock = {
    saveFile: vi.fn().mockResolvedValue({ ok: true }),
    saveAllFiles: vi.fn().mockResolvedValue({ ok: true }),
    exportZip: vi.fn().mockResolvedValue({ ok: true }),
  };
  (window as unknown as { mcApi: Record<string, ReturnType<typeof vi.fn>> }).mcApi = mcApiMock;

  // jsdom polyfill
  if (!Element.prototype.scrollIntoView) {
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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MiddlePanel', () => {
  it('渲染冒烟：包含 5 个 tab 按钮（预览/低代码/资源/NBT/代码）', () => {
    render(<MiddlePanel />);
    expect(screen.getByRole('tab', { name: /预览/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /低代码/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /资源/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /NBT/ })).toBeTruthy();
    // 「代码」tab 的 accessible name 含图标 alt（如 "terminal 代码"），
    // 用 / 代码$/ 区分「低代码」（accessible name 为 "grid 低代码"）
    expect(screen.getByRole('tab', { name: / 代码$/ })).toBeTruthy();
  });

  it('默认选中预览 tab', () => {
    render(<MiddlePanel />);
    expect(screen.getByRole('tab', { name: /预览/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('tablist 支持左右箭头键切换', () => {
    render(<MiddlePanel />);
    // 在 tablist 上按 ArrowRight 应切换到低代码 tab（位于预览之后）
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    const lowcodeTab = screen.getByRole('tab', { name: /低代码/ });
    expect(lowcodeTab.getAttribute('aria-selected')).toBe('true');
  });

  it('点击资源 tab 切换到资源视图', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /资源/ }));
    expect(screen.getByRole('tab', { name: /资源/ }).getAttribute('aria-selected')).toBe('true');
    // 资源视图渲染 ResourcePackPreview（包含拖放区域等子组件，不深入断言）
    // 切换后预览 tab 不再激活
    expect(screen.getByRole('tab', { name: /预览/ }).getAttribute('aria-selected')).toBe('false');
  });

  it('点击代码 tab 切换到代码视图', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByRole('tab', { name: / 代码$/ }));
    expect(screen.getByRole('tab', { name: / 代码$/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('点击 NBT tab 切换到 NBT 视图', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /NBT/ }));
    expect(screen.getByRole('tab', { name: /NBT/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('默认预览 tab 渲染 EmptyState（spec=null 时 ModPreviewPanel 兜底）', () => {
    render(<MiddlePanel />);
    // generatorType=mod 时 renderPreviewPanel 返回 <ModPreviewPanel />，
    // spec=null 时 ModPreviewPanel 渲染 EmptyState 标题
    expect(screen.getByText('尚未生成 Mod Spec')).toBeTruthy();
  });

  it('渲染命令面板入口按钮（含 F1 提示）', () => {
    render(<MiddlePanel />);
    // 用 title 精确定位 MiddlePanel 顶部命令面板入口按钮
    // （EmptyState 也有「打开命令面板」按钮但无 title 属性）
    const paletteBtn = screen.getByTitle('打开命令面板（F1）');
    expect(paletteBtn).toBeTruthy();
    // 内部含 F1 标识
    expect(paletteBtn.textContent).toContain('F1');
  });

  it('点击命令面板入口按钮打开命令面板', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByTitle('打开命令面板（F1）'));
    // 命令面板打开后渲染命令列表
    expect(screen.getByText('保存当前文件')).toBeTruthy();
  });

  it('F1 键打开命令面板', () => {
    render(<MiddlePanel />);
    fireEvent.keyDown(window, { key: 'F1' });
    expect(screen.getByText('保存当前文件')).toBeTruthy();
  });

  it('Ctrl+Shift+P 键打开命令面板', () => {
    render(<MiddlePanel />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: true });
    expect(screen.getByText('保存当前文件')).toBeTruthy();
  });

  it('Ctrl+P 键打开命令面板（Quick Open 等价）', () => {
    render(<MiddlePanel />);
    fireEvent.keyDown(window, { key: 'P', ctrlKey: true, shiftKey: false });
    expect(screen.getByText('保存当前文件')).toBeTruthy();
  });

  it('命令面板包含核心命令：保存/导出/新建/清空/切换 tab', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByTitle('打开命令面板（F1）'));
    expect(screen.getByText('保存当前文件')).toBeTruthy();
    expect(screen.getByText('保存全部文件到目录')).toBeTruthy();
    expect(screen.getByText('导出为 ZIP')).toBeTruthy();
    expect(screen.getByText('新建文件')).toBeTruthy();
    expect(screen.getByText('清空所有文件')).toBeTruthy();
    expect(screen.getByText('切换到预览视图')).toBeTruthy();
    expect(screen.getByText('切换到低代码视图')).toBeTruthy();
    expect(screen.getByText('切换到代码视图')).toBeTruthy();
    expect(screen.getByText('切换到资源视图')).toBeTruthy();
    expect(screen.getByText('切换到 NBT 编辑器')).toBeTruthy();
    expect(screen.getByText('快捷键帮助')).toBeTruthy();
  });

  it('命令面板执行「切换到资源视图」切到资源 tab', () => {
    render(<MiddlePanel />);
    fireEvent.click(screen.getByTitle('打开命令面板（F1）'));
    // 点击「切换到资源视图」命令
    fireEvent.click(screen.getByText('切换到资源视图'));
    // 命令面板关闭后，资源 tab 应被激活
    expect(screen.getByRole('tab', { name: /资源/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('ESC 关闭命令面板', () => {
    render(<MiddlePanel />);
    // 打开命令面板
    fireEvent.click(screen.getByTitle('打开命令面板（F1）'));
    expect(screen.getByText('保存当前文件')).toBeTruthy();
    // ESC 关闭（CommandPalette 的 ESC 监听在 input 上，不是 window）
    const input = screen.getByPlaceholderText('输入命令名或 / 触发 MC 命令补全…');
    fireEvent.keyDown(input, { key: 'Escape' });
    // 命令面板关闭后「保存当前文件」不再可见
    expect(screen.queryByText('保存当前文件')).toBeNull();
  });

  it('Ctrl+S 触发保存当前文件 IPC 调用（无选中文件时不调用）', () => {
    render(<MiddlePanel />);
    // 无选中文件 → 不调用 saveFile
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true });
    expect(mcApiMock.saveFile).not.toHaveBeenCalled();
  });

  it('Ctrl+S 有选中文件时调用 saveFile', () => {
    useModStore.setState({
      selectedFile: 'test.txt',
      files: [{ path: 'test.txt', content: 'hello' }],
    });
    render(<MiddlePanel />);
    fireEvent.keyDown(window, { key: 'S', ctrlKey: true });
    expect(mcApiMock.saveFile).toHaveBeenCalledWith({
      path: 'test.txt',
      content: 'hello',
      defaultName: 'test.txt',
    });
  });

  // === L3 纯代码模式分支测试 ===
  it('lowcode/hybrid 模式下「低代码」tab 渲染 LowcodeWorkspace', () => {
    useEditorModeStore.setState({ mode: 'lowcode', lastSwitchAt: Date.now() });
    render(<MiddlePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /低代码/ }));
    // LowcodeWorkspace 顶层 role=application + aria-label "低代码工作区"
    expect(screen.getByRole('application', { name: /低代码工作区/ })).toBeTruthy();
  });

  it('purecode 模式下「低代码」tab 渲染 PurecodeWorkspace 而非 LowcodeWorkspace', () => {
    useEditorModeStore.setState({ mode: 'purecode', lastSwitchAt: Date.now() });
    render(<MiddlePanel />);
    fireEvent.click(screen.getByRole('tab', { name: /低代码/ }));
    // PurecodeWorkspace 顶层 role=application + aria-label "纯代码工作区"
    expect(screen.getByRole('application', { name: /纯代码工作区/ })).toBeTruthy();
    // LowcodeWorkspace 的 aria-label 不应出现
    expect(screen.queryByRole('application', { name: /低代码工作区/ })).toBeNull();
    // PurecodeWorkspace 文件树也应可见
    expect(screen.getByRole('tree', { name: /项目文件树/ })).toBeTruthy();
  });
});
