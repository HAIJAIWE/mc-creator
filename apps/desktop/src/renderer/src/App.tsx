import { useState, useCallback } from 'react';
import { TopBar } from './components/TopBar.js';
import { FileTree } from './components/FileTree.js';
import { ChatPanel } from './components/ChatPanel.js';
import { CodePreview } from './components/CodePreview.js';
import { AiChat } from './components/AiChat.js';
import { BuildPanel } from './components/BuildPanel.js';
import { Dashboard } from './components/Dashboard.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { Splitter } from './components/Splitter.js';
import { useProjectStore } from './store/project-store.js';
import { useModStore } from './store/mod-store.js';

export default function App() {
  const view = useProjectStore((s) => s.view);
  const backToDashboard = useProjectStore((s) => s.backToDashboard);
  const files = useModStore((s) => s.files);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  // P34：三栏可拖拽调整宽度
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(320);

  const handleLeftResize = useCallback((delta: number) => {
    setLeftWidth((w) => Math.max(160, Math.min(480, w + delta)));
  }, []);
  const handleRightResize = useCallback((delta: number) => {
    setRightWidth((w) => Math.max(200, Math.min(600, w - delta)));
  }, []);

  if (view === 'dashboard') {
    return <Dashboard />;
  }

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar
        onBackToDashboard={backToDashboard}
        onSaveProject={() => setShowSaveDialog(true)}
        canSaveProject={files.length > 0}
      />
      <div className="flex flex-1 overflow-hidden">
        {/* 左：文件树 */}
        <aside
          style={{ width: leftWidth }}
          className="flex-shrink-0 overflow-y-auto border-r border-zinc-800"
        >
          <FileTree />
        </aside>
        <Splitter onResize={handleLeftResize} />
        {/* 中：对话 + Spec + 代码预览 + 编译 */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel />
          <CodePreview />
          <BuildPanel />
        </main>
        <Splitter onResize={handleRightResize} />
        {/* 右：AI 聊天 */}
        <aside
          style={{ width: rightWidth }}
          className="flex-shrink-0 overflow-y-auto border-l border-zinc-800"
        >
          <AiChat />
        </aside>
      </div>
      {showSaveDialog && (
        <ProjectSaveDialog onClose={() => setShowSaveDialog(false)} />
      )}
    </div>
  );
}
