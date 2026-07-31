import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { CommentNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';

/**
 * 注释节点：仅文档用途，不参与编译。无端口。
 * 颜色：mc-comment（黄色）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer，
 * 避免内联回调创建不稳定引用。
 */
function CommentNodeComponent({ id: _id, data, selected }: NodeProps<CommentNodeData>) {
  const { toggleCollapse, openDrawer } = useNodeActions(data.nodeId);
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
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="whitespace-pre-wrap break-words text-mc-text">
        {data.text || '（空备注）'}
      </div>
    </McNodeShell>
  );
}

export const CommentNode = memo(CommentNodeComponent);
