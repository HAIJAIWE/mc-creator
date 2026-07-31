import type { Edge, Connection } from 'reactflow';
import type { ModNode, NodeGraph, NodePort, PortType } from '@mc-creator/shared';

/**
 * 节点连线校验规则
 *
 * 用于 React Flow 的 isValidConnection 回调，防止用户连接不兼容的端口。
 *
 * 校验维度（按优先级）：
 * 1. 自连校验：source === target 拒绝
 * 2. 节点存在校验：source/target 节点必须在 graph.nodes 中
 * 3. 节点禁用校验：data.disabled === true 拒绝
 * 4. 端口存在校验：sourceHandle/targetHandle 必须能在节点 ports 中找到
 * 5. 端口类型兼容校验：类型相同或其中一方为 'any'
 * 6. 端口方向校验：源端口 direction === 'out'，目标端口 direction === 'in'
 *
 * 注：schema 中 PortType 不含 'flow'，控制流端口统一使用 'void' 类型。
 */

/**
 * 在节点的 ports 中查找指定 ID 的端口。
 *
 * @param node 节点实例
 * @param portId 端口 ID（可能为 null/undefined）
 * @returns 命中的端口，未找到返回 undefined
 */
export function findPort(node: ModNode, portId: string | undefined | null): NodePort | undefined {
  if (!portId) return undefined;
  return node.ports.find((p) => p.id === portId);
}

/**
 * 判断两个端口类型是否兼容。
 *
 * 规则：
 * - 类型相同 → 兼容
 * - 任一为 'any' → 兼容（any 是通配类型，代码节点使用）
 * - 其他 → 不兼容
 *
 * 注：schema 中 PortType 不含 'flow'，因此不需要 flow 兼容规则。
 * 控制流端口统一使用 'void'，相同类型即兼容。
 *
 * @param sourceType 源端口类型
 * @param targetType 目标端口类型
 * @returns 兼容返回 true
 */
export function arePortTypesCompatible(sourceType: PortType, targetType: PortType): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'any' || targetType === 'any') return true;
  return false;
}

/**
 * 构建 nodeMap 索引（按 id 查找节点，O(1)）。
 * P2 dogfood 优化：缓存 nodeMap，避免每次 isValidConnection/validateConnection
 * 调用都重建 Map。当 graph 引用变化时才重新构建。
 */
let cachedGraphRef: NodeGraph | null = null;
let cachedNodeMap: Map<string, ModNode> | null = null;

function getNodeMap(graph: NodeGraph): Map<string, ModNode> {
  if (cachedGraphRef === graph && cachedNodeMap) return cachedNodeMap;
  cachedGraphRef = graph;
  cachedNodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  return cachedNodeMap;
}

/**
 * 校验一条连线是否合法。
 *
 * @param graph 当前节点图
 * @param connection React Flow 传入的 Connection 或 Edge
 * @returns 合法返回 true，非法返回 false
 */
export function isValidConnection(graph: NodeGraph, connection: Connection | Edge): boolean {
  const sourceId = connection.source;
  const targetId = connection.target;

  // 1. source/target 必须存在（Connection 类型允许 null）
  if (!sourceId || !targetId) return false;

  // 2. 自连校验
  if (sourceId === targetId) return false;

  // 3. 节点存在校验（P1 优化：用 Map 替代 Array.find，P2 缓存优化）
  const nodeMap = getNodeMap(graph);
  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);
  if (!sourceNode || !targetNode) return false;

  // 4. 节点禁用校验
  if (sourceNode.data.disabled) return false;
  if (targetNode.data.disabled) return false;

  // 5. 端口存在校验
  const sourcePort = findPort(sourceNode, connection.sourceHandle);
  const targetPort = findPort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return false;

  // 6. 端口类型兼容校验
  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) return false;

  // 7. 端口方向校验：源必须是 out，目标必须是 in
  if (sourcePort.direction !== 'out') return false;
  if (targetPort.direction !== 'in') return false;

  return true;
}

/**
 * 校验连线合法性，返回带失败原因的结果。
 *
 * 在 isValidConnection 基础上增加：
 * - multiple 限制：目标端口 multiple=false 且已有连线时拒绝
 * - 返回 { ok: true } 或 { ok: false, reason: string }
 */
export function validateConnection(
  graph: NodeGraph,
  connection: Connection | Edge,
): { ok: true } | { ok: false; reason: string } {
  const sourceId = connection.source;
  const targetId = connection.target;

  if (!sourceId || !targetId) return { ok: false, reason: '缺少源或目标节点' };
  if (sourceId === targetId) return { ok: false, reason: '不能自连' };

  const nodeMap = getNodeMap(graph);
  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);
  if (!sourceNode || !targetNode) return { ok: false, reason: '节点不存在' };

  if (sourceNode.data.disabled) return { ok: false, reason: '源节点已禁用' };
  if (targetNode.data.disabled) return { ok: false, reason: '目标节点已禁用' };

  const sourcePort = findPort(sourceNode, connection.sourceHandle);
  const targetPort = findPort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return { ok: false, reason: '端口不存在' };

  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
    return { ok: false, reason: `端口类型不兼容：${sourcePort.type} → ${targetPort.type}` };
  }

  if (sourcePort.direction !== 'out') return { ok: false, reason: '源端口必须是输出方向' };
  if (targetPort.direction !== 'in') return { ok: false, reason: '目标端口必须是输入方向' };

  // multiple 限制：目标端口不允许多条连线时，检查是否已有连线
  if (!targetPort.multiple) {
    const existingConnection = graph.edges.some(
      (e) =>
        e.target === targetId &&
        e.targetHandle === (connection.targetHandle ?? undefined) &&
        e.id !== (connection as Edge).id,
    );
    if (existingConnection) {
      return { ok: false, reason: '该端口为单连线端口，已有连线（将替换旧连线）' };
    }
  }

  return { ok: true };
}
