import { useShallow } from 'zustand/react/shallow';
import { useDebuggerStore } from '../../../../store/debugger-store.js';
import type { NodeDebugState } from './McNodeHeader.js';

/**
 * 获取节点的调试状态（断点/调试中）。
 * 折叠时在 McNodeHeader 中显示标记。
 *
 * P2 性能优化：使用 useShallow 合并 3 个独立订阅为 1 个，
 * 减少 Zustand 订阅开销，避免任何 debugger 状态变化都触发 3 次重渲染。
 */
export function useDebugState(nodeId: string): NodeDebugState {
  const { isDebugMode, debugCurrentNodeId, hasBreakpoint } = useDebuggerStore(
    useShallow((s) => ({
      isDebugMode: s.state !== null,
      debugCurrentNodeId: s.state?.currentNodeId ?? null,
      hasBreakpoint: s.breakpoints.has(nodeId),
    })),
  );

  if (isDebugMode && debugCurrentNodeId === nodeId) return 'debugging';
  if (hasBreakpoint) return 'breakpoint';
  return null;
}
