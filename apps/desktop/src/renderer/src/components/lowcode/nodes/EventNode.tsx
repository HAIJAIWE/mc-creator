import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EventNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
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
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function EventNodeComponent({ id, data, selected }: NodeProps<EventNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="power-button"
      title={EVENT_TYPE_LABELS[data.eventType] || data.label || '事件'}
      colorClass="mc-event"
      badge="触发器"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const EventNode = memo(EventNodeComponent);
