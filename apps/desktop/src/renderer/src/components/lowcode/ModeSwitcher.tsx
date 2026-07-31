import { memo, useCallback } from 'react';
import type { KeyboardEvent } from 'react';
import type { EditorMode } from '@mc-creator/shared';
import { useEditorModeStore } from '../../store/editor-mode-store.js';

interface ModeSwitcherProps {
  /** 自定义类名 */
  className?: string;
  /** 是否禁用 */
  disabled?: boolean;
}

const MODE_LABELS: Record<EditorMode, { label: string; short: string; description: string }> = {
  lowcode: {
    label: '低代码',
    short: 'L1',
    description: '节点图编辑，预置节点表达所有内容',
  },
  hybrid: {
    label: '混合',
    short: 'L2',
    description: '节点图 + 代码节点，复杂逻辑内嵌 Monaco',
  },
  purecode: {
    label: '纯代码',
    short: 'L3',
    description: '跳过节点图，直接 Monaco + 项目脚手架',
  },
};

const MODE_ORDER: EditorMode[] = ['lowcode', 'hybrid', 'purecode'];

/**
 * 编辑模式切换器
 *
 * 三段式：L1 低代码 / L2 混合 / L3 纯代码
 * 切换不影响数据，仅切换 UI 表现。
 *
 * WAI-ARIA Radiogroup 模式（a11y 增强）：
 * - role="radiogroup" + role="radio" aria-checked 已存在
 * - 增加 Roving Tabindex：仅当前选中项 tabIndex=0，其余 tabIndex=-1
 * - 增加方向键导航：ArrowLeft/ArrowRight/ArrowUp/ArrowDown/Home/End
 *   朗读切换结果（屏幕阅读器会因 aria-checked 变化自动播报）
 * - 短名前缀 L1/L2/L3 在 aria-label 中保留，便于朗读时识别模式层级
 */
function ModeSwitcherComponent({ className, disabled }: ModeSwitcherProps) {
  const mode = useEditorModeStore((s) => s.mode);
  const setMode = useEditorModeStore((s) => s.setMode);

  // 方向键导航：在 radiogroup 内移动焦点到下一个 radio
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;
      const currentIdx = MODE_ORDER.indexOf(mode);
      let nextIdx: number | null = null;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          nextIdx = (currentIdx + 1) % MODE_ORDER.length;
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          nextIdx = (currentIdx - 1 + MODE_ORDER.length) % MODE_ORDER.length;
          break;
        case 'Home':
          nextIdx = 0;
          break;
        case 'End':
          nextIdx = MODE_ORDER.length - 1;
          break;
        default:
          return; // 不处理其他键
      }
      e.preventDefault();
      if (nextIdx !== null && nextIdx !== currentIdx) {
        const nextMode = MODE_ORDER[nextIdx];
        setMode(nextMode);
        // 切换后把焦点移到新选中项（用按钮 id 定位）
        const btn = document.getElementById(`mode-switch-${nextMode}`);
        btn?.focus();
      }
    },
    [disabled, mode, setMode],
  );

  return (
    <div
      role="radiogroup"
      aria-label="编辑模式切换"
      onKeyDown={handleKeyDown}
      className={`inline-flex items-center gap-0.5 rounded-mc-md border border-mc-border bg-mc-surface-2 p-0.5 ${
        className ?? ''
      }`}
    >
      {MODE_ORDER.map((m) => {
        const info = MODE_LABELS[m];
        const isActive = mode === m;
        return (
          <button
            key={m}
            id={`mode-switch-${m}`}
            type="button"
            role="radio"
            aria-checked={isActive}
            // Roving Tabindex：仅当前选中项在 tab 序列中
            tabIndex={isActive ? 0 : -1}
            aria-label={`${info.short} ${info.label}：${info.description}`}
            title={info.description}
            disabled={disabled}
            onClick={() => setMode(m)}
            className={`flex items-center gap-1 rounded-mc px-2 py-1 text-[11px] font-medium transition-colors ${
              isActive
                ? 'bg-mc-accent text-white'
                : 'text-mc-dim hover:bg-mc-surface hover:text-mc-text'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span aria-hidden="true" className="opacity-70">
              {info.short}
            </span>
            <span>{info.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export const ModeSwitcher = memo(ModeSwitcherComponent);
