import { memo } from 'react';
import type { NodePort, SubgraphNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeActions } from './hooks/useNodeActions.js';
import { customNodeRegistry } from '../custom/customNodeRegistry.js';

/**
 * 自定义节点内容组件（由 SubgraphNode 在 data.customTypeId 非空时委托渲染）。
 *
 * 不直接注册到 React Flow nodeTypes——数据 kind 仍是 'subgraph'，
 * SubgraphNode 组件做路由。此组件复用 McNodeShell，schema 驱动端口和字段。
 *
 * 注：useNodeActions 同时订阅了 node 选择器，但本组件接收外部传入的 ports 而非
 * 使用 node.ports（schema 派生）。保留统一 hook 调用以减少样板，订阅开销可接受。
 */

interface CustomNodeContentProps {
  data: SubgraphNodeData;
  selected?: boolean;
  ports: NodePort[];
}

function CustomNodeContentComponent({ data, selected, ports }: CustomNodeContentProps) {
  const { toggleCollapse, openDrawer } = useNodeActions(data.nodeId);
  const schema = data.customTypeId ? customNodeRegistry.get(data.customTypeId) : undefined;

  if (!schema) {
    return (
      <McNodeShell
        icon="custom"
        title={data.label || '自定义节点'}
        colorClass="mc-code"
        ports={ports}
        collapsed={data.collapsed}
        selected={selected}
        errorState="warning"
        onToggleCollapse={toggleCollapse}
        onOpenDrawer={openDrawer}
      >
        <div className="text-[10px] text-yellow-400">自定义类型未注册：{data.customTypeId}</div>
      </McNodeShell>
    );
  }

  return (
    <McNodeShell
      icon={schema.icon || 'custom'}
      title={data.label || schema.label}
      colorClass={schema.color || 'mc-code'}
      badge="custom"
      ports={ports.length > 0 ? ports : schema.ports}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={toggleCollapse}
      onOpenDrawer={openDrawer}
    >
      <div className="text-[10px] text-mc-mute">
        <div className="font-mono text-mc-text">{schema.typeId}</div>
        {schema.description && <div className="text-mc-dim">{schema.description}</div>}
      </div>
    </McNodeShell>
  );
}

export const CustomNodeContent = memo(CustomNodeContentComponent);
