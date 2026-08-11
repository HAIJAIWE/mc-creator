import { createWithEqualityFn } from 'zustand/traditional';
import type { NodeGraph } from '@mc-creator/shared';
import {
  initDebugger,
  stepForward,
  runUntilBreakpoint,
  resetDebugger,
  type DebugState,
} from '../lib/nodeGraphDebugger.js';

/**
 * 调试器 UI 状态管理（Zustand）
 *
 * 与 useNodeGraphStore 解耦：调试器不直接修改节点图，仅读取 graph 进行模拟。
 * UI（DebuggerPanel）订阅本 store 的 state/breakpoints/isRunning/isPaused。
 *
 * 状态机：
 * - idle：state=null，未启动
 * - running：state≠null，isRunning=true（run 模式中）
 * - paused：state≠null，isPaused=true（单步或遇断点暂停）
 * - finished：state.finished=true（执行完成）
 *
 * 控制：
 * - start(graph)：初始化调试器，进入第一个 event 节点（多 event 时依次串行遍历全部入口）
 * - step(graph)：单步推进
 * - run(graph)：执行到下一断点或结束
 * - reset(graph)：重置回初始状态
 * - stop：清空 state，回到 idle
 *
 * 断点：
 * - toggleBreakpoint(nodeId)：切换节点断点
 * - clearBreakpoints()：清空所有断点
 */

interface DebuggerStore {
  /** 调试器执行状态（null 表示未启动） */
  state: DebugState | null;
  /** 断点集合（节点 id） */
  breakpoints: Set<string>;
  /** 是否正在自动运行（run 模式） */
  isRunning: boolean;
  /** 是否暂停（单步或断点命中） */
  isPaused: boolean;

  // === 控制 ===
  /** 启动调试器：初始化状态，进入第一个 event 节点 */
  start: (graph: NodeGraph) => void;
  /** 单步执行 */
  step: (graph: NodeGraph) => void;
  /** 执行到下一断点或结束 */
  run: (graph: NodeGraph) => void;
  /** 重置调试器到初始状态 */
  reset: (graph: NodeGraph) => void;
  /** 停止调试，清空状态 */
  stop: () => void;

  // === 断点 ===
  /** 切换节点断点 */
  toggleBreakpoint: (nodeId: string) => void;
  /** 清空所有断点 */
  clearBreakpoints: () => void;
}

export const useDebuggerStore = createWithEqualityFn<DebuggerStore>((set, get) => ({
  state: null,
  breakpoints: new Set<string>(),
  isRunning: false,
  isPaused: false,

  start: (graph) => {
    const state = initDebugger(graph);
    set({
      state,
      isRunning: false,
      isPaused: true, // 启动后暂停在入口
    });
  },

  step: (graph) => {
    const current = get().state;
    if (!current) return;
    if (current.finished) return;
    const next = stepForward(graph, current);
    set({
      state: next,
      isRunning: false,
      isPaused: true,
    });
  },

  run: (graph) => {
    const current = get().state;
    if (!current) return;
    if (current.finished) return;
    const breakpoints = get().breakpoints;
    // 标记 running
    set({ isRunning: true, isPaused: false });
    const next = runUntilBreakpoint(graph, current, breakpoints);
    set({
      state: next,
      isRunning: false,
      isPaused: !next.finished,
    });
  },

  reset: (graph) => {
    const state = resetDebugger(graph);
    set({
      state,
      isRunning: false,
      isPaused: true,
    });
  },

  stop: () => {
    set({
      state: null,
      isRunning: false,
      isPaused: false,
    });
  },

  toggleBreakpoint: (nodeId) => {
    const current = get().breakpoints;
    const next = new Set(current);
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    set({ breakpoints: next });
  },

  clearBreakpoints: () => {
    set({ breakpoints: new Set<string>() });
  },
}));
