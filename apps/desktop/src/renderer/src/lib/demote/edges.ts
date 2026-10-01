import type { ModNode, ModEdge } from '@mc-creator/shared';

// === 边生成 ===

/**
 * 生成 recipe → item 边（按 outputItem 匹配 itemId）。
 *
 * @param nodes 节点列表（用于建立 itemId → item 节点 id 映射）
 * @param recipeOutputs 每个配方节点的输出物品（recipeId/nodeId → outputItem，已剥离命名空间）
 * @param warnings 警告收集器
 */
export function generateRecipeEdges(
  nodes: ModNode[],
  recipeOutputs: Array<{ nodeId: string; outputItem: string; recipeId: string }>,
  warnings: string[],
): ModEdge[] {
  const edges: ModEdge[] = [];
  // 建立 itemId → item 节点 id 映射
  const itemIndex = new Map<string, string>(); // itemId → nodeId
  for (const node of nodes) {
    if (node.data.kind === 'item') {
      const itemId = (node.data as { itemId: string }).itemId;
      itemIndex.set(itemId, node.id);
    }
  }
  // 遍历 recipe 输出列表，生成 craft 边
  let edgeIdx = 0;
  for (const { nodeId, outputItem, recipeId } of recipeOutputs) {
    if (!outputItem) continue;
    const targetNodeId = itemIndex.get(outputItem);
    if (!targetNodeId) {
      warnings.push(`配方 ${recipeId} 引用了不存在的物品 ${outputItem}，未生成输出连线`);
      continue;
    }
    const edgeId = `edge_recipe_${edgeIdx++}`;
    edges.push({
      id: edgeId,
      source: nodeId,
      target: targetNodeId,
      sourceHandle: 'out',
      targetHandle: undefined,
      kind: 'craft',
      label: undefined,
      disabled: false,
    });
  }
  return edges;
}
