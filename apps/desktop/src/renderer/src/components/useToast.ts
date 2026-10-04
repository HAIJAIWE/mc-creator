import { createContext, useContext } from 'react';

/**
 * Toast 类型与 context（从 ToastProvider 拆出，便于 Fast Refresh）。
 *
 * ToastProvider.tsx 只导出 component；useToast hook 在本文件导出。
 * 这样 react-refresh/only-export-components 规则不会警告，且 Dashboard 等
 * 消费方直接从本文件导入 hook，无需经过 provider 文件。
 */

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  actions?: ToastAction[];
  /** 不自动消失（用于需要用户操作的 toast） */
  persistent?: boolean;
}

export interface ToastContextValue {
  toast: (message: string, type?: ToastType, options?: { actions?: ToastAction[]; persistent?: boolean }) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
  /** 显示冲突 toast，包含三个操作按钮 */
  showConflictToast: (params: {
    filePath: string;
    serverMeta: { mtime: number; size: number; hash: string };
    localMeta: { mtime: number; size: number; hash: string } | null;
    onAcceptServer: () => void;
    onKeepLocal: () => void;
    onViewDiff: () => void;
  }) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

/** 在 ToastProvider 内消费 toast API。 */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return ctx;
}
