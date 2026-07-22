import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ItemNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const RARITY_BADGE: Record<ItemNodeData['rarity'], string> = {
  common: '普通',
  uncommon: '稀有',
  rare: '罕见',
  epic: '史诗',
};

/**
 * 物品节点：表达一个 Minecraft 物品。
 *
 * 端口：out (item_stack)
 * 颜色：mc-item（粉色）
 */
function ItemNodeComponent({ id, data, selected }: NodeProps<ItemNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="sword"
      title={data.displayName || data.label || '物品'}
      colorClass="mc-item"
      badge={RARITY_BADGE[data.rarity]}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.itemId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>{data.category}</span>
        {data.maxDamage > 0 && <span>耐久 {data.maxDamage}</span>}
        <span>堆叠 {data.maxStackSize}</span>
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const ItemNode = memo(ItemNodeComponent);
