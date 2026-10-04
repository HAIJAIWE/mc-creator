/**
 * Toast —— 轻量通知（设计文档 §4.5；§9 任务反馈；P32 通知系统）。
 *
 * API 对齐 `apps/desktop/src/renderer/src/components/ToastProvider.tsx`：
 * `<ToastProvider>` + `useToast()` 的 `success/error/warning/info` 快捷方法，
 * 让 desktop 后续替换时调用方几乎不用改（§5.4：desktop 尚未实际用
 * @mc-creator/ui 替换组件）。
 *
 * 与 desktop 版的两处有意差异：
 * 1. **`duration` 可按条覆盖**，`duration={0}` 表示不自动消失。
 *    desktop 版只有 `persistent` 布尔，且时长写死在模块常量里；
 *    这里把它变成可传参，「需要用户读完的错误」不必靠 persistent 绕。
 * 2. **live region 属性挂在每条 toast 上**，而不是另做一个 sr-only
 *    副本（desktop 的 LiveRegion 会把消息文本复制一份到隐藏区，
 *    导致测试/查询出现重复文本）。挂在真实节点上，少一份 DOM 也少一份漂移。
 *
 * 礼貌级别：error 用 `assertive`（立即打断读屏），其余 `polite`
 * （排队等空闲）—— 与 desktop 一致。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from '../utils';

/** 通知类型。命名对齐 desktop 的 ToastType。 */
export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

/** 各类型默认自动消失时长（毫秒）。error 给更久，因为要读完。 */
export const TOAST_DEFAULT_DURATION: Record<ToastVariant, number> = {
  info: 3000,
  success: 3000,
  warning: 4000,
  error: 5000,
};

/** 语义色 → 边框/文字色变量。 */
const VARIANT_VAR: Record<ToastVariant, { border: string; text: string; icon: string }> = {
  info: { border: '--mc-accent', text: '--mc-accent-bright', icon: 'ℹ' },
  success: { border: '--mc-accent', text: '--mc-accent-bright', icon: '✓' },
  warning: { border: '--mc-gold', text: '--mc-gold', icon: '⚠' },
  error: { border: '--mc-redstone', text: '--mc-redstone', icon: '✕' },
};

/** 一条通知的静态描述（不含 id）。 */
export interface ToastInput {
  /** 文案 */
  message: string;
  /** 类型，默认 `info` */
  variant?: ToastVariant;
  /** 自动消失时长；`0` = 不自动消失。省略则按 variant 取默认值 */
  duration?: number;
}

/** 一条通知（含运行时生成的 id）。 */
export interface ToastItem extends ToastInput {
  /** 唯一 id，`show()` 的返回值，可用于手动 dismiss */
  id: string;
  /** 类型已填默认值 */
  variant: ToastVariant;
  /** 时长已填默认值 */
  duration: number;
}

export interface ToastContextValue {
  /** 显示一条通知，返回其 id */
  show: (input: ToastInput) => string;
  /** 手动关闭指定 id */
  dismiss: (id: string) => void;
  /** 关闭全部 */
  clear: () => void;
  /** 当前通知列表（只读快照） */
  toasts: readonly ToastItem[];
  /** 快捷方法 */
  success: (message: string, options?: { duration?: number }) => string;
  error: (message: string, options?: { duration?: number }) => string;
  warning: (message: string, options?: { duration?: number }) => string;
  info: (message: string, options?: { duration?: number }) => string;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** 在 `<ToastProvider>` 内消费通知 API。 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}

/* ------------------------------------------------------------------ *
 * 单条通知
 * ------------------------------------------------------------------ */

export interface ToastProps {
  /** 唯一 id；独立使用时不传即可（关闭按钮会退化但不报错） */
  id?: string;
  /** 文案 */
  message: string;
  /** 类型，默认 `info` */
  variant?: ToastVariant;
  /** 自动消失时长（仅 Provider 会消费；独立展示时忽略）。`0` = 不自动消失 */
  duration?: number;
  /** 关闭回调。不传则不渲染关闭按钮的点击行为 */
  onDismiss?: (id: string) => void;
}

/** 单条通知。`role`/`aria-live` 挂在真实节点上（见文件头注释）。 */
export function Toast({ id, message, variant = 'info', onDismiss }: ToastProps) {
  const colors = VARIANT_VAR[variant];
  const isError = variant === 'error';
  // 独立使用（没经过 Provider）时不渲染关闭按钮，避免点了没反应的死按钮
  const dismissible = Boolean(onDismiss);
  return (
    <div
      data-testid="mc-toast"
      data-toast-id={id}
      // error 用 alert（隐含 assertive 且立即打断），其余用 status（polite）
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className="mc-pop pointer-events-auto flex min-w-[240px] max-w-[420px] items-start gap-2 border px-4 py-3"
      style={{
        borderColor: `rgb(var(${colors.border}) / 0.55)`,
      }}
    >
      <span
        aria-hidden="true"
        className="mt-0.5 shrink-0"
        style={{ color: `rgb(var(${colors.text}))` }}
      >
        {colors.icon}
      </span>
      <div className="flex-1 whitespace-pre-wrap text-sm text-mc-text">{message}</div>
      {dismissible ? (
        <button
          type="button"
          onClick={() => onDismiss?.(id ?? '')}
          aria-label={`关闭通知：${message}`}
          className="shrink-0 text-mc-text-dim transition-colors hover:text-mc-text"
        >
          <svg
            viewBox="0 0 16 16"
            className="mc-icon-svg h-4 w-4"
            aria-hidden="true"
            focusable="false"
          >
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="square"
              fill="none"
            />
          </svg>
        </button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

let toastSeq = 0;
/** 单调递增 id：同一毫秒内多次 show 也不会撞 id（Date.now() 会撞）。 */
function nextToastId(): string {
  toastSeq += 1;
  return `mc-toast-${Date.now().toString(36)}-${toastSeq}`;
}

export interface ToastProviderProps {
  children: ReactNode;
  /** 浮层位置，默认右上角（desktop 的 ToastProvider 同） */
  placement?: 'top-right' | 'bottom-right' | 'top-center' | 'bottom-center';
}

const PLACEMENT_CLASS: Record<NonNullable<ToastProviderProps['placement']>, string> = {
  'top-right': 'right-4 top-4',
  'bottom-right': 'right-4 bottom-4',
  'top-center': 'left-1/2 top-4 -translate-x-1/2',
  'bottom-center': 'left-1/2 bottom-4 -translate-x-1/2',
};

export function ToastProvider({ children, placement = 'top-right' }: ToastProviderProps) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  /** id → 定时器。存 ref 而非 state：定时器不是渲染数据 */
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const clear = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const show = useCallback(
    ({ message, variant = 'info', duration }: ToastInput): string => {
      const id = nextToastId();
      const resolvedDuration = duration ?? TOAST_DEFAULT_DURATION[variant];
      setToasts((prev) => [...prev, { id, message, variant, duration: resolvedDuration }]);

      // duration === 0 ⇒ 不自动消失（需用户手动关闭）
      if (resolvedDuration > 0) {
        const timer = setTimeout(() => dismiss(id), resolvedDuration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  // 卸载时清掉所有定时器：否则 Provider 卸载后定时器仍会 setState（内存泄漏 + 警告）
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      dismiss,
      clear,
      toasts,
      success: (message, options) =>
        show({ message, variant: 'success', ...(options?.duration !== undefined ? { duration: options.duration } : {}) }),
      error: (message, options) =>
        show({ message, variant: 'error', ...(options?.duration !== undefined ? { duration: options.duration } : {}) }),
      warning: (message, options) =>
        show({ message, variant: 'warning', ...(options?.duration !== undefined ? { duration: options.duration } : {}) }),
      info: (message, options) =>
        show({ message, variant: 'info', ...(options?.duration !== undefined ? { duration: options.duration } : {}) }),
    }),
    [show, dismiss, clear, toasts],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        data-testid="mc-toast-stack"
        className={cx(
          'pointer-events-none fixed z-[200] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2',
          PLACEMENT_CLASS[placement],
        )}
      >
        {toasts.map((item) => (
          <Toast key={item.id} {...item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
