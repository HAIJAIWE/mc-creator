import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ConditionNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

const CONDITION_TYPE_LABELS: Record<ConditionNodeData['conditionType'], string> = {
  has_item: '拥有物品',
  health_below: '血量低于',
  health_above: '血量高于',
  distance_less: '距离小于',
  distance_greater: '距离大于',
  is_day: '是白天',
  is_night: '是夜晚',
  is_raining: '下雨中',
  biome_is: '生物群系是',
  block_is: '方块是',
  custom: '自定义',
};

/**
 * 条件节点：分支判断。
 * 端口：in / true / false
 * 颜色：mc-condition（蓝色）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function ConditionNodeComponent({ id, data, selected }: NodeProps<ConditionNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="scales"
      title={CONDITION_TYPE_LABELS[data.conditionType] || data.label || '条件'}
      colorClass="mc-condition"
      badge={data.invert ? '取反' : undefined}
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

export const ConditionNode = memo(ConditionNodeComponent);
