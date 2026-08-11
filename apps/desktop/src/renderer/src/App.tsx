import { useState, useCallback } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { FileTree } from './components/FileTree.js';
import { MiddlePanel } from './components/middle/MiddlePanel.js';
import { AgentPanel } from './components/AgentPanel.js';
import { TopToolbar } from './components/TopToolbar.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { Splitter } from './components/Splitter.js';
import { ItemRecipeEditor } from './components/ItemRecipeEditor.js';
import { SearchPanel } from './components/SearchPanel.js';
import { PackagesPanel } from './components/PackagesPanel.js';
import { GitPanel } from './components/GitPanel.js';
import { BlockEditor } from './components/BlockEditor.js';
import { EntityAiEditor } from './components/EntityAiEditor.js';
import { AudioPanel } from './components/AudioPanel.js';
import { CiCdPanel } from './components/CiCdPanel.js';
import { GameLauncherPanel } from './components/GameLauncherPanel.js';
import { BuildPanel } from './components/BuildPanel.js';
import { TerminalPanel } from './components/TerminalPanel.js';
import { Dashboard } from './components/Dashboard.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { useProjectStore } from './store/project-store.js';

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
          <ErrorBoundary name="侧面板">{renderActivityPanel()}</ErrorBoundary>
        </aside>

        <Splitter onResize={handleLeftResize} />

        <main className="flex flex-1 flex-col overflow-hidden">
          <ErrorBoundary name="编辑区">
            <MiddlePanel />
          </ErrorBoundary>
          <BuildPanel />
          <TerminalPanel />
        </main>

        <Splitter onResize={handleRightResize} />

        <aside
          style={{ width: rightWidth }}
          className="flex-shrink-0 overflow-hidden border-l border-mc-border bg-mc-surface"
        >
          <ErrorBoundary name="智能体面板">
            <AgentPanel />
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
        <Dashboard />
      </ErrorBoundary>
    );
  return <Workbench />;
}
