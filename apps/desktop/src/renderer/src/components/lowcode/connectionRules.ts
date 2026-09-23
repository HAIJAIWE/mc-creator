import type { Edge, Connection } from 'reactflow';
import type { ModNode, NodeGraph, NodePort, PortType } from '@mc-creator/shared';
import { CompileErrorCode, CompileErrors } from '../../lib/compileErrors.js';

/**
 * 节点连线校验规则
 *
 * 用于 React Flow 的 isValidConnection 回调，防止用户连接不兼容的端口。
 *
 * 校验维度（按优先级）：
 * 1. 自连线检查：源节点 === 目标节点则拒绝
 * 2. 节点存在性检查：源/目标节点必须存在于 graph.nodes 中
 * 3. 节点禁用检查：data.disabled === true 则拒绝
 * 4. 端口存在性检查：sourceHandle/targetHandle 必须存在于节点端口中
 * 5. 端口类型兼容性检查：类型必须匹配或一方为 'any'
 * 6. 端口方向检查：源端口方向 === 'out'，目标端口方向 === 'in'
 *
 * 注意：schema PortType 不包含 'flow'，控制流端口统一使用 'void' 类型。
 */

/**
 * 在节点端口中按 ID 查找端口。
 *
 * @param node 节点实例
 * @param portId 端口 ID（可能为 null/undefined）
 * @returns 找到的端口，未找到则返回 undefined
 */
export function findPort(node: ModNode, portId: string | undefined | null): NodePort | undefined {
  if (!portId) return undefined;
  return node.ports.find((p) => p.id === portId);
}

/**
 * 检查两个端口类型是否兼容。
 *
 * 规则：
 * - 同类型 -> 兼容
 * - 任意一方为 'any' -> 兼容（any 为通配类型，供 code 节点使用）
 * - 其他 -> 不兼容
 *
 * 注意：schema PortType 不包含 'flow'，无需流类型兼容规则。
 * 控制流端口统一使用 'void'，同类型即兼容。
 *
 * @param sourceType 源端口类型
 * @param targetType 目标端口类型
 * @returns 是否兼容
 */
export function arePortTypesCompatible(sourceType: PortType, targetType: PortType): boolean {
  if (sourceType === targetType) return true;
  if (sourceType === 'any' || targetType === 'any') return true;
  return false;
}

/**
 * 构建 nodeMap 索引（按 id O(1) 查找）。
 * P2 dogfood 优化：缓存 nodeMap，避免每次 isValidConnection/validateConnection 调用重建 Map。
 * 仅当 graph 引用变化时重建。
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
 * 校验单条连线。
 *
 * @param graph 当前节点图
 * @param connection React Flow Connection 或 Edge
 * @returns 是否有效
 */
export function isValidConnection(graph: NodeGraph, connection: Connection | Edge): boolean {
  const sourceId = connection.source;
  const targetId = connection.target;

  // 1. 源/目标节点必须存在（Connection 类型允许 null）
  if (!sourceId || !targetId) return false;

  // 2. 自连线检查
  if (sourceId === targetId) return false;

  // 3. 节点存在性检查（P1 优化：Map 代替 Array.find，P2 缓存优化）
  const nodeMap = getNodeMap(graph);
  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);
  if (!sourceNode || !targetNode) return false;

  // 4. 节点禁用检查
  if (sourceNode.data.disabled) return false;
  if (targetNode.data.disabled) return false;

  // 5. 端口存在性检查
  const sourcePort = findPort(sourceNode, connection.sourceHandle);
  const targetPort = findPort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return false;

  // 6. 端口类型兼容性检查
  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) return false;

  // 7. 端口方向检查：源端口必须为 out，目标端口必须为 in
  if (sourcePort.direction !== 'out') return false;
  if (targetPort.direction !== 'in') return false;

  return true;
}

/**
 * 校验连线有效性，返回带失败原因的结果。
 *
 * 除 isValidConnection 外：
 * - multiple 限制：目标端口 multiple=false 且已有连线则拒绝
 * - 返回 { ok: true } 或 { ok: false, reason: string }
 */
export function validateConnection(
  graph: NodeGraph,
  connection: Connection | Edge,
): { ok: true } | { ok: false; reason: string; code?: string } {
  const sourceId = connection.source;
  const targetId = connection.target;

  if (!sourceId || !targetId)
    return {
      ok: false,
      reason: '缺少源节点或目标节点',
      code: CompileErrorCode.CONNECTION_MISSING_SOURCE,
    };
  if (sourceId === targetId)
    return { ok: false, reason: '不允许自连线', code: CompileErrorCode.CONNECTION_SELF_LOOP };

  const nodeMap = getNodeMap(graph);
  const sourceNode = nodeMap.get(sourceId);
  const targetNode = nodeMap.get(targetId);
  if (!sourceNode || !targetNode)
    return { ok: false, reason: '节点不存在', code: CompileErrorCode.CONNECTION_NODE_NOT_FOUND };

  if (sourceNode.data.disabled)
    return { ok: false, reason: '源节点已禁用', code: CompileErrorCode.CONNECTION_NODE_DISABLED };
  if (targetNode.data.disabled)
    return { ok: false, reason: '目标节点已禁用', code: CompileErrorCode.CONNECTION_NODE_DISABLED };

  const sourcePort = findPort(sourceNode, connection.sourceHandle);
  const targetPort = findPort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort)
    return { ok: false, reason: '端口不存在', code: CompileErrorCode.CONNECTION_PORT_NOT_FOUND };

  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
    return {
      ok: false,
      reason: `端口类型不兼容: ${sourcePort.type} -> ${targetPort.type}`,
      code: CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
    };
  }

  if (sourcePort.direction !== 'out')
    return {
      ok: false,
      reason: '源端口必须是输出方向',
      code: CompileErrorCode.CONNECTION_DIRECTION_INVALID,
    };
  if (targetPort.direction !== 'in')
    return {
      ok: false,
      reason: '目标端口必须是输入方向',
      code: CompileErrorCode.CONNECTION_DIRECTION_INVALID,
    };

  // multiple 限制：目标端口 multiple=false 且已有连线则拒绝
  if (!targetPort.multiple) {
    const existingConnection = graph.edges.some(
      (e) =>
        e.target === targetId &&
        e.targetHandle === (connection.targetHandle ?? undefined) &&
        e.id !== (connection as Edge).id,
    );
    if (existingConnection) {
      return {
        ok: false,
        reason: '单连线端口已存在连线（将替换旧连线）',
        code: CompileErrorCode.CONNECTION_MULTIPLE_LIMIT,
      };
    }
  }

  return { ok: true };
}

/**
 * 批量校验图中所有连线（用于保存/编译前检查）。
 *
 * @returns { ok: true } 或 { ok: false, errors: ValidationError[] }
 */
export interface ValidationError {
  edgeId: string;
  reason: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export function validateGraphConnections(
  graph: NodeGraph,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = [];

  for (const edge of graph.edges) {
    const result = validateConnection(graph, edge);
    if (!result.ok) {
      errors.push({
        edgeId: edge.id,
        reason: result.reason,
        sourceNodeId: edge.source,
        targetNodeId: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * 检测控制流图中的环（死循环检测）。
 *
 * 仅检查 'control' 类型的边（EdgeKind === 'control'）。
 * 使用 DFS + 三色标记法检测有向图环。
 *
 * @returns { hasCycle: true, cycle: string[] } | { hasCycle: false }
 */
export function detectControlFlowCycles(
  graph: NodeGraph,
): { hasCycle: true; cycle: string[] } | { hasCycle: false } {
  const controlEdges = graph.edges.filter((e) => e.kind === 'control');
  const adjacency = new Map<string, string[]>();

  for (const edge of controlEdges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }

  const WHITE = 0; // 未访问
  const GRAY = 1; // 访问中（在栈中）
  const BLACK = 2; // 已访问完

  const colors = new Map<string, number>();
  const parent = new Map<string, string | null>();
  let cyclePath: string[] | null = null;

  function dfs(nodeId: string): boolean {
    colors.set(nodeId, GRAY);
    const neighbors = adjacency.get(nodeId) ?? [];
    for (const neighbor of neighbors) {
      const color = colors.get(neighbor) ?? 0;
      if (color === 0) {
        parent.set(neighbor, nodeId);
        if (dfs(neighbor)) return true;
      } else if (color === 1) {
        // 发现环，回溯构建路径
        const path = [neighbor];
        let curr = nodeId;
        while (curr && curr !== neighbor) {
          path.push(curr);
          curr = parent.get(curr) ?? '';
        }
        if (curr !== neighbor) {
          cyclePath = [neighbor, nodeId, neighbor];
          return true;
        }
        path.push(neighbor);
        cyclePath = path.reverse();
        return true;
      }
    }
    colors.set(nodeId, BLACK);
    return false;
  }

  for (const node of Array.from(adjacency.keys())) {
    if (!colors.has(node)) {
      parent.set(node, null);
      if (dfs(node)) break;
    }
  }

  if (cyclePath) {
    return { hasCycle: true, cycle: cyclePath };
  }
  return { hasCycle: false };
}

export {
  validateDynamicPortConnections,
  varTypeToPortType,
  loopVarTypeToPortType,
} from './portValidation';
