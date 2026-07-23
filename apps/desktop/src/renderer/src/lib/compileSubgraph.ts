import type { NodeGraph, ModNode, SubgraphDefinition } from '@mc-creator/shared';
import type { SubgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';

/**
 * 子图内联展开：把主图中的 subgraph 节点替换为其引用的子图内部节点。
 *
 * 返回 { graph: NodeGraph; warnings: string[] }（不是交叉类型）。
 * - 子图未找到：加 warning，保留原节点
 * - 循环引用（DFS visited 检测）：加 warning，不递归展开
 * - 嵌套子图：递归展开（带 visited 防环）
 * - 自定义节点（customTypeId 非空）：跳过（由 compileCustomNode 处理）
 */
export function inlineSubgraphNodes(
  graph: NodeGraph,
  manager: SubgraphManager,
): { graph: NodeGraph; warnings: string[] } {
  const warnings: string[] = [];
  const visited = new Set<string>();

  function expand(node: ModNode, depth: number): ModNode[] {
    if (depth > 32) {
      warnings.push(`子图嵌套过深（>32），可能存在循环引用：${node.id}`);
      return [node];
    }
    if (node.data.kind !== 'subgraph') return [node];
    // 自定义节点不在此处理
    if (node.data.customTypeId) return [node];
    const sgId = node.data.subgraphId;
    if (!sgId) return [node];
    if (visited.has(sgId)) {
      warnings.push(`子图循环引用：${sgId}（跳过展开）`);
      return [node];
    }
    visited.add(sgId);
    const sg: SubgraphDefinition | undefined = manager.get(sgId) ?? graph.subgraphs[sgId];
    if (!sg) {
      warnings.push(`子图未找到：${sgId}（节点 ${node.id}）`);
      visited.delete(sgId);
      return [node];
    }
    const expanded: ModNode[] = [];
    for (const inner of sg.nodes) {
      expanded.push(...expand(inner, depth + 1));
    }
    visited.delete(sgId);
    return expanded;
  }

  const newNodes: ModNode[] = [];
  for (const node of graph.nodes) {
    newNodes.push(...expand(node, 0));
  }

  return {
    graph: { ...graph, nodes: newNodes },
    warnings,
  };
}
