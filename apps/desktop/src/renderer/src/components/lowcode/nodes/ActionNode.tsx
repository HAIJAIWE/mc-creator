import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ActionNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const ACTION_TYPE_LABELS: Record<ActionNodeData['actionType'], string> = {
  spawn_entity: '生成实体',
  give_item: '给予物品',
  take_item: '拿走物品',
  teleport: '传送',
  damage: '造成伤害',
  heal: '治疗',
  set_block: '放置方块',
  remove_block: '移除方块',
  play_sound: '播放声音',
  send_message: '发送消息',
  summon_lightning: '召唤闪电',
  give_effect: '给予效果',
  custom: '自定义',
};

/**
 * 动作节点：执行某个效果。
 * 端口：in (执行) / out (完成)
 * 颜色：mc-action（红色）
 */
function ActionNodeComponent({ id, data, selected }: NodeProps<ActionNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="fireball"
      title={ACTION_TYPE_LABELS[data.actionType] || data.label || '动作'}
      colorClass="mc-action"
      badge="执行"
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

export const ActionNode = memo(ActionNodeComponent);
