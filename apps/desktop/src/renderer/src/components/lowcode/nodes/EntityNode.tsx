import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EntityNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 生物节点：表达一个 Minecraft 实体。
 * 端口：out (entity)
 * 颜色：mc-entity（青色）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function EntityNodeComponent({ id, data, selected }: NodeProps<EntityNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="creeper"
      title={data.displayName || data.label || '生物'}
      colorClass="mc-entity"
      badge={data.classification}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
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
