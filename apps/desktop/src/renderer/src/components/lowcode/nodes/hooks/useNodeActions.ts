import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNodeGraphStore } from '../../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../../store/drawer-store.js';
import type { ModNode } from '@mc-creator/shared';

/**
 * 节点组件通用 store 操作 hook（toggleCollapse + openDrawer + 当前节点引用）。
 *
 * 此前在 VariableNode/LoopNode/SubgraphNode/CustomNode 中重复定义相同的三个
 * store 选择器，造成样板代码。现统一抽取，调用方仅传入 nodeId 即可获得：
 * - toggleCollapse(nodeId)：折叠/展开节点
 * - openDrawer(nodeId)：打开节点详情抽屉
 * - node：当前节点（可能为 undefined，调用方应做容错）
 *
 * 注意：返回的 toggleCollapse/openDrawer 已绑定 nodeId，调用时无需再传参。
 *
 * P2 性能优化：
 * - toggleCollapse/openDrawer 使用 useCallback 绑定 nodeId，引用稳定
 * - node 选择器使用 useShallow + 自定义比较，仅当目标节点引用变化时才触发重渲染
 */
export function useNodeActions(nodeId: string): {
  toggleCollapse: () => void;
  openDrawer: () => void;
  node: ModNode | undefined;
} {
  const toggleCollapseFn = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawerFn = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore(useShallow((s) => s.graph.nodes.find((n) => n.id === nodeId)));

  const toggleCollapse = useCallback(() => toggleCollapseFn(nodeId), [toggleCollapseFn, nodeId]);
  const openDrawer = useCallback(() => openDrawerFn(nodeId), [openDrawerFn, nodeId]);

  return {
    toggleCollapse,
    openDrawer,
    node,
  };
}
