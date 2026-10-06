import { useState, useCallback, lazy, Suspense, type ReactNode, useEffect } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { TopToolbar } from './components/TopToolbar.js';
import { Splitter } from './components/Splitter.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { CodeDiffDialog } from './components/common/CodeDiffDialog.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { DomainSwitcher } from './components/DomainSwitcher.js';
import { useProjectStore } from './store/project-store.js';
import { useModStore } from './store/mod-store.js';
import { useDomainStore, selectDomain, selectSetDomain } from './store/domain-store.js';
import {
  useLayoutStore,
  selectLeftWidth,
  selectRightWidth,
  selectSetLeftWidth,
  selectSetRightWidth,
} from './shell/layout-store.js';
import { initPanelRegistries } from './shell/index.js';
import { getAllPanels } from './shell/panels.js';
import { defaultPanelOfDomain, isCommonPanel, domainOfPanel } from './shell/domains.js';
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

/** 工作台视图（三栏布局：左侧文件树 + 中间主视图 + 右侧智能体） */
function Workbench() {
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
  const domain = useDomainStore(selectDomain);
  const setDomain = useDomainStore(selectSetDomain);

  // 左侧面板激活状态。
  // 初始值从「固定 explorer」改为**域感知**：挂载时就落到当前域的默认面板，
  // 否则重启后停在 explorer（common 面板），切域判定永远不触发，域切换形同虚设。
  const [activeLeftPanel, setActiveLeftPanel] = useState(() => defaultPanelOfDomain(domain));

  // 获取所有面板列表（用于校验 activeLeftPanel 有效性）
  const allPanels = getAllPanels();
  const panelIds = allPanels.map((p) => p.id);

  // 确保 activeLeftPanel 有效，并做域感知纠偏：
  // 1) 面板不在注册表里 → 兜底到注册表首项
  // 2) 面板属于别的域（common 视为哪儿都能待）→ 落到当前域的默认面板
  useEffect(() => {
    if (!panelIds.includes(activeLeftPanel)) {
      setActiveLeftPanel(panelIds[0] ?? defaultPanelOfDomain(domain));
      return;
    }
    if (!isCommonPanel(activeLeftPanel) && domainOfPanel(activeLeftPanel) !== domain) {
      setActiveLeftPanel(defaultPanelOfDomain(domain));
    }
  }, [panelIds, activeLeftPanel, domain]);

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

  return (
    <ProfileProvider>
      <div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
        {/* 顶部草绿细条：品牌识别线 */}
        <div className="h-[3px] w-full bg-mc-accent shadow-[0_1px_0_0_rgb(0_0_0/0.4)]" />

        {/* 顶部工具栏：项目菜单 + 全局设置 + API 状态 */}
        <TopToolbar onOpenSettings={() => setActiveLeftPanel('settings')} />

        {/* 工作域切换器（§0.2）：三域并列，决定中部主视图的默认面板与空态文案。
            放在 TopToolbar 之下、ActivityBar 之上：三栏布局本身不动。 */}
        <DomainSwitcher value={domain} onChange={setDomain} />

        <div className="flex flex-1 overflow-hidden">
          <ActivityBar
            active={activeLeftPanel}
            onChange={setActiveLeftPanel}
            onHome={backToDashboard}
          />

          {/* 左侧：固定显示 FileTree 作为导航 */}
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

          <Splitter onResize={handleLeftResize} />

          {/* 中间：动态内容区域 */}
          <main className="flex flex-1 flex-col overflow-hidden">
            <ErrorBoundary name="主视图">
              <LazyPanel>
                <MainPanelView activePanel={activeLeftPanel} />
              </LazyPanel>
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
