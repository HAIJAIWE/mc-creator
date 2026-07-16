import { useState, useCallback } from 'react';
import { ActivityBar } from './components/ActivityBar.js';
import { FileTree } from './components/FileTree.js';
import { TabBar } from './components/TabBar.js';
import { CodePreview } from './components/CodePreview.js';
import { AgentPanel } from './components/AgentPanel.js';
import { LayoutLearner } from './components/LayoutLearner.js';
import { LayoutConfig } from './components/LayoutConfig.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { TaskCompleteDialog } from './components/TaskCompleteDialog.js';
import { Splitter } from './components/Splitter.js';
import { ItemRecipeEditor } from './components/ItemRecipeEditor.js';
import { SearchPanel } from './components/SearchPanel.js';
import { PackagesPanel } from './components/PackagesPanel.js';
import { GitPanel } from './components/GitPanel.js';
import { BlockEditor } from './components/BlockEditor.js';
import { useModStore } from './store/mod-store.js';

type Activity = 'explorer' | 'search' | 'git' | 'packages' | 'learn' | 'settings' | 'items' | 'blocks';

/** 尚未实现的面板：做成有设计感的「敬请期待」，而非一片空白文字 */
function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center animate-mc-panel-in">
      <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <span className="text-lg font-bold text-mc-mute">?</span>
      </div>
      <div className="text-xs font-medium text-mc-dim">{label}</div>
      <div className="text-xs text-mc-mute">敬请期待</div>
    </div>
  );
}

export default function App() {
  const files = useModStore((s) => s.files);
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
      case 'learn':
        return <LayoutLearner />;
      case 'items':
        return <ItemRecipeEditor />;
      case 'blocks':
        return <BlockEditor />;
      case 'settings':
        return (
          <LayoutConfig
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

      <div className="flex flex-1 overflow-hidden">
        <ActivityBar active={activeActivity} onChange={setActiveActivity} />

        <aside
          style={{ width: leftWidth }}
          className="flex-shrink-0 overflow-hidden border-r border-mc-border bg-mc-surface"
        >
          {renderActivityPanel()}
        </aside>

        <Splitter onResize={handleLeftResize} />

        <main className="flex flex-1 flex-col overflow-hidden">
          <TabBar />
          <div className="flex-1 overflow-hidden">
            <CodePreview />
          </div>
        </main>

        <Splitter onResize={handleRightResize} />

        <aside
          style={{ width: rightWidth }}
          className="flex-shrink-0 overflow-hidden border-l border-mc-border bg-mc-surface"
        >
          <AgentPanel />
        </aside>
      </div>

      {showSaveDialog && (
        <ProjectSaveDialog onClose={() => setShowSaveDialog(false)} />
      )}

      <TaskCompleteDialog
        show={showTaskComplete}
        onContinue={() => setShowTaskComplete(false)}
        onStop={() => window.close()}
      />
    </div>
  );
}
