/**
 * RecentGraphsMenu —— 最近打开的节点图下拉菜单
 *
 * 职责：
 * - 显示最近 10 个节点图条目（filePath / modId / savedAt / nodeCount）
 * - 点击条目触发 `onOpen(filePath)` 回调
 * - 空列表时显示友好提示
 * - 完整 a11y：role="menu" / role="menuitem" / aria-label / 键盘导航
 *
 * 键盘导航（roving tabindex 模式）：
 * - Arrow Down：焦点移到下一项（末项循环到首项）
 * - Arrow Up：焦点移到上一项（首项循环到末项）
 * - Enter / Space：触发当前项的 onOpen
 * - Escape：关闭菜单（调用 onClose）
 * - Home / End：跳到首项 / 末项
 *
 * 用法：
 * ```tsx
 * <RecentGraphsMenu
 *   entries={entries}
 *   onOpen={(path) => handleOpen(path)}
 *   onClose={() => setMenuOpen(false)}
 * />
 * ```
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecentGraphEntry } from '../../lib/nodeGraphPersistence.js';

interface RecentGraphsMenuProps {
  /** 最近打开条目列表（最多 10 条，由调用方从 listRecentGraphs 取） */
  entries: RecentGraphEntry[];
  /** 点击某条目时触发，参数为文件绝对路径 */
  onOpen: (filePath: string) => void;
  /** 关闭菜单（Escape 键或点击外部时触发） */
  onClose: () => void;
  /** 可选：额外的 aria-label 后缀，用于多实例区分 */
  ariaLabelSuffix?: string;
}

/**
 * 把 ISO 时间戳格式化为本地可读时间（YYYY-MM-DD HH:mm）。
 * 解析失败时回退为原字符串。
 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return iso;
  }
}

/**
 * 从绝对路径提取文件名（最后一段）。
 * 兼容 Windows `\` 与 POSIX `/` 分隔符。
 */
function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

export function RecentGraphsMenu({
  entries,
  onOpen,
  onClose,
  ariaLabelSuffix,
}: RecentGraphsMenuProps): JSX.Element {
  // 当前焦点项索引（-1 表示无焦点，菜单刚打开时默认聚焦首项以便键盘操作）
  const [focusedIdx, setFocusedIdx] = useState<number>(entries.length > 0 ? 0 : -1);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 菜单容器 ref，用于点击外部判定
  const containerRef = useRef<HTMLDivElement>(null);

  // 菜单打开时自动聚焦当前 focused 项
  useEffect(() => {
    if (focusedIdx >= 0 && itemRefs.current[focusedIdx]) {
      itemRefs.current[focusedIdx]?.focus();
    }
  }, [focusedIdx]);

  // 点击外部关闭菜单
  useEffect(() => {
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  // 键盘导航
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (entries.length === 0) {
      if (e.key === 'Escape') onClose();
      return;
    }
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setFocusedIdx((prev) => (prev + 1) % entries.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setFocusedIdx((prev) => (prev - 1 + entries.length) % entries.length);
        break;
      }
      case 'Home': {
        e.preventDefault();
        setFocusedIdx(0);
        break;
      }
      case 'End': {
        e.preventDefault();
        setFocusedIdx(entries.length - 1);
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (focusedIdx >= 0 && focusedIdx < entries.length) {
          onOpen(entries[focusedIdx].filePath);
        }
        break;
      }
      case 'Escape': {
        e.preventDefault();
        onClose();
        break;
      }
      default:
        break;
    }
  };

  const label = useMemo(
    () => `最近打开的节点图${ariaLabelSuffix ? `（${ariaLabelSuffix}）` : ''}`,
    [ariaLabelSuffix],
  );

  return (
    <div
      ref={containerRef}
      role="menu"
      aria-label={label}
      className="recent-graphs-menu absolute z-50 mt-1 w-80 rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
      onKeyDown={handleKeyDown}
    >
      {entries.length === 0 ? (
        <div
          role="menuitem"
          aria-disabled="true"
          className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400"
        >
          暂无最近打开的节点图
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto py-1" role="presentation">
          {entries.map((entry, idx) => (
            <li key={entry.filePath} role="presentation">
              <button
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={idx === focusedIdx ? 0 : -1}
                aria-label={`打开 ${basename(entry.filePath)}，modId: ${entry.modId || '(无)'}，${entry.nodeCount} 个节点，保存于 ${formatTime(entry.savedAt)}`}
                className="flex w-full flex-col items-start gap-0.5 px-4 py-2 text-left text-sm hover:bg-gray-100 focus:bg-blue-50 focus:outline-none dark:hover:bg-gray-700 dark:focus:bg-blue-900"
                onClick={() => onOpen(entry.filePath)}
                onMouseEnter={() => setFocusedIdx(idx)}
              >
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {basename(entry.filePath)}
                </span>
                <span className="flex w-full items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span className="truncate">
                    {entry.modId ? `modId: ${entry.modId}` : 'modId: (无)'}
                  </span>
                  <span className="ml-2 shrink-0">{entry.nodeCount} 节点</span>
                </span>
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {formatTime(entry.savedAt)}
                </span>
                {/* 完整路径以 title 形式提供，鼠标悬停可见，避免菜单过宽 */}
                <span
                  className="truncate text-xs text-gray-400 dark:text-gray-500"
                  title={entry.filePath}
                >
                  {entry.filePath}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
