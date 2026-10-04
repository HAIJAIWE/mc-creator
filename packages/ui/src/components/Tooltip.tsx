/**
 * Tooltip —— 悬浮提示（设计文档 §4.5）。
 *
 * 定位策略：纯 CSS 绝对定位（`bottom-full` / `top-full` / `left-full` …），
 * **不做运行时测量**。测量式定位（floating-ui 那一套）能避免视口溢出，
 * 但需要额外依赖 + 布局抖动，与「零运行时第三方依赖」冲突；
 * 这里的取舍是：提示内容由调用方控制简短，配合 `max-w` 基本不会溢出，
 * 真需要精确避让的场景应在业务层自行处理。
 *
 * 两个必须做对的无障碍点：
 * 1. **键盘也要能触发**。只监听 `onMouseEnter` 的 tooltip 对键盘用户
 *    完全不存在 —— 这里是 `focus`/`blur` 与 hover 双通道。
 * 2. **`aria-describedby` 常驻**在触发元素上。tooltip 未显示时它是隐藏的，
 *    但 `aria-describedby` 仍然指向它，读屏在聚焦触发元素的瞬间就能
 *    取到描述；只在显示时才补属性会造成「聚焦先于 hover」的时序竞态。
 *
 * `children` 一律包一层 `<span tabIndex={0}>`：触发源常常是纯文本或图标
 * （`<span>`/自定义图标），本身不可聚焦，包一层才有一个键盘可达的触发点。
 * 已知代价：若 children 本身已可聚焦（如 `<button>`），会出现两个 Tab 停靠点。
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cx } from '../utils';

/** 提示出现的位置。 */
export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

const PLACEMENT_CLASS: Record<TooltipPlacement, string> = {
  // 纯 CSS 绝对定位 + -translate- 做居中，无需 JS 测量
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-1',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-1',
  left: 'right-full top-1/2 -translate-y-1/2 mr-1',
  right: 'left-full top-1/2 -translate-y-1/2 ml-1',
};

/** 四种放置方向各自需要的定位 class（导出便于测试与复用）。 */
export function tooltipPlacementClass(placement: TooltipPlacement): string {
  return PLACEMENT_CLASS[placement];
}

export interface TooltipProps {
  /** 提示文本 */
  content: ReactNode;
  /** 出现位置，默认 `top` */
  placement?: TooltipPlacement;
  /** 延迟显示毫秒数（隐藏不延迟，避免「鼠标划过就闪」）。默认 200 */
  delayMs?: number;
  /** 禁用：不响应任何触发 */
  disabled?: boolean;
  /** 触发源 */
  children: ReactNode;
  /** 触发元素 className */
  className?: string;
}

export function Tooltip({
  content,
  placement = 'top',
  delayMs = 200,
  disabled = false,
  children,
  className,
}: TooltipProps) {
  const reactId = useId().replace(/:/g, '');
  const tooltipId = `mc-tooltip-${reactId}`;

  const [open, setOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 卸载时清掉待触发的定时器，否则会对已卸载组件 setState
  useEffect(() => clearTimer, [clearTimer]);

  const show = useCallback(() => {
    if (disabled) return;
    clearTimer();
    if (delayMs <= 0) {
      setOpen(true);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setOpen(true);
    }, delayMs);
  }, [disabled, delayMs, clearTimer]);

  /** 隐藏是即时的：再延迟只会让 tooltip 显得粘手。 */
  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  // disabled 从 false 翻到 true 时要主动收起已显示的提示
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  // Escape 收起（键盘用户移开焦点前的主动关闭路径）
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    if (event.key === 'Escape' && open) {
      event.stopPropagation();
      hide();
    }
  };

  return (
    <span
      className={cx('relative inline-flex', className)}
      // 纯 CSS 触发：hover 与 focus-within 都能点亮，无需 JS 监听
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={handleKeyDown}
    >
      <span className="inline-flex" tabIndex={0} aria-describedby={tooltipId}>
        {children}
      </span>
      {open ? (
        <span
          role="tooltip"
          id={tooltipId}
          data-testid="mc-tooltip"
          className={cx(
            'mc-pop pointer-events-none absolute z-50 whitespace-nowrap px-2 py-1 text-xs text-mc-text',
            PLACEMENT_CLASS[placement],
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
