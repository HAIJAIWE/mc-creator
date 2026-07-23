import type { NodeGraph, ModNode, ModEdge, SubgraphDefinition } from '@mc-creator/shared';
import type { SubgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';

/**
 * 子图内联展开：把主图中的 subgraph 节点替换为其引用的子图内部节点。
 *
 * 返回 { graph: NodeGraph; warnings: string[] }（不是交叉类型）。
 *
 * 行为：
 * - 子图未找到：加 warning，保留原节点
 * - 循环引用（DFS visited 检测）：加 warning，不递归展开
 * - 嵌套子图：递归展开（带 visited 防环，最大深度 32）
 * - 自定义节点（customTypeId 非空）：跳过（由 compileCustomNode 处理）
 *
 * ID 重映射（冲突检测策略）：
 * - 收集主图已有节点 ID，展开子图时若内部节点 ID 与已有 ID 冲突，
 *   则加前缀（`${父节点 id}_${原 id}`）生成唯一 ID
 * - 无冲突时保留原 ID（encapsulate → inline 流程不影响 snippetId 稳定性）
 * - 子图内部边的 source/target 同步重映射
 * - 节点 data.nodeId 与节点 id 保持一致
 * - 主图边原样保留
 */
export function inlineSubgraphNodes(
  graph: NodeGraph,
  manager: SubgraphManager,
): { graph: NodeGraph; warnings: string[] } {
  const warnings: string[] = [];
  const visited = new Set<string>();
  // 已使用的节点 ID（用于冲突检测）
  const usedIds = new Set<string>(graph.nodes.map((n) => n.id));

  function expand(
    node: ModNode,
    depth: number,
    parentPrefix: string,
  ): { nodes: ModNode[]; edges: ModEdge[] } {
    if (depth > 32) {
      warnings.push(`子图嵌套过深（>32），可能存在循环引用：${node.id}`);
      return { nodes: [node], edges: [] };
    }
    if (node.data.kind !== 'subgraph') {
      return { nodes: [node], edges: [] };
    }
    // 自定义节点不在此处理
    if (node.data.customTypeId) return { nodes: [node], edges: [] };
    const sgId = node.data.subgraphId;
    if (!sgId) return { nodes: [node], edges: [] };
    if (visited.has(sgId)) {
      warnings.push(`子图循环引用：${sgId}（跳过展开）`);
      return { nodes: [node], edges: [] };
    }
    visited.add(sgId);
    const sg: SubgraphDefinition | undefined = manager.get(sgId) ?? graph.subgraphs[sgId];
    if (!sg) {
      warnings.push(`子图未找到：${sgId}（节点 ${node.id}）`);
      visited.delete(sgId);
      return { nodes: [node], edges: [] };
    }

    // 为子图内部节点构建 ID 重映射表（仅冲突时重映射）
    const idMap = new Map<string, string>();
    for (const inner of sg.nodes) {
      if (usedIds.has(inner.id)) {
        // 冲突：加前缀生成唯一 ID
        const newId = `${parentPrefix ? `${parentPrefix}_` : ''}${node.id}_${inner.id}`;
        idMap.set(inner.id, newId);
        usedIds.add(newId);
      } else {
        idMap.set(inner.id, inner.id);
        usedIds.add(inner.id);
      }
    }

    const expandedNodes: ModNode[] = [];
    const expandedEdges: ModEdge[] = [];

    // 重映射并保留子图内部边
    for (const edge of sg.edges) {
      const newSource = idMap.get(edge.source) ?? edge.source;
      const newTarget = idMap.get(edge.target) ?? edge.target;
      // 边 ID 也可能冲突，但概率低；为安全起见也加前缀
      const newEdgeId = usedIds.has(edge.id)
        ? `${parentPrefix ? `${parentPrefix}_` : ''}${node.id}_${edge.id}`
        : edge.id;
      usedIds.add(newEdgeId);
      expandedEdges.push({
        ...edge,
        id: newEdgeId,
        source: newSource,
        target: newTarget,
      });
    }

    // 递归展开内部节点（处理嵌套子图）
    for (const inner of sg.nodes) {
      const newId = idMap.get(inner.id)!;
      const innerPrefix = parentPrefix ? `${parentPrefix}_${node.id}` : node.id;
      const result = expand(inner, depth + 1, innerPrefix);
      if (result.nodes.length === 1 && result.nodes[0].id === inner.id) {
        // 非子图节点或跳过展开的子图节点：应用重映射（若 ID 变化）
        if (newId !== inner.id) {
          expandedNodes.push({
            ...result.nodes[0],
            id: newId,
            data: { ...result.nodes[0].data, nodeId: newId },
          });
        } else {
          expandedNodes.push(result.nodes[0]);
        }
      } else if (result.nodes.length > 0) {
        expandedNodes.push(...result.nodes);
        expandedEdges.push(...result.edges);
      } else {
        // 空结果：用重映射 ID 直接放节点
        expandedNodes.push({ ...inner, id: newId, data: { ...inner.data, nodeId: newId } });
      }
    }

    visited.delete(sgId);
    return { nodes: expandedNodes, edges: expandedEdges };
  }

  const newNodes: ModNode[] = [];
  const newEdges: ModEdge[] = [...graph.edges]; // 保留主图边

  for (const node of graph.nodes) {
    const result = expand(node, 0, '');
    newNodes.push(...result.nodes);
    newEdges.push(...result.edges);
  }

  return {
    graph: { ...graph, nodes: newNodes, edges: newEdges },
    warnings,
  };
}
