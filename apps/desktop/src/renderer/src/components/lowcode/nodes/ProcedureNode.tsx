import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ProcedureNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * P1-3 过程节点：命名的可复用逻辑单元（对标 MCreator procedure）。
 *
 * 端口：
 *   - in (void, in, multiple)：调用入口（event/procedure → procedure 的 control 边）
 *   - trigger (void, out, multiple)：过程体出口（procedure → condition/action 的 control 边）
 *
 * 颜色：mc-procedure（靛蓝色）
 * 标题：显示 procedureName（编译为 Java 方法名 procedure_<name>）
 *
 * P2 性能优化：使用 useNodeActions 统一获取 toggleCollapse/openDrawer/node，
 * 避免每次任何节点变化都因 find 选择器触发重新渲染。
 */
function ProcedureNodeComponent({ id, data, selected }: NodeProps<ProcedureNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="link"
      title={data.procedureName || '过程'}
      colorClass="mc-procedure"
      badge="过程"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      codeLocked={data.codeLocked}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      {data.displayName && data.displayName !== data.procedureName && (
        <div className="text-mc-dim">{data.displayName}</div>
      )}
      <div className="text-mc-dim">procedure_{data.procedureName}(event)</div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const ProcedureNode = memo(ProcedureNodeComponent);
