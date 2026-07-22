import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { CommentNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';

/**
 * 注释节点：仅文档用途，不参与编译。无端口。
 * 颜色：mc-comment（黄色）
 */
function CommentNodeComponent({ id, data, selected }: NodeProps<CommentNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const debugState = null; // comment 节点不支持调试

  return (
    <McNodeShell
      icon="thought-bubble"
      title={data.label || '备注'}
      colorClass="mc-comment"
      badge={data.color !== 'yellow' ? data.color : undefined}
      ports={[]}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="whitespace-pre-wrap break-words text-mc-text">
        {data.text || '（空备注）'}
      </div>
    </McNodeShell>
  );
}

export const CommentNode = memo(CommentNodeComponent);
