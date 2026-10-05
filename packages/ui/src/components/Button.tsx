/**
 * Button —— Minecraft 凸起方块按钮（设计文档 §4.5 设计系统；§12 设置项）。
 *
 * 为什么是「薄封装」：立体阴影、高光、按下塌陷全部由 index.css 的
 * `.mc-btn-primary` / `.mc-btn-ghost` / `.mc-btn-danger` 用
 * `var(--mc-shadow-block)` 实现，组件只负责把 `variant` 映射到正确的
 * className —— 样式一旦在组件里用内联 style 重写，换肤（改写
 * `--mc-*` 变量）就失效了。
 *
 * 两条容易被忽略但很关键的约定：
 * 1. `type` 默认 `'button'`。HTML 的 button 默认 `type="submit"`，
 *    放在 `<form>` 里会意外提交表单，是最常见的隐形 bug 源。
 * 2. `loading` 时**真禁用**（`disabled`）而不只是加 loading 样式，
 *    避免重复提交；同时补 `aria-busy` 让屏幕阅读器知道正在处理。
 */
import { forwardRef, type ButtonHTMLAttributes, type ForwardedRef, type ReactNode } from 'react';
import { cx } from '../utils';

/** 视觉变体 → index.css 的组件 class。 */
export type ButtonVariant = 'primary' | 'ghost' | 'danger';

/** 尺寸。`md` 直接用 index.css 内建的 `px-3 py-1.5 text-xs`。 */
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'mc-btn-primary',
  ghost: 'mc-btn-ghost',
  danger: 'mc-btn-danger',
};

/**
 * size 只补 sm/lg 的偏移量，`md` 留空。
 * 基础间距由 `.mc-btn-*` 单点定义，避免两处定义互相漂移。
 */
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-[11px]',
  md: '',
  lg: 'px-4 py-2 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体，默认 `primary` */
  variant?: ButtonVariant;
  /** 尺寸，默认 `md` */
  size?: ButtonSize;
  /** 加载中：禁用点击 + `aria-busy`，左侧显示 spinner（文案保留，避免宽度跳动） */
  loading?: boolean;
  /** 左侧图标（自动 `aria-hidden`，不参与朗读） */
  iconLeft?: ReactNode;
  /** 右侧图标（自动 `aria-hidden`） */
  iconRight?: ReactNode;
  /** 占满父容器宽度 */
  fullWidth?: boolean;
}

/** 内联 SVG spinner：零第三方依赖（不引 lucide），且继承 currentColor。 */
function Spinner() {
  return (
    <svg
      className="mc-icon-svg h-3 w-3 animate-spin"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="24 12"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ButtonComponent(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    iconLeft,
    iconRight,
    fullWidth = false,
    // 见文件头注释 1：绝不默认 submit
    type = 'button',
    disabled = false,
    className,
    children,
    ...rest
  }: ButtonProps,
  ref: ForwardedRef<HTMLButtonElement>,
) {
  // loading 与 disabled 合并成「不可交互」：loading 时不该能重复提交
  const inert = disabled || loading;

  return (
    <button
      {...rest}
      ref={ref}
      type={type}
      disabled={inert}
      // 只在 loading 时出现，不写 aria-busy="false" 噪声
      aria-busy={loading ? true : undefined}
      data-loading={loading ? 'true' : undefined}
      className={cx(
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        fullWidth && 'w-full',
        loading && 'cursor-progress',
        className,
      )}
    >
      {loading ? <Spinner /> : iconLeft ? <span className="mc-icon-svg">{iconLeft}</span> : null}
      {children}
      {!loading && iconRight ? <span className="mc-icon-svg">{iconRight}</span> : null}
    </button>
  );
}

export const Button = forwardRef(ButtonComponent);
Button.displayName = 'Button';
