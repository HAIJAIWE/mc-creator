import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MultiBlockNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 多方块结构节点：表达一个 3D 结构。
 * 端口：controller (in, block_state) / out (out, block_state)
 * 颜色：mc-multiblock（紫色）
 */
function MultiBlockNodeComponent({ id, data, selected }: NodeProps<MultiBlockNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="castle"
      title={data.displayName || data.label || '多方块结构'}
      colorClass="mc-multiblock"
      badge={data.hollow ? '空心' : '实心'}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.structureId}</div>
      <div className="text-mc-dim">
        尺寸 {data.width}×{data.height}×{data.depth}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const MultiBlockNode = memo(MultiBlockNodeComponent);
