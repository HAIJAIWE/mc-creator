import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModNode } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store';

/**
 * 大纲面板选择同步 Hook
 *
 * 功能：
 * - 双向同步：画布选中 -> 大纲选中并展开路径；大纲点击 -> 画布选中并聚焦
 * - 自动展开选中节点的所有祖先路径
 * - 支持键盘导航（上/下/左/右/Enter）
 */
export function useOutlineSelection() {
  const selectedNodeId = useNodeGraphStore((s) => s.selectedNodeId);
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const graph = useNodeGraphStore((s) => s.graph);

  const [outlineSelectedId, setOutlineSelectedId] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // 记录已消费过的画布选中值：只响应 store 的真实变化，
  // 否则大纲本地选中（handleSelect）在 store 尚未回写时会被立刻覆盖回旧值。
  // 初值为 undefined，保证挂载时的首次同步一定会执行。
  const lastSyncedIdRef = useRef<string | null | undefined>(undefined);

  // focusedIndex 的同步镜像：navigate 需要读到最新值，
  // 否则同一批处理内的连续导航会重复基于同一个旧值计算（keydown 快速连按会跳格）。
  const focusedIndexRef = useRef(focusedIndex);

  // 当画布选中变化时，同步到大纲并展开路径
  useEffect(() => {
    if (selectedNodeId === lastSyncedIdRef.current) return;
    lastSyncedIdRef.current = selectedNodeId;

    setOutlineSelectedId(selectedNodeId);
    if (selectedNodeId) {
      // 计算并展开所有祖先路径
      const ancestors = getAncestorIds(graph.nodes, selectedNodeId);
      setExpandedPaths((prev) => new Set([...prev, ...ancestors]));
      // 更新聚焦索引（需要在渲染后计算，这里标记需要更新）
      setFocusedIndex(-1); // 触发重新计算
      focusedIndexRef.current = -1;
    }
  }, [selectedNodeId, graph.nodes]);

  // 处理大纲点击选择
  const handleSelect = useCallback(
    (nodeId: string) => {
      if (nodeId !== selectedNodeId) {
        selectNode(nodeId);
        setOutlineSelectedId(nodeId);
        // 展开祖先路径
        const ancestors = getAncestorIds(graph.nodes, nodeId);
        setExpandedPaths((prev) => new Set([...prev, ...ancestors]));
      }
    },
    [selectedNodeId, selectNode, graph.nodes],
  );

  // 切换展开/折叠
  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  // 检查是否展开
  const isExpanded = useCallback((nodeId: string) => expandedPaths.has(nodeId), [expandedPaths]);

  // 展开指定路径
  const expandPath = useCallback((nodeIds: string[]) => {
    setExpandedPaths((prev) => new Set([...prev, ...nodeIds]));
  }, []);

  // 折叠所有
  const collapseAll = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  // 展开所有（仅容器节点）
  const expandAllContainers = useCallback(() => {
    const containerIds = graph.nodes
      .filter((n) => ['subgraph', 'loop', 'comment'].includes(n.type))
      .map((n) => n.id);
    setExpandedPaths((prev) => new Set([...prev, ...containerIds]));
  }, [graph.nodes]);

  // 键盘导航
  const navigate = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right' | 'enter', visibleNodes: ModNode[]) => {
      if (visibleNodes.length === 0) return;

      let currentIndex = focusedIndexRef.current;
      if (currentIndex === -1) {
        // 没有聚焦项时从当前选中项出发；若也没有选中，保持 -1，
        // 这样首个上/下移动都落在 index 0（否则 down 会直接跳到 index 1，漏掉第一项）。
        currentIndex = visibleNodes.findIndex((n) => n.id === outlineSelectedId);
      }

      let nextIndex = currentIndex;
      if (direction === 'up') {
        nextIndex = Math.max(0, currentIndex - 1);
      } else if (direction === 'down') {
        nextIndex = Math.min(visibleNodes.length - 1, currentIndex + 1);
      } else if (direction === 'left') {
        // 折叠当前节点
        const node = visibleNodes[currentIndex];
        if (node && ['subgraph', 'loop', 'comment'].includes(node.type)) {
          toggleExpanded(node.id);
        }
        return;
      } else if (direction === 'right') {
        // 展开当前节点
        const node = visibleNodes[currentIndex];
        if (node && ['subgraph', 'loop', 'comment'].includes(node.type)) {
          toggleExpanded(node.id);
        }
        return;
      } else if (direction === 'enter') {
        // 选中并聚焦
        const node = visibleNodes[currentIndex];
        if (node) handleSelect(node.id);
        return;
      }

      if (nextIndex !== currentIndex) {
        setFocusedIndex(nextIndex);
        focusedIndexRef.current = nextIndex; // 立即生效，批处理内可累积
        const node = visibleNodes[nextIndex];
        if (node) {
          handleSelect(node.id);
          // 滚动到视野（由父组件处理 scrollIntoView）
        }
      }
    },
    [outlineSelectedId, handleSelect, toggleExpanded],
  );

  // 设置聚焦索引（外部调用，如渲染后计算）
  const setFocusedIndexRef = useCallback((index: number) => {
    focusedIndexRef.current = index;
    setFocusedIndex(index);
  }, []);

  return {
    // 状态
    outlineSelectedId,
    expandedPaths,
    focusedIndex,
    // 操作
    handleSelect,
    toggleExpanded,
    isExpanded,
    expandPath,
    collapseAll,
    expandAllContainers,
    navigate,
    setFocusedIndex: setFocusedIndexRef,
  };
}

/**
 * 递归获取节点的所有祖先 ID（基于边连接关系）
 * 注意：当前图是扁平的，通过 edges 推断层级关系
 */
function getAncestorIds(nodes: ModNode[], targetId: string): string[] {
  const graph = useNodeGraphStore.getState().graph;
  const edges = graph.edges;
  const ancestors = new Set<string>();
  const visited = new Set<string>();

  function findParents(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    // 找到所有指向该节点的边的源节点
    const parentEdges = edges.filter((e) => e.target === nodeId);
    for (const edge of parentEdges) {
      ancestors.add(edge.source);
      findParents(edge.source);
    }
  }

  findParents(targetId);
  return Array.from(ancestors);
}
