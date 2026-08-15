import { useState, useCallback, lazy, Suspense, type ReactNode } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { TopToolbar } from './components/TopToolbar.js';
import { Splitter } from './components/Splitter.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useProjectStore } from './store/project-store.js';

// 重型面板按需加载（Monaco / reactflow / xterm / skinview3d 拆进独立 chunk，首次不进主包）
const MiddlePanel = lazy(() =>
  import('./components/middle/MiddlePanel.js').then((m) => ({ default: m.MiddlePanel })),
);
const AgentPanel = lazy(() =>
  import('./components/AgentPanel.js').then((m) => ({ default: m.AgentPanel })),
);
const BuildPanel = lazy(() =>
  import('./components/BuildPanel.js').then((m) => ({ default: m.BuildPanel })),
);
const TerminalPanel = lazy(() =>
  import('./components/TerminalPanel.js').then((m) => ({ default: m.TerminalPanel })),
);
const Dashboard = lazy(() =>
  import('./components/Dashboard.js').then((m) => ({ default: m.Dashboard })),
);
const FileTree = lazy(() =>
  import('./components/FileTree.js').then((m) => ({ default: m.FileTree })),
);
const SearchPanel = lazy(() =>
  import('./components/SearchPanel.js').then((m) => ({ default: m.SearchPanel })),
);
const GitPanel = lazy(() =>
  import('./components/GitPanel.js').then((m) => ({ default: m.GitPanel })),
);
const PackagesPanel = lazy(() =>
  import('./components/PackagesPanel.js').then((m) => ({ default: m.PackagesPanel })),
);
const ItemRecipeEditor = lazy(() =>
  import('./components/ItemRecipeEditor.js').then((m) => ({ default: m.ItemRecipeEditor })),
);
const BlockEditor = lazy(() =>
  import('./components/BlockEditor.js').then((m) => ({ default: m.BlockEditor })),
);
const EntityAiEditor = lazy(() =>
  import('./components/EntityAiEditor.js').then((m) => ({ default: m.EntityAiEditor })),
);
const AudioPanel = lazy(() =>
  import('./components/AudioPanel.js').then((m) => ({ default: m.AudioPanel })),
);
const CiCdPanel = lazy(() =>
  import('./components/CiCdPanel.js').then((m) => ({ default: m.CiCdPanel })),
);
const GameLauncherPanel = lazy(() =>
  import('./components/GameLauncherPanel.js').then((m) => ({ default: m.GameLauncherPanel })),
);
const SettingsPanel = lazy(() =>
  import('./components/SettingsPanel.js').then((m) => ({ default: m.SettingsPanel })),
);

type Activity =
  | 'explorer'
  | 'search'
  | 'git'
  | 'packages'
  | 'settings'
  | 'items'
  | 'blocks'
  | 'entity'
  | 'audio'
  | 'cicd'
  | 'game';

/** 按需加载面板的 Suspense 边界 */
function LazyPanel({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="p-3 text-sm text-mc-dim">加载中…</div>}>
      {children}
    </Suspense>
  );
}

/** 工作台视图（三栏布局） */
function Workbench() {
  const backToDashboard = useProjectStore((s) => s.backToDashboard);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showTaskComplete, setShowTaskComplete] = useState(false);
  const [activeActivity, setActiveActivity] = useState<Activity>('explorer');

  const [leftWidth, setLeftWidth] = useState(200);
  const [rightWidth, setRightWidth] = useState(360);

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(120, Math.min(400, w + delta)));
  }, []);

  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(240, Math.min(560, w - delta)));
  }, []);

  const renderActivityPanel = () => {
    switch (activeActivity) {
      case 'explorer':
        return <FileTree />;
      case 'search':
        return <SearchPanel />;
      case 'git':
        return <GitPanel />;
      case 'packages':
        return <PackagesPanel />;
      case 'items':
        return <ItemRecipeEditor />;
      case 'blocks':
        return <BlockEditor />;
      case 'entity':
        return <EntityAiEditor />;
      case 'audio':
        return <AudioPanel />;
      case 'cicd':
        return <CiCdPanel />;
      case 'game':
        return <GameLauncherPanel />;
      case 'settings':
        return (
          <SettingsPanel
            leftWidth={leftWidth}
            rightWidth={rightWidth}
            onLeftWidthChange={setLeftWidth}
            onRightWidthChange={setRightWidth}
          />
        );
      default:
        return <FileTree />;
    }
  };

  return (
    <div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
      {/* 顶部草绿细条：品牌识别线 */}
      <div className="h-[3px] w-full bg-mc-accent shadow-[0_1px_0_0_rgb(0_0_0/0.4)]" />

      {/* 顶部工具栏：项目菜单 + 全局设置 + API 状态 */}
      <TopToolbar onOpenSettings={() => setActiveActivity('settings')} />

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar
          active={activeActivity}
          onChange={setActiveActivity}
          onHome={backToDashboard}
        />

        <aside
          style={{ width: leftWidth }}
          className="flex-shrink-0 overflow-hidden border-r border-mc-border bg-mc-surface"
        >
          <ErrorBoundary name="侧面板">
            <LazyPanel>{renderActivityPanel()}</LazyPanel>
          </ErrorBoundary>
        </aside>

        <Splitter onResize={handleLeftResize} />

        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary name="编辑区">
            <LazyPanel>
              <MiddlePanel />
            </LazyPanel>
          </ErrorBoundary>
          <LazyPanel>
            <BuildPanel />
          </LazyPanel>
          <LazyPanel>
            <TerminalPanel />
          </LazyPanel>
        </main>

        <Splitter onResize={handleRightResize} />

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
    </div>
  );
}

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
