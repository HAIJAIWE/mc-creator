import { useState, useCallback, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { Tabs, type TabItem } from '@mc-creator/ui';
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
 *
 * ## 基于 ui `Tabs` 的实现要点
 *
 * 1. **不传 `children`**：文件标签栏只有标签、没有面板内容。ui Tabs 因此会
 *    渲染一组空 `role="tabpanel"`，用 `panelClassName="hidden"` 整体藏掉 ——
 *    否则那个选中面板会是个带 `px-3 py-3` 的空块，在标签栏下面凭空撑出
 *    24px 空白。
 * 2. **空态在组件外层条件渲染**：ui Tabs 没有「暂无打开的文件」的概念，
 *    且空 items 会渲染出一个空 tablist（无 tab 子节点，同样违反
 *    aria-required-children），所以 `openTabs.length === 0` 时直接不渲染 Tabs。
 * 3. **右键菜单挪到 Tabs 外面**：老实现把菜单渲染在 `role="tablist"` 内部，
 *    三个 button 成了 tablist 的子节点，违反 aria-required-children。现在
 *    菜单与 Tabs 平级。
 * 4. **roving tabindex + 方向键**：由 ui Tabs 统一提供。老实现每个 tab 都
 *    `tabIndex={0}`，10 个文件要按 10 次 Tab 才穿得过标签栏。
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

  // 点击任意处关闭右键菜单
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  const handleAuxClick = useCallback(
    (path: string, button: number) => {
      // ui Tabs 只在非常规键（button !== 0）时回调，且已代为 preventDefault 中键
      if (button === 1) closeTab(path);
    },
    [closeTab],
  );

  const handleContextMenu = useCallback((path: string, e: MouseEvent) => {
    // ui Tabs 默认不 preventDefault（弹不弹菜单是调用方的决定），这里自己拦
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path });
  }, []);

  const items = useMemo<TabItem[]>(
    () =>
      openTabs.map((path) => {
        const fileName = path.split('/').pop() || path;
        return {
          value: path,
          // 长文件名截断类挂在内层 span 上：ui Tabs 的外层 <span> 无法加 class
          label: <span className="max-w-32 truncate">{fileName}</span>,
          // label 是 ReactNode，ui Tabs 取不到纯文本名（会退回完整路径，
          // 关闭按钮就变成「关闭 src/main/java/Mod.java」）。显式给文件名。
          ariaLabel: fileName,
          icon: getFileIcon(path),
          closeable: true,
          dirty: dirtyFiles.has(path),
          onClose: closeTab,
        };
      }),
    [openTabs, dirtyFiles, closeTab],
  );

  if (openTabs.length === 0) {
    return (
      <div className="flex items-center gap-0.5 border-b border-mc-border bg-mc-surface px-1 py-1">
        <span className="px-2 py-1 text-xs text-mc-mute">暂无打开的文件</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <Tabs
        items={items}
        // 受控选中值。store 里 selectedFile 允许为 null（此刻没有选中文件），
        // 这里兜成空串：ui Tabs 的受控模式靠 items 校验回退到首个可用 tab，
        // 不会退化成非受控。exactOptionalPropertyTypes 下不能传 undefined
        // —— 那会被解读成「这个 prop 没传」而切到非受控分支。
        value={selectedFile ?? ''}
        onValueChange={selectFile}
        label="打开的文件"
        // 文件多时横向滚动，不换行（老实现行为）
        className="overflow-x-auto"
        // 隐藏空 tabpanel：见文件头第 1 条
        panelClassName="hidden"
        onTabAuxClick={(value, button) => handleAuxClick(value, button)}
        onTabContextMenu={(value, e) => handleContextMenu(value, e)}
        closeLabel={(_value, label) => `关闭 ${label}`}
      />

      {/* 右键菜单（约束在视口内）—— 与 Tabs 平级，不塞进 tablist */}
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
