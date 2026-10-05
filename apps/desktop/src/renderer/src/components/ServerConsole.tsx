import { useCallback, useEffect, useRef, useState } from 'react';
import { ipcClient } from '../lib/ipc-client.js';
import { KernelReadLogsResponse } from '../../../shared/ipc-channels.js';

/**
 * 服务端控制台（§17 闭环的只读观测面）。
 *
 * 只做一件事：对单个 serverId 轮询只读 kind `read_logs` 并展示尾部日志。
 * - mount 后立即拉一次，之后每 5s 自动轮询；unmount 时清 interval，
 *   且任何情况下不在 unmount 后 setState（mountedRef 守卫）。
 * - 所有响应走 `KernelReadLogsResponse.safeParse`，形状不对只记本组件
 *   错误条（role=alert），不抛、不崩、不污染外部。
 * - 渲染层绝不 import 内核包、不碰 `kernel:execute`、不新增 IPC 通道。
 */
export function ServerConsole({ serverId }: { serverId: string }) {
  const [tail, setTail] = useState<string[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const prevServerIdRef = useRef(serverId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchLogs = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);
    try {
      // serverId 直接透传，不做任何拼接（与 KernelPanel 同一约定）。
      const res = await ipcClient.kernelRead({ kind: 'read_logs', payload: { serverId } });
      if (!mountedRef.current) return;
      const parsed =
        res.ok && res.data !== null ? KernelReadLogsResponse.safeParse(res.data) : null;
      if (parsed !== null && parsed.success) {
        setTail(parsed.data.tail.slice(-100));
        setFile(parsed.data.file);
      } else {
        setError(res.error?.message ?? '日志形状不符合契约（KernelReadLogsResponse）');
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError((e as Error).message);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    // serverId 变化时重置状态并重拉（paused 开关保持用户选择，
    // 但切 server 必重拉一次）；仅切换暂停开关不触发多余拉取。
    const serverChanged = prevServerIdRef.current !== serverId;
    prevServerIdRef.current = serverId;
    if (serverChanged) {
      setTail([]);
      setFile(null);
      setError(null);
      setLoading(true);
    }
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await fetchLogs();
    };
    if (!paused || serverChanged) void run();
    if (paused) {
      return () => {
        cancelled = true;
      };
    }
    const timerId = setInterval(() => {
      void run();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timerId);
    };
  }, [serverId, paused, fetchLogs]);

  const statusText = paused ? '已暂停' : loading ? '加载中' : error !== null ? '错误' : '运行中';

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <span className="text-xs font-medium text-mc-text">服务端控制台</span>
        <span className="text-[10px] text-mc-mute" data-testid="console-file">
          {file ?? '—'}
        </span>
        <span className="text-[10px] text-mc-dim" data-testid="console-status">
          {statusText}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label={paused ? '继续自动刷新' : '暂停自动刷新'}
            onClick={() => setPaused((p) => !p)}
            className="rounded-mc border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-text"
          >
            {paused ? '继续' : '暂停'}
          </button>
          <button
            type="button"
            aria-label="手动刷新"
            onClick={() => void fetchLogs()}
            className="rounded-mc border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-text"
          >
            刷新
          </button>
        </div>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="border-b border-mc-border bg-red-500/10 px-3 py-2 text-[11px] text-red-400"
        >
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading && tail.length === 0 && error === null ? (
          <p className="text-[11px] text-mc-mute">日志加载中…</p>
        ) : tail.length === 0 ? (
          <p className="text-[11px] text-mc-mute">暂无日志输出</p>
        ) : (
          <pre
            data-testid="console-tail"
            className="whitespace-pre-wrap break-all font-mono text-[11px] text-mc-text"
          >
            {tail.join('\n')}
          </pre>
        )}
      </div>
    </div>
  );
}
