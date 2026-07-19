import { useState, useCallback, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { getFileIconName } from '../lib/file-utils.js';

function getFileIcon(path: string) {
  return <McIcon scope="pixel" name={getFileIconName(path)} size={14} style={{ opacity: 0.85 }} />;
}

interface TabContextMenu {
  x: number;
  y: number;
  path: string;
}

/**
 * 多标签页栏：仅显示 openTabs 中已打开的文件，支持切换、关闭、脏标记、右键菜单。
 * 不再遍历整个 files 列表，避免文件数量多时 tab 栏爆炸。
 */
export function TabBar() {
  const { openTabs, selectedFile, selectFile, closeTab, closeOtherTabs, closeAllTabs, dirtyFiles } =
    useModStore(
      (s) => ({
        openTabs: s.openTabs,
        selectedFile: s.selectedFile,
        selectFile: s.selectFile,
        closeTab: s.closeTab,
        closeOtherTabs: s.closeOtherTabs,
        closeAllTabs: s.closeAllTabs,
        dirtyFiles: s.dirtyFiles,
      }),
      shallow,
    );

  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  // 点击任意处关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // 鼠标中键点击关闭标签页
  const handleAuxClick = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button === 1) {
        // 中键
        e.preventDefault();
        closeTab(path);
      }
    },
    [closeTab],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  return (
    <div
      ref={tabBarRef}
      className="flex items-center gap-0.5 overflow-x-auto border-b border-mc-border bg-mc-surface px-1 py-1"
    >
      {openTabs.length === 0 && (
        <span className="px-2 py-1 text-xs text-mc-mute">暂无打开的文件</span>
      )}
      {openTabs.map((path) => {
        const isSelected = selectedFile === path;
        const fileName = path.split('/').pop() || path;
        const isDirty = dirtyFiles.has(path);

        return (
          <button
            key={path}
            onClick={() => selectFile(path)}
            onAuxClick={(e) => handleAuxClick(e, path)}
            onContextMenu={(e) => handleContextMenu(e, path)}
            className={`group flex items-center gap-1.5 rounded-mc border-b-2 px-2 py-1 text-xs transition-colors ${
              isSelected
                ? 'border-mc-accent bg-mc-surface-2 text-mc-text'
                : 'border-transparent text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {getFileIcon(path)}
            <span className="max-w-32 truncate">{fileName}</span>
            {isDirty && <span className="text-mc-gold">●</span>}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(path);
              }}
              className="rounded-mc p-0.5 text-mc-mute transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            >
              <X className="h-3 w-3" />
            </button>
          </button>
        );
      })}

      {/* 右键菜单（约束在视口内） */}
      {contextMenu && (
        <div
          className="mc-pop fixed z-50 min-w-[160px] py-1"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 180),
            top: Math.min(contextMenu.y, window.innerHeight - 120),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              closeTab(contextMenu.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-mc-text transition-colors hover:bg-mc-surface-3"
          >
            <X className="h-3 w-3" />
            关闭
          </button>
          <button
            onClick={() => {
              closeOtherTabs(contextMenu.path);
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-mc-text transition-colors hover:bg-mc-surface-3"
          >
            关闭其他
          </button>
          <button
            onClick={() => {
              closeAllTabs();
              setContextMenu(null);
            }}
            className="flex w-full items-center gap-2 px-3 py-1 text-left text-xs text-mc-text transition-colors hover:bg-mc-surface-3"
          >
            关闭全部
          </button>
        </div>
      )}
    </div>
  );
}
