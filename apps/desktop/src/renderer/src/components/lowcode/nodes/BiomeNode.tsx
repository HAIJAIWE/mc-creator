import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { BiomeNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 生物群系节点：Mod 侧生物群系（降水/温度/颜色/地表）。
 * 端口：无（独立内容节点）
 * 颜色：mc-biome（青绿色）
 */
function BiomeNodeComponent({ id, data, selected }: NodeProps<BiomeNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="tree"
      title={data.displayName || data.label || '生物群系'}
      colorClass="mc-biome"
      badge="生物群系"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-mc-mute">ID: {data.biomeId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>{data.precipitation}</span>
        <span>{data.temperature}°C</span>
        <span>降 {data.downfall}</span>
      </div>
      <div className="text-mc-dim">
        权重 {data.spawnWeight} · {data.surfaceBuilder}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const BiomeNode = memo(BiomeNodeComponent);
