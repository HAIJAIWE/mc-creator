import { useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { TopToolbar } from './components/TopToolbar.js';
import { Splitter } from './components/Splitter.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { CodeDiffDialog } from './components/common/CodeDiffDialog.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { DomainSwitcher } from './components/DomainSwitcher.js';
import { DomainTabs } from './shell/DomainTabs.js';
import { StatusBar } from './components/StatusBar.js';
import { useProjectStore } from './store/project-store.js';
import { useModStore } from './store/mod-store.js';
import {
  useWorkbenchStore,
  resolveActivePanel,
  selectDomain,
  selectSelectPanel,
  selectSetDomain,
} from './shell/workbench-store.js';
import {
  useLayoutStore,
  selectLeftWidth,
  selectRightWidth,
  selectLeftCollapsed,
  selectSetLeftWidth,
  selectSetRightWidth,
  selectSetLeftCollapsed,
} from './shell/layout-store.js';
import { initPanelRegistries } from './shell/index.js';
import { getPanel } from './shell/panels.js';
import { FileTree } from './components/FileTree.js';
import { MainPanelView } from './components/MainPanelView.js';
import { ProfileProvider } from './shell/profile-manager-provider.js';

// Monaco 本地化配置（worker 映射 + loader.config({ monaco })）**不能**在这里静态引入：
// monaco-setup.ts 会把 ~5MB 的 monaco-editor 拖进主 chunk，懒加载被完全抵消。
// 改为由 withMonacoSetup() 串在「可能渲染 <Editor> 的惰性加载器」上 —— 见 lib/lazy-monaco.ts
// 与下方 AgentPanel。铁律：任何 <Editor> 挂载前该配置必须已求值完，否则 loader.init()
// 会永久走 CDN 分支并被 CSP 拦掉（编辑器能开但高亮/补全/TS 诊断全无）。
import { withMonacoSetup } from './lib/lazy-monaco.js';

// 重型面板按需加载（Monaco / reactflow / xterm / skinview3d 拆进独立 chunk，首次不进主包）
const Dashboard = lazy(() =>
  import('./components/Dashboard.js').then((m) => ({ default: m.Dashboard })),
);
// AgentPanel 右侧栏在 workbench 挂载时即加载，而它内部有 <Editor>（Spec 区块），
// 所以加载器必须先完成 Monaco 配置。
const AgentPanel = lazy(
  withMonacoSetup(() =>
    import('./components/AgentPanel.js').then((m) => ({ default: m.AgentPanel })),
  ),
);

/** 按需加载面板的 Suspense 边界 */
function LazyPanel({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-3 text-sm text-mc-dim">加载中…</div>}>
      {children}
    </Suspense>
  );
}

/**
 * 左栏文件树该显示吗 —— 派生自当前面板的 `needsFileTree`，用户手动锁定优先。
 *
 * ## 为什么要按面板派生
 *
 * 文件树不是「浏览整个项目」的通用导航。核查全仓 `selectFile(` 的生产调用点，
 * 只有 3 处：`PurecodeWorkspace`（代码编辑区）、`Breadcrumb`、`SearchPanel`。
 * 也就是说它真正的作用是**给代码编辑器挑文件**。
 *
 * 而「游戏启动器」只 `files.find(f => f.path.endsWith('.jar'))` 取一个路径、
 * 「包管理」只用 loader/版本/spec 做 Modrinth 版本匹配、「内核自检」完全不碰项目文件 ——
 * 这三个面板面前摆一棵 200px 的空树，纯占位（这正是用户反馈的现象）。
 *
 * ## 手动锁定的语义
 *
 * `leftCollapsed` 存 `null` 时跟随面板自动决定；用户点 explorer 图标后
 * 变成显式的 true/false，**切换面板也不再改** —— 否则用户刚展开的文件树
 * 会在切面板时无声消失，「我明明打开了」和「它自己关了」没法区分。
 */
function useFileTreeVisibility(panelId: string): {
  collapsed: boolean;
  toggle: () => void;
} {
  const override = useLayoutStore(selectLeftCollapsed);
  const setOverride = useLayoutStore(selectSetLeftCollapsed);

  const autoNeeded = getPanel(panelId)?.needsFileTree === true;
  const collapsed = override === null ? !autoNeeded : override;

  const toggle = useCallback(() => {
    setOverride(!collapsed);
  }, [collapsed, setOverride]);

  return { collapsed, toggle };
}

/** 工作台视图（三栏布局：左侧文件树 + 中间主视图 + 右侧智能体） */
export function Workbench() {
  const backToDashboard = useProjectStore((s) => s.backToDashboard);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showTaskComplete, setShowTaskComplete] = useState(false);

  // 从 layout-store 读取/写入宽度（持久化）
  const leftWidth = useLayoutStore(selectLeftWidth);
  const rightWidth = useLayoutStore(selectRightWidth);
  const setLeftWidth = useLayoutStore(selectSetLeftWidth);
  const setRightWidth = useLayoutStore(selectSetRightWidth);

  // 冲突差异对话框状态
  const conflictDialog = useModStore((s) => s.conflictDialog);

  // 当前工作域（§0.2 三域并列）。智能体右侧栏不在域里 —— 它横向贯穿三域，一直常驻。
  const domain = useWorkbenchStore(selectDomain);
  const setDomain = useWorkbenchStore(selectSetDomain);
  // 激活面板。**取代**原来的 useState + 域纠偏 useEffect：
  // 「切域重置」与「激活跨域面板则同切域」两条规则现在都在 store 里（见 workbench-store.ts），
  // 组件只负责读。resolveActivePanel 顺带兜住 localStorage 里的失效 id。
  const selectPanel = useWorkbenchStore(selectSelectPanel);
  const panelId = useWorkbenchStore((s) => s.panelId);
  const activeLeftPanel = resolveActivePanel({ domain, panelId });

  // 左栏折叠态由当前面板派生（见 useFileTreeVisibility）：
  // explorer 图标改为折叠/展开它，而不是往中栏再渲一份文件树。
  const { collapsed: leftCollapsed, toggle: toggleLeftCollapsed } =
    useFileTreeVisibility(activeLeftPanel);

  const handleLeftResize = useCallback(
    (delta: number) => {
      setLeftWidth(Math.max(120, Math.min(480, leftWidth + delta)));
    },
    [leftWidth, setLeftWidth],
  );

  const handleRightResize = useCallback(
    (delta: number) => {
      setRightWidth(Math.max(200, Math.min(600, rightWidth - delta)));
    },
    [rightWidth, setRightWidth],
  );

  /**
   * 活动栏点击的**唯一分派点**。
   *
   * `explorer` 与其它 core 面板不是一回事：
   * - 其它（search/git/packages/settings）→ 选中中栏面板，正常路由
   * - `explorer`（文件树）→ **只**住在左栏，点它折叠/展开左栏
   *
   * 之前 explorer 走的是 `selectPanel('explorer')`，于是中栏也渲了一份 FileTree，
   * 和左栏常驻那份叠成两个文件树（`explorer-duplication.repro.test.tsx` 用
   * `waitFor` 数出 `filetree-empty × 2` 实锤）。现在从**入口**就不让中栏参与；
   * `resolveActivePanel` 里的 `SIDEBAR_ONLY_PANEL_IDS` 是第二道闸，
   * 挡住 localStorage 残留等旁路。
   */
  const handleActivityChange = useCallback(
    (id: string) => {
      if (id === 'explorer') {
        toggleLeftCollapsed();
        return;
      }
      selectPanel(id);
    },
    [selectPanel, toggleLeftCollapsed],
  );

  return (
    <ProfileProvider>
      <div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
        {/* 顶部草绿细条：品牌识别线 */}
        <div className="h-[3px] w-full bg-mc-accent shadow-[0_1px_0_0_rgb(0_0_0/0.4)]" />

        {/* 顶部工具栏：项目菜单 + 全局设置 + API 状态 */}
        <TopToolbar
          onOpenSettings={() => selectPanel('settings')}
          // build 面板只归属 dev 域：非 dev 域展示按钮点了会把用户拽去 dev 域，等于误导
          canOpenBuild={domain === 'dev'}
          onOpenBuild={() => selectPanel('build')}
        />

        {/* 工作域切换器（§0.2）：三域并列，决定中部主视图的默认面板与空态文案。
            放在 TopToolbar 之下、ActivityBar 之上：三栏布局本身不动。 */}
        <DomainSwitcher value={domain} onChange={setDomain} />

        <div className="flex flex-1 overflow-hidden">
          {/*
            活动栏的 explorer 图标改为折叠/展开左栏（VS Code 行为），
            所以 explorer 的选中态表达的是「左栏是否展开」，而不是「中栏正在渲它」。
            ActivityBar 内部据此算出高亮与 roving tabindex 锚点，
            这里只需要把两个事实喂给它：
            - activeLeftPanel：经 resolveActivePanel 过滤后**永远不会是 explorer**
            - leftCollapsed：左栏折叠态
          */}
          <ActivityBar
            activePanel={activeLeftPanel}
            leftCollapsed={leftCollapsed}
            onChange={handleActivityChange}
            onHome={backToDashboard}
          />

          {/* 左侧边栏：文件树。它是中栏唯一的目录浏览入口
              （MiddlePanel 的 5 个 tab 只有「已打开文件的 TabBar」，没有目录层级），
              所以不能删；但可折叠，否则常驻 200px 会一直挤占中栏的 Monaco 空间。 */}
          {!leftCollapsed && (
            <aside
              style={{ width: leftWidth }}
              className="flex-shrink-0 overflow-hidden border-r border-mc-border bg-mc-surface"
            >
              <ErrorBoundary name="文件导航">
                <LazyPanel>
                  <FileTree />
                </LazyPanel>
              </ErrorBoundary>
            </aside>
          )}

          {!leftCollapsed && <Splitter onResize={handleLeftResize} />}

          {/* 中间：动态内容区域。
                DomainTabs = 域面板 tab 条（IDE 编辑器区形态），解决 8 个面板不可达。
                它同时渲染 tab 条与对应的 tabpanel 容器 —— WAI-ARIA Tabs 要求
                每个 tab 的 aria-controls 指向真实存在的 tabpanel，
                两者放在一起才不会「改一边忘另一边」。
                跨域常驻面板（explorer/search/git/...）不在 tab 条里，
                由 MainPanelView 通过 commonPanelContent 承载。 */}
          <main className="flex flex-1 flex-col overflow-hidden">
            <ErrorBoundary name="域面板tab条">
              <DomainTabs
                commonPanelContent={
                  <ErrorBoundary name="主视图">
                    <LazyPanel>
                      <MainPanelView activePanel={activeLeftPanel} />
                    </LazyPanel>
                  </ErrorBoundary>
                }
              />
            </ErrorBoundary>
          </main>

          <Splitter onResize={handleRightResize} />

          {/* 右侧：AI 智能体面板 */}
          <aside
            style={{ width: rightWidth }}
            className="flex-shrink-0 overflow-hidden border-l border-mc-border bg-mc-surface"
          >
            <ErrorBoundary name="智能体面板">
              <LazyPanel>
                <AgentPanel />
              </LazyPanel>
            </ErrorBoundary>
          </aside>
        </div>

        {/* 底部状态栏（IDE 标准层）：项目身份 + 构建上下文的只读展示，点击进设置。
            这三个值原先是 TopToolbar 中间的三个下拉框 —— 按 IDE 惯例迁到这里：
            VS Code 的六个区域里没有「工具栏」，项目上下文一律在底部状态栏。 */}
        <ErrorBoundary name="状态栏">
          <StatusBar />
        </ErrorBoundary>

        {showSaveDialog && <ProjectSaveDialog onClose={() => setShowSaveDialog(false)} />}

        <TaskCompleteDialog
          show={showTaskComplete}
          onContinue={() => setShowTaskComplete(false)}
          onStop={() => window.close()}
        />

        {conflictDialog && (
          <CodeDiffDialog
            filePath={conflictDialog.filePath}
            serverContent={conflictDialog.serverContent}
            localContent={conflictDialog.localContent}
            onClose={() => {
              useModStore.getState().closeConflictDiff();
            }}
            isOpen={conflictDialog.isOpen}
          />
        )}
      </div>
    </ProfileProvider>
  );
}

// 初始化面板注册表（副作用：注册所有面板）
initPanelRegistries();

export default function App() {
  // P1 修复：按 view 状态切换 Dashboard 首屏与工作台
  const view = useProjectStore((s) => s.view);
  if (view === 'dashboard')
    return (
      <ErrorBoundary name="仪表盘">
        <LazyPanel>
          <Dashboard />
        </LazyPanel>
      </ErrorBoundary>
    );
  return <Workbench />;
}
