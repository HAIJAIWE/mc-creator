/**
 * Card —— 内容容器（设计文档 §4.5 设计系统）。
 *
 * 复用 index.css 的 `.mc-card`（`rounded-mc-lg` + `border-mc-border-strong`
 * + `var(--mc-sheen)` 顶面受光 + 1px 外投影）。Card 只负责**槽位语义**：
 * 标题区 / 内容区 / 页脚区三段式布局，以及 `interactive` 的可点击语义。
 *
 * `interactive` 的 a11y 处理：hover 态本身对键盘与读屏用户毫无意义，
 * 所以一旦传了 `onClick`，组件会自动补 `tabIndex={0}` + `role="button"`
 * + Enter/Space 激活。只做视觉不加键盘可达性的「假按钮」是 a11y 反模式，
 * 这里宁可让库替调用方补齐，也不给desktop 侧留坑。
 */
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { cx } from '../utils';

/** 内边距。`none` 留给「自己管间距」的复杂布局。 */
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

/** 标题渲染成哪个 heading 标签 —— 由外层文档的标题层级决定，暴露出来避免硬编码 h3。 */
export type CardTitleAs = 'h2' | 'h3' | 'h4';

const PADDING_CLASS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
};

/**
 * 注意 `Omit<..., 'title'>`：`HTMLAttributes.title` 是原生悬浮说明
 * （`title="提示语"`），与「卡片标题」语义撞名。卡片标题更重要，故占用
 * 该名字；需要原生悬浮说明时改用 `aria-label`。
 */
export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** 标题区标题 */
  title?: ReactNode;
  /** 标题区副标题 */
  subtitle?: ReactNode;
  /** 页脚区（按钮组等） */
  footer?: ReactNode;
  /** hover 高亮 + 可聚焦（配合 `onClick` 时自动补 role/tabIndex/键盘激活） */
  interactive?: boolean;
  /** 内容区内边距，默认 `md` */
  padding?: CardPadding;
  /** 标题标签，默认 `h3` */
  titleAs?: CardTitleAs;
}

export function Card({
  title,
  subtitle,
  footer,
  interactive = false,
  padding = 'md',
  titleAs: TitleTag = 'h3',
  onClick,
  onKeyDown,
  className,
  children,
  ...rest
}: CardProps) {
  // 只有「可交互 + 真的有点击行为」才升级成 button 语义
  const clickable = interactive && Boolean(onClick);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    onKeyDown?.(event);
    if (!clickable || event.defaultPrevented) return;
    // Space 在 div 上默认会滚动页面，必须拦掉
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick?.(event as unknown as React.MouseEvent<HTMLDivElement>);
    }
  };

  return (
    <div
      {...rest}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      // 条件展开而非传 undefined：exactOptionalPropertyTypes 下更明确
      {...(clickable ? { role: 'button', tabIndex: 0 } : {})}
      className={cx(
        'mc-card',
        interactive && 'cursor-pointer transition-colors hover:bg-mc-surface-3',
        className,
      )}
    >
      {title || subtitle ? (
        <div className="border-b border-mc-border px-4 py-3">
          {title ? <TitleTag className="text-sm font-semibold text-mc-text">{title}</TitleTag> : null}
          {subtitle ? <p className="mt-0.5 text-xs text-mc-text-dim">{subtitle}</p> : null}
        </div>
      ) : null}

      <div className={PADDING_CLASS[padding]}>{children}</div>

      {footer ? <div className="border-t border-mc-border px-4 py-3">{footer}</div> : null}
    </div>
  );
}
