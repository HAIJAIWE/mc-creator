import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EventNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const EVENT_TYPE_LABELS: Record<EventNodeData['eventType'], string> = {
  player_right_click_block: '右键方块',
  player_right_click_item: '右键物品',
  player_left_click: '左键',
  block_break: '方块破坏',
  block_place: '方块放置',
  entity_death: '实体死亡',
  entity_hurt: '实体受伤',
  item_use: '使用物品',
  item_pickup: '拾取物品',
  player_join: '玩家加入',
  player_quit: '玩家退出',
  tick: 'Tick',
  custom: '自定义',
};

/**
 * 事件节点：触发器，作为控制流起点。
 * 端口：trigger (void, out, multiple)
 * 颜色：mc-event（紫色）
 */
function EventNodeComponent({ id, data, selected }: NodeProps<EventNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="power-button"
      title={EVENT_TYPE_LABELS[data.eventType] || data.label || '事件'}
      colorClass="mc-event"
      badge="触发器"
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const EventNode = memo(EventNodeComponent);
