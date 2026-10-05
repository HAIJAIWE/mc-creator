/**
 * Modal —— 模态对话框（设计文档 §4.5；§10.6 执行须弹窗）。
 *
 * 行为对齐 `apps/desktop/src/renderer/src/components/ConfirmDialog.tsx`
 * （遮罩点击关闭 / Escape 关闭 / role="dialog" + aria-modal），并补上
 * ConfirmDialog 缺的两件事：
 *
 * 1. **焦点陷阱（focus trap）**：`aria-modal="true"` 只是告诉读屏
 *    「背景内容已惰化」，**不会**阻止 Tab 键把焦点移到背后的页面 ——
 *    键盘用户会掉进看不见焦点的黑洞（这是 WCAG 2.1.2 的硬要求）。
 *    这里用 document 级 keydown 监听把 Tab 在面板内循环。
 * 2. **焦点归还**：关闭时把焦点还给打开它的那个元素；不还就等于
 *    把用户的键盘位置凭空重置到 body（WCAG 2.4.3）。
 *
 * 为什么用 portal：模态必须脱离父级的 `overflow: hidden` /
 * `transform` / `z-index` 包含块，否则「fixed 居中」会被某个
 * 祖先的 transform 变成相对定位。挂到 document.body 才可靠。
 */
import { useCallback, useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../utils';

/** 宽度档位。`md` 对齐 ConfirmDialog 的 `max-w-md`。 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/**
 * 面板内可聚焦元素选择器。
 *
 * 每个条目都要自带 `:not([tabindex="-1"])`：CSS 逗号是「或」而不是「与」，
 * 只在最后一个条目上写一次排除条件是无效的 —— `button:not([disabled])`
 * 依然会匹配 `tabIndex={-1}` 的按钮，那类元素本不该进 Tab 序列。
 */
const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([type="hidden"]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** 列出容器内所有可聚焦元素（按 tab 顺序）。导出来便于测试与复用。 */
export function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

export interface ModalProps {
  /** 是否显示。`false` 时不渲染任何 DOM（连遮罩都没有） */
  open: boolean;
  /** 标题（渲染成 heading 并作为 `aria-labelledby` 目标） */
  title?: ReactNode;
  /** 关闭回调（遮罩点击 / Escape / 右上角关闭按钮三处都会调） */
  onClose: () => void;
  /** 正文 */
  children?: ReactNode;
  /** 底部操作区 */
  footer?: ReactNode;
  /** 宽度档位，默认 `md` */
  size?: ModalSize;
  /** 点遮罩是否关闭，默认 true */
  closeOnOverlayClick?: boolean;
  /** Escape 是否关闭，默认 true */
  closeOnEscape?: boolean;
  /** 打开后聚焦的元素；不传则聚焦面板内第一个可聚焦元素 */
  initialFocusRef?: RefObject<HTMLElement>;
  /**
   * 关闭按钮的可访问名，默认 `关闭`。
   *
   * 为什么可注入：i18n（§4.5）要求错误文案映射层统一多语言。关闭按钮是
   * 每个对话框都要朗读的控件，硬编码中文会让英文环境读出中文；
   * 调用方从自己的文案表取 `common.close` 传进来即可。
   */
  closeLabel?: string;
  /** 面板 className 覆盖 */
  className?: string;
}

/** 内联 X 图标（零第三方依赖，继承 currentColor）。 */
function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" className="mc-icon-svg h-4 w-4" aria-hidden="true" focusable="false">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="square"
        fill="none"
      />
    </svg>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  size = 'md',
  closeOnOverlayClick = true,
  closeOnEscape = true,
  initialFocusRef,
  closeLabel = '关闭',
  className,
}: ModalProps) {
  const reactId = useId().replace(/:/g, '');
  const titleId = `mc-modal-title-${reactId}`;
  const bodyId = `mc-modal-body-${reactId}`;

  const panelRef = useRef<HTMLDivElement>(null);
  /** 关闭按钮：参与 Tab 循环，但**不作为初始焦点**（见下方注释） */
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  /** 打开前的焦点，用于关闭后归还 */
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // 打开：记住当前焦点 → 聚焦目标；关闭/卸载：归还焦点
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // 初始焦点优先级：initialFocusRef > 面板内第一个「非关闭按钮」的可聚焦元素 > 面板本身。
    // 刻意跳过关闭按钮：它在 DOM 里排最前，若默认聚焦它，用户手一抖按下
    // Enter/Space 就把弹窗关了 —— 对话框的初始焦点应落在最无害的元素上。
    const target =
      initialFocusRef?.current ??
      getFocusableElements(panelRef.current).find((el) => el !== closeButtonRef.current) ??
      panelRef.current;
    target?.focus();
    return () => {
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (!closeOnEscape) return;
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusables = getFocusableElements(panel);

      // 面板内一个可聚焦元素都没有：把焦点钉在面板上（tabIndex={-1}）。
      // 当前实现里关闭按钮恒定渲染，所以这条是防御性的 —— 万一将来加了
      // `hideCloseButton`，没有它焦点就会直接逃出弹窗。
      if (focusables.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1] as HTMLElement;
      const active = document.activeElement;
      const inside = active !== null && panel.contains(active);
      // 焦点在面板自身（tabIndex={-1}，不在可聚焦列表里）时视为「边界外」，
      // 两个方向都要显式接管：否则正向要依赖浏览器原生把焦点送进面板内
      // 首个 tabbable 元素，行为在不同浏览器/嵌套结构下并不一致。
      const onPanel = active === panel;

      if (event.shiftKey) {
        if (!inside || onPanel || active === first) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || onPanel || active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, closeOnEscape, onClose]);

  const handleOverlayClick = useCallback(() => {
    if (!closeOnOverlayClick) return;
    onClose();
  }, [closeOnOverlayClick, onClose]);

  // 早退必须排在全部 hook 之后（React Hooks 规则）
  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
      {/* 遮罩：纯装饰（aria-hidden），点击关闭 */}
      <div
        data-testid="mc-modal-overlay"
        aria-hidden="true"
        onClick={handleOverlayClick}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-mc-dialog-in"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={bodyId}
        // tabIndex=-1 让面板本身可被程序化聚焦（无子元素可聚焦时的兜底），
        // 同时被 :not([tabindex="-1"]) 选择器排除，不进 Tab 序列
        tabIndex={-1}
        className={cx(
          'mc-pop relative flex max-h-[85vh] w-full flex-col overflow-hidden animate-mc-dialog-in',
          SIZE_CLASS[size],
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-mc-border px-4 py-3">
          {title ? (
            <h2 id={titleId} className="text-sm font-semibold text-mc-text">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {/* 关闭按钮恒定渲染：没有它，键盘用户在无标题的 Modal 里
              就只剩 Escape 一条出路（而 closeOnEscape 可能被关掉） */}
          <button
            type="button"
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={closeLabel}
            className="shrink-0 text-mc-dim transition-colors hover:text-mc-text"
          >
            <CloseIcon />
          </button>
        </div>

        <div
          id={bodyId}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap px-4 py-4 text-sm text-mc-text"
        >
          {children}
        </div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-mc-border px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
