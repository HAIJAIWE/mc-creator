import { useCallback, useMemo } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
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
    const boundaries: Node[] = subgraph.portMappings.map((m) => ({
      id: `boundary_${m.externalPortId}`,
      type: 'boundary',
      position: m.direction === 'in' ? { x: -200, y: 0 } : { x: 200, y: 0 },
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
    }));
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
        <ReactFlow nodes={flowNodes} edges={flowEdges} nodeTypes={subgraphNodeTypes} fitView>
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
