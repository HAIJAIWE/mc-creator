import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { VariableNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';

/**
 * 变量节点：定义全局变量/常量，可被其他节点引用。
 *
 * 端口：value (out, type 随 varType)
 * 颜色：mc-variable
 * 徽章：常量显示 'const'
 */
function VariableNodeComponent({ data, selected }: NodeProps<VariableNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === data.nodeId));

  return (
    <McNodeShell
      icon="variable"
      title={data.label || data.varName}
      colorClass="mc-variable"
      badge={data.isConstant ? 'const' : undefined}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => openDrawer(data.nodeId)}
    >
      <div className="text-[10px] text-mc-mute">
        <span className="font-mono text-mc-text">{data.varName}</span>
        {' : '}
        <span className="text-mc-dim">{data.varType}</span>
        {' = '}
        <span className="font-mono text-mc-text">{String(data.value)}</span>
      </div>
    </McNodeShell>
  );
}

export const VariableNode = memo(VariableNodeComponent);
