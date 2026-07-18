import { useState, useCallback, type ReactNode } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ToastContext, type ToastType } from './useToast';

/**
 * Toast 通知系统（P32）。
 *
 * - 4 种类型：success / error / warning / info
 * - 自动消失（success/info 3s，warning 4s，error 5s）
 * - 手动关闭按钮
 * - 深色主题 + lucide-react 图标
 * - 右上角堆叠，slide-in 动画
 *
 * 用法：
 *   import { useToast } from './useToast';
 *   const toast = useToast();
 *   toast.success('导入成功');
 *   toast.error('导入失败：xxx');
 *
 * 注：useToast hook 和 ToastContext 都在 ./useToast.ts 中导出，
 * 让本文件只导出 ToastProvider component，符合 react-refresh/only-export-components 规则。
 */

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      const dur = DEFAULT_DURATION[type];
      setTimeout(() => remove(id), dur);
    },
    [remove],
  );

  const value = {
    toast,
    success: (m: string) => toast(m, 'success'),
    error: (m: string) => toast(m, 'error'),
    warning: (m: string) => toast(m, 'warning'),
    info: (m: string) => toast(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器：fixed top-right，z-index 高于所有模态框 */}
      <div className="pointer-events-none fixed right-4 top-4 z-[200] flex flex-col gap-2">
        {toasts.map((t) => {
          const config = TYPE_CONFIG[t.type];
          const icon = config.icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-mc-lg border ${config.border} bg-mc-surface px-4 py-3 shadow-mc-pop min-w-[280px] max-w-[400px] animate-mc-toast-in`}
            >
              <McIcon
                scope={icon.scope}
                name={icon.name}
                size={20}
                className="mt-0.5 flex-shrink-0"
              />
              <div className="flex-1 text-sm text-mc-text">{t.message}</div>
              <button
                onClick={() => remove(t.id)}
                className="flex-shrink-0 text-mc-text-dim transition-colors hover:text-mc-text"
                aria-label="关闭"
              >
                <McIcon scope="pixel" name="close" size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
