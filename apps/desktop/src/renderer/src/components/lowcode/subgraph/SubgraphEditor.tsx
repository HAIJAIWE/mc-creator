import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { SubgraphDefinition, ModNode, ModEdge } from '@mc-creator/shared';
import { SubgraphBoundaryNode } from './SubgraphBoundaryNode.js';

interface SubgraphEditorProps {
  /** 编辑的子图定义 */
  subgraph: SubgraphDefinition;
  /** 子图内容变更回调 */
  onChange: (sg: SubgraphDefinition) => void;
}

const subgraphNodeTypes = { boundary: SubgraphBoundaryNode };

/**
 * 子图独立画布：在 SubgraphWorkspace 内渲染，编辑子图内部节点 + 边界节点。
 *
 * 边界节点（type: 'boundary'）定义子图对外端口，保存时映射到 portMappings。
 *
 * 交互回调（onNodesChange / onEdgesChange / onConnect）通过 onChange 更新子图定义，
 * 使内部节点可拖拽、可连线。边界节点位置由 portMappings 索引推导（不可拖拽）。
 */
export function SubgraphEditor({ subgraph, onChange }: SubgraphEditorProps) {
  const flowNodes: Node[] = useMemo(() => {
    const inner: Node[] = subgraph.nodes.map((n: ModNode) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      selected: n.selected,
    }));
    // 边界节点位置按方向索引展开 Y 坐标，避免堆叠
    let inIdx = 0;
    let outIdx = 0;
    const boundaries: Node[] = subgraph.portMappings.map((m) => {
      const y = m.direction === 'in' ? inIdx * 80 : outIdx * 80;
      if (m.direction === 'in') inIdx++;
      else outIdx++;
      return {
        id: `boundary_${m.externalPortId}`,
        type: 'boundary',
        position: m.direction === 'in' ? { x: -200, y } : { x: 200, y },
        data: {
          nodeId: `boundary_${m.externalPortId}`,
          label: m.label,
          note: '',
          disabled: false,
          kind: 'comment',
          text: '',
          color: 'yellow',
          collapsed: false,
          boundaryType: m.direction,
          portLabel: m.label,
          portType: m.type,
        },
      };
    });
    return [...inner, ...boundaries];
  }, [subgraph]);

  const flowEdges: Edge[] = useMemo(
    () =>
      subgraph.edges.map((e: ModEdge) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    [subgraph],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // 将 ReactFlow 节点变更应用到 flowNodes，再映射回 subgraph.nodes
      const updatedFlowNodes = applyNodeChanges(changes, flowNodes);
      // 只保留内部节点（排除 boundary_ 前缀的边界节点）
      const updatedInnerNodes: ModNode[] = [];
      for (const fn of updatedFlowNodes) {
        if (fn.id.startsWith('boundary_')) continue;
        const original = subgraph.nodes.find((n) => n.id === fn.id);
        if (original) {
          updatedInnerNodes.push({
            ...original,
            position: fn.position,
            selected: fn.selected ?? false,
          });
        }
      }
      // 若内部节点数量没变，说明没有节点被删除（边界节点不允许删除）
      if (updatedInnerNodes.length === subgraph.nodes.length) {
        onChange({ ...subgraph, nodes: updatedInnerNodes });
      }
    },
    [flowNodes, subgraph, onChange],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updatedFlowEdges = applyEdgeChanges(changes, flowEdges);
      // 重新从 flowEdges 构建 ModEdge[]（保留原有 kind/disabled 等字段）
      const edgeMap = new Map(subgraph.edges.map((e) => [e.id, e]));
      const updatedEdges: ModEdge[] = updatedFlowEdges.map((fe) => {
        const original = edgeMap.get(fe.id);
        if (original) {
          return { ...original, selected: fe.selected };
        }
        // 新增的边（不应出现在 edgesChange 中，但容错处理）
        return {
          id: fe.id,
          source: fe.source,
          target: fe.target,
          sourceHandle: fe.sourceHandle ?? undefined,
          targetHandle: fe.targetHandle ?? undefined,
          kind: 'craft',
          disabled: false,
        } as ModEdge;
      });
      onChange({ ...subgraph, edges: updatedEdges });
    },
    [flowEdges, subgraph, onChange],
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      // Connection 的 source/target 可能为 null（未完成连线），跳过无效连接
      if (!conn.source || !conn.target) return;
      // 边界节点之间的连接不允许（应通过内部节点连接）
      const newEdge: ModEdge = {
        id: `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        source: conn.source,
        target: conn.target,
        sourceHandle: conn.sourceHandle ?? undefined,
        targetHandle: conn.targetHandle ?? undefined,
        kind: 'craft',
        disabled: false,
      };
      const updatedFlowEdges = addEdge(conn, flowEdges);
      // 使用 flowEdges 的 addEdge 结果保持 ReactFlow 内部一致，但实际持久化用 ModEdge
      void updatedFlowEdges;
      onChange({ ...subgraph, edges: [...subgraph.edges, newEdge] });
    },
    [flowEdges, subgraph, onChange],
  );

  const isValidConnection = useCallback((conn: Connection | Edge): boolean => {
    // 禁止自连
    if (conn.source === conn.target) return false;
    // 禁止边界节点 → 边界节点直连（必须经过内部节点）
    const isBoundary = (id: string | null | undefined) => !!id && id.startsWith('boundary_');
    if (isBoundary(conn.source) && isBoundary(conn.target)) return false;
    return true;
  }, []);

  const addBoundary = useCallback(
    (direction: 'in' | 'out') => {
      const idx = subgraph.portMappings.length;
      const externalPortId = `${direction}_${idx}`;
      const newMapping = {
        internalPortId: externalPortId,
        externalPortId,
        label: direction === 'in' ? `输入${idx + 1}` : `输出${idx + 1}`,
        direction,
        type: 'item_stack' as const,
      };
      onChange({
        ...subgraph,
        portMappings: [...subgraph.portMappings, newMapping],
      });
    },
    [subgraph, onChange],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-mc-border px-3 py-1 text-xs text-mc-text">
        子图：{subgraph.name}
        <span className="ml-2 text-mc-mute">({subgraph.nodes.length} 节点)</span>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={subgraphNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <div className="flex gap-2 border-t border-mc-border p-2">
        <button
          type="button"
          onClick={() => addBoundary('in')}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          添加输入边界
        </button>
        <button
          type="button"
          onClick={() => addBoundary('out')}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          添加输出边界
        </button>
      </div>
    </div>
  );
}
