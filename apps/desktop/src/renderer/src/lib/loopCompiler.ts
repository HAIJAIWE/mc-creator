import type { NodeGraph, ModNode, ConditionSpec, ProcedureSpec } from '@mc-creator/shared';
import { compileConditionNode, compileProcedureNode } from './compileNodeGraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';

/**
 * 编译循环节点的循环体：从 bodySubgraphId 引用的子图中提取代码节点/动作节点的代码，
 * 拼接为循环体代码字符串。无 bodySubgraphId 或子图未找到时返回空注释。
 *
 * P2-5：condition 节点编译为 `if (check_<id>(ctx)) { ... }`（条件方法由
 * compileLoopSubgraphSpecs 收集进 spec.conditions，adapter 生成 check_ 方法）；
 * procedure 节点编译为 `procedure_<name>(ctx);` 调用（同样由子图收集进 spec.procedures）。
 */
export function compileLoopBody(
  graph: NodeGraph,
  bodySubgraphId?: string,
  _warnings?: string[],
): string {
  if (!bodySubgraphId) return '// no body';
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return '// body subgraph not found';
  const lines: string[] = [];
  for (const node of sg.nodes) {
    // 跳过禁用节点，与主编译流程一致
    if (node.data.disabled) continue;
    if (node.data.kind === 'code') {
      // 与主编译流程一致：codeLocked 节点使用用户手改的 lockedCode
      lines.push(
        node.data.codeLocked && node.data.lockedCode ? node.data.lockedCode : node.data.code,
      );
    } else if (node.data.kind === 'action') {
      lines.push(`execute_${node.id}(ctx);`);
    } else if (node.data.kind === 'condition') {
      // P2-5：循环体中的条件节点编译为 if (check_<id>(ctx)) 块，内嵌其 control 下游逻辑
      const downstream = sg.edges
        .filter((e) => e.source === node.id && e.kind === 'control' && !e.disabled)
        .map((e) => sg.nodes.find((n) => n.id === e.target))
        .filter((n): n is ModNode => !!n && !n.data.disabled);
      const innerLines: string[] = [];
      for (const dn of downstream) {
        if (dn.data.kind === 'code') {
          innerLines.push(
            dn.data.codeLocked && dn.data.lockedCode ? dn.data.lockedCode : dn.data.code,
          );
        } else if (dn.data.kind === 'action') {
          innerLines.push(`execute_${dn.id}(ctx);`);
        } else if (dn.data.kind === 'procedure') {
          innerLines.push(`procedure_${dn.data.procedureName}(ctx);`);
        }
      }
      const inner =
        innerLines.length > 0
          ? innerLines.map((l) => `            ${l}`).join('\n')
          : '            // (无循环体逻辑)';
      lines.push(`if (check_${node.id}(ctx)) {\n${inner}\n        }`);
    } else if (node.data.kind === 'procedure') {
      // P2-5：循环体中的过程调用编译为 procedure_<name>(ctx);
      lines.push(`procedure_${node.data.procedureName}(ctx);`);
    }
  }
  return lines.length > 0 ? lines.join('\n  ') : '// empty body';
}

/**
 * P2-5：收集循环节点 body 子图中的 condition / procedure 节点，编译为 spec 字段，
 * 供 adapter 生成 check_<id> 方法与 procedure_<name> 方法（循环体代码引用它们）。
 * procedure 的体内逻辑基于子图自身的 nodes/edges 做 BFS（复用 compileProcedureNode）。
 */
export function compileLoopSubgraphSpecs(
  graph: NodeGraph,
  bodySubgraphId: string,
  warnings?: string[],
): { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } {
  const result: { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } = {
    conditions: [],
    procedures: [],
  };
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return result;
  for (const node of sg.nodes) {
    if (node.data.disabled) continue;
    if (node.data.kind === 'condition') {
      try {
        result.conditions.push(compileConditionNode(node, warnings));
      } catch {
        warnings?.push(`循环体中的条件节点 ${node.id} 编译失败`);
      }
    } else if (node.data.kind === 'procedure') {
      try {
        const sgGraph: NodeGraph = {
          modId: graph.modId,
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: sg.nodes,
          edges: sg.edges,
          subgraphs: {},
        };
        result.procedures.push(compileProcedureNode(sgGraph, node));
      } catch {
        warnings?.push(`循环体中的过程节点 ${node.id} 编译失败`);
      }
    }
  }
  return result;
}

/**
 * P2-5：遍历所有可编译的 loop 节点，汇总各 body 子图的 condition/procedure 编译结果。
 */
export function compileLoopSubgraphSpecsAll(
  nodes: ModNode[],
  graph: NodeGraph,
  warnings?: string[],
): { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } {
  const result: { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } = {
    conditions: [],
    procedures: [],
  };
  for (const node of nodes) {
    if (node.data.kind !== 'loop') continue;
    if (!node.data.bodySubgraphId) continue;
    const sub = compileLoopSubgraphSpecs(graph, node.data.bodySubgraphId, warnings);
    result.conditions.push(...sub.conditions);
    result.procedures.push(...sub.procedures);
  }
  return result;
}
