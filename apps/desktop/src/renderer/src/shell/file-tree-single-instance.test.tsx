// @vitest-environment jsdom
/**
 * 回归网：屏幕上**永远只有一个**文件树。
 *
 * ## 这个 bug 是怎么来的
 *
 * | 位置 | 渲染什么 |
 * * | --- | --- |
 * | `App.tsx` 左栏 | `FileTree`（常驻） |
 * | 注册表 `explorer` loader（`register-all-panels.ts:9`） | `FileTree` |
 *
 * 点活动栏的 explorer 图标走 `selectPanel('explorer')` → 中栏 `PanelHost('explorer')`
 * 也渲一份 → 屏幕上两个文件树。
 *
 * ## 为什么之前那次修复没抓到
 *
 * 早一轮改动（`MainPanelView.test.tsx` 记录的「explorer 三份语义」）把中栏那份
 * 从 `CodePreview` 统一成了 `FileTree` —— 语义确实统一了，
 * 但**没处理「左栏本来就常驻文件树」**。语义一致 ≠ 可以同时显示两份。
 * 换句话说：那次修复让三处说法一致，却没问「一致之后是不是就有两份了」。
 *
 * ## 现在的两道防线
 *
 * 1. `App.tsx` 的 `handleActivityChange`：explorer 图标改为折叠/展开左栏，
 *    入口就不让中栏参与；
 * 2. `workbench-store.ts` 的 `SIDEBAR_ONLY_PANEL_IDS`：`resolveActivePanel`
 *    永不返回 explorer，挡住 localStorage 残留等旁路。
 *
 * 下面的用例对**两条防线都做破坏性验证** —— 只测一条的话，
 * 另一条被删掉时不会有任何用例变红。
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { Workbench } from '../App.js';
import { initPanelRegistries } from '../shell/index.js';
import { useWorkbenchStore, resolveActivePanel } from '../shell/workbench-store.js';
import { useLayoutStore } from '../shell/layout-store.js';
import { DEFAULT_DOMAIN_ID } from '../shell/domains.js';

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
      // **有项目**是关键：MainPanelView 在 !currentProjectId 时会短路成空态，
      // 那样 explorer 面板根本不会渲染，重复就观察不到。
      currentProjectId: 'p1',
      projects: [{ id: 'p1', name: 'demo' }],
      loadProjects: vi.fn(),
      loadProject: vi.fn(),
      importProject: vi.fn(),
      saveCurrentAsProject: vi.fn(),
      backToDashboard: vi.fn(),
    }),
}));

// jsdom 没有 IndexedDB。FileTree 的树缓存与编译缓存都会碰它，
// 不打桩的话挂载期就 ReferenceError，断言全部假红（与被测行为无关）。
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
  // FileTree 挂载后会去拉目录树；通道不存在时它会一直停在 loading 分支，
  // 观察不到空态。这里给一个「空目录」的真实形状响应。
  (window as unknown as { mcApi: unknown }).mcApi = {
    fileProjectListTree: vi.fn(async () => ({ success: true, tree: [] })),
  };
  initPanelRegistries();
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useWorkbenchStore.setState({ domain: DEFAULT_DOMAIN_ID, panelId: null });
  useLayoutStore.setState({ leftCollapsed: false });
});

afterEach(() => {
  cleanup();
});

/** 文件树实例数。空态 testid 唯一标识一个已挂载的 FileTree。 */
function fileTreeCount(): number {
  return screen.queryAllByTestId('filetree-empty').length;
}

describe('回归：文件树只有一份', () => {
  it('初始状态：左栏一份文件树', async () => {
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
  });

  it('点 explorer → 折叠左栏（不是在中栏再渲一份）', async () => {
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /explorer/i }));
    // 折叠后左栏整体卸载，文件树随之消失；关键是**没有变成 2**
    await waitFor(() => expect(fileTreeCount()).toBe(0));
    expect(useLayoutStore.getState().leftCollapsed).toBe(true);
  });

  it('再点 explorer → 展开，仍然只有一份', async () => {
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
    const btn = screen.getByRole('button', { name: /explorer/i });

    fireEvent.click(btn);
    await waitFor(() => expect(fileTreeCount()).toBe(0));
    fireEvent.click(btn);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
    // 折叠→展开两个来回，恒定一份
    fireEvent.click(btn);
    await waitFor(() => expect(fileTreeCount()).toBe(0));
    fireEvent.click(btn);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
  });

  it('反复切换其它 core 面板也不会多出文件树', async () => {
    render(<Workbench />);
    await waitFor(() => expect(fileTreeCount()).toBe(1));
    for (const name of [/search/i, /git/i, /设置|settings/i]) {
      fireEvent.click(screen.getByRole('button', { name }));
      // 给 lazy 面板时间落地 —— 第一版就是漏了这步，
      // 在 Suspense 阶段就断言，导致 bug 第一次跑出来是「1」而误判自己判断错了
      await waitFor(() => expect(fileTreeCount()).toBe(1));
    }
  });
});

describe('回归：第二道防线 —— resolveActivePanel 永不返回 explorer', () => {
  it('panelId 显式为 explorer 时回落到域默认面板', () => {
    expect(resolveActivePanel({ domain: 'dev', panelId: 'explorer' })).toBe('items');
    expect(resolveActivePanel({ domain: 'launcher', panelId: 'explorer' })).toBe('game');
    expect(resolveActivePanel({ domain: 'server', panelId: 'explorer' })).toBe('kernel');
  });

  it('localStorage 残留的 explorer 也会被挡住（模拟旧版本持久化）', () => {
    useWorkbenchStore.setState({ domain: 'dev', panelId: 'explorer' });
    expect(resolveActivePanel(useWorkbenchStore.getState())).toBe('items');
  });

  it('其它跨域常驻面板不受影响（search/git/settings 仍可作中栏面板）', () => {
    expect(resolveActivePanel({ domain: 'dev', panelId: 'search' })).toBe('search');
    expect(resolveActivePanel({ domain: 'dev', panelId: 'git' })).toBe('git');
    expect(resolveActivePanel({ domain: 'dev', panelId: 'settings' })).toBe('settings');
  });
});
