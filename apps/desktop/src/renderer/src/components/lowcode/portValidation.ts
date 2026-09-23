import type { NodeGraph, NodePort, PortType } from '@mc-creator/shared';
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

type NodeKind = 'variable' | 'loop' | 'procedure' | 'subgraph';

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

  const kind = (node.data as any).kind as string;
  const errors: ValidationError[] = [];

  const relatedEdges = graph.edges.filter(
    (e) => e.source === changedNodeId || e.target === changedNodeId,
  );

  if (relatedEdges.length === 0) return { ok: true };

  // Use switch for better type narrowing
  switch (kind) {
    case 'variable': {
      const oldType = (oldData as any)?.varType;
      const newType = (newData as any)?.varType;
      if (oldType !== newType) {
        for (const edge of graph.edges.filter((e) => e.source === changedNodeId)) {
          const targetNode = graph.nodes.find((n) => n.id === edge.target);
          if (!targetNode) continue;
          const targetPort = findPort(targetNode, edge.targetHandle);
          const sourcePortType = varTypeToPortType(newType);
          if (!targetPort || !arePortTypesCompatible(sourcePortType, targetPort.type)) {
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
      const oldType = (oldData as any)?.loopVarType;
      const newType = (newData as any)?.loopVarType;
      if (oldType !== newType) {
        for (const edge of graph.edges.filter(
          (e) => e.source === changedNodeId && e.sourceHandle === 'loop_var',
        )) {
          const targetNode = graph.nodes.find((n) => n.id === edge.target);
          if (!targetNode) continue;
          const targetPort = findPort(targetNode, edge.targetHandle);
          const sourcePortType = loopVarTypeToPortType(newType);
          if (!targetPort || !arePortTypesCompatible(sourcePortType, targetPort.type)) {
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
      const oldInputs = ((oldData as any)?.inputs ?? []) as Array<{ name: string; type: string }>;
      const newInputs = ((newData as any)?.inputs ?? []) as Array<{ name: string; type: string }>;

      const oldInputMap = new Map(oldInputs.map((i) => [`in_${i.name}`, i.type as PortType]));
      const newInputMap = new Map(newInputs.map((i) => [`in_${i.name}`, i.type as PortType]));

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
      const oldPortMappings = ((oldData as any)?.portMappings ?? []) as Array<{
        externalPortId: string;
        type: string;
        direction: 'in' | 'out';
      }>;
      const newPortMappings = ((newData as any)?.portMappings ?? []) as Array<{
        externalPortId: string;
        type: string;
        direction: 'in' | 'out';
      }>;

      const oldPortMap = new Map(
        oldPortMappings.map((p) => [p.externalPortId, p.type as PortType]),
      );
      const newPortMap = new Map(
        newPortMappings.map((p) => [p.externalPortId, p.type as PortType]),
      );

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
