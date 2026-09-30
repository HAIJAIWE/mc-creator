import { memo } from 'react';
import { type Node } from '@xyflow/react';
import type { BlockNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

type BlockNode = Node<BlockNodeData, 'block'>;
type BlockNodeComponentProps = {
  id: string;
  data: BlockNodeData;
  selected?: boolean;
};

/**
 * 方块节点：表达一个 Minecraft 方块。
 * 端口：out (block_state)
 * 颜色：mc-block（橙色）
 */
function BlockNodeComponent({ id, data, selected }: BlockNodeComponentProps) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n: { id: string; ports: unknown[] }) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="stone-block"
      title={data.displayName || data.label || '方块'}
      colorClass="mc-block"
      badge={data.isBlockEntity ? 'BE' : undefined}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected ?? false}
      debugState={debugState ?? undefined}
      codeLocked={data.codeLocked ?? false}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.blockId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>硬度 {data.hardness}</span>
        <span>抗爆 {data.blastResistance}</span>
        {data.luminance > 0 && <span>发光 {data.luminance}</span>}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const BlockNode = memo(BlockNodeComponent);
