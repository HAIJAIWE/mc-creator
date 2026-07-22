import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EntityNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 生物节点：表达一个 Minecraft 实体。
 * 端口：out (entity)
 * 颜色：mc-entity（青色）
 */
function EntityNodeComponent({ id, data, selected }: NodeProps<EntityNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="creeper"
      title={data.displayName || data.label || '生物'}
      colorClass="mc-entity"
      badge={data.classification}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.entityId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>❤ {data.maxHealth}</span>
        <span>⚔ {data.attackDamage}</span>
        <span>速度 {data.movementSpeed}</span>
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const EntityNode = memo(EntityNodeComponent);
