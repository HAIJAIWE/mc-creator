import { useCallback, type ReactNode } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useTranslation } from '../hooks/useTranslation';

interface ConfirmDialogProps {
  /** 是否显示 */
  open: boolean;
  /** 标题 */
  title?: string;
  /** 消息内容（支持 i18n key 或直接文本） */
  message: string;
  /** 确认按钮文本 */
  confirmText?: string;
  /** 取消按钮文本 */
  cancelText?: string;
  /** 是否为危险操作（红色确认按钮） */
  destructive?: boolean;
  /** 点击确认回调 */
  onConfirm: () => void | Promise<void>;
  /** 点击取消/关闭回调 */
  onCancel: () => void;
  /** 确认按钮 loading 状态 */
  confirmLoading?: boolean;
  /** 子组件（可选，用于自定义内容） */
  children?: ReactNode;
}

/**
 * 确认对话框（替代 window.confirm）
 *
 * 用法：
 *   const [showConfirm, setShowConfirm] = useState(false);
 *   const handleDelete = () => setShowConfirm(true);
 *
 *   <ConfirmDialog
 *     open={showConfirm}
 *     message="确定删除该文件吗？"
 *     onConfirm={async () => { await deleteFile(); setShowConfirm(false); }}
 *     onCancel={() => setShowConfirm(false)}
 *   />
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmText,
  cancelText,
  destructive = false,
  onConfirm,
  onCancel,
  confirmLoading = false,
  children,
}: ConfirmDialogProps) {
  const { tCommon } = useTranslation();

  const handleConfirm = useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && !confirmLoading) {
        handleConfirm();
      }
    },
    [onCancel, handleConfirm, confirmLoading],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center"
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'confirm-title' : undefined}
      aria-describedby="confirm-message"
    >
      {/* 遮罩层 */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-mc-fade-in"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* 对话框 */}
      <div className="relative w-full max-w-md mx-4 bg-mc-surface border border-mc-border rounded-mc-lg shadow-mc-pop overflow-hidden animate-mc-panel-in">
        {(title || children) && (
          <div className="flex items-center justify-between border-b border-mc-border px-4 py-3">
            <h2 id="confirm-title" className="text-sm font-semibold text-mc-text">
              {title ?? tCommon('warning')}
            </h2>
            <button
              onClick={onCancel}
              className="text-mc-text-dim hover:text-mc-text transition-colors"
              aria-label={tCommon('close') ?? '关闭'}
            >
              <McIcon scope="pixel" name="close" size={18} />
            </button>
          </div>
        )}

        <div className="px-4 py-4">
          <div id="confirm-message" className="text-sm text-mc-text mb-4">
            {children ?? message}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-mc-border px-4 py-3">
          <button onClick={onCancel} disabled={confirmLoading} className="mc-btn-ghost">
            {cancelText ?? tCommon('cancel') ?? '取消'}
          </button>
          <button
            onClick={handleConfirm}
            disabled={confirmLoading}
            className={`mc-btn ${destructive ? 'mc-btn-destructive' : 'mc-btn-primary'}`}
          >
            {confirmLoading ? (
              <span className="flex items-center gap-1.5">
                <McIcon scope="pixel" name="loader" size={14} className="animate-spin" />{' '}
                {tCommon('loading') ?? '处理中...'}
              </span>
            ) : (
              (confirmText ?? tCommon('confirm') ?? '确定')
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 简易 confirm 替代函数（非 React 组件环境使用）
 * 注意：这是同步阻塞的，仅用于无法使用组件的场景
 */
export function confirmI18n(message: string, _title?: string): boolean {
  if (typeof window === 'undefined') return true;
  // 简单的 fallback，实际项目中建议始终使用 ConfirmDialog 组件
  return window.confirm(message);
}
