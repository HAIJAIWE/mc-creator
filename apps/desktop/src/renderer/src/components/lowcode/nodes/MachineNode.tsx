import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MachineNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 机器节点：方块实体 + GUI + 能源。
 * 端口：in_item / in_energy / out_item
 * 颜色：mc-machine（翠绿）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function MachineNodeComponent({ id, data, selected }: NodeProps<MachineNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="gear-hammer"
      title={data.displayName || data.label || '机器'}
      colorClass="mc-machine"
      badge="BE+GUI"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-mc-mute">ID: {data.machineId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>容量 {data.energyCapacity} FE</span>
        <span>输入 ×{data.inputSlots}</span>
        <span>输出 ×{data.outputSlots}</span>
      </div>
      <div className="text-mc-dim">
        {data.defaultProcessTime}t / {data.defaultEnergyPerTick} FE/t
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const MachineNode = memo(MachineNodeComponent);
