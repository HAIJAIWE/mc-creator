/**
 * Progress —— 进度条（设计文档 §4.5；构建/编译进度展示）。
 *
 * 三层结构：外层容器（布局）→ `role="progressbar"` 的轨道（语义）→
 * 填充条（视觉）。语义放在轨道上而不是外层，是为了让读屏只念
 * 「进度条 40%」而不把 label/百分比文本重复念一遍。
 *
 * `value` 越界一律 clamp 而不是报错：进度值常常来自外部
 * （构建 JSON、任务回调），一个 `value: 120` 不该让整个面板白屏。
 * NaN 也归一到 0，理由同上。
 *
 * 填充色用 `rgbVar()` 内联引用 CSS 变量，而不是写死三元组 ——
 * 这样换肤（改写 `--mc-accent`）时进度条颜色跟着变。
 */
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { TONE_COLOR_VAR, rgbVar, type ToneColor } from '../theme/index';
import { cx } from '../utils';

/** 进度条语义色。 */
export type ProgressTone = ToneColor;

/** 把任意输入夹到 0..100；非有限数（NaN / Infinity）归一到 0。 */
export function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface ProgressProps extends HTMLAttributes<HTMLDivElement> {
  /** 当前进度 0..100（越界自动 clamp）。不传即视为不确定态 */
  value?: number;
  /** 强制不确定态（如「已连接，等待服务器响应」） */
  indeterminate?: boolean;
  /** 标签（同时作为可访问名，仅字符串时生效） */
  label?: ReactNode;
  /** 是否在标签行右侧显示百分比 */
  showPercent?: boolean;
  /** 语义色，默认 `accent` */
  tone?: ProgressTone;
}

/** Tailwind 过渡类名放在模块常量里，避免每次渲染新建字符串（利于 React.memo 比较）。 */
const FILL_TRANSITION = 'h-full transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]';

export function Progress({
  value,
  indeterminate = false,
  label,
  showPercent = false,
  tone = 'accent',
  className,
  style,
  ...rest
}: ProgressProps) {
  // 没有 value 或显式 indeterminate ⇒ 不确定态
  const isIndeterminate = indeterminate || value === undefined;
  const percent = isIndeterminate ? 0 : clampProgress(value as number);

  const labelText = typeof label === 'string' ? label : undefined;
  const percentText = `${percent}%`;
  // aria-valuetext 覆盖读屏对 aria-valuenow 的默认播报，
  // 带上 label 读起来才是「项目构建 40%」而不是孤零零的「40」
  const valueText = isIndeterminate
    ? (labelText ?? '加载中')
    : (labelText ? `${labelText} ${percentText}` : percentText);

  const fillStyle: CSSProperties = {
    background: rgbVar(TONE_COLOR_VAR[tone]),
    ...(isIndeterminate ? {} : { width: `${percent}%` }),
  };

  return (
    <div {...rest} className={cx('flex w-full flex-col gap-1', className)} style={style}>
      {label || showPercent ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-mc-dim">{label}</span>
          {showPercent && !isIndeterminate ? (
            <span className="mc-tag tabular-nums" data-testid="mc-progress-percent">
              {percentText}
            </span>
          ) : null}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        // 不确定态下 ARIA 规定不得出现 aria-valuenow（出现即表示已知值）
        aria-valuenow={isIndeterminate ? undefined : percent}
        aria-valuetext={valueText}
        {...(labelText ? { 'aria-label': labelText } : {})}
        className="h-2 w-full overflow-hidden rounded-mc border border-mc-border bg-mc-surface-2"
      >
        <div
          data-testid="mc-progress-fill"
          className={cx(FILL_TRANSITION, isIndeterminate && 'w-1/3 animate-pulse')}
          style={fillStyle}
        />
      </div>
    </div>
  );
}
