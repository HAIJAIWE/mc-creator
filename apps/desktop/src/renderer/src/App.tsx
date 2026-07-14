import { TopBar } from './components/TopBar.js';
import { FileTree } from './components/FileTree.js';
import { ChatPanel } from './components/ChatPanel.js';
import { CodePreview } from './components/CodePreview.js';
import { AiChat } from './components/AiChat.js';
import { BuildPanel } from './components/BuildPanel.js';

export default function App() {
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
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
    </div>
  );
}
