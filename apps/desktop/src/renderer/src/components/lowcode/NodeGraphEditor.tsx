import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  type Node,
  type Edge,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { NodeKind, EdgeKind, ModNode, ModEdge } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useDebuggerStore } from '../../store/debugger-store.js';
import { useLiveRegion } from '../../lib/useLiveRegion.js';
import { nodeTypes } from './nodes';
import { isValidConnection as checkConnection } from './connectionRules.js';

/**
 * 节点图主画布：React Flow 集成
 *
 * 职责：
 * - 渲染节点和连线
 * - 处理拖拽新增节点（来自 NodePalette）
 * - 处理节点/连线变化（移动、删除、连线）
 * - 同步状态到 useNodeGraphStore
 * - 暴露 toolbar（撤销/重做/清空）
 *
 * 注意：React Flow 的 nodes/edges 类型与 ModNode/ModEdge 略有差异，
 * 这里做类型适配（data 字段对齐 NodeData discriminated union）。
 */

// === 类型适配 ===

function toFlowNode(n: ModNode): Node {
  return {
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    selected: n.selected,
  };
}

/**
 * 根据 edge kind 返回区分样式：
 * - control（event→condition→action）：紫色虚线、不动画，突出控制流
 * - craft（item→recipe）：黄色实线
 * - structure（block→multiblock）：紫色实线
 * - flow（item/block→machine）：绿色实线
 * - data（默认）：灰色实线
 */
function getEdgeStyle(kind: EdgeKind) {
  switch (kind) {
    case 'control':
      return { stroke: '#c084fc', strokeDasharray: '5 5' };
    case 'craft':
      return { stroke: '#facc15' };
    case 'structure':
      return { stroke: '#a78bfa' };
    case 'flow':
      return { stroke: '#34d399' };
    case 'data':
    default:
      return { stroke: '#6b7280' };
  }
}

function toFlowEdge(e: ModEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'step', // 直角折线（MC 工业风）
    // control 边为静态虚线，其余 kind 在未禁用时动画
    animated: !e.disabled && e.kind !== 'control',
    markerEnd: { type: MarkerType.ArrowClosed },
    label: e.label,
    data: { kind: e.kind, disabled: e.disabled },
    style: getEdgeStyle(e.kind),
  };
}

function fromFlowNode(n: Node): ModNode {
  return {
    id: n.id,
    type: n.type as NodeKind,
    position: n.position,
    data: n.data as ModNode['data'],
    ports: [], // ports 由 store 管理，不从 Flow 同步回来
    selected: n.selected ?? false,
  };
}

function fromFlowEdge(e: Edge): ModEdge {
  const data = (e.data ?? {}) as { kind?: EdgeKind; disabled?: boolean };
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
    kind: data.kind ?? 'data',
    label: typeof e.label === 'string' ? e.label : undefined,
    disabled: data.disabled ?? false,
  };
}

// === 推断连线类型 ===

function inferEdgeKind(sourceType: NodeKind, targetType: NodeKind): EdgeKind {
  // 控制流：event → condition → action
  if (sourceType === 'event' || sourceType === 'condition' || sourceType === 'action') {
    if (targetType === 'condition' || targetType === 'action') return 'control';
  }
  // 合成关系：item + item → recipe
  if (sourceType === 'item' && targetType === 'recipe') return 'craft';
  // 结构关系：block → multiblock
  if (sourceType === 'block' && targetType === 'multiblock') return 'structure';
  // 机器流：item/energy → machine
  if ((sourceType === 'item' || sourceType === 'block') && targetType === 'machine') {
    return 'flow';
  }
  return 'data';
}

/**
 * 从编译错误/警告消息中提取涉及的节点 id。
 *
 * 编译器错误消息格式如「物品节点 item_xxx_1 编译失败：…」「配方节点 recipe_xxx_2（recipe_id）没有输出物品连线」，
 * 均包含 node.id。这里遍历所有节点 id，用正则检查是否在消息中出现。
 * 正则确保完整匹配 id（前后为非 id 字符或字符串边界），避免 'item_a_1' 误匹配 'item_a_10'。
 */
function extractNodeIds(messages: string[], allNodeIds: string[]): Set<string> {
  const ids = new Set<string>();
  for (const id of allNodeIds) {
    const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, 'i');
    for (const msg of messages) {
      if (regex.test(msg)) {
        ids.add(id);
        break; // 该 id 已确认出现，无需检查其余消息
      }
    }
  }
  return ids;
}

interface NodeGraphEditorProps {
  /** 是否只读（预览模式） */
  readOnly?: boolean;
  /** 是否显示迷你地图 */
  showMiniMap?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 双击节点回调（如代码节点打开编辑器） */
  onNodeDoubleClick?: (nodeId: string, kind: NodeKind) => void;
}

export function NodeGraphEditor({
  readOnly = false,
  showMiniMap = true,
  className,
  onNodeDoubleClick,
}: NodeGraphEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null);

  const graph = useNodeGraphStore((s) => s.graph);
  const addNode = useNodeGraphStore((s) => s.addNode);
  const moveNode = useNodeGraphStore((s) => s.moveNode);
  const removeNode = useNodeGraphStore((s) => s.removeNode);
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const selectEdge = useNodeGraphStore((s) => s.selectEdge);
  const addEdge = useNodeGraphStore((s) => s.addEdge);
  const removeEdge = useNodeGraphStore((s) => s.removeEdge);
  const updateEdge = useNodeGraphStore((s) => s.updateEdge);
  const commit = useNodeGraphStore((s) => s.commit);
  const setViewport = useNodeGraphStore((s) => s.setViewport);
  const compileResult = useNodeGraphStore((s) => s.compileResult);
  // a11y：当前选中节点 id，用于 aria-activedescendant（屏幕阅读器朗读当前聚焦节点）
  const selectedNodeId = useNodeGraphStore((s) => s.selectedNodeId);

  // 调试器状态：当前执行节点（青色高亮）+ 断点集合（红色边框装饰）
  const isDebugMode = useDebuggerStore((s) => s.state !== null);
  const debugCurrentNodeId = useDebuggerStore((s) => s.state?.currentNodeId ?? null);
  const debugBreakpoints = useDebuggerStore((s) => s.breakpoints);

  // a11y：用 LiveRegion 朗读编译结果与选中节点变化，让屏幕阅读器用户感知画布状态
  const { announce: announceCompile, LiveRegion: CompileLiveRegion } = useLiveRegion({
    politeness: 'polite',
    clearAfterMs: 0,
  });

  // 编译结果变化时朗读错误/警告数量（防抖避免编译过程中频繁刷屏）
  useEffect(() => {
    if (!compileResult) return;
    const errCount = compileResult.errors.length;
    const warnCount = compileResult.warnings.length;
    if (errCount === 0 && warnCount === 0) {
      announceCompile('编译通过，无错误');
    } else {
      announceCompile(`编译完成：${errCount} 个错误，${warnCount} 个警告`);
    }
  }, [compileResult, announceCompile]);

  const flowNodes = useMemo(() => {
    // 根据编译结果给节点添加错误/警告边框（error 红色优先于 warning 黄色）
    const errorNodeIds = extractNodeIds(
      compileResult?.errors ?? [],
      graph.nodes.map((n) => n.id),
    );
    const warningNodeIds = extractNodeIds(
      compileResult?.warnings ?? [],
      graph.nodes.map((n) => n.id),
    );
    return graph.nodes.map((n) => {
      const flowNode = toFlowNode(n);
      // 调试器当前执行节点：青色发光边框（最高优先级，覆盖编译错误/警告样式）
      if (isDebugMode && n.id === debugCurrentNodeId) {
        return {
          ...flowNode,
          style: { border: '2px solid #22d3ee', boxShadow: '0 0 8px rgba(34, 211, 238, 0.6)' },
        };
      }
      // 断点节点：紫色虚线边框（不覆盖编译错误红色，叠加显示）
      if (debugBreakpoints.has(n.id)) {
        return { ...flowNode, style: { border: '2px dashed #c084fc' } };
      }
      if (errorNodeIds.has(n.id)) {
        return { ...flowNode, style: { border: '2px solid #ef4444' } };
      }
      if (warningNodeIds.has(n.id)) {
        return { ...flowNode, style: { border: '2px solid #facc15' } };
      }
      return flowNode;
    });
  }, [graph.nodes, compileResult, isDebugMode, debugCurrentNodeId, debugBreakpoints]);
  const flowEdges = useMemo(() => graph.edges.map(toFlowEdge), [graph.edges]);

  // === 拖拽新增节点 ===
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const kind = e.dataTransfer.getData('application/reactflow-node-kind') as NodeKind;
      if (!kind || !rfInstanceRef.current) return;

      const position = rfInstanceRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY,
      });
      commit();
      addNode(kind, position);
    },
    [addNode, commit],
  );

  // === 节点变化处理 ===
  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (readOnly) {
        // 只读模式仅允许选中
        const selectChanges = changes.filter((c) => c.type === 'select');
        if (selectChanges.length === 0) return;
      }
      // 提交撤销点（仅对删除/移动结束操作）
      const hasRemoval = changes.some((c) => c.type === 'remove');
      const hasDragStop = changes.some((c) => c.type === 'position' && c.dragging === false);
      if (hasRemoval || hasDragStop) commit();

      // 应用变化到 store
      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          moveNode(change.id, change.position);
        } else if (change.type === 'remove') {
          removeNode(change.id);
        } else if (change.type === 'select') {
          if (change.selected) selectNode(change.id);
        }
      }
    },
    [readOnly, commit, moveNode, removeNode, selectNode],
  );

  // === 连线变化处理 ===
  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (readOnly) return;
      const hasRemoval = changes.some((c) => c.type === 'remove');
      if (hasRemoval) commit();
      for (const change of changes) {
        if (change.type === 'remove') {
          removeEdge(change.id);
        } else if (change.type === 'select') {
          if (change.selected) selectEdge(change.id);
        }
      }
    },
    [readOnly, commit, removeEdge, selectEdge],
  );

  // === 新建连线 ===
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (readOnly) return;
      if (!connection.source || !connection.target) return;
      const sourceNode = graph.nodes.find((n) => n.id === connection.source);
      const targetNode = graph.nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return;

      commit();
      addEdge({
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        kind: inferEdgeKind(sourceNode.type, targetNode.type),
        disabled: false,
      });
    },
    [readOnly, graph.nodes, commit, addEdge],
  );

  // === 连线 label 编辑 ===
  const onEdgeDoubleClick = useCallback(
    (_e: unknown, edge: Edge) => {
      if (readOnly) return;
      const currentLabel = typeof edge.label === 'string' ? edge.label : '';
      const newLabel = window.prompt('连线标签（留空清除）', currentLabel);
      if (newLabel !== null) {
        updateEdge(edge.id, { label: newLabel || undefined });
      }
    },
    [readOnly, updateEdge],
  );

  // === 连线合法性校验（传给 ReactFlow.isValidConnection） ===
  // 拖拽连线时实时调用，返回 false 会阻止落线。
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => checkConnection(graph, connection),
    [graph],
  );

  // === 视口变化 ===
  const onMoveEnd = useCallback(
    (_e: unknown, viewport: { x: number; y: number; zoom: number }) => {
      setViewport(viewport);
    },
    [setViewport],
  );

  // === 双击节点（如代码节点打开编辑器） ===
  const handleNodeDoubleClick = useCallback(
    (_e: unknown, node: Node) => {
      if (readOnly) return;
      onNodeDoubleClick?.(node.id, node.type as NodeKind);
    },
    [readOnly, onNodeDoubleClick],
  );

  return (
    <div
      ref={wrapperRef}
      className={`relative h-full w-full bg-mc-bg ${className ?? ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
      role="application"
      aria-label="节点图画布"
      // a11y：aria-activedescendant 让屏幕阅读器朗读当前选中的节点（无需 DOM 聚焦）
      // 选中节点 id 来自 node-graph-store；无选中时为 undefined（不渲染属性）
      aria-activedescendant={selectedNodeId ?? undefined}
    >
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onInit={(inst: ReactFlowInstance) => {
          rfInstanceRef.current = inst;
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onMoveEnd={onMoveEnd}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeClick={(_e, node) => selectNode(node.id)}
        onEdgeClick={(_e, edge) => selectEdge(edge.id)}
        onPaneClick={() => {
          selectNode(null);
          selectEdge(null);
        }}
        fitView
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        elementsSelectable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        multiSelectionKeyCode={['Meta', 'Control']}
        proOptions={{ hideAttribution: true }}
        className="bg-mc-bg"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3a3a3a" />
        <Controls
          className="!rounded-mc !border !border-mc-border !bg-mc-surface !shadow-md"
          showInteractive={!readOnly}
        />
        {showMiniMap && (
          <MiniMap
            className="!rounded-mc !border !border-mc-border !bg-mc-surface"
            nodeColor={(n) => {
              switch (n.type) {
                case 'item':
                  return '#f472b6';
                case 'block':
                  return '#fb923c';
                case 'entity':
                  return '#22d3ee';
                case 'recipe':
                  return '#facc15';
                case 'machine':
                  return '#34d399';
                case 'multiblock':
                  return '#a78bfa';
                case 'event':
                  return '#c084fc';
                case 'condition':
                  return '#60a5fa';
                case 'action':
                  return '#f87171';
                case 'code':
                  return '#9ca3af';
                case 'comment':
                  return '#fde047';
                default:
                  return '#888888';
              }
            }}
            maskColor="rgba(0, 0, 0, 0.4)"
          />
        )}
      </ReactFlow>

      {readOnly && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-mc bg-mc-surface/80 px-3 py-1 text-[11px] text-mc-mute backdrop-blur">
          只读预览模式
        </div>
      )}

      {graph.nodes.length === 0 && !readOnly && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center"
          role="status"
          aria-live="polite"
        >
          <div className="mb-2 text-4xl opacity-30" aria-hidden="true">
            🎨
          </div>
          <div className="text-sm text-mc-mute">从左侧拖拽节点到画布开始</div>
          <div className="mt-1 text-[11px] text-mc-mute">或点击节点库中的项目添加</div>
        </div>
      )}

      {/* a11y：屏幕阅读器朗读区域，视觉隐藏。编译结果变化时通知 */}
      <CompileLiveRegion id="node-graph-compile-status" />
    </div>
  );
}
