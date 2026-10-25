import { useCallback, useMemo, useState } from 'react';
import type { ModNode, NodeKind } from '@mc-creator/shared';
import { NODE_METADATA } from '../nodes/index.js';

interface UseOutlineFilterOptions {
  /** 搜索关键词 */
  searchQuery: string;
  /** 显示错误节点 */
  showErrors?: boolean;
  /** 显示警告节点 */
  showWarnings?: boolean;
  /** 显示禁用节点 */
  showDisabled?: boolean;
  /** 按类型过滤 */
  typeFilter?: NodeKind[];
  /** 自定义过滤函数 */
  customFilter?: (node: ModNode) => boolean;
}

interface UseOutlineFilterResult {
  /** 过滤后的节点列表（扁平化，用于列表渲染） */
  filteredNodes: ModNode[];
  /** 过滤统计 */
  stats: {
    total: number;
    filtered: number;
    errors: number;
    warnings: number;
    disabled: number;
  };
  /** 当前搜索关键词 */
  searchQuery: string;
  /** 设置搜索关键词 */
  setSearchQuery: (query: string) => void;
  /** 切换错误显示 */
  toggleShowErrors: () => void;
  /** 切换警告显示 */
  toggleShowWarnings: () => void;
  /** 切换禁用显示 */
  toggleShowDisabled: () => void;
  /** 切换类型过滤 */
  toggleTypeFilter: (type: NodeKind) => void;
  /** 清空所有过滤 */
  clearFilters: () => void;
}

/**
 * 大纲面板过滤 Hook
 *
 * 功能：
 * - 关键词搜索（名称/类型/ID/备注）
 * - 多维度过滤：错误、警告、禁用、类型
 * - 实时统计计数
 * - 防抖搜索（可选，由外部控制）
 */
export function useOutlineFilter(
  allNodes: ModNode[],
  compileResult: { errors: string[]; warnings: string[] } | null,
  options: Partial<UseOutlineFilterOptions> = {},
): UseOutlineFilterResult {
  const [searchQuery, setSearchQuery] = useState(options.searchQuery ?? '');
  const [showErrors, setShowErrors] = useState(options.showErrors ?? true);
  const [showWarnings, setShowWarnings] = useState(options.showWarnings ?? true);
  const [showDisabled, setShowDisabled] = useState(options.showDisabled ?? true);
  const [typeFilter, setTypeFilter] = useState<NodeKind[]>(options.typeFilter ?? []);

  // 从编译结果提取错误/警告节点 ID
  const errorNodeIds = useMemo(() => {
    if (!compileResult?.errors.length) return new Set<string>();
    const ids = new Set<string>();
    for (const node of allNodes) {
      const escaped = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, 'i');
      if (compileResult.errors.some((msg) => regex.test(msg))) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [compileResult?.errors, allNodes]);

  const warningNodeIds = useMemo(() => {
    if (!compileResult?.warnings.length) return new Set<string>();
    const ids = new Set<string>();
    for (const node of allNodes) {
      const escaped = node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:$|[^a-z0-9_])`, 'i');
      if (compileResult.warnings.some((msg) => regex.test(msg))) {
        ids.add(node.id);
      }
    }
    return ids;
  }, [compileResult?.warnings, allNodes]);

  // 执行过滤
  const filteredNodes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return allNodes.filter((node) => {
      // 类型过滤
      if (typeFilter.length > 0 && !typeFilter.includes(node.type as NodeKind)) {
        return false;
      }

      // 禁用状态过滤
      if (!showDisabled && node.data.disabled) return false;

      // 错误/警告过滤（如果开启了只看错误/警告模式）
      const hasError = errorNodeIds.has(node.id);
      const hasWarning = warningNodeIds.has(node.id);

      if (showErrors && showWarnings) {
        // 都开启：不过滤
      } else if (showErrors && !showWarnings) {
        // 只看错误
        if (!hasError) return false;
      } else if (!showErrors && showWarnings) {
        // 只看警告
        if (!hasWarning && !hasError) return false;
      } else {
        // 都关闭：隐藏有错误/警告的节点
        if (hasError || hasWarning) return false;
      }

      // 关键词搜索
      if (query) {
        const searchableText = [
          node.data.label,
          (node.data as Record<string, unknown>).displayName,
          (node.data as Record<string, unknown>).subgraphName,
          (node.data as Record<string, unknown>).procedureName,
          node.id,
          node.type,
          (node.data as Record<string, unknown>).note,
          NODE_METADATA.find((m) => m.kind === node.type)?.label,
          NODE_METADATA.find((m) => m.kind === node.type)?.description,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        if (!searchableText.includes(query)) return false;
      }

      // 自定义过滤
      if (options.customFilter && !options.customFilter(node)) {
        return false;
      }

      return true;
    });
  }, [
    allNodes,
    searchQuery,
    typeFilter,
    showErrors,
    showWarnings,
    showDisabled,
    errorNodeIds,
    warningNodeIds,
    options.customFilter,
  ]);

  // 统计信息
  const stats = useMemo(() => {
    let errors = 0;
    let warnings = 0;
    let disabled = 0;

    for (const node of allNodes) {
      if (errorNodeIds.has(node.id)) errors++;
      if (warningNodeIds.has(node.id)) warnings++;
      if (node.data.disabled) disabled++;
    }

    return {
      total: allNodes.length,
      filtered: filteredNodes.length,
      errors,
      warnings,
      disabled,
    };
  }, [allNodes, filteredNodes.length, errorNodeIds, warningNodeIds]);

  const toggleShowErrors = useCallback(() => {
    setShowErrors((v) => !v);
  }, []);

  const toggleShowWarnings = useCallback(() => {
    setShowWarnings((v) => !v);
  }, []);

  const toggleShowDisabled = useCallback(() => {
    setShowDisabled((v) => !v);
  }, []);

  const toggleTypeFilter = useCallback((type: NodeKind) => {
    setTypeFilter((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSearchQuery('');
    setShowErrors(true);
    setShowWarnings(true);
    setShowDisabled(true);
    setTypeFilter([]);
  }, []);

  return {
    filteredNodes,
    stats,
    searchQuery,
    setSearchQuery,
    toggleShowErrors,
    toggleShowWarnings,
    toggleShowDisabled,
    toggleTypeFilter,
    clearFilters,
  };
}

/**
 * 获取节点的显示标题（用于搜索匹配）
 */
export function getNodeDisplayTitle(node: ModNode): string {
  const data = node.data as Record<string, unknown>;
  // 类型专属名称优先：子图/过程节点复用其它类型的 data 时会残留 displayName，
  // 若先取 displayName 会掩盖真实名称，故 subgraphName/procedureName 排在前面。
  if (data.subgraphName) return String(data.subgraphName);
  if (data.procedureName) return String(data.procedureName);
  if (node.data.label) return node.data.label;
  if (data.displayName) return String(data.displayName);
  const meta = NODE_METADATA.find((m) => m.kind === node.type);
  if (meta) return meta.label;
  return node.type;
}

/**
 * 获取节点的搜索文本（包含所有可搜索字段）
 */
export function getNodeSearchText(node: ModNode): string {
  const parts: string[] = [
    getNodeDisplayTitle(node),
    node.id,
    node.type,
    (node.data as Record<string, unknown>).note as string,
  ];

  const meta = NODE_METADATA.find((m) => m.kind === node.type);
  if (meta) {
    parts.push(meta.label, meta.description);
  }

  return parts.filter(Boolean).join(' ').toLowerCase();
}
