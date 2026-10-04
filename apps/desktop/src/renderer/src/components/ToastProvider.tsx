import { useState, useCallback, type ReactNode } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { LiveRegion } from './common/LiveRegion';
import { ToastContext, type ToastType, type ToastItem, type ToastAction } from './useToast';

/**
 * Toast 通知系统（P32）。
 *
 * - 4 种类型：success / error / warning / info
 * - 自动消失（success/info 3s，warning 4s，error 5s）
 * - 手动关闭按钮
 * - 支持操作按钮（用于冲突提示等需要用户决策的场景）
 * - 深色主题 + lucide-react 图标
 * - 右上角堆叠，slide-in 动画
 *
 * 用法：
 *   import { useToast } from './useToast';
 *   const toast = useToast();
 *   toast.success('导入成功');
 *   toast.error('导入失败：xxx');
 *   toast.showConflictToast({ ... }); // 显示冲突处理 toast
 *
 * 注：useToast hook 和 ToastContext 都在 ./useToast.ts 中导出，
 * 让本文件只导出 ToastProvider component，符合 react-refresh/only-export-components 规则。
 */

const TYPE_CONFIG: Record<
  ToastType,
  { icon: { scope: 'pixel'; name: string }; color: string; border: string }
> = {
  success: {
    icon: { scope: 'pixel', name: 'check' },
    color: 'text-mc-accent',
    border: 'border-mc-accent',
  },
  error: {
    icon: { scope: 'pixel', name: 'square-alert' },
    color: 'text-mc-redstone',
    border: 'border-mc-redstone',
  },
  warning: {
    icon: { scope: 'pixel', name: 'warning-box' },
    color: 'text-mc-gold',
    border: 'border-mc-gold',
  },
  info: {
    icon: { scope: 'pixel', name: 'info-box' },
    color: 'text-mc-accent',
    border: 'border-mc-accent',
  },
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};

function ToastItemComponent({
  item,
  onRemove,
}: {
  item: ToastItem;
  onRemove: (id: string) => void;
}) {
  const config = TYPE_CONFIG[item.type];
  const icon = config.icon;

  const renderActions = () => {
    if (!item.actions || item.actions.length === 0) return null;
    return (
      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-mc-border/30">
        {item.actions.map((action, i) => (
          <button
            key={i}
            onClick={() => {
              action.onClick();
              if (!item.persistent) onRemove(item.id);
            }}
            className={`text-xs px-2 py-1 rounded-mc transition-colors ${
              action.variant === 'primary'
                ? 'bg-mc-accent text-mc-bg hover:bg-mc-accent/80'
                : action.variant === 'secondary'
                ? 'bg-mc-surface-3 text-mc-text hover:bg-mc-surface-4'
                : 'text-mc-dim hover:text-mc-text hover:bg-mc-surface-3'
            }`}
          >
            {action.label}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`pointer-events-auto flex flex-col gap-2 rounded-mc-lg border ${config.border} bg-mc-surface px-4 py-3 shadow-mc-pop min-w-[320px] max-w-[480px] animate-mc-toast-in`}
    >
      <div className="flex items-start gap-2">
        <McIcon
          scope={icon.scope}
          name={icon.name}
          size={20}
          className={`mt-0.5 flex-shrink-0 ${config.color}`}
        />
        <div className="flex-1 text-sm text-mc-text whitespace-pre-wrap">{item.message}</div>
        <button
          onClick={() => onRemove(item.id)}
          className="flex-shrink-0 text-mc-text-dim transition-colors hover:text-mc-text"
          aria-label="关闭"
        >
          <McIcon scope="pixel" name="close" size={16} />
        </button>
      </div>
      {renderActions()}
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info', options?: { actions?: ToastAction[]; persistent?: boolean }) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newToast: ToastItem = { id, type, message };
      if (options?.actions) newToast.actions = options.actions;
      if (options?.persistent) newToast.persistent = options.persistent;
      setToasts((prev) => [...prev, newToast]);
      const dur = DEFAULT_DURATION[type];
      if (!options?.persistent) {
        setTimeout(() => remove(id), dur);
      }
    },
    [remove],
  );

  const showConflictToast = useCallback(
    (params: {
      filePath: string;
      serverMeta: { mtime: number; size: number; hash: string };
      localMeta: { mtime: number; size: number; hash: string } | null;
      onAcceptServer: () => void;
      onKeepLocal: () => void;
      onViewDiff: () => void;
    }) => {
      const { filePath, serverMeta, localMeta, onAcceptServer, onKeepLocal, onViewDiff } = params;
      const localDesc = localMeta
        ? `本地: mtime=${localMeta.mtime}, size=${localMeta.size}, hash=${localMeta.hash.slice(0, 8)}`
        : '本地: (文件不存在)';
      const message = `文件冲突：${filePath}\n服务器: mtime=${serverMeta.mtime}, size=${serverMeta.size}, hash=${serverMeta.hash.slice(0, 8)}; ${localDesc}`;

      toast(message, 'warning', {
        persistent: true,
        actions: [
          { label: '接受服务器版本', onClick: onAcceptServer, variant: 'secondary' },
          { label: '保留本地版本', onClick: onKeepLocal, variant: 'secondary' },
          { label: '查看差异', onClick: onViewDiff, variant: 'primary' },
        ],
      });
    },
    [toast],
  );

  const value = {
    toast,
    success: (m: string) => toast(m, 'success'),
    error: (m: string) => toast(m, 'error'),
    warning: (m: string) => toast(m, 'warning'),
    info: (m: string) => toast(m, 'info'),
    showConflictToast,
  };

  // a11y：最新一条 toast 朗读给屏幕阅读器（error 用 assertive 立即打断，其余 polite）
  const latestToast = toasts[toasts.length - 1];

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器：fixed top-right，z-index 高于所有模态框 */}
      <div
        data-testid="toast-stack"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="pointer-events-none fixed right-4 top-4 z-[200] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastItemComponent key={t.id} item={t} onRemove={remove} />
        ))}
      </div>
      {/* a11y：朗读最新 toast，屏幕阅读器可感知通知而不必聚焦到右上角 */}
      <LiveRegion
        id="toast-announcer"
        message={latestToast?.message ?? ''}
        politeness={latestToast?.type === 'error' ? 'assertive' : 'polite'}
      />
    </ToastContext.Provider>
  );
}