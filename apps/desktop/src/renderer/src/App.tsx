import { useState, useCallback, lazy, Suspense, type ReactNode, useEffect } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { TopToolbar } from './components/TopToolbar.js';
import { Splitter } from './components/Splitter.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { CodeDiffDialog } from './components/common/CodeDiffDialog.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useProjectStore } from './store/project-store.js';
import { useModStore } from './store/mod-store.js';
import { useLayoutStore, selectLeftWidth, selectRightWidth, selectSetLeftWidth, selectSetRightWidth } from './shell/layout-store.js';
import { initPanelRegistries } from './shell/index.js';
import { getAllPanels } from './shell/panels.js';
import { FileTree } from './components/FileTree.js';
import { MainPanelView } from './components/MainPanelView.js';
import { ProfileProvider } from './shell/profile-manager-provider.js';

// Monaco 本地化配置必须在任何 <Editor> 挂载前完成（避免回落到 CDN 被 CSP 拦截）
// 在应用启动时立即加载，确保 MonacoEnvironment 在任何编辑器挂载前就绪
import './lib/monaco-setup.js';

// 重型面板按需加载（Monaco / reactflow / xterm / skinview3d 拆进独立 chunk，首次不进主包）
const Dashboard = lazy(() =>
  import('./components/Dashboard.js').then((m) => ({ default: m.Dashboard })),
);
const AgentPanel = lazy(() =>
  import('./components/AgentPanel.js').then((m) => ({ default: m.AgentPanel })),
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

  // 左侧面板激活状态（默认 explorer）
  const [activeLeftPanel, setActiveLeftPanel] = useState('explorer');

  // 获取所有面板列表（用于校验 activeLeftPanel 有效性）
  const allPanels = getAllPanels();
  const panelIds = allPanels.map((p) => p.id);

  // 确保 activeLeftPanel 有效（首次加载或注册表变化时）
  useEffect(() => {
    if (!panelIds.includes(activeLeftPanel)) {
      setActiveLeftPanel(panelIds[0] ?? 'explorer');
    }
  }, [panelIds, activeLeftPanel, setActiveLeftPanel]);

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth(Math.max(120, Math.min(480, leftWidth + delta)));
  }, [leftWidth, setLeftWidth]);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth(Math.max(200, Math.min(600, rightWidth - delta)));
  }, [rightWidth, setRightWidth]);

  return (
    <ProfileProvider>
      <div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
        {/* 顶部草绿细条：品牌识别线 */}
        <div className="h-[3px] w-full bg-mc-accent shadow-[0_1px_0_0_rgb(0_0_0/0.4)]" />

        {/* 顶部工具栏：项目菜单 + 全局设置 + API 状态 */}
        <TopToolbar onOpenSettings={() => setActiveLeftPanel('settings')} />

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
            onClose={(action, mergedContent) => {
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