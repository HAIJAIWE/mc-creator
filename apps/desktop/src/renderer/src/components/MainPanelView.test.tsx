// @vitest-environment jsdom
/**
 * `explorer` 面板语义测试 —— 锁住「文件树不显示文件内容」这条 IDE 约定
 *
 * ## 为什么这条需要测试
 *
 * `explorer` 曾是全仓唯一**同一面板三份语义**的地方：
 *
 * | 位置 | 渲染什么 |
 * | --- | --- |
 * | `App.tsx` 左栏固定 | `FileTree`（文件树） |
 * | `MainPanelView` 的 `case 'explorer'` | `CodePreview`（文件**内容**） |
 * | 注册表 `explorer` loader | `FileTree`（文件树） |
 *
 * 中间那份与另外两份语义相反，且违反 VS Code / IntelliJ 的通行规则：
 * 文件树是 **View**，内容是 **Editor**，点文件应把内容送到编辑器区的 tab，
 * 而不是在树的位置展开内容。VS Code 官方表述是
 * 「explorer on the left, showing all of the files and folders …,
 *   and an editor on the right, showing the content of the files you have opened」。
 *
 * 这类分歧不会自己暴露：两份实现都能编译、都能渲染、都不报错，
 * 只有把三处放在一起看才发现它们在说不同的事。所以必须有断言。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// 用代理组件冒充真实的 FileTree / CodePreview：断言的是「渲染了哪一个」，
// 而不是它们内部长什么样 —— 后者由各自组件自己的测试负责。
const fileTreeSpy = vi.fn(() => <div data-testid="panel-FileTree">文件树</div>);
const codePreviewSpy = vi.fn(() => <div data-testid="panel-CodePreview">文件内容</div>);

// MainPanelView 现在走 PanelHost 从注册表渲染，需在测试中注册 explorer 面板
vi.mock('./FileTree.js', () => ({ FileTree: () => fileTreeSpy() }));
vi.mock('./CodePreview.js', () => ({ CodePreview: () => codePreviewSpy() }));

// 注册表相关 mock：PanelHost 读取 panelRegistry
const mockExplorerRegistration = {
  id: 'explorer',
  title: 'activityBar.explorer',
  icon: <span />,
  component: () => Promise.resolve({ default: () => fileTreeSpy() }),
  kind: 'core' as const,
  domain: null,
  order: 10,
};

vi.mock('../shell/panels.js', async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    getPanel: vi.fn((id: string) => {
      if (id === 'explorer') return mockExplorerRegistration;
      return undefined;
    }),
    getAllPanels: vi.fn(() => [mockExplorerRegistration]),
    getShellPanels: vi.fn(() => [mockExplorerRegistration]),
  };
});

const state = {
  currentProjectId: 'proj-1' as string | null,
  selectedFile: 'src/main/java/com/example/Demo.java' as string | null,
  files: [
    { path: 'src/main/java/com/example/Demo.java', content: 'class Demo {}' },
    { path: 'data/test.nbt', content: 'hello nbt' },
    { path: 'textures/icon.png', content: '' },
  ] as { path: string; content: string }[],
  updateFileContent: vi.fn<(path: string, content: string) => void>((path, content) => {
    const f = state.files.find((x) => x.path === path);
    if (f) f.content = content;
  }),
  domain: 'dev' as string,
};

vi.mock('../store/project-store.js', () => ({
  useProjectStore: (sel: (s: { currentProjectId: string | null }) => unknown) =>
    sel({ currentProjectId: state.currentProjectId }),
}));

vi.mock('../store/mod-store.js', () => ({
  useModStore: (
    sel: (s: {
      selectedFile: string | null;
      files: { path: string; content: string }[];
      updateFileContent: (path: string, content: string) => void;
    }) => unknown,
  ) =>
    sel({
      selectedFile: state.selectedFile,
      files: state.files,
      updateFileContent: state.updateFileContent,
    }),
}));

vi.mock('../shell/workbench-store.js', () => ({
  useWorkbenchStore: (sel: (s: { domain: string }) => unknown) => sel({ domain: state.domain }),
  // MainPanelView 直接 import 这个选择器（不是走 useWorkbenchStore(sel)），故需一并提供
  selectDomain: (s: { domain: string }) => s.domain,
}));

// 其余面板在 explorer 用例里不该被加载，但 MainPanelView 顶层有它们的 lazy 声明，
// 这里只提供同名导出占位，避免 dynamic import 真的去拉模块。
vi.mock('./SearchPanel.js', () => ({ SearchPanel: () => null }));
vi.mock('./GitPanel.js', () => ({ GitPanel: () => null }));
vi.mock('./PackagesPanel.js', () => ({ PackagesPanel: () => null }));
vi.mock('./SettingsPanel.js', () => ({ SettingsPanel: () => null }));

import { MainPanelView } from './MainPanelView.js';

beforeEach(() => {
  state.currentProjectId = 'proj-1';
  state.selectedFile = 'src/main/java/com/example/Demo.java';
  state.domain = 'dev';
  fileTreeSpy.mockClear();
  codePreviewSpy.mockClear();
});

afterEach(cleanup);

describe('MainPanelView · explorer 语义', () => {
  it('explorer 渲染文件树，不是文件内容', async () => {
    render(<MainPanelView activePanel="explorer" />);

    expect(await screen.findByTestId('panel-FileTree')).toBeTruthy();
    expect(screen.queryByTestId('panel-CodePreview')).toBeNull();
    expect(fileTreeSpy).toHaveBeenCalled();
    expect(codePreviewSpy).not.toHaveBeenCalled();
  });

  it('有选中文件时也不切到内容视图 —— 这正是原缺陷的触发条件', async () => {
    // 旧实现：有 selectedFile → 渲染 CodeEditor（即 CodePreview）。
    // 规则是「文件树在任何情况下都不显示文件内容」，选中与否不改变这一点。
    expect(state.selectedFile).not.toBeNull();
    render(<MainPanelView activePanel="explorer" />);

    expect(await screen.findByTestId('panel-FileTree')).toBeTruthy();
    expect(codePreviewSpy).not.toHaveBeenCalled();
  });

  it('无选中文件时同样渲染文件树（不再显示「选择文件以查看内容」空态）', async () => {
    state.selectedFile = null;
    render(<MainPanelView activePanel="explorer" />);

    expect(await screen.findByTestId('panel-FileTree')).toBeTruthy();
    expect(screen.queryByText('选择文件以查看内容')).toBeNull();
  });
});

// NbtEditor 用 spy 替换：只关心「有没有被传 initialValue / onChange」
const nbtEditorSpy = vi.fn(
  ({ initialValue, onChange }: { initialValue: string; onChange?: (v: string) => void }) => (
    <div data-testid="nbt-editor" data-initial-value={initialValue}>
      <button onClick={() => onChange?.('{ edited: true }')}>edit</button>
    </div>
  ),
);
vi.mock('./NbtEditor.js', () => ({
  NbtEditor: (p: unknown) =>
    nbtEditorSpy(p as { initialValue: string; onChange?: (v: string) => void }),
}));

describe('MainPanelView · nbt 面板不再是空壳', () => {
  it('有选中文件时把其内容作为 initialValue 传入（不是默认空 compound）', async () => {
    state.selectedFile = 'data/test.nbt';
    // mod-store 的 files 通过 useModStore 的第二个 selector 读取 —— 需要 mock
    render(<MainPanelView activePanel="nbt" />);

    const el = await screen.findByTestId('nbt-editor');
    expect(el.getAttribute('data-initial-value')).toBe('hello nbt');
  });

  it('.png 文件兜底为空对象', async () => {
    state.selectedFile = 'textures/icon.png';
    render(<MainPanelView activePanel="nbt" />);

    const el = await screen.findByTestId('nbt-editor');
    expect(el.getAttribute('data-initial-value')).toBe('{}');
  });

  it('无选中文件时不崩且兜底为空对象', async () => {
    state.selectedFile = null;
    render(<MainPanelView activePanel="nbt" />);

    const el = await screen.findByTestId('nbt-editor');
    expect(el.getAttribute('data-initial-value')).toBe('{}');
  });

  it('编辑后写回 store（updateFileContent 被调用）', async () => {
    state.selectedFile = 'data/test.nbt';
    state.updateFileContent.mockClear();
    render(<MainPanelView activePanel="nbt" />);

    const el = await screen.findByTestId('nbt-editor');
    fireEvent.click(within(el).getByText('edit'));

    expect(state.updateFileContent).toHaveBeenCalledWith('data/test.nbt', '{ edited: true }');
  });
});
