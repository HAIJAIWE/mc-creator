import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { CommentNodeData, NodePort, PortType } from '@mc-creator/shared';
import { McNodeShell } from '../nodes/base/McNodeShell.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';

/**
 * 子图边界节点：定义子图的输入/输出端口。
 *
 * 复用 CommentNodeData（kind: 'comment'）作为数据载体，附加运行时字段
 * boundaryType/portLabel/portType（不进 Zod schema，由 SubgraphEditor 本地管理）。
 * 在子图画布中渲染为入口/出口标记。
 */

export interface SubgraphBoundaryNodeData extends CommentNodeData {
  /** 边界类型：in=子图输入，out=子图输出 */
  boundaryType: 'in' | 'out';
  /** 对外端口标签 */
  portLabel: string;
  /** 对外端口类型 */
  portType: PortType;
}

type SubgraphBoundaryNodeProps = NodeProps<SubgraphBoundaryNodeData>;

function SubgraphBoundaryNodeComponent({ data, selected }: SubgraphBoundaryNodeProps) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const ports: NodePort[] = [
    {
      id: data.boundaryType === 'in' ? 'out' : 'in',
      label: data.portLabel,
      type: data.portType,
      direction: data.boundaryType === 'in' ? 'out' : 'in',
      required: false,
      multiple: data.boundaryType === 'in',
    },
  ];

  return (
    <McNodeShell
      icon="boundary"
      title={data.label || (data.boundaryType === 'in' ? '输入' : '输出')}
      colorClass="mc-subgraph"
      badge={data.boundaryType}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => {}}
    >
      <div className="text-[10px] text-mc-mute">
        <span className="text-mc-text">{data.portLabel}</span>
        {' : '}
        <span className="text-mc-dim">{data.portType}</span>
      </div>
    </McNodeShell>
  );
}

export const SubgraphBoundaryNode = memo(SubgraphBoundaryNodeComponent);
