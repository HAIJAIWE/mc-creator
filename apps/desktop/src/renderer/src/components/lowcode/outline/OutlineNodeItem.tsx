import { useCallback, useMemo, forwardRef } from 'react';
import type { ModNode, NodeKind } from '@mc-creator/shared';
import { McIcon } from '../../../assets/mc-ui/McIcon.js';
import { NODE_METADATA } from '../nodes/index.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useToast } from '../../useToast.js';

interface OutlineNodeItemProps {
  /** 节点数据 */
  node: ModNode;
  /** 缩进层级（用于树形结构） */
  depth?: number;
  /** 是否选中 */
  selected?: boolean;
  /** 是否展开子节点（用于可折叠节点如 subgraph/loop） */
  expanded?: boolean;
  /** 是否有子节点 */
  hasChildren?: boolean;
  /** 点击回调 */
  onClick?: (nodeId: string) => void;
  /** 双击回调（重命名） */
  onDoubleClick?: (nodeId: string) => void;
  /** 右键菜单回调 */
  onContextMenu?: (e: React.MouseEvent, nodeId: string) => void;
  /** 拖拽相关 */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent, nodeId: string) => void;
  onDragOver?: (e: React.DragEvent, nodeId: string) => void;
  onDrop?: (e: React.DragEvent, nodeId: string) => void;
  onDragEnd?: (e: React.DragEvent, nodeId: string) => void;
  /** 错误/警告状态 */
  hasError?: boolean;
  hasWarning?: boolean;
  /** 是否为调试当前节点 */
  isDebugCurrent?: boolean;
  /** 是否有断点 */
  hasBreakpoint?: boolean;
}

/**
 * 单个大纲节点项组件
 *
 * 功能：
 * - 显示节点图标、名称、类型
 * - 选中高亮
 * - 错误/警告/调试/断点标记
 * - 折叠/展开切换（针对容器类节点）
 * - 右键菜单触发
 * - 拖拽排序支持
 * - 键盘导航支持
 */
const OutlineNodeItem = forwardRef<HTMLDivElement, OutlineNodeItemProps>(
  (
    {
      node,
      depth = 0,
      selected = false,
      expanded = true,
      hasChildren = false,
      onClick,
      onDoubleClick,
      onContextMenu,
      draggable = false,
      onDragStart,
      onDragOver,
      onDrop,
      onDragEnd,
      hasError = false,
      hasWarning = false,
      isDebugCurrent = false,
      hasBreakpoint = false,
    },
    ref,
  ) => {
  const selectNode = useNodeGraphStore((s) => s.selectNode);
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const removeNode = useNodeGraphStore((s) => s.removeNode);
  const duplicateNode = useNodeGraphStore((s) => s.duplicateNode);
  const { info, success } = useToast();

  // 获取节点元信息（图标、颜色、分类等）
  const meta = useMemo(
    () => NODE_METADATA.find((m) => m.kind === node.type),
    [node.type],
  );

  // 获取显示标题：优先 label，然后 displayName，最后 kind 标签
  const title = useMemo(() => {
    if (node.data.label) return node.data.label;
    const data = node.data as Record<string, unknown>;
    if (data.displayName) return String(data.displayName);
    if (data.subgraphName) return String(data.subgraphName);
    if (data.procedureName) return String(data.procedureName);
    if (meta) return meta.label;
    return node.type;
  }, [node.data, meta]);

  // 获取副标题（类型/ID）
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (meta) parts.push(meta.kind);
    parts.push(node.id.slice(-8)); // 显示 ID 后 8 位
    return parts.join(' · ');
  }, [node.id, meta]);

  // 确定状态指示器颜色
  const statusIndicator = useMemo(() => {
    if (isDebugCurrent) return { color: '#22d3ee', label: '调试当前', icon: 'play-circle' };
    if (hasError) return { color: '#ef4444', label: '编译错误', icon: 'alert-circle' };
    if (hasWarning) return { color: '#facc15', label: '编译警告', icon: 'alert-triangle' };
    if (hasBreakpoint) return { color: '#c084fc', label: '断点', icon: 'bookmark' };
    return null;
  }, [isDebugCurrent, hasError, hasWarning, hasBreakpoint]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClick?.(node.id);
      selectNode(node.id);
    },
    [node.id, onClick, selectNode],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onDoubleClick?.(node.id);
    },
    [node.id, onDoubleClick],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onContextMenu?.(e, node.id);
    },
    [node.id, onContextMenu],
  );

  const handleToggleCollapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      // 只有容器类节点支持折叠
      if (['subgraph', 'loop', 'comment'].includes(node.type)) {
        toggleCollapse(node.id);
      }
    },
    [node.id, node.type, toggleCollapse],
  );

  const handleRename = useCallback(() => {
    onDoubleClick?.(node.id);
  }, [node.id, onDoubleClick]);

  const handleDuplicate = useCallback(() => {
    const newId = duplicateNode(node.id);
    if (newId) {
      success(`已复制节点：${title}`);
      selectNode(newId);
    }
  }, [node.id, title, duplicateNode, success, selectNode]);

  const handleCopyId = useCallback(() => {
    navigator.clipboard.writeText(node.id);
    info(`已复制节点 ID：${node.id}`);
  }, [node.id, info]);

  const handleFocus = useCallback(() => {
    onClick?.(node.id);
    selectNode(node.id);
  }, [node.id, onClick, selectNode]);

  const handleDelete = useCallback(() => {
    if (window.confirm(`确定删除节点「${title}」？此操作可撤销。`)) {
      removeNode(node.id);
      success(`已删除节点：${title}`);
    }
  }, [node.id, title, removeNode, success]);

  const contextMenuItems = useMemo(
    () => [
      { label: '重命名', action: handleRename, shortcut: 'F2', icon: 'edit' },
      { label: '复制', action: handleDuplicate, shortcut: 'Ctrl+D', icon: 'copy' },
      { label: '复制 ID', action: handleCopyId, shortcut: 'Ctrl+Shift+C', icon: 'clipboard' },
      { label: '聚焦画布', action: handleFocus, shortcut: 'Enter', icon: 'crosshair' },
      { type: 'separator' as const },
      { label: '删除', action: handleDelete, shortcut: 'Delete', icon: 'trash', destructive: true },
    ],
    [handleRename, handleDuplicate, handleCopyId, handleFocus, handleDelete],
  );

  const indentSize = 16; // 每层缩进像素
  const indentStyle = { paddingLeft: `${depth * indentSize}px` };

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${
        selected ? 'bg-mc-accent/15 text-mc-accent' : 'text-mc-text hover:bg-mc-surface-2'
      } ${draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
      style={indentStyle}
      role="treeitem"
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      tabIndex={0}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        } else if (e.key === 'F2') {
          e.preventDefault();
          handleRename();
        } else if (e.key === 'ArrowRight' && hasChildren && !expanded) {
          e.preventDefault();
          handleToggleCollapse(e as unknown as React.MouseEvent);
        } else if (e.key === 'ArrowLeft' && hasChildren && expanded) {
          e.preventDefault();
          handleToggleCollapse(e as unknown as React.MouseEvent);
        }
      }}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, node.id)}
      onDragOver={(e) => onDragOver?.(e, node.id)}
      onDrop={(e) => onDrop?.(e, node.id)}
      onDragEnd={(e) => onDragEnd?.(e, node.id)}
      data-node-id={node.id}
      data-node-type={node.type}
    >
      {/* 折叠/展开按钮（仅容器节点显示） */}
      {hasChildren && (
        <button
          type="button"
          onClick={handleToggleCollapse}
          aria-label={expanded ? '折叠' : '展开'}
          aria-expanded={expanded}
          className="flex-shrink-0 flex items-center justify-center w-5 h-5 text-mc-mute hover:text-mc-text rounded transition-colors"
          tabIndex={-1}
        >
          <McIcon
            scope="pixel"
            name={expanded ? 'chevron-down' : 'chevron-right'}
            size={12}
            aria-hidden="true"
          />
        </button>
      )}

      {/* 非容器节点占位 */}
      {!hasChildren && <span className="flex-shrink-0 w-5" aria-hidden="true" />}

      {/* 状态指示器（错误/警告/调试/断点） */}
      {statusIndicator && (
        <span
          className="flex-shrink-0 flex items-center justify-center w-5 h-5"
          title={statusIndicator.label}
          aria-label={statusIndicator.label}
        >
          <McIcon
            scope="pixel"
            name={statusIndicator.icon}
            size={11}
            style={{ color: statusIndicator.color }}
            aria-hidden="true"
          />
        </span>
      )}

      {!statusIndicator && <span className="flex-shrink-0 w-5" aria-hidden="true" />}

      {/* 节点类型图标 */}
      {meta && (
        <McIcon
          scope="pixel"
          name={meta.icon}
          size={14}
          className="flex-shrink-0"
          style={{ color: meta.color }}
          aria-hidden="true"
        />
      )}

      {!meta && (
        <McIcon
          scope="pixel"
          name="cube"
          size={14}
          className="flex-shrink-0 text-mc-mute"
          aria-hidden="true"
        />
      )}

      {/* 节点标题与副标题 */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5 truncate">
          <span className="font-medium text-[11px] truncate" title={title}>
            {title}
          </span>
          {node.data.disabled && (
            <span
              className="flex-shrink-0 px-1 py-0.5 text-[9px] bg-gray-600/50 text-gray-400 rounded"
              title="已禁用"
              aria-label="节点已禁用"
            >
              禁用
            </span>
          )}
          {node.data.collapsed && (
            <span
              className="flex-shrink-0 px-1 py-0.5 text-[9px] bg-amber-600/20 text-amber-400 rounded"
              title="已折叠"
              aria-label="节点已折叠"
            >
              折叠
            </span>
          )}
        </div>
        <div className="text-[10px] text-mc-mute truncate" title={subtitle}>
          {subtitle}
        </div>
      </div>

      {/* 右键菜单触发区域（隐藏，仅用于键盘触发） */}
      <button
        type="button"
        onClick={handleContextMenu}
        className="flex-shrink-0 opacity-0 hover:opacity-100 p-0.5 rounded text-mc-mute hover:text-mc-text hover:bg-mc-surface-2 transition-all"
        tabIndex={-1}
        aria-label="更多操作"
        aria-haspopup="menu"
      >
        <McIcon scope="pixel" name="more-horizontal" size={12} aria-hidden="true" />
      </button>

      {/* 右键菜单（通过 portal 渲染，这里仅定义数据） */}
      {/* 实际菜单由父组件 OutlinePanel 统一管理 */}
    </div>
  );
});

OutlineNodeItem.displayName = 'OutlineNodeItem';

export { OutlineNodeItem };