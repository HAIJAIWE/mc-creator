import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { FluidNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 流体节点：Mod 侧流体（颜色/温度/黏度/发光）。
 * 端口：无（独立内容节点）
 * 颜色：mc-fluid（天蓝）
 */
function FluidNodeComponent({ id, data, selected }: NodeProps<FluidNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="droplet"
      title={data.displayName || data.label || '流体'}
      colorClass="mc-fluid"
      badge="流体"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-mc-mute">ID: {data.fluidId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>{data.temperature}K</span>
        <span>黏 {data.viscosity}</span>
        {data.luminous && <span>发光</span>}
      </div>
      <div className="text-mc-dim">#{data.color.toString(16).padStart(6, '0')}</div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const FluidNode = memo(FluidNodeComponent);
