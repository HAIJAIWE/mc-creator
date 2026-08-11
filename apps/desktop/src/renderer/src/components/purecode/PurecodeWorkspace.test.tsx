// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react';

vi.mock('../../lib/ipc-client.js', () => ({
  ipcClient: {
    saveFile: vi.fn(),
  },
}));

import { ToastProvider } from '../ToastProvider.js';
import { ipcClient } from '../../lib/ipc-client.js';

const mockSaveFile = ipcClient.saveFile as ReturnType<typeof vi.fn>;

/** 包 ToastProvider 渲染（保存成功/失败提示依赖 useToast context） */
function renderPurecode(ui: React.ReactElement) {
  return render(ui, { wrapper: ToastProvider });
}

/**
 * mock @monaco-editor/react：避免在 jsdom 中尝试通过 CDN/worker 加载真实 monaco。
 *
 * 工厂内动态 import('react') 以避开 vi.mock 提升（hoisting）导致的循环依赖问题。
 * mock 后的 Editor 渲染一个带 textarea 的容器，便于断言 value/onChange/language。
 */
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
      }),
    );
  };
  return { default: MockEditor };
});

import { PurecodeWorkspace } from './PurecodeWorkspace.js';

/**
 * PurecodeWorkspace 测试：覆盖文件树/工具栏/Monaco 容器渲染与文件切换交互。
 *
 * Monaco 已 mock 为带 textarea 的 div，因此可以断言 value/onChange。
 */
beforeEach(() => {
  // jsdom polyfill
  if (Element.prototype.scrollIntoView === undefined) {
    Element.prototype.scrollIntoView = vi.fn();
  }
  // Monaco 编辑器依赖 ResizeObserver，jsdom 不提供，需手动 polyfill
  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  mockSaveFile.mockReset();
  mockSaveFile.mockResolvedValue({ ok: true, canceled: false, savedPath: 'D:/out/ModMain.java' });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PurecodeWorkspace', () => {
  it('渲染冒烟：包含 Monaco 编辑器容器', () => {
    renderPurecode(<PurecodeWorkspace />);
    // 顶层 role=application 标识
    expect(screen.getByRole('application', { name: /纯代码工作区/ })).toBeTruthy();
    // Monaco 容器 div
    expect(screen.getByTestId('purecode-monaco-container')).toBeTruthy();
    // mock 后的 Monaco 编辑器
    expect(screen.getByTestId('monaco-editor')).toBeTruthy();
  });

  it('渲染冒烟：包含文件树（11 个预设文件 + tree/treeitem role）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const tree = screen.getByRole('tree', { name: /项目文件树/ });
    expect(tree).toBeTruthy();
    // 预设文件全部显示在文件树中（用 within 限定查询范围，避免与下拉框 option 冲突）
    expect(within(tree).getByText('ModMain.java')).toBeTruthy();
    expect(within(tree).getByText('ModItems.java')).toBeTruthy();
    expect(within(tree).getByText('ModBlocks.java')).toBeTruthy();
    expect(within(tree).getByText('ModEvents.java')).toBeTruthy();
    expect(within(tree).getByText('ModRecipes.java')).toBeTruthy();
    expect(within(tree).getByText('fabric.mod.json')).toBeTruthy();
    expect(within(tree).getByText('modname.mixins.json')).toBeTruthy();
    expect(within(tree).getByText('en_us.json')).toBeTruthy();
    expect(within(tree).getByText('build.gradle')).toBeTruthy();
    expect(within(tree).getByText('gradle.properties')).toBeTruthy();
    expect(within(tree).getByText('settings.gradle')).toBeTruthy();
    // treeitem 数量 = 11
    expect(within(tree).getAllByRole('treeitem').length).toBe(11);
  });

  it('渲染冒烟：包含文件选择下拉框（11 个 option）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(11);
  });

  it('顶部工具栏包含「保存」按钮', () => {
    renderPurecode(<PurecodeWorkspace />);
    const btn = screen.getByRole('button', { name: /保存当前文件/ });
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('保存');
  });

  it('顶部工具栏显示当前语言标识（默认 java）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const langBadge = screen.getByLabelText('当前编辑器语言');
    expect(langBadge.textContent).toBe('java');
  });

  it('默认显示 ModMain.java 内容（包含 MOD_ID / onInitialize）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('ModMain');
    expect(textarea.value).toContain('onInitialize');
    expect(textarea.value).toContain('examplemod');
  });

  it('通过下拉框切换到 fabric.mod.json 时编辑器内容更新（语言→json）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    // 切换到 fabric.mod.json
    fireEvent.change(select, {
      target: { value: 'src/main/resources/fabric.mod.json' },
    });
    expect(select.value).toBe('src/main/resources/fabric.mod.json');
    // Monaco mock 的 textarea 反映新文件内容
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('examplemod');
    expect(textarea.value).toContain('entrypoints');
    // 语言标识更新为 json
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('json');
    // Monaco 编辑器 data-language 也更新
    expect(screen.getByTestId('monaco-editor').getAttribute('data-language')).toBe('json');
  });

  it('通过下拉框切换到 build.gradle 时语言→groovy', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'build.gradle' } });
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('groovy');
  });

  it('切换到 ModBlocks.java 时显示方块注册内容（EXAMPLE_BLOCK / BlockItem）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    fireEvent.change(select, {
      target: { value: 'src/main/java/com/example/mod/ModBlocks.java' },
    });
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('EXAMPLE_BLOCK');
    expect(textarea.value).toContain('BlockItem');
    expect(textarea.value).toContain('Registries.BLOCK');
    // 语言仍为 java
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('java');
  });

  it('切换到 ModEvents.java 时显示事件监听内容（ServerTickEvents）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    fireEvent.change(select, {
      target: { value: 'src/main/java/com/example/mod/ModEvents.java' },
    });
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('ServerTickEvents');
    expect(textarea.value).toContain('END_SERVER_TICK');
    expect(textarea.value).toContain('LoggerFactory');
  });

  it('切换到 gradle.properties 时语言→properties 且显示版本属性', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'gradle.properties' } });
    // 语言标识更新为 properties
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('properties');
    // Monaco 编辑器 data-language 也更新
    expect(screen.getByTestId('monaco-editor').getAttribute('data-language')).toBe('properties');
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain('mod_version=1.0.0');
    expect(textarea.value).toContain('minecraft_version=1.21.1');
    expect(textarea.value).toContain('loader_version');
  });

  it('切换到 settings.gradle 时显示 rootProject.name（groovy）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'settings.gradle' } });
    expect(screen.getByLabelText('当前编辑器语言').textContent).toBe('groovy');
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    expect(textarea.value).toContain("rootProject.name = 'examplemod'");
    expect(textarea.value).toContain('pluginManagement');
  });

  it('点击文件树 treeitem 切换文件并更新 aria-selected', () => {
    renderPurecode(<PurecodeWorkspace />);
    const tree = screen.getByRole('tree', { name: /项目文件树/ });
    const treeitems = within(tree).getAllByRole('treeitem');
    expect(treeitems.length).toBe(11);
    // 默认 ModMain.java 被选中
    const mainItem = treeitems.find((t) => t.textContent?.includes('ModMain.java'));
    expect(mainItem?.getAttribute('aria-selected')).toBe('true');
    // 点击 fabric.mod.json（在文件树范围内查找，避免命中下拉框 option）
    fireEvent.click(within(tree).getByText('fabric.mod.json'));
    const jsonItem = within(tree)
      .getAllByRole('treeitem')
      .find((t) => t.textContent?.includes('fabric.mod.json'));
    expect(jsonItem?.getAttribute('aria-selected')).toBe('true');
    // ModMain.java 不再选中
    const mainItemAfter = within(tree)
      .getAllByRole('treeitem')
      .find((t) => t.textContent?.includes('ModMain.java'));
    expect(mainItemAfter?.getAttribute('aria-selected')).toBe('false');
  });

  it('点击保存按钮经 IPC 保存当前文件到磁盘，并提示已保存', async () => {
    renderPurecode(<PurecodeWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: /保存当前文件/ }));
    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledWith({
        path: 'src/main/java/com/example/mod/ModMain.java',
        content: expect.stringContaining('ModMain'),
        defaultName: 'ModMain.java',
      });
    });
    expect(await screen.findByText(/已保存：ModMain.java/)).toBeTruthy();
  });

  it('保存使用编辑器内最新内容（含未落盘修改），并同步回项目 store', async () => {
    renderPurecode(<PurecodeWorkspace />);
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '// SAVED_NOW' } });
    fireEvent.click(screen.getByRole('button', { name: /保存当前文件/ }));
    await waitFor(() => {
      expect(mockSaveFile).toHaveBeenCalledWith(
        expect.objectContaining({ content: '// SAVED_NOW', defaultName: 'ModMain.java' }),
      );
    });
  });

  it('保存失败时提示错误；用户取消时不提示', async () => {
    mockSaveFile.mockResolvedValue({ ok: false, canceled: false, savedPath: null });
    const view = renderPurecode(<PurecodeWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: /保存当前文件/ }));
    expect(await screen.findByText('保存失败')).toBeTruthy();
    view.unmount();
    // 取消不弹任何提示
    mockSaveFile.mockResolvedValue({ ok: false, canceled: true, savedPath: null });
    renderPurecode(<PurecodeWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: /保存当前文件/ }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('保存失败')).toBeNull();
    expect(screen.queryByText(/已保存/)).toBeNull();
  });

  it('Monaco 编辑器内容变化时更新内部状态（textarea 反映新值）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '// modified by test' } });
    expect(textarea.value).toBe('// modified by test');
  });

  it('切换文件后再切回原文件，编辑器内容仍保留（不丢失修改）', () => {
    renderPurecode(<PurecodeWorkspace />);
    const textarea = screen.getByLabelText('Monaco 编辑器内容') as HTMLTextAreaElement;
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    // 修改 ModMain.java 内容
    fireEvent.change(textarea, { target: { value: '// MODIFIED_MAIN' } });
    // 切换到 ModItems.java
    fireEvent.change(select, {
      target: { value: 'src/main/java/com/example/mod/ModItems.java' },
    });
    expect(textarea.value).toContain('EXAMPLE_ITEM');
    // 切回 ModMain.java，修改应保留
    fireEvent.change(select, {
      target: { value: 'src/main/java/com/example/mod/ModMain.java' },
    });
    expect(textarea.value).toBe('// MODIFIED_MAIN');
  });

  it('只读模式下保存按钮禁用且文件下拉禁用', () => {
    renderPurecode(<PurecodeWorkspace readOnly />);
    const saveBtn = screen.getByRole('button', { name: /保存当前文件/ });
    expect(saveBtn.hasAttribute('disabled')).toBe(true);
    const select = screen.getByRole('combobox', {
      name: /选择当前编辑的文件/,
    }) as HTMLSelectElement;
    expect(select.hasAttribute('disabled')).toBe(true);
  });

  it('文件树按分组组织（Java 源码 / 资源与配置 / 构建脚本）', () => {
    renderPurecode(<PurecodeWorkspace />);
    expect(screen.getByRole('group', { name: 'Java 源码' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '资源与配置' })).toBeTruthy();
    expect(screen.getByRole('group', { name: '构建脚本' })).toBeTruthy();
  });
});
