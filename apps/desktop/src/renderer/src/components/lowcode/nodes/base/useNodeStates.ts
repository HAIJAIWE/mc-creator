import { useDebuggerStore } from '../../../../store/debugger-store.js';
import type { NodeDebugState } from './McNodeHeader.js';

/**
 * 获取节点的调试状态（断点/调试中）。
 * 折叠时在 McNodeHeader 中显示标记。
 */
export function useDebugState(nodeId: string): NodeDebugState {
  const isDebugMode = useDebuggerStore((s) => s.state !== null);
  const debugCurrentNodeId = useDebuggerStore((s) => s.state?.currentNodeId ?? null);
  const hasBreakpoint = useDebuggerStore((s) => s.breakpoints.has(nodeId));

  if (isDebugMode && debugCurrentNodeId === nodeId) return 'debugging';
  if (hasBreakpoint) return 'breakpoint';
  return null;
}
