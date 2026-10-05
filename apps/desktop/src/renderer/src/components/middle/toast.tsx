import { useCallback, useRef, useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';

export interface ToastItem {
  id: number;
  msg: string;
  kind: 'success' | 'error' | 'info';
}

const TOAST_TIMEOUT = 2500;

/** 轻量 Toast：每个编辑器各用一个实例，无需全局 Context */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (msg: string, kind: ToastItem['kind'] = 'info') => {
      idRef.current += 1;
      const id = idRef.current;
      setToasts((prev) => [...prev.slice(-2), { id, msg, kind }]);
      setTimeout(() => dismiss(id), TOAST_TIMEOUT);
    },
    [dismiss],
  );

  return { toasts, push, dismiss };
}

export function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className="pointer-events-auto flex items-center gap-1.5 rounded-mc border border-mc-border bg-mc-surface-2/95 px-3 py-1.5 text-[11px] text-mc-text shadow-lg backdrop-blur"
          title="点击关闭"
        >
          {t.kind === 'success' ? (
            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
          ) : t.kind === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-400" />
          ) : null}
          <span>{t.msg}</span>
        </button>
      ))}
    </div>
  );
}
