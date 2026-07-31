/**
 * useRecentGraphs —— 节点图「最近打开」列表 React hook
 *
 * 职责：
 * - mount 时自动 refresh，从 localStorage 拉取最近列表
 * - 暴露 refresh / remove 方法供 UI 触发
 * - 用 loading / error 暴露异步状态，便于 UI 显示加载/错误反馈
 *
 * 使用示例：
 * ```tsx
 * const { recent, refresh, remove, loading, error } = useRecentGraphs();
 * ```
 *
 * 设计要点：
 * - 不依赖 zustand，纯 React 局部状态，避免增加全局 store 复杂度
 * - 内部用 canceled 标志防止 unmount 后的异步回调调用 setState（避免内存泄漏警告）
 * - remove 后自动 refresh，保持列表与 localStorage 同步
 * - recent 类型为 nodeGraphPersistence.ts 中定义的 RecentGraphEntry（含 filePath/modId/savedAt/nodeCount）
 */

import { useCallback, useEffect, useState } from 'react';
import {
  listRecentGraphs,
  removeRecentGraph,
  type RecentGraphEntry,
} from './nodeGraphPersistence.js';

export interface UseRecentGraphsResult {
  /** 最近打开的节点图列表（按最近优先排序，最多 10 条） */
  recent: RecentGraphEntry[];
  /** 重新拉取最近列表 */
  refresh: () => Promise<void>;
  /** 从最近列表移除指定路径（移除后自动 refresh） */
  remove: (filePath: string) => Promise<void>;
  /** 是否正在加载 */
  loading: boolean;
  /** 错误消息（无错误时为 null） */
  error: string | null;
}

/**
 * 节点图「最近打开」列表 hook。
 *
 * mount 时自动 refresh；unmount 时通过 canceled 标志取消进行中的异步回调避免内存泄漏。
 * remove 调用 removeRecentGraph 后自动 refresh，保持 UI 与 localStorage 同步。
 */
export function useRecentGraphs(): UseRecentGraphsResult {
  const [recent, setRecent] = useState<RecentGraphEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const list = await listRecentGraphs();
      setRecent(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(
    async (filePath: string): Promise<void> => {
      setError(null);
      try {
        // removeRecentGraph 是同步函数（操作 localStorage），但保持 async 签名便于未来切换到 IPC
        removeRecentGraph(filePath);
        // 移除成功后刷新列表，保持与 localStorage 同步
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [refresh],
  );

  // mount 时自动 refresh
  useEffect(() => {
    let canceled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listRecentGraphs();
        if (!canceled) setRecent(list);
      } catch (err) {
        if (!canceled) setError((err as Error).message);
      } finally {
        if (!canceled) setLoading(false);
      }
    })();
    return () => {
      canceled = true;
    };
  }, []);

  return { recent, refresh, remove, loading, error };
}
