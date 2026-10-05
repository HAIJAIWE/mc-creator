import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog } from './ConfirmDialog.js';
import type { KernelConfirmReq } from '../../../shared/ipc-channels.js';

/**
 * 内核确认宿主（X2b，§10.6 UI 确认的渲染层落点）。
 *
 * 主进程的 `createUiConfirm` 经 `KERNEL_CONFIRM_REQUEST` 把 `{ id, kind, summary,
 * risk }` 推过来（不带 payload —— 渲染层只需要展示，不需要路径等敏感信息）；
 * 本组件只做三件事：订阅 → 用 `ConfirmDialog` 问用户 → 把 `{ id, approved }`
 * 经 `KERNEL_CONFIRM_RESPONSE` 应答回去。
 *
 * 安全纪律（缺一不可）：
 * - 绝不自动确认：除了用户亲手点「确定」，没有任何路径会发出 `approved: true`
 *  （无默认批准、无超时自动批准 —— 超时由主进程侧计时兜底为 `false`）；
 * - 同 id 重复请求以后到为准：单槽 `useState` 直接覆盖，被顶掉的请求由主进程
 *   超时兜底为拒绝；
 * - `unmount` 时取消订阅（`effect` 清理函数调 `off()`）。
 */
export function KernelConfirmHost() {
  const [pending, setPending] = useState<KernelConfirmReq | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const subscribe = window.mcApi?.onKernelConfirmRequest;
    if (typeof subscribe !== 'function') return;
    const off = subscribe((req: KernelConfirmReq) => {
      setPending(req);
    });
    return () => {
      off();
    };
  }, []);

  const handleConfirm = useCallback(async () => {
    if (pending === null) return;
    const { id } = pending;
    try {
      await window.mcApi.respondKernelConfirm({ id, approved: true });
    } finally {
      setPending((cur) => (cur !== null && cur.id === id ? null : cur));
    }
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (pending === null) return;
    const { id } = pending;
    void window.mcApi.respondKernelConfirm({ id, approved: false }).finally(() => {
      setPending((cur) => (cur !== null && cur.id === id ? null : cur));
    });
  }, [pending]);

  return (
    <ConfirmDialog
      open={pending !== null}
      message={pending?.summary ?? ''}
      {...(pending !== null ? { title: `确认执行 ${pending.kind}` } : {})}
      destructive={pending?.risk === 'execute'}
      onConfirm={() => void handleConfirm()}
      onCancel={handleCancel}
    />
  );
}
