import type { NodeGraph, PortType } from '@mc-creator/shared';
import { PortType as PortTypeSchema } from '@mc-creator/shared';
import { findPort, arePortTypesCompatible } from './connectionRules';
import { CompileErrorCode } from '../../lib/compileErrors.js';

export interface ValidationError {
  edgeId: string;
  reason: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
  code?: string;
}

/**
 * VariableNodeData.varType -> NodePort['type'] mapping
 */
export function varTypeToPortType(
  varType: 'int' | 'double' | 'string' | 'boolean' | 'item' | 'block',
): PortType {
  switch (varType) {
    case 'int':
      return 'integer';
    case 'double':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'item':
      return 'item_stack';
    case 'block':
      return 'block_state';
  }
}

/**
 * LoopNodeData.loopVarType -> NodePort['type'] mapping
 */
export function loopVarTypeToPortType(loopVarType: 'int' | 'item' | 'block' | 'string'): PortType {
  switch (loopVarType) {
    case 'int':
      return 'integer';
    case 'item':
      return 'item_stack';
    case 'block':
      return 'block_state';
    case 'string':
      return 'string';
  }
}

/**
 * Narrowing helpers：动态端口校验的输入是弱类型快照（Record<string, unknown>），
 * 用守卫收敛为具体形状，避免断言逃逸。
 */
type VarType = 'int' | 'double' | 'string' | 'boolean' | 'item' | 'block';
type LoopVarType = 'int' | 'item' | 'block' | 'string';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 端口类型守卫：经 Zod 校验收敛，非法定制字符串一律视为非法 */
function isPortType(v: unknown): v is PortType {
  return PortTypeSchema.safeParse(v).success;
}

function isVarType(v: unknown): v is VarType {
  return (
    v === 'int' ||
    v === 'double' ||
    v === 'string' ||
    v === 'boolean' ||
    v === 'item' ||
    v === 'block'
  );
}

function isLoopVarType(v: unknown): v is LoopVarType {
  return v === 'int' || v === 'item' || v === 'block' || v === 'string';
}

interface ProcedureInput {
  name: string;
  type: PortType;
}

function asProcedureInputs(v: unknown): ProcedureInput[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (i): i is ProcedureInput => isRecord(i) && typeof i.name === 'string' && isPortType(i.type),
  );
}

interface SubgraphPort {
  externalPortId: string;
  type: PortType;
  direction: 'in' | 'out';
}

function asSubgraphPorts(v: unknown): SubgraphPort[] {
  if (!Array.isArray(v)) return [];
  return v.filter(
    (p): p is SubgraphPort =>
      isRecord(p) &&
      typeof p.externalPortId === 'string' &&
      isPortType(p.type) &&
      (p.direction === 'in' || p.direction === 'out'),
  );
}

/**
 * Validate dynamic port node connections for invalidation due to data changes.
 */
export function validateDynamicPortConnections(
  graph: NodeGraph,
  changedNodeId: string,
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown>,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const node = graph.nodes.find((n) => n.id === changedNodeId);
  if (!node) return { ok: true };

  // NodeData 为 discriminated union，kind 可直接读取
  const kind = node.data.kind;
  const errors: ValidationError[] = [];

  const relatedEdges = graph.edges.filter(
    (e) => e.source === changedNodeId || e.target === changedNodeId,
  );

  if (relatedEdges.length === 0) return { ok: true };

  // Use switch for better type narrowing
  switch (kind) {
    case 'variable': {
      const oldType = oldData?.varType;
      const newType = newData.varType;
      if (oldType !== newType) {
        // 非法 varType 视为全不兼容（守卫失败即报错）
        const sourcePortType: PortType | undefined = isVarType(newType)
          ? varTypeToPortType(newType)
          : undefined;
        for (const edge of graph.edges.filter((e) => e.source === changedNodeId)) {
          const targetNode = graph.nodes.find((n) => n.id === edge.target);
          if (!targetNode) continue;
          const targetPort = findPort(targetNode, edge.targetHandle);
          if (
            !targetPort ||
            sourcePortType === undefined ||
            !arePortTypesCompatible(sourcePortType, targetPort.type)
          ) {
            errors.push({
              edgeId: edge.id,
              reason: `Variable type changed causing type incompatibility: ${sourcePortType} -> ${targetPort?.type}`,
              sourceNodeId: edge.source,
              targetNodeId: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              code: CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
            });
          }
        }
      }
      break;
    }
    case 'loop': {
      const oldType = oldData?.loopVarType;
      const newType = newData.loopVarType;
      if (oldType !== newType) {
        const sourcePortType: PortType | undefined = isLoopVarType(newType)
          ? loopVarTypeToPortType(newType)
          : undefined;
        for (const edge of graph.edges.filter(
          (e) => e.source === changedNodeId && e.sourceHandle === 'loop_var',
        )) {
          const targetNode = graph.nodes.find((n) => n.id === edge.target);
          if (!targetNode) continue;
          const targetPort = findPort(targetNode, edge.targetHandle);
          if (
            !targetPort ||
            sourcePortType === undefined ||
            !arePortTypesCompatible(sourcePortType, targetPort.type)
          ) {
            errors.push({
              edgeId: edge.id,
              reason: `Loop variable type changed causing type incompatibility: ${sourcePortType} -> ${targetPort?.type}`,
              sourceNodeId: edge.source,
              targetNodeId: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              code: CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
            });
          }
        }
      }
      break;
    }
    case 'procedure': {
      const newInputs = asProcedureInputs(newData.inputs);

      const newInputMap = new Map(newInputs.map((i) => [`in_${i.name}`, i.type]));

      for (const edge of graph.edges.filter((e) => e.target === changedNodeId)) {
        const handle = edge.targetHandle ?? '';
        if (handle.startsWith('in_')) {
          const newInput = newInputMap.get(handle);
          if (!newInput) {
            errors.push({
              edgeId: edge.id,
              reason: `Procedure input port removed: ${handle}`,
              sourceNodeId: edge.source,
              targetNodeId: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              code: CompileErrorCode.CONNECTION_PORT_NOT_FOUND,
            });
          } else {
            const sourceNode = graph.nodes.find((n) => n.id === edge.source);
            if (!sourceNode) continue;
            const sourcePort = findPort(sourceNode, edge.sourceHandle);
            if (!sourcePort || !arePortTypesCompatible(sourcePort.type, newInput)) {
              errors.push({
                edgeId: edge.id,
                reason: `Procedure input port type change causing incompatibility: ${sourcePort?.type} -> ${newInput}`,
                sourceNodeId: edge.source,
                targetNodeId: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
                code: CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
              });
            }
          }
        }
      }
      break;
    }
    case 'subgraph': {
      const oldPortMappings = asSubgraphPorts(oldData?.portMappings);
      const newPortMappings = asSubgraphPorts(newData.portMappings);

      const oldPortMap = new Map(oldPortMappings.map((p) => [p.externalPortId, p.type]));
      const newPortMap = new Map(newPortMappings.map((p) => [p.externalPortId, p.type]));

      const relatedEdges = graph.edges.filter(
        (e) => e.source === changedNodeId || e.target === changedNodeId,
      );

      for (const edge of relatedEdges) {
        const handle = edge.source === changedNodeId ? edge.sourceHandle : edge.targetHandle;
        if (!handle) continue;

        const oldType = oldPortMap.get(handle);
        const newType = newPortMap.get(handle);

        if (oldType && !newType) {
          errors.push({
            edgeId: edge.id,
            reason: `Subgraph port removed: ${handle}`,
            sourceNodeId: edge.source,
            targetNodeId: edge.target,
            sourceHandle: edge.sourceHandle,
            targetHandle: edge.targetHandle,
            code: CompileErrorCode.CONNECTION_PORT_NOT_FOUND,
          });
        } else if (oldType && newType && oldType !== newType) {
          const otherNodeId = edge.source === changedNodeId ? edge.target : edge.source;
          const otherNode = graph.nodes.find((n) => n.id === otherNodeId);
          if (!otherNode) continue;
          const otherPort = findPort(
            otherNode,
            edge.source === changedNodeId ? edge.targetHandle : edge.sourceHandle,
          );
          if (!otherPort || !arePortTypesCompatible(newType, otherPort.type)) {
            errors.push({
              edgeId: edge.id,
              reason: `Subgraph port type change causing incompatibility: ${newType} -> ${otherPort?.type}`,
              sourceNodeId: edge.source,
              targetNodeId: edge.target,
              sourceHandle: edge.sourceHandle,
              targetHandle: edge.targetHandle,
              code: CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
            });
          }
        }
      }
      break;
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
