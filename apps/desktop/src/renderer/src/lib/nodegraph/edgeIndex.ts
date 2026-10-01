import type { NodeGraph, ModEdge, ModNode } from '@mc-creator/shared';

// === 连线关系查询辅助 ===

/**
 * P2 dogfood 优化：构建边索引，按 source/target 分组，加速 getIncomingEdges/getOutgoingEdges。
 * 原实现每次调用都线性扫描 graph.edges（O(E)），大型图中配方编译和事件 BFS 频繁调用
 * 导致编译慢。构建索引后降为 O(1) 查找 + O(k) 遍历（k 为实际连入/连出边数）。
 */
export function buildEdgeIndex(graph: NodeGraph): {
  outgoing: Map<string, ModEdge[]>;
  incoming: Map<string, ModEdge[]>;
} {
  const outgoing = new Map<string, ModEdge[]>();
  const incoming = new Map<string, ModEdge[]>();
  for (const edge of graph.edges) {
    if (edge.disabled) continue;
    let outList = outgoing.get(edge.source);
    if (!outList) {
      outList = [];
      outgoing.set(edge.source, outList);
    }
    outList.push(edge);
    let inList = incoming.get(edge.target);
    if (!inList) {
      inList = [];
      incoming.set(edge.target, inList);
    }
    inList.push(edge);
  }
  return { outgoing, incoming };
}

/** 缓存边索引（与 connectionRules 的 getNodeMap 同理，引用不变时复用） */
let cachedEdgeGraphRef: NodeGraph | null = null;
let cachedEdgeIndex: ReturnType<typeof buildEdgeIndex> | null = null;

export function getEdgeIndex(graph: NodeGraph): ReturnType<typeof buildEdgeIndex> {
  if (cachedEdgeGraphRef === graph && cachedEdgeIndex) return cachedEdgeIndex;
  cachedEdgeGraphRef = graph;
  cachedEdgeIndex = buildEdgeIndex(graph);
  return cachedEdgeIndex;
}

/** 获取节点的所有输入连线 */
export function getIncomingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return getEdgeIndex(graph).incoming.get(nodeId) ?? [];
}

/** 获取节点的所有输出连线 */
export function getOutgoingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return getEdgeIndex(graph).outgoing.get(nodeId) ?? [];
}

/** 根据连线找到源节点（优先从 nodeMap 查找，回退到线性扫描） */
export function findSourceNode(
  graph: NodeGraph,
  edge: ModEdge,
  nodeMap?: Map<string, ModNode>,
): ModNode | null {
  if (nodeMap) return nodeMap.get(edge.source) ?? null;
  return graph.nodes.find((n) => n.id === edge.source) ?? null;
}

/** 根据连线找到目标节点（优先从 nodeMap 查找，回退到线性扫描） */
export function findTargetNode(
  graph: NodeGraph,
  edge: ModEdge,
  nodeMap?: Map<string, ModNode>,
): ModNode | null {
  if (nodeMap) return nodeMap.get(edge.target) ?? null;
  return graph.nodes.find((n) => n.id === edge.target) ?? null;
}
