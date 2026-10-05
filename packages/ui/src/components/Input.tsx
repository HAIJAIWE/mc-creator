/**
 * Input —— 带 label / hint / 校验错误的表单输入框（设计文档 §4.5；§12 设置项）。
 *
 * 复用 index.css 的 `.mc-input`（`bg-mc-surface-2` + `border-mc-border`
 * + 聚焦时 accent 描边），组件只补三件 CSS 做不到的事：
 *
 * 1. **label ↔ input 的程序化关联**：有 `label` 时自动生成稳定 id 并写
 *    `htmlFor` / `id`。靠视觉上的「文字紧挨输入框」建立关联对屏幕
 *    阅读器无效（读屏念不出「项目名」三个字从哪来）。
 * 2. **错误的可达性**：出错时同时给 `aria-invalid="true"` +
 *    `role="alert"` 的错误文案 + `aria-describedby` 连线，
 *    三者缺一，弱视用户就只能看到一个红框。
 * 3. **hint 与 error 互斥**：出错时 hint 让位给 error，
 *    且 `aria-describedby` 只指向真实渲染的那个，避免悬空引用。
 */
import { forwardRef, useId, type ForwardedRef, type InputHTMLAttributes } from 'react';
import { cx } from '../utils';

/** 尺寸。`md` 沿用 index.css `.mc-input` 内建的 `px-3 py-1.5 text-sm`。 */
export type InputSize = 'sm' | 'md' | 'lg';

const SIZE_CLASS: Record<InputSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: '',
  lg: 'px-3 py-2 text-base',
};

/**
 * 注意 `Omit<..., 'size'>`：`InputHTMLAttributes.size` 是原生
 * `size="20"`（字符宽度），与「视觉尺寸档位」撞名。本组件用 Tailwind
 * 控制尺寸，原生字符宽度属性在这里没有意义（`fullWidth` + className
 * 覆盖已够用），故让 `size` 表示视觉档位。
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 字段标签。有值即自动生成 id 并建立 htmlFor 关联 */
  label?: string;
  /** 校验错误文案。有值即 `aria-invalid` + `role="alert"` */
  error?: string;
  /** 辅助说明（无 error 时展示） */
  hint?: string;
  /** 尺寸，默认 `md` */
  size?: InputSize;
  /** 占满父容器宽度 */
  fullWidth?: boolean;
}

function InputComponent(
  { label, error, hint, size = 'md', fullWidth = false, id, className, ...rest }: InputProps,
  ref: ForwardedRef<HTMLInputElement>,
) {
  const reactId = useId();
  // React 18 的 useId 产出 `:r0:`（带冒号），冒号会让消费方的
  // CSS/文档查询选择器写起来必须转义，去掉更省心。
  const baseId = id ?? (label ? `mc-input-${reactId.replace(/:/g, '')}` : undefined);

  const errorId = error ? `${baseId}-error` : undefined;
  const hintId = hint && !error ? `${baseId}-hint` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cx('flex flex-col gap-1', fullWidth && 'w-full')}>
      {label ? (
        <label htmlFor={baseId} className="text-xs font-medium text-mc-dim">
          {label}
        </label>
      ) : null}

      <input
        {...rest}
        ref={ref}
        id={baseId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          'mc-input',
          SIZE_CLASS[size],
          // 错误态：Tailwind utilities 层在 components 层之后，
          // 同 specificity 下 utilities 胜出，可安全覆盖 .mc-input 的边框色
          error && 'border-mc-redstone focus:border-mc-redstone focus:ring-mc-redstone',
          className,
        )}
      />

      {error ? (
        <p id={errorId} role="alert" className="text-xs text-mc-redstone">
          {error}
        </p>
      ) : null}
      {hintId ? (
        <p id={hintId} className="text-xs text-mc-mute">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef(InputComponent);
Input.displayName = 'Input';
