import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { DimensionNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 维度节点：Mod 侧维度（维度类型模板 + 高度/天空等）。
 * 端口：无（独立内容节点）
 * 颜色：mc-dimension（深蓝）
 */
function DimensionNodeComponent({ id, data, selected }: NodeProps<DimensionNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="globe"
      title={data.displayName || data.label || '维度'}
      colorClass="mc-dimension"
      badge={data.baseType}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-mc-mute">ID: {data.dimensionId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>
          {data.minY}~{data.minY + data.height}
        </span>
        {data.hasSkyLight ? <span>天空光</span> : <span>无天空光</span>}
      </div>
      <div className="text-mc-dim">
        {data.fixedTime !== null ? `固定时间 ${data.fixedTime}` : '昼夜循环'}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const DimensionNode = memo(DimensionNodeComponent);
