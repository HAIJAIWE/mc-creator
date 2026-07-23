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
 */
export function useNodeActions(nodeId: string): {
  toggleCollapse: () => void;
  openDrawer: () => void;
  node: ModNode | undefined;
} {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === nodeId));
  return {
    toggleCollapse: () => toggleCollapse(nodeId),
    openDrawer: () => openDrawer(nodeId),
    node,
  };
}
