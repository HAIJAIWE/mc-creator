import { useEffect, useRef, useMemo } from 'react';
import type { NodeGraph, ModNode } from '@mc-creator/shared';
import { useDebuggerStore } from '../../store/debugger-store.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import type { DebugLogEntry } from '../../lib/nodeGraphDebugger.js';

/**
 * 节点图可视化调试器面板
 *
 * 布局（底部水平面板，高度 200px）：
 * ┌────────────────────────────────────────────────────────────────┐
 * │ [▶ 开始] [⏭ 单步] [⏩ 运行] [⏹ 停止] [🔄 重置] | 状态: 已暂停 │
 * ├──────────────┬───────────────────────┬──────────────────────────┤
 * │ 调用栈        │  变量检查器            │  执行日志（最近 50 条）   │
 * │ - n_event    │  currentNode: n_action │  [ts] enter n_event      │
 * │ - n_condition│  inputs: {item_stack}  │  [ts] execute n_condition│
 * │              │  outputs: {result: true}│  [ts] branch-true        │
 * └──────────────┴───────────────────────┴──────────────────────────┘
 *
 * 与 NodeGraphEditor 集成：
 * - 通过 onHighlightNode 回调通知父组件高亮当前节点
 * - 父组件可在 LowcodeWorkspace 中订阅 useDebuggerStore 的 currentNodeId
 */

interface DebuggerPanelProps {
  /**
   * 当前节点图（可选）。
   *
   * 性能：未传时组件会自行从 useNodeGraphStore 订阅 graph，避免父组件
   * （如 LowcodeWorkspace）仅为传 prop 而订阅整个 graph 对象，从而在节点
   * 拖动等高频 graph 变更时触发不必要的工作区重渲染。
   * 测试中仍可传入自定义 graph 以隔离 store 状态。
   */
  graph?: NodeGraph;
  /** 高亮当前节点的回调（主代理接入 NodeGraphEditor） */
  onHighlightNode?: (nodeId: string | null) => void;
}

/** 日志区域最多显示条数 */
const MAX_LOG_DISPLAY = 50;

/** 根据 node id 在 graph 中查找节点 */
function findNode(graph: NodeGraph, nodeId: string): ModNode | null {
  return graph.nodes.find((n) => n.id === nodeId) ?? null;
}

/** 格式化时间戳为 HH:mm:ss.SSS */
function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

/** 日志条目对应的显示标签 */
function actionLabel(action: DebugLogEntry['action']): string {
  switch (action) {
    case 'enter':
      return '进入';
    case 'execute':
      return '执行';
    case 'leave':
      return '离开';
    case 'branch-true':
      return '分支真';
    case 'branch-false':
      return '分支假';
    case 'error':
      return '错误';
    default:
      return action;
  }
}

/** 日志条目对应的颜色 */
function actionColor(action: DebugLogEntry['action']): string {
  switch (action) {
    case 'enter':
      return 'text-blue-400';
    case 'execute':
      return 'text-mc-text';
    case 'leave':
      return 'text-mc-mute';
    case 'branch-true':
      return 'text-green-400';
    case 'branch-false':
      return 'text-yellow-400';
    case 'error':
      return 'text-red-400';
    default:
      return 'text-mc-text';
  }
}

export function DebuggerPanel({ graph: graphProp, onHighlightNode }: DebuggerPanelProps) {
  const state = useDebuggerStore((s) => s.state);
  const isRunning = useDebuggerStore((s) => s.isRunning);
  const isPaused = useDebuggerStore((s) => s.isPaused);
  const breakpoints = useDebuggerStore((s) => s.breakpoints);
  const start = useDebuggerStore((s) => s.start);
  const step = useDebuggerStore((s) => s.step);
  const run = useDebuggerStore((s) => s.run);
  const reset = useDebuggerStore((s) => s.reset);
  const stop = useDebuggerStore((s) => s.stop);
  const toggleBreakpoint = useDebuggerStore((s) => s.toggleBreakpoint);

  const selectedNodeId = useNodeGraphStore((s) => s.selectedNodeId);
  // 性能：未传 graph prop 时从 store 订阅，避免父组件仅为传 prop 而订阅整个 graph
  const graphFromStore = useNodeGraphStore((s) => s.graph);
  const graph = graphProp ?? graphFromStore;

  // 当前节点高亮：当 state.currentNodeId 变化时通知父组件
  const currentNodeId = state?.currentNodeId ?? null;
  useEffect(() => {
    onHighlightNode?.(currentNodeId);
  }, [currentNodeId, onHighlightNode]);

  // 日志区域自动滚动到底部
  const logRef = useRef<HTMLDivElement>(null);
  const logs = state?.logs ?? [];
  const recentLogs = useMemo(() => logs.slice(-MAX_LOG_DISPLAY), [logs]);
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [recentLogs.length]);

  // 状态文本
  const statusText = state
    ? state.error
      ? `错误：${state.error}`
      : state.finished
        ? '已结束'
        : isRunning
          ? '运行中'
          : isPaused
            ? '已暂停'
            : '空闲'
    : '未启动';

  // 当前节点与变量
  const currentNode = currentNodeId ? findNode(graph, currentNodeId) : null;
  // 变量环境：显示所有已评估节点的 outputs（合并为单一 record 便于检查）
  const allVariables = state?.variables ?? {};
  // 当前节点是否已评估（variables 中存在条目）
  const currentVars = currentNodeId ? state?.variables[currentNodeId] : undefined;
  const currentEvaluated = currentVars !== undefined;

  // 按钮禁用状态
  const hasState = state !== null;
  const isFinished = state?.finished ?? false;
  const hasError = state?.error !== null && state?.error !== undefined;

  return (
    <div
      role="region"
      aria-label="节点图调试器"
      className="flex h-[200px] flex-col border-t border-mc-border bg-mc-surface"
    >
      {/* 顶部工具栏 */}
      <div
        className="flex items-center gap-1 border-b border-mc-border px-2 py-1"
        role="group"
        aria-label="调试器控制"
      >
        <button
          type="button"
          onClick={() => start(graph)}
          disabled={hasState && !isFinished && !hasError}
          aria-label="开始调试"
          title="启动调试器，进入第一个 event 节点"
          className="rounded-mc px-2 py-0.5 text-[11px] text-mc-text transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">▶</span> 开始
        </button>
        <button
          type="button"
          onClick={() => step(graph)}
          disabled={!hasState || isFinished || hasError || isRunning}
          aria-label="单步执行"
          title="单步执行下一步（沿 control 边推进）"
          className="rounded-mc px-2 py-0.5 text-[11px] text-mc-text transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">⏭</span> 单步
        </button>
        <button
          type="button"
          onClick={() => run(graph)}
          disabled={!hasState || isFinished || hasError || isRunning}
          aria-label="运行到断点"
          title="执行到下一个断点或结束"
          className="rounded-mc px-2 py-0.5 text-[11px] text-mc-text transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">⏩</span> 运行
        </button>
        <button
          type="button"
          onClick={() => stop()}
          disabled={!hasState}
          aria-label="停止调试"
          title="停止调试并清空状态"
          className="rounded-mc px-2 py-0.5 text-[11px] text-mc-text transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">⏹</span> 停止
        </button>
        <button
          type="button"
          onClick={() => reset(graph)}
          disabled={!hasState}
          aria-label="重置调试器"
          title="重置调试器到初始状态"
          className="rounded-mc px-2 py-0.5 text-[11px] text-mc-text transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <span aria-hidden="true">🔄</span> 重置
        </button>

        <div className="mx-2 h-4 w-px bg-mc-border" aria-hidden="true" />

        {/* 状态显示 */}
        <span
          className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
          role="status"
          aria-label={`调试器状态：${statusText}`}
        >
          状态: {statusText}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {/* 断点切换：基于当前选中节点 */}
          <button
            type="button"
            onClick={() => {
              if (selectedNodeId) toggleBreakpoint(selectedNodeId);
            }}
            disabled={!selectedNodeId}
            aria-label={
              selectedNodeId
                ? breakpoints.has(selectedNodeId)
                  ? `移除节点 ${selectedNodeId} 的断点`
                  : `为节点 ${selectedNodeId} 添加断点`
                : '请先选中节点'
            }
            title={
              selectedNodeId
                ? breakpoints.has(selectedNodeId)
                  ? `移除断点 ${selectedNodeId}`
                  : `添加断点 ${selectedNodeId}`
                : '请先在画布选中节点'
            }
            className="rounded-mc px-2 py-0.5 text-[11px] transition-colors hover:bg-mc-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {selectedNodeId && breakpoints.has(selectedNodeId) ? '🔴 断点' : '⚪ 断点'}
          </button>
          <span
            className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute"
            role="status"
            aria-label={`已设置断点数：${breakpoints.size}`}
          >
            断点: {breakpoints.size}
          </span>
        </div>
      </div>

      {/* 三栏内容区 */}
      <div className="grid flex-1 grid-cols-3 overflow-hidden">
        {/* 调用栈 */}
        <div className="overflow-auto border-r border-mc-border p-2">
          <div className="mb-1 text-[10px] font-medium text-mc-mute">调用栈</div>
          {state && state.callStack.length > 0 ? (
            <ol role="list" aria-label="调用栈" className="space-y-0.5">
              {state.callStack.map((id, idx) => {
                const node = findNode(graph, id);
                const isTop = idx === state.callStack.length - 1;
                return (
                  <li
                    key={`${id}-${idx}`}
                    className={`truncate text-[11px] ${
                      isTop ? 'font-medium text-mc-accent' : 'text-mc-dim'
                    }`}
                    title={`${id} (${node?.data.kind ?? '?'})`}
                  >
                    <span aria-hidden="true">{isTop ? '→ ' : '  '}</span>
                    {node?.data.label || id}
                    <span className="ml-1 text-[10px] text-mc-mute">[{node?.data.kind}]</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="text-[11px] text-mc-mute">无调用栈</div>
          )}
        </div>

        {/* 变量检查器 */}
        <div className="overflow-auto border-r border-mc-border p-2">
          <div className="mb-1 text-[10px] font-medium text-mc-mute">变量检查器</div>
          {!hasState ? (
            <div className="text-[11px] text-mc-mute">调试器未启动</div>
          ) : !currentNode ? (
            <div className="text-[11px] text-mc-mute">无当前节点</div>
          ) : (
            <div className="space-y-1 text-[11px]">
              <div>
                <span className="text-mc-mute">currentNode: </span>
                <span className="text-mc-text">{currentNode.data.label || currentNode.id}</span>
                <span className="ml-1 text-[10px] text-mc-mute">[{currentNode.data.kind}]</span>
              </div>
              <div>
                <span className="text-mc-mute">nodeId: </span>
                <span className="text-mc-text">{currentNode.id}</span>
              </div>
              <div>
                <div className="text-mc-mute">
                  outputs ({currentEvaluated ? '已评估' : '尚未评估'}):
                </div>
                <pre
                  className="mt-0.5 ml-2 max-h-20 overflow-auto rounded-mc bg-mc-bg p-1 text-[10px] text-mc-text"
                  aria-label="当前节点输出变量"
                >
                  {currentVars ? JSON.stringify(currentVars, null, 2) : '{}'}
                </pre>
              </div>
              <div>
                <div className="text-mc-mute">variables (所有已评估节点):</div>
                <pre
                  className="mt-0.5 ml-2 max-h-20 overflow-auto rounded-mc bg-mc-bg p-1 text-[10px] text-mc-text"
                  aria-label="变量环境"
                >
                  {Object.keys(allVariables).length > 0
                    ? JSON.stringify(allVariables, null, 2)
                    : '{}'}
                </pre>
              </div>
              <div>
                <div className="text-mc-mute">visited ({state?.visitedNodeIds.length ?? 0}):</div>
                <div className="ml-2 text-[10px] text-mc-dim">
                  {state?.visitedNodeIds.join(' → ') || '无'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 执行日志 */}
        <div
          ref={logRef}
          className="overflow-auto p-2"
          aria-live="polite"
          aria-label="执行日志"
          role="log"
        >
          <div className="mb-1 text-[10px] font-medium text-mc-mute">
            执行日志（最近 {MAX_LOG_DISPLAY} 条）
          </div>
          {recentLogs.length === 0 ? (
            <div className="text-[11px] text-mc-mute">暂无日志</div>
          ) : (
            <ul className="space-y-0.5">
              {recentLogs.map((log, idx) => (
                <li key={`${log.ts}-${idx}`} className={`text-[11px] ${actionColor(log.action)}`}>
                  <span className="text-mc-mute">[{formatTs(log.ts)}]</span>{' '}
                  <span className="font-medium">{actionLabel(log.action)}</span>{' '}
                  <span className="text-mc-dim">{log.nodeId}</span>
                  {log.message ? <span className="ml-1 text-mc-text">— {log.message}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
