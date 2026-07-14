import { useState } from 'react';
import { TopBar } from './components/TopBar.js';
import { FileTree } from './components/FileTree.js';
import { ChatPanel } from './components/ChatPanel.js';
import { CodePreview } from './components/CodePreview.js';
import { AiChat } from './components/AiChat.js';
import { BuildPanel } from './components/BuildPanel.js';
import { Dashboard } from './components/Dashboard.js';
import { ProjectSaveDialog } from './components/ProjectSaveDialog.js';
import { useProjectStore } from './store/project-store.js';
import { useModStore } from './store/mod-store.js';

export default function App() {
  const view = useProjectStore((s) => s.view);
  const backToDashboard = useProjectStore((s) => s.backToDashboard);
  const files = useModStore((s) => s.files);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

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
        <aside className="w-60 border-r border-zinc-800 overflow-y-auto">
          <FileTree />
        </aside>
        {/* 中：对话 + Spec + 代码预览 + 编译 */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel />
          <CodePreview />
          <BuildPanel />
        </main>
        {/* 右：AI 聊天 */}
        <aside className="w-80 border-l border-zinc-800 overflow-y-auto">
          <AiChat />
        </aside>
      </div>
      {showSaveDialog && (
        <ProjectSaveDialog onClose={() => setShowSaveDialog(false)} />
      )}
    </div>
  );
}
