// @vitest-environment jsdom
/**
 * 回归网：左栏文件树**按面板派生**显隐。
 *
 * ## 触发
 *
 * 用户在**启动器域**看到左栏挂着「项目目录为空」，问
 * 「怎么又要出现了？还是启动器那边……启动界面需要这个吗」。
 *
 * ## 核查结论（这是本文件断言的依据，不是猜的）
 *
 * 全仓 `selectFile(` 的生产调用点只有 3 处：
 * `PurecodeWorkspace`（代码编辑区）、`Breadcrumb`、`SearchPanel`。
 * 文件树真正的作用是**给代码编辑器挑文件**，不是通用项目导航。
 *
 * | 面板 | 实际读什么 | 要树吗 |
 * | --- | --- | --- |
 * | 游戏启动器 `game` | `files.find(f => f.path.endsWith('.jar'))` 取一个路径 | ❌ |
 * | 包管理 `packages` | `loader/mcVersion/spec` 做 Modrinth 版本匹配 | ❌ |
 * | 内核自检 `kernel` | 完全不碰项目文件 | ❌ |
 * | 代码编辑 `preview` | `PurecodeWorkspace` 消费 `selectedFile` | ✅ |
 * | NBT `nbt` | `NbtPanelWithStore` 消费 `selectedFile` | ✅ |
 * | 资源包 `resources` | `selectedFile`×6 | ✅ |
 * | 皮肤 `skin` | 读 files 生成资源包，产物要可见 | ✅ |
 * | 构建 `build` | 读 files 打包，产物要可见 | ✅ |
 *
 * ## 三态语义
 *
 * `leftCollapsed === null` → 跟随面板自动决定；
 * `true/false` → 用户手动锁定，**切面板也不再改**。
 * 只有 boolean 时做不到「自动跟随」与「手动锁死」共存 ——
 * 每次切面板都会把用户刚展开的树无声收掉。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { Workbench } from '../App.js';
import { initPanelRegistries, getPanel } from './index.js';
import { useWorkbenchStore, resolveActivePanel } from './workbench-store.js';
import { useLayoutStore } from './layout-store.js';
import { DEFAULT_DOMAIN_ID } from './domains.js';

vi.mock('../hooks/useTranslation.js', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    tCommon: (key: string) => key,
    locale: 'zh',
  }),
}));

vi.mock('../assets/mc-ui/McIcon.js', () => ({
  McIcon: ({ name, size }: { name: string; size?: number }) => (
    <span data-icon={name} data-size={size} />
  ),
}));

vi.mock('../components/LanguageSwitcher.js', () => ({
  LanguageSwitcher: () => <span data-testid="lang-switcher" />,
}));

vi.mock('../store/mod-store.js', () => ({
  useModStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      generatorType: 'mod',
      loader: 'fabric',
      mcVersion: '1.20.1',
      loading: false,
      spec: null,
      files: [],
      description: '',
      conflictDialog: null,
      setError: vi.fn(),
      setGeneratorType: vi.fn(),
      setLoader: vi.fn(),
      setMcVersion: vi.fn(),
    }),
}));

vi.mock('../store/model-config-store.js', () => ({
  useModelConfigStore: () => ({ apiKey: 'sk-test' }),
}));

vi.mock('../store/project-store.js', () => ({
  useProjectStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      currentProjectId: 'p1',
      projects: [{ id: 'p1', name: 'demo' }],
      loadProjects: vi.fn(),
      loadProject: vi.fn(),
      importProject: vi.fn(),
      saveCurrentAsProject: vi.fn(),
      backToDashboard: vi.fn(),
    }),
}));

vi.mock('../lib/filetree-cache.js', () => ({
  getFileTreeCache: vi.fn(async () => null),
  setFileTreeCache: vi.fn(async () => undefined),
  invalidatePathCache: vi.fn(async () => undefined),
}));

beforeAll(() => {
  if (typeof globalThis.indexedDB === 'undefined') {
    (globalThis as { indexedDB?: unknown }).indexedDB = {
      open: () => {
        throw new Error('本测试不应真的打开 IndexedDB');
      },
    };
  }
  (window as unknown as { mcApi: unknown }).mcApi = {
    fileProjectListTree: vi.fn(async () => ({ success: true, tree: [] })),
  };
  initPanelRegistries();
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useWorkbenchStore.setState({ domain: DEFAULT_DOMAIN_ID, panelId: null });
  // null = 跟随面板自动决定
  useLayoutStore.setState({ leftCollapsed: null });
});

afterEach(() => {
  cleanup();
});

function fileTreeCount(): number {
  return screen.queryAllByTestId('filetree-empty').length;
}

describe('needsFileTree：注册表里的标注与核查结论一致', () => {
  it('不需要文件树的面板都没标', () => {
    for (const id of ['game', 'packages', 'kernel']) {
      expect(getPanel(id)?.needsFileTree, `${id} 不该需要文件树`).not.toBe(true);
    }
  });

  it('需要文件树的面板都标了', () => {
    for (const id of ['preview', 'nbt', 'resources', 'skin', 'build']) {
      expect(getPanel(id)?.needsFileTree, `${id} 需要文件树`).toBe(true);
    }
  });

  it('explorer 本身不标 —— 它是左栏的宿主，不是中栏面板', () => {
    expect(getPanel('explorer')?.needsFileTree).toBeUndefined();
  });
});

describe('左栏按面板自动显隐', () => {
  it('启动器域默认面板（游戏启动器）→ 左栏自动收起', async () => {
    useWorkbenchStore.setState({ domain: 'launcher', panelId: null });
    render(<Workbench />);
    // game 的 needsFileTree 不是 true → 树不该出现
    await waitFor(() => expect(fileTreeCount()).toBe(0));
  });

  it('代码编辑（preview）→ 左栏自动展开', async () => {
    useWorkbenchStore.setState({ domain: 'dev', panelId: 'preview' });
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
  });

  it('NBT / 资源包 → 左栏自动展开', async () => {
    for (const id of ['nbt', 'resources']) {
      cleanup();
      useWorkbenchStore.setState({ domain: 'server', panelId: id });
      render(<Workbench />);
      await waitFor(() => expect(fileTreeCount()).toBe(1));
    }
  });

  it('包管理 → 左栏保持收起', async () => {
    useWorkbenchStore.setState({ domain: 'launcher', panelId: 'packages' });
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(0));
  });
});

describe('手动锁定优先于自动派生', () => {
  it('在不需要树的面板上手动展开 → 树出现', async () => {
    useWorkbenchStore.setState({ domain: 'launcher', panelId: 'game' });
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(0));

    fireEvent.click(screen.getByRole('button', { name: /explorer/i }));
    await waitFor(() => expect(fileTreeCount()).toBe(1));
    expect(useLayoutStore.getState().leftCollapsed).toBe(false);
  });

  it('锁定后切面板不再改变 —— 用户展开的树不会无声消失', async () => {
    useWorkbenchStore.setState({ domain: 'launcher', panelId: 'game' });
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(0));
    fireEvent.click(screen.getByRole('button', { name: /explorer/i }));
    await waitFor(() => expect(fileTreeCount()).toBe(1));

    // 切到 packages（自动态应该是收起的），但用户锁定为展开 → 保持展开
    act(() => {
      useWorkbenchStore.getState().selectPanel('packages');
    });
    await waitFor(() => {
      expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('packages');
      expect(fileTreeCount()).toBe(1);
    });
  });

  it('在需要树的面板上手动收起 → 切回别的面板仍保持收起', async () => {
    useWorkbenchStore.setState({ domain: 'dev', panelId: 'preview' });
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /explorer/i }));
    await waitFor(() => expect(fileTreeCount()).toBe(0));

    act(() => {
      useWorkbenchStore.getState().selectPanel('nbt');
    });
    await waitFor(() => {
      expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('nbt');
      expect(fileTreeCount()).toBe(0);
    });
  });
});
