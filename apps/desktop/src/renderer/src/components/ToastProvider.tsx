import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { CheckCircle, AlertCircle, AlertTriangle, Info, X } from 'lucide-react';

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
 *   const toast = useToast();
 *   toast.success('导入成功');
 *   toast.error('导入失败：xxx');
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TYPE_CONFIG: Record<
  ToastType,
  { icon: typeof CheckCircle; color: string; border: string }
> = {
  success: { icon: CheckCircle, color: 'text-green-400', border: 'border-green-600' },
  error: { icon: AlertCircle, color: 'text-red-400', border: 'border-red-600' },
  warning: { icon: AlertTriangle, color: 'text-yellow-400', border: 'border-yellow-600' },
  info: { icon: Info, color: 'text-blue-400', border: 'border-blue-600' },
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

  const value: ToastContextValue = {
    toast,
    success: (m) => toast(m, 'success'),
    error: (m) => toast(m, 'error'),
    warning: (m) => toast(m, 'warning'),
    info: (m) => toast(m, 'info'),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast 容器：fixed top-right，z-index 高于所有模态框 */}
      <div className="pointer-events-none fixed right-4 top-4 z-[200] flex flex-col gap-2">
        {toasts.map((t) => {
          const config = TYPE_CONFIG[t.type];
          const Icon = config.icon;
          return (
            <div
              key={t.id}
              className={`pointer-events-auto flex items-start gap-2 rounded-lg border ${config.border} bg-zinc-900 px-4 py-3 shadow-lg min-w-[280px] max-w-[400px] toast-slide-in`}
            >
              <Icon className={`mt-0.5 h-5 w-5 flex-shrink-0 ${config.color}`} />
              <div className="flex-1 text-sm text-zinc-100">{t.message}</div>
              <button
                onClick={() => remove(t.id)}
                className="flex-shrink-0 text-zinc-400 hover:text-white"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
