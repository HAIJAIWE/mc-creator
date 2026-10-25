import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompileResult } from '../../../lib/compileNodeGraph.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDebuggerStore } from '../../../store/debugger-store.js';
import { OutlineSearch } from './OutlineSearch.js';
import { OutlineNodeItem } from './OutlineNodeItem.js';
import { useOutlineSelection } from './useOutlineSelection.js';
import { useOutlineFilter } from './useOutlineFilter.js';
import { McIcon } from '../../../assets/mc-ui/McIcon.js';
import { useToast } from '../../useToast.js';

export interface OutlinePanelProps {
  /** 编译结果（用于错误/警告标记） */
  compileResult: CompileResult | null;
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 是否显示工具栏 */
  showToolbar?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 点击节点回调（画布聚焦） */
  onFocusNode?: (nodeId: string) => void;
  /** 双击节点回调（重命名等） */
  onRenameNode?: (nodeId: string) => void;
}

/**
 * 大纲面板主组件
 *
 * 功能：
 * 1. 树形展示所有节点，支持层级展开/折叠
 * 2. 实时搜索/过滤（名称/类型/ID/备注）
 * 3. 点击定位：画布自动居中并高亮该节点
 * 4. 节点类型图标 + 颜色分类
 * 5. 错误/警告/调试/断点状态标记
 * 6. 右键菜单：重命名、删除、复制、复制ID、聚焦
 * 7. 拖拽排序（可选）
 * 8. 选中同步：画布选中时大纲自动选中并展开路径
 * 9. 键盘导航支持
 * 10. 多维度过滤：错误、警告、禁用、类型
 */
export function OutlinePanel({
  compileResult,
  showSearch = true,
  showToolbar = true,
  className,
  onFocusNode,
  onRenameNode,
}: OutlinePanelProps) {
  const graph = useNodeGraphStore((s) => s.graph);
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const removeNode = useNodeGraphStore((s) => s.removeNode);
  const duplicateNode = useNodeGraphStore((s) => s.duplicateNode);
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const { info, success } = useToast();

  const isDebugMode = useDebuggerStore((s) => s.state !== null);
  const debugCurrentNodeId = useDebuggerStore((s) => s.state?.currentNodeId ?? null);
  const debugBreakpoints = useDebuggerStore((s) => s.breakpoints);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodeId: string;
    visible: boolean;
  } | null>(null);

  // 重命名输入状态
  const [renamingNodeId, setRenamingNodeId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 滚动容器 ref（用于键盘导航滚动）
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  // 使用选择同步 hook
  const selection = useOutlineSelection();

  // 使用过滤 hook
  const filter = useOutlineFilter(graph.nodes, compileResult, {
    searchQuery: '',
  });

  // 合并过滤后的节点与展开状态
  const visibleNodes = useMemo(() => {
    // 这里可以根据需要构建树形结构
    // 目前先返回扁平列表，保持原有顺序
    return filter.filteredNodes;
  }, [filter.filteredNodes]);

  // 处理节点点击
  const handleNodeClick = useCallback(
    (nodeId: string) => {
      selection.handleSelect(nodeId);
      onFocusNode?.(nodeId);
    },
    [selection, onFocusNode],
  );

  // 处理双击重命名
  const handleNodeDoubleClick = useCallback(
    (nodeId: string) => {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node) {
        setRenamingNodeId(nodeId);
        setRenameValue(node.data.label ?? '');
        // 下一帧聚焦输入框
        setTimeout(() => {
          const input = document.querySelector(
            `[data-rename-input="${nodeId}"]`,
          ) as HTMLInputElement;
          input?.focus();
          input?.select();
        }, 0);
      }
      onRenameNode?.(nodeId);
    },
    [graph.nodes, onRenameNode],
  );

  // 处理右键菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, nodeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      selection.handleSelect(nodeId);
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId, visible: true });
    },
    [selection],
  );

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 处理重命名确认
  const handleRenameConfirm = useCallback(
    (nodeId: string, newLabel: string) => {
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (node && newLabel.trim() !== node.data.label) {
        // 这里需要通过 store 更新节点 label
        // 暂时使用 updateNode（需要从 store 获取）
        useNodeGraphStore.getState().updateNode(nodeId, { label: newLabel.trim() });
        success(`已重命名为：${newLabel.trim()}`);
      }
      setRenamingNodeId(null);
      setRenameValue('');
    },
    [graph.nodes, success],
  );

  // 处理重命名取消
  const handleRenameCancel = useCallback(() => {
    setRenamingNodeId(null);
    setRenameValue('');
  }, []);

  // 右键菜单操作
  const handleDuplicate = useCallback(
    (nodeId: string) => {
      const newId = duplicateNode(nodeId);
      if (newId) {
        const node = graph.nodes.find((n) => n.id === nodeId);
        success(`已复制节点：${node?.data.label ?? nodeId}`);
        selectNode(newId);
        onFocusNode?.(newId);
      }
      closeContextMenu();
    },
    [duplicateNode, graph.nodes, success, selectNode, onFocusNode, closeContextMenu],
  );

  const handleCopyId = useCallback(
    (nodeId: string) => {
      navigator.clipboard.writeText(nodeId);
      info(`已复制节点 ID：${nodeId}`);
      closeContextMenu();
    },
    [info, closeContextMenu],
  );

  const handleFocusCanvas = useCallback(
    (nodeId: string) => {
      onFocusNode?.(nodeId);
      selectNode(nodeId);
      closeContextMenu();
    },
    [onFocusNode, selectNode, closeContextMenu],
  );

  const handleDelete = useCallback(
    (nodeId: string) => {
      const node = graph.nodes.find((n) => n.id === nodeId);
      const label = node?.data.label ?? nodeId;
      if (window.confirm(`确定删除节点「${label}」？此操作可撤销。`)) {
        removeNode(nodeId);
        success(`已删除节点：${label}`);
      }
      closeContextMenu();
    },
    [graph.nodes, removeNode, success, closeContextMenu],
  );

  const handleToggleCollapse = useCallback(
    (nodeId: string) => {
      toggleCollapse(nodeId);
      closeContextMenu();
    },
    [toggleCollapse, closeContextMenu],
  );

  // 键盘导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listRef.current?.contains(document.activeElement)) return;

      const directionMap: Record<string, 'up' | 'down' | 'left' | 'right' | 'enter'> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
        Enter: 'enter',
      };

      const direction = directionMap[e.key];
      if (direction) {
        e.preventDefault();
        selection.navigate(direction, visibleNodes);
        // 滚动到视野
        const focusedItem = itemRefs.current.get(visibleNodes[selection.focusedIndex]?.id ?? '');
        focusedItem?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (e.key === 'Escape') {
        // 关闭重命名/右键菜单
        if (renamingNodeId) handleRenameCancel();
        if (contextMenu) closeContextMenu();
      } else if (e.key === 'F2') {
        e.preventDefault();
        const selectedNode = visibleNodes[selection.focusedIndex];
        if (selectedNode) handleNodeDoubleClick(selectedNode.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const selectedNode = visibleNodes[selection.focusedIndex];
        if (selectedNode) handleDelete(selectedNode.id);
      } else if (e.key === 'd' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        const selectedNode = visibleNodes[selection.focusedIndex];
        if (selectedNode) handleDuplicate(selectedNode.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    visibleNodes,
    selection,
    renamingNodeId,
    contextMenu,
    handleRenameCancel,
    closeContextMenu,
    handleNodeDoubleClick,
    handleDelete,
    handleDuplicate,
  ]);

  // 点击外部关闭右键菜单
  useEffect(() => {
    const handleClickOutside = () => closeContextMenu();
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [closeContextMenu]);

  // 统计信息
  const stats = filter.stats;

  // 工具栏操作
  const handleCollapseAll = useCallback(() => {
    selection.collapseAll();
  }, [selection]);

  const handleExpandAll = useCallback(() => {
    selection.expandAllContainers();
  }, [selection]);

  const handleClearFilters = useCallback(() => {
    filter.clearFilters();
  }, [filter]);

  // 渲染右键菜单（通过 Portal）
  const contextMenuContent = useMemo(() => {
    if (!contextMenu) return null;

    const node = graph.nodes.find((n) => n.id === contextMenu.nodeId);
    if (!node) return null;

    const isContainer = ['subgraph', 'loop', 'comment'].includes(node.type);
    const isCollapsed = node.data.collapsed;

    return (
      <div
        className="fixed z-50 rounded-mc border border-mc-border bg-mc-surface py-1 shadow-lg min-w-[180px]"
        style={{ left: contextMenu.x, top: contextMenu.y }}
        role="menu"
        aria-label="节点操作菜单"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            handleNodeDoubleClick(contextMenu.nodeId);
            closeContextMenu();
          }}
          className="w-full px-3 py-1.5 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 flex items-center gap-2"
        >
          <McIcon scope="pixel" name="edit" size={12} aria-hidden="true" />
          <span>重命名</span>
          <kbd className="ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
            F2
          </kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => handleDuplicate(contextMenu.nodeId)}
          className="w-full px-3 py-1.5 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 flex items-center gap-2"
        >
          <McIcon scope="pixel" name="copy" size={12} aria-hidden="true" />
          <span>复制</span>
          <kbd className="ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
            Ctrl+D
          </kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => handleCopyId(contextMenu.nodeId)}
          className="w-full px-3 py-1.5 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 flex items-center gap-2"
        >
          <McIcon scope="pixel" name="clipboard" size={12} aria-hidden="true" />
          <span>复制 ID</span>
          <kbd className="ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
            Ctrl+Shift+C
          </kbd>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => handleFocusCanvas(contextMenu.nodeId)}
          className="w-full px-3 py-1.5 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 flex items-center gap-2"
        >
          <McIcon scope="pixel" name="crosshair" size={12} aria-hidden="true" />
          <span>聚焦画布</span>
          <kbd className="ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
            Enter
          </kbd>
        </button>
        {isContainer && (
          <button
            type="button"
            role="menuitem"
            onClick={() => handleToggleCollapse(contextMenu.nodeId)}
            className="w-full px-3 py-1.5 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 flex items-center gap-2"
          >
            <McIcon
              scope="pixel"
              name={isCollapsed ? 'chevron-right' : 'chevron-down'}
              size={12}
              aria-hidden="true"
            />
            <span>{isCollapsed ? '展开' : '折叠'}</span>
          </button>
        )}
        <div className="h-px bg-mc-border mx-1 my-0.5" role="separator" />
        <button
          type="button"
          role="menuitem"
          onClick={() => handleDelete(contextMenu.nodeId)}
          className="w-full px-3 py-1.5 text-left text-[11px] text-red-400 hover:bg-red-500/10 flex items-center gap-2"
        >
          <McIcon scope="pixel" name="trash" size={12} aria-hidden="true" />
          <span>删除</span>
          <kbd className="ml-auto text-[9px] text-mc-dim px-1.5 py-0.5 rounded bg-mc-bg border border-mc-border font-mono">
            Delete
          </kbd>
        </button>
      </div>
    );
  }, [
    contextMenu,
    graph.nodes,
    handleNodeDoubleClick,
    handleDuplicate,
    handleCopyId,
    handleFocusCanvas,
    handleToggleCollapse,
    handleDelete,
    closeContextMenu,
  ]);

  return (
    <div
      className={`flex flex-col h-full bg-mc-surface border-l border-mc-border ${className ?? ''}`}
      role="region"
      aria-label="大纲面板"
    >
      {/* 工具栏 */}
      {showToolbar && (
        <div className="flex items-center gap-1 border-b border-mc-border bg-mc-bg px-2 py-1.5">
          <div className="flex-1 flex items-center gap-1">
            <span className="text-[10px] font-medium text-mc-mute uppercase tracking-wide">
              大纲
            </span>
            {stats.total > 0 && (
              <span className="text-[10px] text-mc-dim font-mono">
                {stats.filtered} / {stats.total}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {/* 折叠全部 */}
            <button
              type="button"
              onClick={handleCollapseAll}
              disabled={stats.filtered === 0}
              aria-label="全部折叠 (大纲)"
              title="全部折叠 (大纲面板)"
              className="p-1 rounded text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <McIcon scope="pixel" name="minimize-2" size={12} aria-hidden="true" />
            </button>
            {/* 展开全部 */}
            <button
              type="button"
              onClick={handleExpandAll}
              disabled={stats.filtered === 0}
              aria-label="全部展开 (大纲)"
              title="全部展开 (大纲面板)"
              className="p-1 rounded text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <McIcon scope="pixel" name="maximize-2" size={12} aria-hidden="true" />
            </button>
            {/* 清空过滤 */}
            {filter.searchQuery && (
              <button
                type="button"
                onClick={handleClearFilters}
                aria-label="清空过滤"
                title="清空所有过滤条件"
                className="p-1 rounded text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
              >
                <McIcon scope="pixel" name="filter-x" size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 搜索框 */}
      {showSearch && (
        <OutlineSearch
          value={filter.searchQuery}
          onChange={filter.setSearchQuery}
          onClear={filter.clearFilters}
          totalCount={stats.total}
          filteredCount={stats.filtered}
        />
      )}

      {/* 状态图例（仅在有错误/警告时显示） */}
      {(stats.errors > 0 || stats.warnings > 0 || isDebugMode) && (
        <div className="flex flex-wrap gap-2 px-2 py-1.5 border-b border-mc-border bg-mc-bg">
          {stats.errors > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] text-red-400"
              title={`${stats.errors} 个错误节点`}
            >
              <McIcon
                scope="pixel"
                name="alert-circle"
                size={10}
                style={{ color: '#ef4444' }}
                aria-hidden="true"
              />
              错误 {stats.errors}
            </span>
          )}
          {stats.warnings > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] text-yellow-400"
              title={`${stats.warnings} 个警告节点`}
            >
              <McIcon
                scope="pixel"
                name="alert-triangle"
                size={10}
                style={{ color: '#facc15' }}
                aria-hidden="true"
              />
              警告 {stats.warnings}
            </span>
          )}
          {isDebugMode && debugCurrentNodeId && (
            <span
              className="flex items-center gap-1 text-[10px] text-cyan-400"
              title="调试当前节点"
            >
              <McIcon
                scope="pixel"
                name="play-circle"
                size={10}
                style={{ color: '#22d3ee' }}
                aria-hidden="true"
              />
              调试中
            </span>
          )}
          {debugBreakpoints.size > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] text-purple-400"
              title={`${debugBreakpoints.size} 个断点`}
            >
              <McIcon
                scope="pixel"
                name="bookmark"
                size={10}
                style={{ color: '#c084fc' }}
                aria-hidden="true"
              />
              断点 {debugBreakpoints.size}
            </span>
          )}
        </div>
      )}

      {/* 节点列表 */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto overflow-x-hidden p-1"
        role="tree"
        aria-label="节点列表"
        aria-multiselectable="false"
      >
        {visibleNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-mc-mute py-8">
            <McIcon
              scope="pixel"
              name={filter.searchQuery ? 'search-x' : 'cube'}
              size={32}
              className="mb-2 opacity-30"
              aria-hidden="true"
            />
            <p className="text-sm text-center px-4">
              {filter.searchQuery ? '没有匹配的节点' : '画布中暂无节点'}
            </p>
            {filter.searchQuery && (
              <button
                type="button"
                onClick={filter.clearFilters}
                className="mt-2 text-[11px] text-mc-accent hover:underline"
              >
                清空搜索
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-0.5" role="group" aria-label="节点列表">
            {visibleNodes.map((node) => {
              const isSelected = selection.outlineSelectedId === node.id;
              const hasError =
                compileResult?.errors.some((err: string) =>
                  new RegExp(
                    `(?:^|[^a-z0-9_])${node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9_])`,
                    'i',
                  ).test(err),
                ) ?? false;
              const hasWarning =
                compileResult?.warnings.some((warn: string) =>
                  new RegExp(
                    `(?:^|[^a-z0-9_])${node.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9_])`,
                    'i',
                  ).test(warn),
                ) ?? false;
              const isDebugCurrent = isDebugMode && debugCurrentNodeId === node.id;
              const hasBreakpoint = debugBreakpoints.has(node.id);
              const isContainer = ['subgraph', 'loop', 'comment'].includes(node.type);
              const expanded = selection.isExpanded(node.id);

              return (
                <OutlineNodeItem
                  key={node.id}
                  ref={(el: HTMLDivElement | null) => {
                    if (el) itemRefs.current.set(node.id, el);
                    else itemRefs.current.delete(node.id);
                  }}
                  node={node}
                  depth={0} // 扁平列表，深度由父组件计算
                  selected={isSelected}
                  expanded={expanded}
                  hasChildren={isContainer}
                  onClick={handleNodeClick}
                  onDoubleClick={handleNodeDoubleClick}
                  onContextMenu={handleContextMenu}
                  draggable={false} // 暂不启用拖拽排序
                  hasError={hasError}
                  hasWarning={hasWarning}
                  isDebugCurrent={isDebugCurrent}
                  hasBreakpoint={hasBreakpoint}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* 底部状态栏 */}
      <div className="border-t border-mc-border bg-mc-bg px-2 py-1.5 text-[10px] text-mc-mute flex items-center justify-between">
        <span>
          {stats.filtered} / {stats.total} 个节点
        </span>
        <span className="flex items-center gap-1">
          <kbd className="text-[9px] px-1.5 py-0.5 rounded bg-mc-surface border border-mc-border font-mono">
            ⌘F
          </kbd>
          <span className="hidden sm:inline">搜索</span>
        </span>
      </div>

      {/* 右键菜单 Portal */}
      {contextMenuContent}

      {/* 重命名输入覆盖层（简化版，实际可用 Portal） */}
      {renamingNodeId && (
        <div
          className="fixed inset-0 z-40 bg-black/10 flex items-center justify-center"
          onClick={handleRenameCancel}
          aria-hidden="true"
        >
          <div
            className="bg-mc-surface border border-mc-border rounded-mc p-4 min-w-[280px] shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="重命名节点"
            aria-modal="true"
          >
            <h3 className="text-sm font-medium text-mc-text mb-3">重命名节点</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameConfirm(renamingNodeId, renameValue);
                else if (e.key === 'Escape') handleRenameCancel();
              }}
              autoFocus
              data-rename-input={renamingNodeId}
              className="w-full px-3 py-2 rounded-mc border border-mc-border bg-mc-bg text-mc-text text-sm outline-none focus:border-mc-accent focus:ring-1 focus:ring-mc-accent"
              placeholder="输入新名称"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={handleRenameCancel}
                className="px-3 py-1.5 text-sm text-mc-mute hover:text-mc-text rounded-mc hover:bg-mc-surface-2"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleRenameConfirm(renamingNodeId, renameValue)}
                className="px-3 py-1.5 text-sm text-white bg-mc-accent rounded-mc hover:bg-mc-accent/80"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
