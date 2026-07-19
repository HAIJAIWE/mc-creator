import { useMemo, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Columns, X } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { defineMcMonacoTheme, mcEditorOptions, MC_MONACO_THEME } from '../lib/monaco-theme.js';
import { getFileIconName, getLang } from '../lib/file-utils.js';
import { Breadcrumb } from './Breadcrumb.js';
import type { FileNode } from '@mc-creator/shared';

/**
 * 分栏编辑器：左侧为主编辑区（selectedFile），右侧为分栏区（splitFile）。
 * 中间有可拖拽分割线调整宽度比例。右侧面板可关闭。
 */
export function SplitCodeEditor() {
  const { files, selectedFile, splitFile, updateFileContent, setSplitFile, dirtyFiles } =
    useModStore(
      (s) => ({
        files: s.files,
        selectedFile: s.selectedFile,
        splitFile: s.splitFile,
        updateFileContent: s.updateFileContent,
        setSplitFile: s.setSplitFile,
        dirtyFiles: s.dirtyFiles,
      }),
      shallow,
    );

  const [splitRatio, setSplitRatio] = useState(0.5);
  const [dragging, setDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const leftFile = useMemo(() => files.find((f) => f.path === selectedFile), [files, selectedFile]);
  const rightFile = useMemo(() => files.find((f) => f.path === splitFile), [files, splitFile]);

  // 拖拽分割线（使用 ref 持有容器引用，避免依赖 event target）
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault(); // 防止拖拽时选中文本
    setDragging(true);
    const container = containerRef.current;
    if (!container) return;
    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const ratio = (ev.clientX - rect.left) / rect.width;
      setSplitRatio(Math.max(0.2, Math.min(0.8, ratio)));
    };
    const onUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (!leftFile) return null;

  const renderEditorPane = (file: FileNode, side: 'left' | 'right') => (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 面包屑 */}
      <Breadcrumb filePath={file.path} />
      {/* 编辑器 */}
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          path={`${side}-${file.path}`}
          language={getLang(file.path)}
          theme={MC_MONACO_THEME}
          onMount={(editor, monaco) => {
            defineMcMonacoTheme(editor, monaco);
            // Ctrl+S 保存当前侧的文件
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
              const state = useModStore.getState();
              const f =
                side === 'left'
                  ? state.files.find((x) => x.path === state.selectedFile)
                  : state.files.find((x) => x.path === state.splitFile);
              if (!f) return;
              ipcClient
                .saveFile({
                  path: f.path,
                  content: f.content,
                  defaultName: f.path.split('/').pop() || 'file.txt',
                })
                .then((res) => {
                  if (res.ok) state.markFileClean(f.path);
                });
            });
          }}
          value={file.content}
          onChange={(value) => {
            if (value !== undefined && value !== file.content) {
              updateFileContent(file.path, value);
            }
          }}
          options={{ ...mcEditorOptions, readOnly: false }}
        />
      </div>
    </div>
  );

  // 如果没有分栏，只显示主编辑区
  if (!splitFile || !rightFile) {
    return (
      <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden bg-mc-bg">
        <div className="flex items-center gap-2 border-b border-mc-border bg-mc-surface px-2 py-1">
          <button
            onClick={() => {
              // 分栏到右侧：将当前文件移到右侧，选中另一个文件
              const other = files.find((f) => f.path !== selectedFile);
              if (other) setSplitFile(other.path);
            }}
            className="mc-btn-ghost !px-1.5 !py-0.5"
            title="分栏编辑（打开右侧面板）"
          >
            <Columns className="h-3 w-3" />
            <span className="text-xs">分栏</span>
          </button>
        </div>
        {renderEditorPane(leftFile, 'left')}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden bg-mc-bg">
      {/* 分栏工具栏 */}
      <div className="flex items-center justify-between border-b border-mc-border bg-mc-surface px-2 py-1">
        <div className="flex items-center gap-2">
          <Columns className="h-3 w-3 text-mc-accent" />
          <span className="text-xs text-mc-dim">分栏编辑</span>
        </div>
        <div className="flex items-center gap-2">
          <McIcon
            scope="pixel"
            name={getFileIconName(rightFile.path)}
            size={12}
            className="text-mc-mute"
          />
          <span className="max-w-48 truncate text-xs text-mc-text">{rightFile.path}</span>
          {dirtyFiles.has(rightFile.path) && <span className="text-xs text-mc-gold">●</span>}
          <button
            onClick={() => setSplitFile(null)}
            className="rounded-mc p-1 text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
            title="关闭右侧面板"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* 双栏编辑器 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧：主编辑区 */}
        <div style={{ width: `${splitRatio * 100}%` }} className="overflow-hidden">
          {renderEditorPane(leftFile, 'left')}
        </div>

        {/* 可拖拽分割线 */}
        <div
          onMouseDown={handleMouseDown}
          className={`flex-shrink-0 cursor-col-resize border-x border-mc-border bg-mc-surface transition-colors hover:bg-mc-accent/20 ${
            dragging ? 'bg-mc-accent/20' : ''
          }`}
          style={{ width: 4 }}
        />

        {/* 右侧：分栏区 */}
        <div style={{ width: `${(1 - splitRatio) * 100}%` }} className="overflow-hidden">
          {renderEditorPane(rightFile, 'right')}
        </div>
      </div>
    </div>
  );
}
