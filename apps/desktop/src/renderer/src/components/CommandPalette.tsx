import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, CornerDownLeft } from 'lucide-react';

export interface Command {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  /** 命令分类（用于过滤显示） */
  category?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * 命令面板（VS Code 风格）：F1 触发，模糊过滤命令列表，键盘上下选择 + 回车执行。
 * 包含 MC 命令补全（/give /summon /tp 等）+ 命令分类筛选。
 */
export function CommandPalette({ open, onClose, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时重置状态并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setActiveCategory('all');
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // 提取所有分类
  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const c of commands) {
      if (c.category) set.add(c.category);
    }
    return ['all', ...Array.from(set).sort()];
  }, [commands]);

  const categoryLabels: Record<string, string> = useMemo(
    () => ({
      all: '全部',
      file: '文件',
      view: '视图',
      git: 'Git',
      edit: '编辑',
      mc: 'MC 命令',
      tools: '工具',
      ai: 'AI',
      project: '项目',
    }),
    [],
  );

  // 过滤命令：分类 + 模糊匹配
  const filtered = useMemo(() => {
    let result = commands;
    if (activeCategory !== 'all') {
      result = result.filter((c) => c.category === activeCategory);
    }
    if (!query) return result;
    const q = query.toLowerCase();
    return result.filter(
      (c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q),
    );
  }, [commands, query, activeCategory]);

  // 输入变化时重置选中项
  useEffect(() => {
    setSelectedIdx(0);
  }, [query, activeCategory]);

  // 自动滚动选中项到可视区（必须在 early return 之前调用以遵守 hooks 规则）
  useEffect(() => {
    if (!open) return;
    const el = document.getElementById(`cmd-item-${selectedIdx}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, open]);

  if (!open) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      // Tab 切换分类
      const curIdx = categories.indexOf(activeCategory);
      const nextIdx = e.shiftKey
        ? (curIdx - 1 + categories.length) % categories.length
        : (curIdx + 1) % categories.length;
      setActiveCategory(categories[nextIdx]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filtered[selectedIdx];
      if (cmd) {
        cmd.run();
        onClose();
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[90vw] overflow-hidden rounded-mc-lg border border-mc-border bg-mc-surface shadow-mc-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
          <Search className="h-4 w-4 text-mc-mute" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入命令名或 / 触发 MC 命令补全…"
            className="flex-1 bg-transparent text-sm text-mc-text outline-none placeholder:text-mc-mute"
          />
          <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-xs text-mc-dim">
            ESC 关闭 · Tab 切分类
          </span>
        </div>

        {/* 分类标签栏 */}
        {categories.length > 1 && (
          <div className="flex flex-wrap items-center gap-1 border-b border-mc-border bg-mc-surface-2 px-2 py-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${
                  activeCategory === cat
                    ? 'bg-mc-accent text-white'
                    : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                }`}
              >
                {categoryLabels[cat] ?? cat}
              </button>
            ))}
          </div>
        )}

        {/* 命令列表 */}
        <div className="max-h-[400px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-mc-mute">未找到匹配命令</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                id={`cmd-item-${i}`}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => {
                  cmd.run();
                  onClose();
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors ${
                  i === selectedIdx ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-text'
                }`}
              >
                <div className="flex flex-1 items-center gap-2">
                  {/* 分类徽章 */}
                  {cmd.category && (
                    <span
                      className={`rounded-mc px-1.5 py-0.5 text-[9px] ${
                        cmd.category === 'mc'
                          ? 'bg-green-500/20 text-green-400'
                          : cmd.category === 'git'
                            ? 'bg-orange-500/20 text-orange-400'
                            : cmd.category === 'ai'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-mc-surface-3 text-mc-mute'
                      }`}
                    >
                      {categoryLabels[cmd.category] ?? cmd.category}
                    </span>
                  )}
                  <div className="flex flex-col">
                    <span className="font-medium">{cmd.label}</span>
                    {cmd.description && <span className="text-mc-mute">{cmd.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {cmd.shortcut && (
                    <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-xs text-mc-dim">
                      {cmd.shortcut}
                    </span>
                  )}
                  {i === selectedIdx && <CornerDownLeft className="h-3 w-3" />}
                </div>
              </button>
            ))
          )}
        </div>

        {/* 底部统计 */}
        <div className="border-t border-mc-border bg-mc-surface-2 px-3 py-1 text-[10px] text-mc-mute">
          {filtered.length} / {commands.length} 个命令 · 当前分类：
          {categoryLabels[activeCategory] ?? activeCategory}
        </div>
      </div>
    </div>
  );
}
