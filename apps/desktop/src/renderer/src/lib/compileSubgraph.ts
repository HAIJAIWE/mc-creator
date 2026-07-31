import type {
  NodeGraph,
  ModNode,
  ModEdge,
  SubgraphDefinition,
  SubgraphPortMapping,
} from '@mc-creator/shared';
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
 *
 * 端口透传（L-2 修复）：
 * - 每个 portMapping 生成一个边界节点（kind: comment，id = boundary_<internalPortId>），
 *   使子图内部连到边界的边在展开后仍有落点
 * - 主图中连到子图节点的边：direction 'in' 的映射把 target 重定向到输入边界节点，
 *   direction 'out' 的映射把 source 重定向到输出边界节点
 * - 无法匹配任何端口映射的边：加 warning 并丢弃（不再保留悬空边）
 */
export function inlineSubgraphNodes(
  graph: NodeGraph,
  manager: SubgraphManager,
): { graph: NodeGraph; warnings: string[] } {
  const warnings: string[] = [];
  const visited = new Set<string>();
  // 已使用的节点/边 ID（用于冲突检测）
  const usedIds = new Set<string>(graph.nodes.map((n) => n.id));

  /** 是否是可展开的普通子图节点（kind=subgraph、非自定义、引用了存在的子图） */
  function isExpandable(node: ModNode): boolean {
    if (node.data.kind !== 'subgraph' || node.data.customTypeId || !node.data.subgraphId) {
      return false;
    }
    const sgId = node.data.subgraphId;
    return !!(manager.get(sgId) ?? graph.subgraphs[sgId]);
  }

  /** 端口映射对应的子图内部边界节点 ID */
  function boundaryIdOf(m: SubgraphPortMapping): string {
    return m.internalPortId.startsWith('boundary_')
      ? m.internalPortId
      : `boundary_${m.internalPortId}`;
  }

  /** 分配唯一 ID：冲突时加父节点前缀 */
  function allocId(originalId: string, node: ModNode, parentPrefix: string): string {
    if (!usedIds.has(originalId)) {
      usedIds.add(originalId);
      return originalId;
    }
    const newId = `${parentPrefix ? `${parentPrefix}_` : ''}${node.id}_${originalId}`;
    usedIds.add(newId);
    return newId;
  }

  /** 从端口映射生成边界节点（透传端口，kind: comment） */
  function makeBoundaryNode(originalId: string, newId: string, m: SubgraphPortMapping): ModNode {
    const isIn = m.direction === 'in';
    return {
      id: newId,
      type: 'comment',
      position: { x: isIn ? -240 : 240, y: 0 },
      data: {
        nodeId: newId,
        label: m.label,
        note: '',
        disabled: false,
        kind: 'comment',
        text: '',
        color: 'yellow',
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [
        {
          id: isIn ? 'out' : 'in',
          label: m.label,
          type: m.type,
          direction: isIn ? 'out' : 'in',
          required: false,
          multiple: isIn,
        },
      ],
      selected: false,
    };
  }

  /**
   * 展开子图节点。
   * externalEdges：本层图中连到该节点的边（主图边或父级子图内部边），
   * 展开成功后经 portMappings 重定向到边界节点；无法匹配则丢弃并 warning。
   * 注意：外部边"另一端"的 ID 已由调用方预映射为最终 ID，只有指向本节点的
   * 端点保持原始 ID，便于在这里判断匹配。
   */
  function expand(
    node: ModNode,
    depth: number,
    parentPrefix: string,
    externalEdges: ModEdge[],
  ): { nodes: ModNode[]; edges: ModEdge[] } {
    if (depth > 32) {
      warnings.push(`子图嵌套过深（>32），可能存在循环引用：${node.id}`);
      return { nodes: [node], edges: externalEdges };
    }
    if (node.data.kind !== 'subgraph') {
      return { nodes: [node], edges: externalEdges };
    }
    // 自定义节点不在此处理
    if (node.data.customTypeId) return { nodes: [node], edges: externalEdges };
    const sgId = node.data.subgraphId;
    if (!sgId) return { nodes: [node], edges: externalEdges };
    if (visited.has(sgId)) {
      warnings.push(`子图循环引用：${sgId}（跳过展开）`);
      return { nodes: [node], edges: externalEdges };
    }
    visited.add(sgId);
    const sg: SubgraphDefinition | undefined = manager.get(sgId) ?? graph.subgraphs[sgId];
    if (!sg) {
      warnings.push(`子图未找到：${sgId}（节点 ${node.id}）`);
      visited.delete(sgId);
      return { nodes: [node], edges: externalEdges };
    }

    // 为子图内部节点 + 边界节点构建 ID 重映射表（仅冲突时重映射）
    const idMap = new Map<string, string>();
    for (const inner of sg.nodes) {
      idMap.set(inner.id, allocId(inner.id, node, parentPrefix));
    }
    const boundaryIds = new Map<string, string>(); // externalPortId → 边界节点新 id
    const boundaryRemap = new Map<string, string>(); // 原边界 id → 新 id
    for (const m of sg.portMappings) {
      const newId = allocId(boundaryIdOf(m), node, parentPrefix);
      boundaryIds.set(m.externalPortId, newId);
      boundaryRemap.set(boundaryIdOf(m), newId);
    }

    const expandedNodes: ModNode[] = [];
    const expandedEdges: ModEdge[] = [];

    // 递归展开内部节点（处理嵌套子图）
    const innerPrefix = parentPrefix ? `${parentPrefix}_${node.id}` : node.id;
    for (const inner of sg.nodes) {
      if (isExpandable(inner)) {
        // 子图节点：把子图内部连到它的边传下去（另一端预映射为最终 ID）
        const innerEdges = sg.edges
          .filter((e) => e.source === inner.id || e.target === inner.id)
          .map((e) => ({
            ...e,
            source:
              e.source === inner.id
                ? e.source
                : (idMap.get(e.source) ?? boundaryRemap.get(e.source) ?? e.source),
            target:
              e.target === inner.id
                ? e.target
                : (idMap.get(e.target) ?? boundaryRemap.get(e.target) ?? e.target),
          }));
        const result = expand(inner, depth + 1, innerPrefix, innerEdges);
        // 嵌套展开失败时返回原节点：应用本层重映射，并重映射边中指向本节点的端点
        if (result.nodes.length === 1 && result.nodes[0].id === inner.id) {
          const newId = idMap.get(inner.id)!;
          if (newId !== inner.id) {
            expandedNodes.push({
              ...result.nodes[0],
              id: newId,
              data: { ...result.nodes[0].data, nodeId: newId },
            });
          } else {
            expandedNodes.push(result.nodes[0]);
          }
          for (const e of result.edges) {
            expandedEdges.push({
              ...e,
              source: e.source === inner.id ? newId : e.source,
              target: e.target === inner.id ? newId : e.target,
            });
          }
        } else {
          expandedNodes.push(...result.nodes);
          expandedEdges.push(...result.edges);
        }
      } else {
        // 普通节点：应用本层 ID 重映射
        const newId = idMap.get(inner.id)!;
        if (newId !== inner.id) {
          expandedNodes.push({
            ...inner,
            id: newId,
            data: { ...inner.data, nodeId: newId },
          });
        } else {
          expandedNodes.push(inner);
        }
      }
    }

    // 生成边界节点（透传端口）
    for (const m of sg.portMappings) {
      expandedNodes.push(makeBoundaryNode(boundaryIdOf(m), boundaryIds.get(m.externalPortId)!, m));
    }

    // 子图内部边：两端都非可展开子图节点才重映射保留；
    // 连到内部子图节点的边已交由嵌套 expand 的 externalEdges 处理
    for (const edge of sg.edges) {
      const srcNode = sg.nodes.find((n) => n.id === edge.source);
      const tgtNode = sg.nodes.find((n) => n.id === edge.target);
      if ((srcNode && isExpandable(srcNode)) || (tgtNode && isExpandable(tgtNode))) continue;
      expandedEdges.push({
        ...edge,
        id: allocId(edge.id, node, parentPrefix),
        source: idMap.get(edge.source) ?? boundaryRemap.get(edge.source) ?? edge.source,
        target: idMap.get(edge.target) ?? boundaryRemap.get(edge.target) ?? edge.target,
      });
    }

    // 外部边（主图边或父级内部边）经 portMappings 重定向到边界节点
    for (const edge of externalEdges) {
      let newSource = edge.source;
      let newTarget = edge.target;
      if (edge.target === node.id) {
        const m = sg.portMappings.find(
          (p) => p.direction === 'in' && p.externalPortId === edge.targetHandle,
        );
        if (!m) {
          warnings.push(
            `边 ${edge.id} 指向子图 ${sgId} 但未匹配输入端口（handle=${edge.targetHandle}），已丢弃`,
          );
          continue;
        }
        newTarget = boundaryIds.get(m.externalPortId)!;
      }
      if (edge.source === node.id) {
        const m = sg.portMappings.find(
          (p) => p.direction === 'out' && p.externalPortId === edge.sourceHandle,
        );
        if (!m) {
          warnings.push(
            `边 ${edge.id} 从子图 ${sgId} 出发但未匹配输出端口（handle=${edge.sourceHandle}），已丢弃`,
          );
          continue;
        }
        newSource = boundaryIds.get(m.externalPortId)!;
      }
      expandedEdges.push({
        ...edge,
        id: allocId(edge.id, node, parentPrefix),
        source: newSource,
        target: newTarget,
      });
    }

    visited.delete(sgId);
    return { nodes: expandedNodes, edges: expandedEdges };
  }

  const newNodes: ModNode[] = [];
  const newEdges: ModEdge[] = [];
  const consumedMainEdgeIds = new Set<string>();

  for (const node of graph.nodes) {
    // 普通 subgraph 节点一律尝试展开：子图缺失时由 expand 内部加 warning 并保留原节点
    if (node.data.kind !== 'subgraph' || node.data.customTypeId || !node.data.subgraphId) {
      newNodes.push(node);
      continue;
    }
    const nodeEdges = graph.edges.filter((e) => e.source === node.id || e.target === node.id);
    for (const e of nodeEdges) consumedMainEdgeIds.add(e.id);
    const result = expand(node, 0, '', nodeEdges);
    newNodes.push(...result.nodes);
    newEdges.push(...result.edges);
  }

  // 保留未连接到被展开子图节点的主图边
  for (const edge of graph.edges) {
    if (!consumedMainEdgeIds.has(edge.id)) newEdges.push(edge);
  }

  return {
    graph: { ...graph, nodes: newNodes, edges: newEdges },
    warnings,
  };
}
