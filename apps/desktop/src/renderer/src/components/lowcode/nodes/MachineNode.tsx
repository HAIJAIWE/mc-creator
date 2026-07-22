import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MachineNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 机器节点：方块实体 + GUI + 能源。
 * 端口：in_item / in_energy / out_item
 * 颜色：mc-machine（翠绿）
 */
function MachineNodeComponent({ id, data, selected }: NodeProps<MachineNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="gear-hammer"
      title={data.displayName || data.label || '机器'}
      colorClass="mc-machine"
      badge="BE+GUI"
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
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
