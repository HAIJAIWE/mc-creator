import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
} from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';

interface TreeNode {
  name: string;
  type: 'folder' | 'file';
  path: string;
  children?: TreeNode[];
}

interface FlatNode {
  node: TreeNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
}

interface RowData {
  flatNodes: FlatNode[];
  selectedFile: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, node: TreeNode) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  node: TreeNode | null; // null 表示在空白处右键
}

const ROW_HEIGHT = 22;

function buildTree(files: { path: string; content: string }[]): TreeNode[] {
  const root: TreeNode = { name: '', type: 'folder', path: '', children: [] };

  files.forEach((file) => {
    const parts = file.path.split('/');
    let current = root;

    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const childPath = current.path ? `${current.path}/${part}` : part;

      let child = current.children?.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          type: isLast ? 'file' : 'folder',
          path: childPath,
          children: isLast ? undefined : [],
        };
        current.children?.push(child);
      }
      current = child;
    });
  });

  return root.children || [];
}

function getFileIcon(path: string): string {
  if (path.endsWith('.json')) return 'file-text';
  if (path.endsWith('.java')) return 'terminal';
  if (path.endsWith('.gradle') || path.endsWith('.toml') || path.endsWith('.properties'))
    return 'terminal';
  if (path.endsWith('.png')) return 'image';
  return 'file';
}

function collectFolderPaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (ns: TreeNode[]) => {
    for (const n of ns) {
      if (n.type === 'folder' && n.children && n.children.length > 0) {
        paths.push(n.path);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

// 将树扁平化为可见行数组；expandedSet === null 表示「全部展开」（默认），
// 这样新生成的文件夹在用户主动折叠前始终展开，与原 useState(true) 行为一致
function flattenTree(nodes: TreeNode[], expandedSet: Set<string> | null, depth = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    const hasChildren = node.type === 'folder' && (node.children?.length ?? 0) > 0;
    const isExpanded = expandedSet === null || expandedSet.has(node.path);
    result.push({ node, depth, hasChildren, isExpanded });
    if (hasChildren && isExpanded) {
      result.push(...flattenTree(node.children ?? [], expandedSet, depth + 1));
    }
  }
  return result;
}

// react-window 行渲染器：无状态，所有数据经 itemData 注入
const Row = ({ index, style, data }: ListChildComponentProps<RowData>) => {
  const { flatNodes, selectedFile, onToggle, onSelect, onContextMenu } = data;
  const { node, depth, hasChildren, isExpanded } = flatNodes[index];
  const paddingLeft = depth * 12 + 8;

  if (node.type === 'folder') {
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    return (
      <div style={style} data-tree-node="true">
        <button
          onClick={() => onToggle(node.path)}
          onContextMenu={(e) => onContextMenu(e, node)}
          className="flex h-full w-full items-center gap-1 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2"
          style={{ paddingLeft }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-mc-mute" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-mc-mute" />
            )
          ) : (
            <span className="inline-block h-3 w-3 shrink-0" />
          )}
          <FolderIcon className="h-3 w-3 shrink-0 text-mc-accent" />
          <span className="truncate text-mc-text">{node.name}</span>
        </button>
      </div>
    );
  }
  const isSelected = selectedFile === node.path;
  return (
    <div style={style} data-tree-node="true">
      <button
        onClick={() => onSelect(node.path)}
        onContextMenu={(e) => onContextMenu(e, node)}
        className={`flex h-full w-full items-center gap-1 border-l-2 pr-2 text-left text-xs transition-colors ${
          isSelected
            ? 'border-mc-accent bg-mc-surface-3 text-mc-text'
            : 'border-transparent text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
        }`}
        style={{ paddingLeft }}
      >
        <McIcon
          scope="pixel"
          name={getFileIcon(node.path)}
          size={12}
          className="shrink-0 text-mc-mute"
        />
        <span className="truncate">{node.name}</span>
      </button>
    </div>
  );
};

interface ContextMenuProps {
  x: number;
  y: number;
  node: TreeNode | null;
  onClose: () => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onRename: (oldPath: string, isFolder: boolean) => void;
  onDelete: (path: string) => void;
}

function ContextMenu({
  x,
  y,
  node,
  onClose,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: ContextMenuProps) {
  useEffect(() => {
    const close = () => onClose();
    // 点击任意处或再次右键即关闭菜单
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [onClose]);

  const isFolder = node?.type === 'folder';
  const parentPath = node
    ? isFolder
      ? node.path
      : node.path.split('/').slice(0, -1).join('/')
    : '';

  const items: Array<{
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    danger?: boolean;
  }> = [];

  // 新建文件/文件夹：仅在文件夹或空白处可用
  if (!node || isFolder) {
    items.push({
      label: '新建文件',
      icon: <FilePlus className="h-3 w-3" />,
      onClick: () => onNewFile(parentPath),
    });
    items.push({
      label: '新建文件夹',
      icon: <FolderPlus className="h-3 w-3" />,
      onClick: () => onNewFolder(parentPath),
    });
  }

  if (node) {
    items.push({
      label: '重命名',
      icon: <Pencil className="h-3 w-3" />,
      onClick: () => onRename(node.path, isFolder),
    });
    items.push({
      label: '删除',
      icon: <Trash2 className="h-3 w-3" />,
      onClick: () => onDelete(node.path),
      danger: true,
    });
  }

  // 边界检测：菜单超出视口右/下时调整
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 28 - 16);

  return (
    <div
      className="mc-pop fixed z-50 min-w-[160px] py-1"
      style={{ left: adjustedX, top: adjustedY }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={(e) => {
            e.stopPropagation();
            item.onClick();
          }}
          className={`flex w-full items-center gap-2 px-3 py-1 text-left text-xs transition-colors hover:bg-mc-surface-3 ${
            item.danger ? 'text-mc-redstone' : 'text-mc-text'
          }`}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

export function FileTree() {
  // P3 性能：用 shallow 选择器仅订阅所需字段，避免 buildLog/loading 流式更新时重渲染
  // 注：createFile/deleteFile/renameFile 由另一个 subagent 在 store 中实现
  const { files, selectedFile, selectFile, createFile, deleteFile, renameFile } = useModStore(
    (s) => ({
      files: s.files,
      selectedFile: s.selectedFile,
      selectFile: s.selectFile,
      createFile: s.createFile,
      deleteFile: s.deleteFile,
      renameFile: s.renameFile,
    }),
    shallow,
  );

  // P3 性能：仅 files 变化时重建树，避免每次渲染都 O(n) 重建
  // 注意：useMemo 必须在 early return 之前调用，否则违反 React hooks 规则。
  const tree = useMemo(() => buildTree(files), [files]);

  // 顶层 Set 统一管理展开状态，替代每个 TreeItem 各自的 useState(true)。
  // null = 全部展开（默认），首次折叠时惰性生成 Set。
  const [expandedSet, setExpandedSet] = useState<Set<string> | null>(null);

  const toggleExpand = useCallback(
    (path: string) => {
      setExpandedSet((prev) => {
        if (prev === null) {
          const next = new Set(collectFolderPaths(tree));
          next.delete(path);
          return next;
        }
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [tree],
  );

  const flatNodes = useMemo(() => flattenTree(tree, expandedSet), [tree, expandedSet]);
  // 测量列表容器高度：文件树处于 flex 布局中，高度由父级决定，需用 ResizeObserver 动态获取
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // 依赖 files.length：空状态时不渲染容器，文件出现后需要重新挂载 observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h !== undefined && h > 0) setHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [files.length]);

  // 节点项右键
  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, node });
  }, []);

  // 空白处右键
  const handleContainerContextMenu = useCallback((e: React.MouseEvent) => {
    // 检查是否点在节点项之外
    const target = e.target as HTMLElement;
    if (!target.closest('[data-tree-node]')) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, node: null });
    }
  }, []);

  const rowData: RowData = useMemo(
    () => ({
      flatNodes,
      selectedFile,
      onToggle: toggleExpand,
      onSelect: selectFile,
      onContextMenu: handleNodeContextMenu,
    }),
    [flatNodes, selectedFile, toggleExpand, selectFile, handleNodeContextMenu],
  );

  // 公共菜单回调：新建文件
  const handleNewFile = useCallback(
    (parentPath: string) => {
      setContextMenu(null);
      const name = prompt('请输入文件名（含扩展名，如 mod.json）', 'new-file.json');
      if (!name) return;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      createFile(fullPath, '');
    },
    [createFile],
  );

  // 公共菜单回调：新建文件夹（用 .gitkeep 占位）
  const handleNewFolder = useCallback(
    (parentPath: string) => {
      setContextMenu(null);
      const name = prompt('请输入文件夹名', 'new-folder');
      if (!name) return;
      const fullPath = parentPath ? `${parentPath}/${name}` : name;
      createFile(`${fullPath}/.gitkeep`, '');
    },
    [createFile],
  );

  // 公共菜单回调：重命名
  const handleRename = useCallback(
    (oldPath: string, isFolder: boolean) => {
      setContextMenu(null);
      const parts = oldPath.split('/');
      const oldName = parts.pop() || oldPath;
      const newName = prompt(`重命名${isFolder ? '文件夹' : '文件'}：`, oldName);
      if (!newName || newName === oldName) return;
      const newPath = parts.length > 0 ? `${parts.join('/')}/${newName}` : newName;
      renameFile(oldPath, newPath);
    },
    [renameFile],
  );

  // 公共菜单回调：删除
  const handleDelete = useCallback(
    (path: string) => {
      setContextMenu(null);
      if (confirm(`确定删除 ${path}？`)) {
        deleteFile(path);
      }
    },
    [deleteFile],
  );

  const renderContextMenu = () =>
    contextMenu ? (
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        node={contextMenu.node}
        onClose={() => setContextMenu(null)}
        onNewFile={handleNewFile}
        onNewFolder={handleNewFolder}
        onRename={handleRename}
        onDelete={handleDelete}
      />
    ) : null;

  if (files.length === 0) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        onContextMenu={handleContainerContextMenu}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <Folder className="h-6 w-6 text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">暂无生成文件</div>
        <div className="text-xs text-mc-mute">在右侧 AI 智能体中描述你的需求</div>
        <div className="text-xs text-mc-mute">然后点击「生成代码」创建文件</div>
        {renderContextMenu()}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" onContextMenu={handleContainerContextMenu}>
      <div className="mc-section-title border-b border-mc-border">项目文件</div>
      <div ref={containerRef} className="min-h-0 flex-1 px-1">
        <List
          height={height}
          itemCount={flatNodes.length}
          itemSize={ROW_HEIGHT}
          width="100%"
          itemData={rowData}
        >
          {Row}
        </List>
      </div>
      {renderContextMenu()}
    </div>
  );
}
