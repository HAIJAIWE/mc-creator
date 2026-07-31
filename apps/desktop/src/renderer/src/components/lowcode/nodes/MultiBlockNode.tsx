import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MultiBlockNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 多方块结构节点：表达一个 3D 结构。
 * 端口：controller (in, block_state) / out (out, block_state)
 * 颜色：mc-multiblock（紫色）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function MultiBlockNodeComponent({ id, data, selected }: NodeProps<MultiBlockNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="castle"
      title={data.displayName || data.label || '多方块结构'}
      colorClass="mc-multiblock"
      badge={data.hollow ? '空心' : '实心'}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
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
