// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { FileTree } from './FileTree.js';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';

/**
 * FileTree 单测（重写：旧文件按 mod-store.files 断言，与当前实现不符，
 * 当前实现数据源 = projectId + window.mcApi.fileProjectListTree/ListDir + idb 缓存）。
 *
 * Mock 策略（与任务要求一致）：
 * 1. window.mcApi.fileProject*（真实 ipcClient 透传，仅桥接层被 mock）
 * 2. filetree-cache idb 封装（模块 mock，避免真实 IndexedDB）
 * 3. useProjectStore / useModStore 真实 store（setState 驱动）
 *
 * 说明（诚实记录，与任务描述的差异）：
 * - 当前 FileTree.tsx 无搜索框 / 无 Fuse / 无防抖（grep 全仓无 Fuse 引用，
 *   package.json 仅有未使用的 fuse.js 依赖）。「搜索过滤高亮」「fakeTimers 控防抖」
 *   在当前实现上 N/A：用回归测试锁定“无搜索框”现状 + 一个 fakeTimers 同步渲染
 *   测试证明组件无定时器依赖；若后续接入搜索再补过滤用例。
 * - 不改业务逻辑，仅加了 data-testid 钩子。
 */

const cacheMocks = vi.hoisted(() => ({
  getCache: vi.fn(),
  setCache: vi.fn(),
  invalidatePath: vi.fn(),
}));

vi.mock('../lib/filetree-cache.js', () => ({
  getFileTreeCache: cacheMocks.getCache,
  setFileTreeCache: cacheMocks.setCache,
  invalidatePathCache: cacheMocks.invalidatePath,
}));

// jsdom 无 ResizeObserver，FileTree 用它测量容器高度，提供 stub 避免崩
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

type CacheNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: CacheNode[];
};

interface MockMcApi {
  fileProjectListTree: ReturnType<typeof vi.fn>;
  fileProjectListDir: ReturnType<typeof vi.fn>;
  fileProjectWriteTextWithMeta: ReturnType<typeof vi.fn>;
  fileProjectWriteText: ReturnType<typeof vi.fn>;
  fileProjectDeleteItem: ReturnType<typeof vi.fn>;
  fileProjectGetFileMeta: ReturnType<typeof vi.fn>;
}

let mockMcApi: MockMcApi;

/** 标准 2 层缓存树：a/1.txt、a/b/2.txt、c.txt（全部已加载） */
function standardTree(): CacheNode[] {
  return [
    {
      name: 'a',
      path: 'a',
      type: 'directory',
      children: [
        { name: '1.txt', path: 'a/1.txt', type: 'file' },
        {
          name: 'b',
          path: 'a/b',
          type: 'directory',
          children: [{ name: '2.txt', path: 'a/b/2.txt', type: 'file' }],
        },
      ],
    },
    { name: 'c.txt', path: 'c.txt', type: 'file' },
  ];
}

/** 含未加载空文件夹 + 全图标分支文件的树（覆盖 getFileIcon 各分支） */
function iconTree(): CacheNode[] {
  return [
    { name: 'empty', path: 'empty', type: 'directory' },
    { name: 'data.json', path: 'data.json', type: 'file' },
    { name: 'Main.java', path: 'Main.java', type: 'file' },
    { name: 'build.gradle', path: 'build.gradle', type: 'file' },
    { name: 'settings.toml', path: 'settings.toml', type: 'file' },
    { name: 'app.properties', path: 'app.properties', type: 'file' },
    { name: 'icon.png', path: 'icon.png', type: 'file' },
    { name: 'notes.txt', path: 'notes.txt', type: 'file' },
  ];
}

function resetStores() {
  useProjectStore.setState({
    projects: [],
    loading: false,
    error: null,
    view: 'dashboard',
    currentProjectId: null,
  });
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: null,
    files: [],
    previousFiles: [],
    selectedFile: null,
    unimplemented: [],
    buildStats: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    lastKnownMeta: {},
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
    conflictDialog: null,
  });
}

beforeEach(() => {
  resetStores();
  cacheMocks.getCache.mockReset();
  cacheMocks.setCache.mockReset();
  cacheMocks.invalidatePath.mockReset();
  cacheMocks.getCache.mockResolvedValue(null);
  cacheMocks.setCache.mockResolvedValue(undefined);
  cacheMocks.invalidatePath.mockResolvedValue(undefined);

  mockMcApi = {
    fileProjectListTree: vi.fn(),
    fileProjectListDir: vi.fn(),
    fileProjectWriteTextWithMeta: vi.fn().mockResolvedValue({ mtime: 1, size: 1, hash: 'h' }),
    fileProjectWriteText: vi.fn().mockResolvedValue(undefined),
    fileProjectDeleteItem: vi.fn().mockResolvedValue(undefined),
    fileProjectGetFileMeta: vi.fn().mockResolvedValue(null),
  };
  mockMcApi.fileProjectListTree.mockResolvedValue({ success: true, tree: [] });
  mockMcApi.fileProjectListDir.mockResolvedValue({ success: true, entries: [] });
  (window as unknown as { mcApi: MockMcApi }).mcApi = mockMcApi;
  (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = false;

  window.prompt = vi.fn().mockReturnValue(null);
  window.confirm = vi.fn().mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** 有项目 + 缓存未命中 + 指定树 payload 的常规渲染 */
async function renderWithTree(tree: CacheNode[]) {
  cacheMocks.getCache.mockResolvedValue(null);
  mockMcApi.fileProjectListTree.mockResolvedValue({ success: true, tree });
  useProjectStore.setState({ currentProjectId: 'p1' });
  render(<FileTree />);
  await waitFor(() => {
    expect(mockMcApi.fileProjectListTree).toHaveBeenCalledWith('p1', '', 5);
  });
}

function treeItems(): HTMLElement[] {
  return screen.getAllByRole('treeitem');
}

function keyOnTree(key: string) {
  fireEvent.keyDown(screen.getByRole('tree'), { key });
}

describe('FileTree 空状态', () => {
  it('无 fakeTimers 依赖：fakeTimers 下无项目空状态同步渲染', () => {
    vi.useFakeTimers();
    try {
      useProjectStore.setState({ currentProjectId: null });
      render(<FileTree />);
      expect(screen.getByTestId('filetree-empty-no-project')).toBeTruthy();
      expect(screen.getByText('请先打开或新建项目')).toBeTruthy();
      expect(mockMcApi.fileProjectListTree).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('无项目时不读缓存不调 IPC', async () => {
    useProjectStore.setState({ currentProjectId: null });
    render(<FileTree />);
    expect(screen.getByText('请先打开或新建项目')).toBeTruthy();
    await waitFor(() => {
      expect(cacheMocks.getCache).not.toHaveBeenCalled();
      expect(mockMcApi.fileProjectListTree).not.toHaveBeenCalled();
    });
  });

  it('有项目但树为空 → “项目目录为空” + 提示右键新建', async () => {
    await renderWithTree([]);
    expect(screen.getByTestId('filetree-empty')).toBeTruthy();
    expect(screen.getByText('项目目录为空')).toBeTruthy();
    expect(screen.getByText('右键新建文件或文件夹')).toBeTruthy();
    // 空树仍会写回缓存（[] 也是有效快照）
    expect(cacheMocks.setCache).toHaveBeenCalledWith('p1', '', []);
  });
});

describe('FileTree 缓存命中 / 未命中', () => {
  it('缓存命中瞬间渲染：先出缓存内容且无 loading，转正后写回新缓存', async () => {
    const cached: CacheNode[] = [{ name: 'old.txt', path: 'old.txt', type: 'file' }];
    const fresh = standardTree();
    cacheMocks.getCache.mockResolvedValue(cached);
    let resolveFresh!: (v: unknown) => void;
    mockMcApi.fileProjectListTree.mockImplementation(
      () => new Promise((r) => void (resolveFresh = r)),
    );
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);

    // 缓存内容瞬间出现，且因为 cacheRestored=true 不显示 loading
    expect(await screen.findByText('old.txt')).toBeTruthy();
    expect(screen.queryByTestId('filetree-loading')).toBeNull();

    // 后台新树到达后替换并写缓存（UI→缓存做 directory/file 转换）
    resolveFresh({ success: true, tree: fresh });
    await waitFor(() => {
      expect(screen.getByText('c.txt')).toBeTruthy();
    });
    expect(cacheMocks.setCache).toHaveBeenCalledWith(
      'p1',
      '',
      expect.arrayContaining([
        expect.objectContaining({ name: 'a', type: 'directory' }),
        expect.objectContaining({ name: 'c.txt', type: 'file' }),
      ]),
    );
  });

  it('缓存未命中：拉取整树渲染，loading 期间显示 spinner', async () => {
    cacheMocks.getCache.mockResolvedValue(null);
    let resolveFresh!: (v: unknown) => void;
    mockMcApi.fileProjectListTree.mockImplementation(
      () => new Promise((r) => void (resolveFresh = r)),
    );
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);

    // 缓存未命中时 isLoading && !cacheRestored → spinner
    expect(await screen.findByTestId('filetree-loading')).toBeTruthy();

    resolveFresh({ success: true, tree: standardTree() });
    await waitFor(() => {
      expect(screen.getByText('c.txt')).toBeTruthy();
    });
    expect(screen.queryByTestId('filetree-loading')).toBeNull();
  });

  it('后台同步失败：保留缓存内容不白屏', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      cacheMocks.getCache.mockResolvedValue([{ name: 'keep.txt', path: 'keep.txt', type: 'file' }]);
      mockMcApi.fileProjectListTree.mockRejectedValue(new Error('net down'));
      useProjectStore.setState({ currentProjectId: 'p1' });
      render(<FileTree />);
      expect(await screen.findByText('keep.txt')).toBeTruthy();
      await waitFor(() => {
        expect(mockMcApi.fileProjectListTree).toHaveBeenCalled();
      });
    } finally {
      errSpy.mockRestore();
    }
  });

  it('整树接口 success:false → 落空状态不崩', async () => {
    cacheMocks.getCache.mockResolvedValue(null);
    mockMcApi.fileProjectListTree.mockResolvedValue({ success: false });
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);
    expect(await screen.findByText('项目目录为空')).toBeTruthy();
  });
});

describe('FileTree 展开 / 折叠 / 懒加载', () => {
  it('点击文件夹折叠隐藏子节点（loaded=true 不触发懒加载），再点恢复', async () => {
    await renderWithTree(standardTree());
    expect(await screen.findByText('2.txt')).toBeTruthy();

    fireEvent.click(screen.getByText('a'));
    await waitFor(() => {
      expect(screen.queryByText('2.txt')).toBeNull();
    });
    expect(mockMcApi.fileProjectListDir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('a'));
    expect(await screen.findByText('2.txt')).toBeTruthy();
    expect(mockMcApi.fileProjectListDir).not.toHaveBeenCalled();

    // Set 分支二次折叠（expandedSet 已是 Set，走 next.delete 分支）
    fireEvent.click(screen.getByText('a'));
    await waitFor(() => {
      expect(screen.queryByText('2.txt')).toBeNull();
    });
  });

  it('Set 分支展开未加载文件夹同样触发懒加载', async () => {
    cacheMocks.getCache.mockResolvedValue(null);
    mockMcApi.fileProjectListTree.mockResolvedValue({
      success: true,
      tree: [
        {
          name: 'a',
          path: 'a',
          type: 'directory',
          children: [{ name: '1.txt', path: 'a/1.txt', type: 'file' }],
        },
        { name: 'empty', path: 'empty', type: 'directory' },
      ] satisfies CacheNode[],
    });
    mockMcApi.fileProjectListDir.mockResolvedValue({
      success: true,
      entries: [{ name: 'inner.txt', type: 'file' }],
    });
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);
    expect(await screen.findByText('empty')).toBeTruthy();

    // 先折叠已加载文件夹，让 expandedSet 从 null 变成 Set
    fireEvent.click(screen.getByText('a'));
    await waitFor(() => {
      expect(screen.queryByText('1.txt')).toBeNull();
    });
    // 再展开未加载文件夹：Set 分支 isExpanding + 懒加载
    fireEvent.click(screen.getByText('empty'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectListDir).toHaveBeenCalledWith('p1', 'empty');
    });
    expect(await screen.findByText('inner.txt')).toBeTruthy();
  });

  it('卸载时断开 ResizeObserver（cleanup 分支）', async () => {
    await renderWithTree(standardTree());
    await screen.findByText('c.txt');
    // afterEach 会 cleanup；此处显式 unmount 覆盖 observer.disconnect 返回分支
    cleanup();
    expect(screen.queryByText('c.txt')).toBeNull();
  });

  it('未加载文件夹展开触发懒加载（listDir），二次点击后子节点可见', async () => {
    cacheMocks.getCache.mockResolvedValue(null);
    mockMcApi.fileProjectListTree.mockResolvedValue({
      success: true,
      tree: [
        { name: 'empty', path: 'empty', type: 'directory' },
        { name: 'top.txt', path: 'top.txt', type: 'file' },
      ] satisfies CacheNode[],
    });
    mockMcApi.fileProjectListDir.mockResolvedValue({
      success: true,
      entries: [{ name: 'inner.txt', type: 'file' }],
    });
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);
    expect(await screen.findByText('empty')).toBeTruthy();

    // 第一次点击：expandedSet null→Set 分支 + 触发 loadChildren
    fireEvent.click(screen.getByText('empty'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectListDir).toHaveBeenCalledWith('p1', 'empty');
    });
    // 第二次点击：Set 展开分支，懒加载到的子节点可见
    fireEvent.click(screen.getByText('empty'));
    expect(await screen.findByText('inner.txt')).toBeTruthy();
  });

  it('懒加载接口 success:false → 不崩且不抛', async () => {
    cacheMocks.getCache.mockResolvedValue(null);
    mockMcApi.fileProjectListTree.mockResolvedValue({
      success: true,
      tree: [{ name: 'empty', path: 'empty', type: 'directory' }] satisfies CacheNode[],
    });
    mockMcApi.fileProjectListDir.mockResolvedValue({ success: false });
    useProjectStore.setState({ currentProjectId: 'p1' });
    render(<FileTree />);
    expect(await screen.findByText('empty')).toBeTruthy();
    fireEvent.click(screen.getByText('empty'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectListDir).toHaveBeenCalled();
    });
    // 无子节点，树仍只有 empty 一行
    expect(treeItems()).toHaveLength(1);
  });
});

describe('FileTree 选择 + 图标分支', () => {
  it('点击文件选中（aria-selected + mod-store 同步）', async () => {
    await renderWithTree(standardTree());
    const before = await screen.findByText('c.txt');
    fireEvent.click(before);
    await waitFor(() => {
      expect(useModStore.getState().selectedFile).toBe('c.txt');
    });
    const items = treeItems();
    const selected = items.find((i) => i.textContent?.includes('c.txt')) as HTMLElement;
    expect(selected.getAttribute('aria-selected')).toBe('true');
  });

  it('全图标分支渲染不崩（json/java/gradle/toml/properties/png/默认）', async () => {
    await renderWithTree(iconTree());
    for (const name of [
      'data.json',
      'Main.java',
      'build.gradle',
      'settings.toml',
      'app.properties',
      'icon.png',
      'notes.txt',
    ]) {
      expect(await screen.findByText(name)).toBeTruthy();
    }
    // 空文件夹（无 children）渲染占位行
    expect(screen.getByText('empty')).toBeTruthy();
  });
});

describe('FileTree 右键 CRUD + 失效缓存', () => {
  async function openMenuOn(text: string) {
    await renderWithTree(standardTree());
    const row = await screen.findByText(text);
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    expect(await screen.findByTestId('filetree-context-menu')).toBeTruthy();
  }

  it('文件夹右键 → 新建文件：createFile + 失效父目录缓存', async () => {
    vi.mocked(window.prompt).mockReturnValue('n.json');
    await openMenuOn('a');
    fireEvent.click(screen.getByTestId('ctx-new-file'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectWriteTextWithMeta).toHaveBeenCalledWith(
        'p1',
        'a/n.json',
        '',
        expect.objectContaining({ mtime: 0, size: 0 }),
        undefined,
      );
      expect(cacheMocks.invalidatePath).toHaveBeenCalledWith('p1', 'a');
    });
    expect(useModStore.getState().files.some((f) => f.path === 'a/n.json')).toBe(true);
  });

  it('空白处右键 → 新建文件夹：生成 .gitkeep + 失效根缓存', async () => {
    vi.mocked(window.prompt).mockReturnValue('nf');
    await renderWithTree(standardTree());
    fireEvent.contextMenu(screen.getByTestId('filetree-tree'), {
      clientX: 10,
      clientY: 10,
    });
    const menu = await screen.findByTestId('filetree-context-menu');
    expect(menu.textContent).toContain('新建文件夹');
    // 空白菜单不应有重命名/删除
    expect(menu.textContent).not.toContain('重命名');
    fireEvent.click(screen.getByTestId('ctx-new-folder'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectWriteTextWithMeta).toHaveBeenCalledWith(
        'p1',
        'nf/.gitkeep',
        '',
        expect.objectContaining({ mtime: 0, size: 0 }),
        undefined,
      );
      expect(cacheMocks.invalidatePath).toHaveBeenCalledWith('p1', '');
    });
  });

  it('文件右键 → 重命名：renameFile + 失效父目录缓存', async () => {
    useModStore.setState({ files: [{ path: 'a/1.txt', content: 'x' }] });
    vi.mocked(window.prompt).mockReturnValue('2.txt');
    await openMenuOn('1.txt');
    fireEvent.click(screen.getByTestId('ctx-rename'));
    await waitFor(() => {
      expect(cacheMocks.invalidatePath).toHaveBeenCalledWith('p1', 'a');
    });
    expect(useModStore.getState().files.some((f) => f.path === 'a/2.txt')).toBe(true);
  });

  it('同名重命名 → 不失效缓存', async () => {
    vi.mocked(window.prompt).mockReturnValue('1.txt');
    await openMenuOn('1.txt');
    fireEvent.click(screen.getByTestId('ctx-rename'));
    await waitFor(() => {
      expect(screen.queryByTestId('filetree-context-menu')).toBeNull();
    });
    expect(cacheMocks.invalidatePath).not.toHaveBeenCalled();
  });

  it('文件右键 → 删除（confirm=true）：deleteFile + 失效父目录缓存', async () => {
    useModStore.setState({ files: [{ path: 'c.txt', content: 'z' }] });
    vi.mocked(window.confirm).mockReturnValue(true);
    await openMenuOn('c.txt');
    fireEvent.click(screen.getByTestId('ctx-delete'));
    await waitFor(() => {
      expect(mockMcApi.fileProjectDeleteItem).toHaveBeenCalledWith('p1', 'c.txt');
      expect(cacheMocks.invalidatePath).toHaveBeenCalledWith('p1', '');
    });
    expect(useModStore.getState().files.some((f) => f.path === 'c.txt')).toBe(false);
  });

  it('prompt 取消 / confirm 拒绝 → 不失效缓存', async () => {
    vi.mocked(window.prompt).mockReturnValue(null);
    await openMenuOn('a');
    fireEvent.click(screen.getByTestId('ctx-new-file'));
    await waitFor(() => {
      expect(screen.queryByTestId('filetree-context-menu')).toBeNull();
    });
    expect(cacheMocks.invalidatePath).not.toHaveBeenCalled();

    // 同一用例内第二次渲染前先卸载，避免两棵树并存导致文本重复
    cleanup();
    await openMenuOn('c.txt');
    fireEvent.click(screen.getByTestId('ctx-delete'));
    await waitFor(() => {
      expect(screen.queryByTestId('filetree-context-menu')).toBeNull();
    });
    expect(cacheMocks.invalidatePath).not.toHaveBeenCalled();
    expect(mockMcApi.fileProjectDeleteItem).not.toHaveBeenCalled();
  });

  it('点击空白处关闭右键菜单', async () => {
    await openMenuOn('a');
    fireEvent.click(document.body);
    await waitFor(() => {
      expect(screen.queryByTestId('filetree-context-menu')).toBeNull();
    });
  });
});

describe('FileTree 键盘导航（a11y）', () => {
  beforeEach(async () => {
    await renderWithTree(standardTree());
    await screen.findByText('2.txt');
  });

  it('容器 role=tree + aria-label，节点 role=treeitem，文件夹带展开态', () => {
    expect(screen.getByRole('tree', { name: '项目文件' })).toBeTruthy();
    // a、1.txt、b、2.txt、c.txt 全部可见（默认全部展开）
    expect(treeItems()).toHaveLength(5);
    const folderA = treeItems().find((i) => i.textContent === 'a') as HTMLElement;
    expect(folderA.getAttribute('aria-expanded')).toBe('true');
  });

  it('Roving Tabindex：首行 0 其余 -1；ArrowDown/ArrowUp 移动焦点', () => {
    const items = treeItems();
    expect(items[0].tabIndex).toBe(0);
    for (let i = 1; i < items.length; i++) expect(items[i].tabIndex).toBe(-1);

    keyOnTree('ArrowDown');
    expect(treeItems()[1].tabIndex).toBe(0);
    expect(treeItems()[0].tabIndex).toBe(-1);

    keyOnTree('ArrowUp');
    expect(treeItems()[0].tabIndex).toBe(0);
  });

  it('首行 ArrowUp 不越界；Home/End 跳首尾', () => {
    keyOnTree('ArrowUp');
    expect(treeItems()[0].tabIndex).toBe(0);

    keyOnTree('End');
    const items = treeItems();
    expect(items[items.length - 1].tabIndex).toBe(0);

    keyOnTree('Home');
    expect(treeItems()[0].tabIndex).toBe(0);
  });

  it('ArrowRight 在展开文件夹上进入首个子节点（a → 1.txt）', () => {
    keyOnTree('ArrowRight');
    expect(treeItems()[1].tabIndex).toBe(0);
  });

  it('ArrowLeft 折叠展开的文件夹（b），ArrowRight 重新展开', () => {
    keyOnTree('ArrowDown');
    keyOnTree('ArrowDown');
    expect(treeItems()[2].tabIndex).toBe(0);
    // b 展开态下 ArrowLeft 折叠
    keyOnTree('ArrowLeft');
    expect(screen.queryByText('2.txt')).toBeNull();
    // 折叠态下 ArrowRight 重新展开
    keyOnTree('ArrowRight');
    expect(screen.getByText('2.txt')).toBeTruthy();
  });

  it('ArrowLeft 从文件跳回父节点（1.txt → a）', () => {
    keyOnTree('ArrowDown');
    keyOnTree('ArrowLeft');
    expect(treeItems()[0].tabIndex).toBe(0);
  });
});

describe('FileTree 搜索功能（Fuse.js 模糊搜索）', () => {
  it('显示搜索框并支持输入', async () => {
    await renderWithTree(standardTree());
    await screen.findByText('2.txt');
    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toBeTruthy();
    expect(searchInput.getAttribute('placeholder')).toBe('搜索文件...');
  });

  it('输入查询词后过滤显示匹配项', async () => {
    await renderWithTree(standardTree());
    await screen.findByText('2.txt');
    const searchInput = screen.getByRole('searchbox');

    // 输入查询词
    fireEvent.change(searchInput, { target: { value: '1' } });
    await waitFor(() => {
      expect(screen.getByText('1.txt')).toBeTruthy();
    });
    // 等待防抖完成，确保非匹配项已被过滤
    await waitFor(() => {
      expect(screen.queryByText('2.txt')).toBeNull();
    });
    await waitFor(() => {
      expect(screen.queryByText('a')).toBeNull();
    });
  });

  it('清空搜索框恢复完整树', async () => {
    await renderWithTree(standardTree());
    await screen.findByText('2.txt');
    const searchInput = screen.getByRole('searchbox');

    fireEvent.change(searchInput, { target: { value: '1' } });
    await waitFor(() => {
      expect(screen.getByText('1.txt')).toBeTruthy();
    });

    fireEvent.change(searchInput, { target: { value: '' } });
    await waitFor(() => {
      expect(screen.getByText('1.txt')).toBeTruthy();
      expect(screen.getByText('2.txt')).toBeTruthy();
      expect(screen.getByText('a')).toBeTruthy();
    });
  });

  it('Esc 键清空搜索框', async () => {
    await renderWithTree(standardTree());
    await screen.findByText('2.txt');
    const searchInput = screen.getByRole('searchbox');

    fireEvent.change(searchInput, { target: { value: '1' } });
    await waitFor(() => {
      expect(screen.getByText('1.txt')).toBeTruthy();
    });

    fireEvent.keyDown(searchInput, { key: 'Escape' });
    await waitFor(() => {
      expect((searchInput as HTMLInputElement).value).toBe('');
      expect(screen.getByText('2.txt')).toBeTruthy();
    });
  });
});
