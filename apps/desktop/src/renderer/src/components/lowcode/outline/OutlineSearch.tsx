import { useCallback, useMemo, useState } from 'react';
import { McIcon } from '../../../assets/mc-ui/McIcon.js';

interface OutlineSearchProps {
  /** 当前搜索关键词 */
  value: string;
  /** 搜索变化回调 */
  onChange: (value: string) => void;
  /** 清空搜索回调 */
  onClear: () => void;
  /** 占位文本 */
  placeholder?: string;
  /** 节点总数（用于显示过滤结果计数） */
  totalCount?: number;
  /** 过滤后显示的节点数 */
  filteredCount?: number;
}

/**
 * 大纲面板搜索/过滤组件
 *
 * 功能：
 * - 实时关键词搜索（防抖由父组件控制）
 * - 清空按钮
 * - 显示过滤结果计数
 * - 键盘快捷键提示
 */
export function OutlineSearch({
  value,
  onChange,
  onClear,
  placeholder = '搜索节点（名称/类型/ID）',
  totalCount,
  filteredCount,
}: OutlineSearchProps) {
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value);
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        onClear();
        (e.target as HTMLInputElement).blur();
      }
    },
    [onClear],
  );

  const showCount = useMemo(() => {
    if (totalCount === undefined || filteredCount === undefined) return null;
    if (value === '') return null;
    return `${filteredCount} / ${totalCount}`;
  }, [totalCount, filteredCount, value]);

  return (
    <div className="relative flex items-center gap-2 border-b border-mc-border bg-mc-surface px-2 py-2">
      <McIcon
        scope="pixel"
        name="search"
        size={14}
        className="text-mc-mute flex-shrink-0"
        aria-hidden="true"
      />
      <input
        type="search"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={placeholder}
        className="flex-1 bg-transparent text-mc-text text-[11px] outline-none placeholder:text-mc-mute pr-6"
        aria-label="搜索节点"
        aria-describedby={showCount ? 'outline-search-count' : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <button
          type="button"
          onClick={onClear}
          aria-label="清空搜索"
          className="flex-shrink-0 p-0.5 rounded text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
          tabIndex={-1}
        >
          <McIcon scope="pixel" name="x" size={12} aria-hidden="true" />
        </button>
      )}
      {showCount && (
        <span
          id="outline-search-count"
          className="flex-shrink-0 text-[10px] text-mc-mute font-mono"
          aria-live="polite"
        >
          {showCount}
        </span>
      )}
      {!isFocused && !value && (
        <kbd className="hidden xs:inline-flex ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
          ⌘F
        </kbd>
      )}
    </div>
  );
}