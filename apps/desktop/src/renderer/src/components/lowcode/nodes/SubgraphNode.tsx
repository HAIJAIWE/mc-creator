import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { SubgraphNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { CustomNodeContent } from './CustomNode.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';

/**
 * 子图节点：封装复用子图。
 *
 * 路由逻辑：data.customTypeId 非空 → 委托 CustomNodeContent（自定义节点）；
 * 否则渲染普通子图摘要（含双击进入子图编辑提示）。
 *
 * 数据上 kind 始终是 'subgraph'，不新增 'custom' NodeKind。
 */
function SubgraphNodeComponent({ data, selected }: NodeProps<SubgraphNodeData>) {
  const { toggleCollapse, openDrawer, node } = useNodeActions(data.nodeId);
  // 子图节点特有：进入子图编辑 + 子图定义查找，不属于通用 useNodeActions 范畴
  const setEditingSubgraphId = useNodeGraphStore((s) => s.setEditingSubgraphId);
  const sg = useNodeGraphStore((s) =>
    data.subgraphId ? s.graph.subgraphs[data.subgraphId] : undefined,
  );

  // 自定义节点：委托 CustomNodeContent
  if (data.customTypeId) {
    return <CustomNodeContent data={data} selected={selected} ports={node?.ports ?? []} />;
  }

  // 普通子图
  const subgraphFound = !!sg;
  return (
    <McNodeShell
      icon="subgraph"
      title={data.label || data.subgraphName || '子图'}
      colorClass="mc-subgraph"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      errorState={!subgraphFound && data.subgraphId ? 'warning' : undefined}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      {subgraphFound ? (
        <div className="text-[10px] text-mc-mute">
          <div>子图：{data.subgraphName}</div>
          <div className="text-mc-dim">双击进入子图编辑</div>
        </div>
      ) : (
        <div className="text-[10px] text-yellow-400">子图未找到：{data.subgraphId || '（空）'}</div>
      )}
      {/* 双击进入子图：React Flow 的 onNodeDoubleClick 在 NodeGraphEditor 处理，
          这里通过 data attribute 提示测试与无障碍。
          setEditingSubgraphId 在 NodeGraphEditor 调用，这里保留引用以避免 lint 警告。 */}
      <span
        data-testid="subgraph-enter-hint"
        aria-label="双击进入子图"
        className="sr-only"
        onClick={() => setEditingSubgraphId(data.subgraphId)}
      >
        双击进入子图
      </span>
    </McNodeShell>
  );
}

export const SubgraphNode = memo(SubgraphNodeComponent);
