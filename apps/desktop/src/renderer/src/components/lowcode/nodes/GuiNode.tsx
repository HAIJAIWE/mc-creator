import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { GuiNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * GUI 节点：容器界面（槽位布局 + 能源/进度条）。
 * 端口：无（独立内容节点）
 * 颜色：mc-gui（金色）
 */
function GuiNodeComponent({ id, data, selected }: NodeProps<GuiNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);
  let slotCount = 0;
  try {
    const parsed = JSON.parse(data.slotsJson || '[]');
    if (Array.isArray(parsed)) slotCount = parsed.length;
  } catch {
    // 忽略
  }

  return (
    <McNodeShell
      icon="window"
      title={data.displayName || data.label || 'GUI'}
      colorClass="mc-gui"
      badge="GUI"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-mc-mute">ID: {data.guiId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>
          {data.width}×{data.height}
        </span>
        <span>{slotCount} 槽</span>
        {data.showEnergyBar && <span>能源</span>}
        {data.showProgressBar && <span>进度</span>}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const GuiNode = memo(GuiNodeComponent);
