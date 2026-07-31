import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { LoopNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';

/**
 * 循环节点：for/forEach/while 批量逻辑。
 *
 * 端口：input (in, void), loop_var (out, 随 loopVarType), body (out, void), done (out, void)
 * 颜色：mc-loop
 * 徽章：循环类型（for/forEach/while）
 */
function LoopNodeComponent({ data, selected }: NodeProps<LoopNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);

  return (
    <McNodeShell
      icon="loop"
      title={data.label || '循环'}
      colorClass="mc-loop"
      badge={data.loopType}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-[10px] text-mc-mute">
        {data.loopType === 'for' && (
          <div className="font-mono text-mc-text">
            for ({data.init ?? ''}; {data.condition}; {data.update ?? ''})
          </div>
        )}
        {data.loopType === 'forEach' && (
          <div className="font-mono text-mc-text">
            for ({data.loopVarType} {data.loopVarName} : {data.iterable ?? 'items'})
          </div>
        )}
        {data.loopType === 'while' && (
          <div className="font-mono text-mc-text">while ({data.condition})</div>
        )}
      </div>
    </McNodeShell>
  );
}

export const LoopNode = memo(LoopNodeComponent);
