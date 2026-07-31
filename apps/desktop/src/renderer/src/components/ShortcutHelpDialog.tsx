import { useEffect, useRef } from 'react';
import { Keyboard, X } from 'lucide-react';

export interface ShortcutEntry {
  keys: string;
  description: string;
  category: string;
}

/**
 * 全项目快捷键清单（单一来源）。
 *
 * MiddlePanel 的 keydown 监听、命令面板的 shortcut 字段、
 * 本帮助面板都应参考此清单，避免文档与实现脱节。
 */
export const SHORTCUTS: ShortcutEntry[] = [
  // 全局
  { keys: 'F1', description: '打开命令面板', category: '全局' },
  { keys: 'Ctrl+P', description: '打开命令面板（Quick Open 等价）', category: '全局' },
  { keys: 'Ctrl+Shift+P', description: '打开命令面板', category: '全局' },
  { keys: 'Ctrl+S', description: '保存当前文件', category: '全局' },
  { keys: 'Esc', description: '关闭对话框 / 命令面板', category: '全局' },

  // 命令面板
  { keys: '↑ / ↓', description: '在命令列表中上下移动', category: '命令面板' },
  { keys: 'Enter', description: '执行选中命令', category: '命令面板' },
  { keys: 'Tab', description: '切换命令分类', category: '命令面板' },
  { keys: 'Shift+Tab', description: '反向切换命令分类', category: '命令面板' },

  // 中间面板 Tab 切换
  { keys: '← / →', description: '在预览/资源/NBT/代码视图间切换', category: '中间面板' },

  // 空状态
  { keys: '点击「打开命令面板」', description: '空状态时快速触发命令面板', category: '空状态' },
];

interface ShortcutHelpDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 快捷键帮助对话框：列出全项目所有快捷键。
 *
 * 触发方式：命令面板中执行「快捷键帮助」命令。
 * 关闭方式：Esc / 点击遮罩 / 点击右上角 ✕。
 */
export function ShortcutHelpDialog({ open, onClose }: ShortcutHelpDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 按分类分组
  const grouped = SHORTCUTS.reduce<Record<string, ShortcutEntry[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});
  const categories = Object.keys(grouped);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-dialog-title"
        className="w-[560px] max-w-[90vw] overflow-hidden rounded-mc-lg border border-mc-border bg-mc-surface shadow-mc-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center gap-2 border-b border-mc-border px-4 py-3">
          <Keyboard className="h-4 w-4 text-mc-accent" aria-hidden="true" />
          <span id="shortcut-help-dialog-title" className="text-sm font-medium text-mc-text">
            快捷键帮助
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            aria-label="关闭 (Esc)"
            title="关闭 (Esc)"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* 快捷键列表（按分类分组） */}
        <div className="max-h-[60vh] overflow-y-auto px-4 py-3">
          {categories.map((cat) => (
            <div key={cat} className="mb-4 last:mb-0">
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
                {cat}
              </div>
              <div className="space-y-1">
                {grouped[cat].map((s, i) => (
                  <div
                    key={`${cat}-${i}`}
                    className="flex items-center justify-between gap-3 rounded-mc px-2 py-1.5 text-xs hover:bg-mc-surface-2"
                  >
                    <span className="text-mc-dim">{s.description}</span>
                    <kbd className="rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text">
                      {s.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* 底部提示 */}
        <div className="border-t border-mc-border bg-mc-surface-2 px-4 py-2 text-[10px] text-mc-mute">
          共 {SHORTCUTS.length} 个快捷键 · 按 Esc 关闭
        </div>
      </div>
    </div>
  );
}
