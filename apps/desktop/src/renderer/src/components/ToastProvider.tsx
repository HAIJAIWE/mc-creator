import { useCallback, useState, type ReactNode } from 'react';
import { Toast as UiToast, type ToastAction as UiToastAction } from '@mc-creator/ui';
import { LiveRegion } from './common/LiveRegion';
import { ToastContext, type ToastType, type ToastItem, type ToastAction } from './useToast';

/**
 * Toast 通知系统（P32）—— 单条 toast 的视觉与无障碍语义复用 `@mc-creator/ui`
 * 的 `Toast`，栈容器 / 朗读区 / 领域方法留在 desktop。
 *
 * ## 为什么是「适配」而不是直接换成 ui 的 `ToastProvider`
 *
 * ui 的 ToastProvider 是通用组件，desktop 现有行为有三处**产品特定**，换掉会
 * 改动既有对外契约：
 *
 * 1. **领域方法 `showConflictToast`**：三个决策按钮（接受服务器 / 保留本地 /
 *    查看差异）。ui 不知道「文件冲突」是什么，这段业务描述属于 desktop。
 * 2. **上下文 API 形状**：desktop 是 `toast(message, type, options)` 三参；
 *    ui 是 `show({message, variant, ...})`。3 处调用方按 desktop 形状写。
 * 3. **测试锚点**：既有测试用 `toast-stack` 定位栈、用
 *    `live-region-toast-announcer` 定位朗读区。ui 的 testid 是 `mc-toast-stack`，
 *    且刻意不另做朗读副本（见 ui Toast 文件头注释）。
 *
 * 真正的复用发生在**单条 toast** 上：视觉（`.mc-pop` + 语义色边框）、无障碍
 * （`role="status"/"alert"` + `aria-live` + `aria-atomic`）、操作按钮组
 * （`role="group" aria-label="操作"`）、关闭按钮全部来自 ui。
 */

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};

/**
 * desktop 动作档位 → ui toast 的 tone。
 *
 * desktop 有三档（primary/secondary/ghost），ui 只有两档。映射理由：
 * `secondary`（强调但非主推）与 `ghost`（弱）在 ui 两档里语义等价 —— 都只是
 * 「可点但不抢视觉焦点」；真正需要抢焦点的「查看差异」已经标成 primary。
 * 保留三档写法是为了调用方不必改；将来 ui 若加档位只需改这一张表。
 */
const TONE_BY_VARIANT: Record<NonNullable<ToastAction['variant']>, 'primary' | 'ghost'> = {
  primary: 'primary',
  secondary: 'ghost',
  ghost: 'ghost',
};

/** desktop ToastType 与 ui variant 名字一致（success/error/warning/info）。 */
function toUiActions(item: ToastItem, onRemove: (id: string) => void): UiToastAction[] | undefined {
  if (item.actions === undefined || item.actions.length === 0) return undefined;
  return item.actions.map((action) => ({
    label: action.label,
    disabled: false,
    tone: TONE_BY_VARIANT[action.variant ?? 'ghost'],
    onClick: () => {
      action.onClick();
      // persistent 的提示点完不消失（冲突提示要留到用户处理完）
      if (!item.persistent) onRemove(item.id);
    },
  }));
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (
      message: string,
      type: ToastType = 'info',
      options?: { actions?: ToastAction[]; persistent?: boolean },
    ) => {
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
        className="pointer-events-none fixed right-4 top-4 z-[200] flex w-[min(480px,calc(100vw-2rem))] flex-col gap-2"
      >
        {toasts.map((t) => {
          // 条件展开而非直接传 undefined：exactOptionalPropertyTypes 下 actions?: T
          // 不接受显式 undefined
          const uiActions = toUiActions(t, remove);
          return (
            <UiToast
              key={t.id}
              id={t.id}
              message={t.message}
              variant={t.type}
              // 关闭按钮的可访问名沿用 desktop 既有文案（ui 默认是「关闭通知：…」）
              closeLabel="关闭"
              onDismiss={remove}
              {...(uiActions === undefined ? {} : { actions: uiActions })}
            />
          );
        })}
      </div>
      {/* a11y：朗读最新 toast，屏幕阅读器可感知通知而不必聚焦到右上角。
          注：ui 的 Toast 已把 aria-live 挂在真实节点上，这里保留独立 LiveRegion
          是为了不改动既有对外契约（测试与 a11y 扫描都锚定这个 testid）。 */}
      <LiveRegion
        id="toast-announcer"
        message={latestToast?.message ?? ''}
        politeness={latestToast?.type === 'error' ? 'assertive' : 'polite'}
      />
    </ToastContext.Provider>
  );
}
