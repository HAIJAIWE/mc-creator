import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import Fuse from 'fuse.js';
import {
  Folder,
  FolderOpen,
  FileText,
  FileImage,
  FileCode,
  File as FileIcon,
} from 'lucide-react';
import { useProjectStore } from '../store/project-store.js';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import {
  getFileTreeCache,
  setFileTreeCache,
  invalidatePathCache,
  type TreeNode as CacheNode,
} from '../lib/filetree-cache.js';

/** 整树拉取深度（与单测约定的 fileProjectListTree 第三个参数一致） */
const TREE_CACHE_DEPTH = 5;
/** 搜索防抖（ms） */
const SEARCH_DEBOUNCE_MS = 150;
/** 虚拟列表行高（px） */
const ROW_HEIGHT = 28;

interface FlatRow {
  node: CacheNode;
  depth: number;
  parentPath: string;
  isExpanded: boolean;
}

/** 虚拟列表行数据 */
interface RowData {
  rows: FlatRow[];
  focusIndex: number;
  selectedFile: string | null;
  onRowClick: (row: FlatRow, index: number) => void;
  onRowContextMenu: (e: React.MouseEvent, row: FlatRow) => void;
}

interface ContextMenuState {
  x: number;
  y: number;
  /** 右键目标节点；null = 空白处 */
  node: CacheNode | null;
}

/** 按扩展名选择文件图标（覆盖单测的各分支） */
function FileTypeIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const cls = 'h-3.5 w-3.5 shrink-0 text-mc-mute';
  if (/\.(png|jpe?g|gif|webp|bmp|ico)$/.test(lower)) return <FileImage className={cls} />;
  if (/\.(java|gradle|toml|json|jsonc|ya?ml|xml|toml|properties|ts|tsx|js|jsx|py|lua)$/.test(lower))
    return <FileCode className={cls} />;
  if (/\.(txt|md|markdown|log|cfg|conf|ini)$/.test(lower)) return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

/** 在树中按 path 查找节点 */
function findNode(nodes: CacheNode[], targetPath: string): CacheNode | null {
  for (const n of nodes) {
    if (n.path === targetPath) return n;
    if (n.children) {
      const found = findNode(n.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

/** 递归替换某节点的 children（返回新树） */
function updateNodeChildren(
  nodes: CacheNode[],
  targetPath: string,
  children: CacheNode[],
): CacheNode[] {
  return nodes.map((n) => {
    if (n.path === targetPath) return { ...n, children };
    if (n.children) return { ...n, children: updateNodeChildren(n.children, targetPath, children) };
    return n;
  });
}

/** 递归删除某节点（返回新树） */
function removeNode(nodes: CacheNode[], targetPath: string): CacheNode[] {
  const out: CacheNode[] = [];
  for (const n of nodes) {
    if (n.path === targetPath) continue;
    out.push(n.children ? { ...n, children: removeNode(n.children, targetPath) } : n);
  }
  return out;
}

/** 递归重命名某节点及其后代路径前缀（返回新树） */
function renameNode(nodes: CacheNode[], oldPath: string, newPath: string): CacheNode[] {
  return nodes.map((n) => {
    if (n.path === oldPath || n.path.startsWith(`${oldPath}/`)) {
      const mapped: CacheNode = {
        ...n,
        path: newPath + n.path.slice(oldPath.length),
      };
      if (n.path === oldPath) {
        const segs = newPath.split('/');
        mapped.name = segs[segs.length - 1] ?? newPath;
      }
      if (n.children) mapped.children = renameNode(n.children, oldPath, newPath);
      return mapped;
    }
    if (n.children) return { ...n, children: renameNode(n.children, oldPath, newPath) };
    return n;
  });
}

/** 向某目录节点追加子节点（返回新树；根目录 parentPath === '' 时追加到顶层） */
function appendChild(nodes: CacheNode[], parentPath: string, child: CacheNode): CacheNode[] {
  if (parentPath === '') return [...nodes, child];
  return nodes.map((n) => {
    if (n.path === parentPath) return { ...n, children: [...(n.children ?? []), child] };
    if (n.children) return { ...n, children: appendChild(n.children, parentPath, child) };
    return n;
  });
}

/** 路径的父目录（根层返回 ''） */
function parentDirOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/** 扁平化为可见行（expandedSet === null 表示全部展开） */
function flattenTree(nodes: CacheNode[], expandedSet: Set<string> | null): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (list: CacheNode[], depth: number, parentPath: string) => {
    for (const node of list) {
      const isDir = node.type === 'directory';
      const isExpanded = isDir && (expandedSet === null || expandedSet.has(node.path));
      rows.push({ node, depth, parentPath, isExpanded });
      if (isDir && isExpanded && node.children) walk(node.children, depth + 1, node.path);
    }
  };
  walk(nodes, 0, '');
  return rows;
}

/** 扁平化全部节点（搜索用，不考虑折叠） */
function flattenAll(nodes: CacheNode[]): FlatRow[] {
  const rows: FlatRow[] = [];
  const walk = (list: CacheNode[], depth: number, parentPath: string) => {
    for (const node of list) {
      rows.push({ node, depth, parentPath, isExpanded: true });
      if (node.children) walk(node.children, depth + 1, node.path);
    }
  };
  walk(nodes, 0, '');
  return rows;
}

function Row({ index, style, data }: ListChildComponentProps<RowData>) {
  const { rows, focusIndex, selectedFile, onRowClick, onRowContextMenu } = data;
  const row = rows[index];
  if (!row) return null;
  const { node, depth, isExpanded } = row;
  const isDir = node.type === 'directory';
  const selected = !isDir && selectedFile === node.path;
  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={isDir ? isExpanded : undefined}
      tabIndex={index === focusIndex ? 0 : -1}
      data-focus-index={index}
      onClick={() => onRowClick(row, index)}
      onContextMenu={(e) => onRowContextMenu(e, row)}
      style={{ ...style, paddingLeft: 8 + depth * 14 }}
      className={`flex cursor-pointer items-center gap-1.5 rounded-mc px-1 text-xs ${
        selected ? 'bg-mc-accent/20 text-mc-text' : 'text-mc-dim hover:bg-mc-surface-2'
      }`}
    >
      {isDir ? (
        isExpanded ? (
          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-mc-gold" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-mc-gold" />
        )
      ) : (
        <FileTypeIcon name={node.name} />
      )}
      <span className="truncate">{node.name}</span>
    </div>
  );
}

export function FileTree() {
  const projectId = useProjectStore((s) => s.currentProjectId);
  const selectedFile = useModStore((s) => s.selectedFile);
  const selectFile = useModStore((s) => s.selectFile);

  const [tree, setTree] = useState<CacheNode[]>([]);
  // null = 全部展开（默认）；首次折叠时生成 Set
  const [expandedSet, setExpandedSet] = useState<Set<string> | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [cacheRestored, setCacheRestored] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ item: FlatRow }[] | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [height, setHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  // 初始化：优先读 IndexedDB 缓存，后台拉整树转正
  useEffect(() => {
    if (!projectId) {
      setTree([]);
      setCacheRestored(false);
      setExpandedSet(null);
      return;
    }
    const pid = projectId;
    let mounted = true;

    async function initTree() {
      setIsLoading(true);
      const cached = await getFileTreeCache(pid, '');
      if (!mounted) return;
      if (cached) {
        setTree(cached);
        setCacheRestored(true);
        setIsLoading(false);
      }
      try {
        const res = (await ipcClient.fileProjectListTree(pid, '', TREE_CACHE_DEPTH)) as unknown as {
          success?: boolean;
          tree?: CacheNode[];
        };
        if (!mounted) return;
        const fresh = res && res.success && Array.isArray(res.tree) ? res.tree : [];
        setTree(fresh);
        await setFileTreeCache(pid, '', fresh);
      } catch (error) {
        console.error('[FileTree] Failed to load fresh tree:', error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    initTree();
    return () => {
      mounted = false;
    };
  }, [projectId]);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fuse 模糊搜索（仅内存数据）
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSearchResults(null);
      return;
    }
    const all = flattenAll(tree);
    const fuse = new Fuse(all, {
      keys: ['node.name', 'node.path'],
      threshold: 0.3,
      minMatchCharLength: 1,
    });
    setSearchResults(fuse.search(debouncedQuery).map((r) => ({ item: r.item })));
  }, [debouncedQuery, tree]);

  // 容器高度自适应
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      if (h !== undefined && h > 0) setHeight(h);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 点击空白关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [menu]);

  // 懒加载某目录的子节点
  const loadChildren = useCallback(
    async (pid: string, dirPath: string) => {
      try {
        const res = (await ipcClient.fileProjectListDir(pid, dirPath)) as unknown as {
          success?: boolean;
          entries?: { name: string; type: string }[];
        };
        if (!res || !res.success || !Array.isArray(res.entries)) return;
        const children: CacheNode[] = res.entries.map((e) => ({
          name: e.name,
          path: dirPath ? `${dirPath}/${e.name}` : e.name,
          type: e.type === 'directory' || e.type === 'dir' ? 'directory' : 'file',
        }));
        setTree((prev) => updateNodeChildren(prev, dirPath, children));
      } catch (error) {
        console.error('[FileTree] Failed to load children:', error);
      }
    },
    [],
  );

  // 展开 / 折叠
  const toggleExpand = useCallback(
    (path: string) => {
      if (!projectId) return;
      const pid = projectId;
      const target = findNode(tree, path);
      const loaded = !!target?.children;
      setExpandedSet((prev) => {
        if (prev === null) {
          const next = new Set<string>();
          const collect = (nodes: CacheNode[]) => {
            for (const n of nodes) {
              if (n.type === 'directory' && n.children && n.children.length > 0) {
                next.add(n.path);
                collect(n.children);
              }
            }
          };
          collect(tree);
          next.delete(path);
          if (!loaded) void loadChildren(pid, path);
          return next;
        }
        const next = new Set(prev);
        const expanding = !next.has(path);
        if (expanding) next.add(path);
        else next.delete(path);
        if (expanding && !loaded) void loadChildren(pid, path);
        return next;
      });
    },
    [projectId, tree, loadChildren],
  );

  const visibleRows = useMemo(() => flattenTree(tree, expandedSet), [tree, expandedSet]);
  const isSearchMode = !!debouncedQuery.trim() && searchResults !== null;
  const rows: FlatRow[] = isSearchMode && searchResults ? searchResults.map((r) => r.item) : visibleRows;

  const moveFocus = useCallback(
    (index: number) => {
      if (rows.length === 0) return;
      setFocusIndex(Math.max(0, Math.min(index, rows.length - 1)));
    },
    [rows.length],
  );

  const handleRowClick = useCallback(
    (row: FlatRow, index: number) => {
      setFocusIndex(index);
      if (row.node.type === 'directory') toggleExpand(row.node.path);
      else selectFile(row.node.path);
    },
    [toggleExpand, selectFile],
  );

  // ---- 右键 CRUD ----
  const openMenu = useCallback((e: React.MouseEvent, node: CacheNode | null) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 180;
    const h = node && node.type === 'directory' ? 4 * 28 + 16 : node ? 2 * 28 + 16 : 2 * 28 + 16;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w),
      y: Math.min(e.clientY, window.innerHeight - h),
      node,
    });
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  const openRowMenu = useCallback(
    (e: React.MouseEvent, row: FlatRow) => openMenu(e, row.node),
    [openMenu],
  );

  const handleNewFile = useCallback(
    async (parentPath: string) => {
      closeMenu();
      if (!projectId) return;
      const name = window.prompt('请输入文件名');
      if (!name) return;
      const newPath = parentPath ? `${parentPath}/${name}` : name;
      try {
        await ipcClient.fileProjectWriteTextWithMeta(
          projectId,
          newPath,
          '',
          { mtime: 0, size: 0 } as unknown as { mtime: number; size: number; hash: string },
          undefined,
        );
        const store = useModStore.getState();
        if (!store.files.some((f) => f.path === newPath)) {
          store.setFiles([...store.files, { path: newPath, content: '' }]);
        }
        setTree((prev) =>
          appendChild(prev, parentPath, { name, path: newPath, type: 'file' }),
        );
        await invalidatePathCache(projectId, parentPath);
      } catch (error) {
        console.error('[FileTree] Failed to create file:', error);
      }
    },
    [projectId, closeMenu],
  );

  const handleNewFolder = useCallback(
    async (parentPath: string) => {
      closeMenu();
      if (!projectId) return;
      const name = window.prompt('请输入文件夹名');
      if (!name) return;
      const dirPath = parentPath ? `${parentPath}/${name}` : name;
      const keepPath = `${dirPath}/.gitkeep`;
      try {
        await ipcClient.fileProjectWriteTextWithMeta(
          projectId,
          keepPath,
          '',
          { mtime: 0, size: 0 } as unknown as { mtime: number; size: number; hash: string },
          undefined,
        );
        setTree((prev) => appendChild(prev, parentPath, { name, path: dirPath, type: 'directory' }));
        await invalidatePathCache(projectId, parentPath);
      } catch (error) {
        console.error('[FileTree] Failed to create folder:', error);
      }
    },
    [projectId, closeMenu],
  );

  const handleRename = useCallback(
    (node: CacheNode) => {
      closeMenu();
      const segs = node.path.split('/');
      const oldName = segs[segs.length - 1] ?? node.path;
      const name = window.prompt('重命名', oldName);
      if (!name || name === oldName) return;
      const parent = parentDirOf(node.path);
      const newPath = parent ? `${parent}/${name}` : name;
      const store = useModStore.getState();
      if (node.type === 'directory') {
        const next = store.files.map((f) =>
          f.path === node.path || f.path.startsWith(`${node.path}/`)
            ? { ...f, path: newPath + f.path.slice(node.path.length) }
            : f,
        );
        store.setFiles(next);
      } else {
        store.renameFile(node.path, newPath);
      }
      setTree((prev) => renameNode(prev, node.path, newPath));
      if (projectId) void invalidatePathCache(projectId, parent);
    },
    [projectId, closeMenu],
  );

  const handleDelete = useCallback(
    (node: CacheNode) => {
      closeMenu();
      if (!window.confirm(`确定删除 ${node.path} 吗？`)) return;
      const store = useModStore.getState();
      if (node.type === 'directory') {
        const next = store.files.filter(
          (f) => f.path !== node.path && !f.path.startsWith(`${node.path}/`),
        );
        store.setFiles(next);
        if (projectId) {
          ipcClient.fileProjectDeleteItem(projectId, node.path).catch((e: unknown) => {
            console.warn('[FileTree] Failed to delete folder:', e);
          });
        }
      } else {
        store.deleteFile(node.path);
      }
      setTree((prev) => removeNode(prev, node.path));
      if (projectId) void invalidatePathCache(projectId, parentDirOf(node.path));
    },
    [projectId, closeMenu],
  );

  // ---- 键盘导航 ----
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const current = rows[focusIndex];
      if (!current) return;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveFocus(focusIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveFocus(focusIndex - 1);
          break;
        case 'Home':
          e.preventDefault();
          moveFocus(0);
          break;
        case 'End':
          e.preventDefault();
          moveFocus(rows.length - 1);
          break;
        case 'ArrowRight': {
          e.preventDefault();
          if (current.node.type === 'directory') {
            if (!current.isExpanded) toggleExpand(current.node.path);
            else moveFocus(focusIndex + 1);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (current.node.type === 'directory' && current.isExpanded) {
            toggleExpand(current.node.path);
          } else if (current.parentPath !== '' || current.depth > 0) {
            const parentIdx = rows.findIndex((r) => r.node.path === current.parentPath);
            if (parentIdx !== -1) moveFocus(parentIdx);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (current.node.type === 'directory') toggleExpand(current.node.path);
          else selectFile(current.node.path);
          break;
        }
        default:
          break;
      }
    },
    [rows, focusIndex, moveFocus, toggleExpand, selectFile],
  );

  // ---- 渲染 ----
  if (!projectId) {
    return (
      <div
        data-testid="filetree-empty-no-project"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <Folder className="h-6 w-6 text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">请先打开或新建项目</div>
      </div>
    );
  }

  if (tree.length === 0 && !isLoading) {
    return (
      <div
        data-testid="filetree-empty"
        className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center"
        onContextMenu={(e) => openMenu(e, null)}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <Folder className="h-6 w-6 text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">项目目录为空</div>
        <div className="text-xs text-mc-mute">右键新建文件或文件夹</div>
        {menu && (
          <ContextMenu
            x={menu.x}
            y={menu.y}
            node={menu.node}
            onClose={closeMenu}
            onNewFile={() => handleNewFile('')}
            onNewFolder={() => handleNewFolder('')}
            onRename={handleRename}
            onDelete={handleDelete}
          />
        )}
      </div>
    );
  }

  if (isLoading && !cacheRestored) {
    return (
      <div
        data-testid="filetree-loading"
        className="flex h-full items-center justify-center text-sm text-mc-mute"
      >
        加载中…
      </div>
    );
  }

  const menuParentPath = menu?.node
    ? menu.node.type === 'directory'
      ? menu.node.path
      : parentDirOf(menu.node.path)
    : '';

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-mc-border p-2">
        <input
          role="searchbox"
          type="search"
          value={searchQuery}
          placeholder="搜索文件..."
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('');
              setDebouncedQuery('');
            }
          }}
          className="mc-input w-full !py-1 !text-xs"
        />
      </div>
      <div
        ref={containerRef}
        data-testid="filetree-tree"
        role="tree"
        aria-label="项目文件"
        onKeyDown={handleTreeKeyDown}
        onContextMenu={(e) => openMenu(e, null)}
        className="flex-1 overflow-hidden outline-none"
      >
        <List<RowData>
          height={height}
          width="100%"
          itemCount={rows.length}
          itemSize={ROW_HEIGHT}
          itemData={{ rows, focusIndex, selectedFile, onRowClick: handleRowClick, onRowContextMenu: openRowMenu }}
        >
          {Row}
        </List>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          node={menu.node}
          onClose={closeMenu}
          onNewFile={() => handleNewFile(menuParentPath)}
          onNewFolder={() => handleNewFolder(menuParentPath)}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
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
}: {
  x: number;
  y: number;
  node: CacheNode | null;
  onClose: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
  onRename: (node: CacheNode) => void;
  onDelete: (node: CacheNode) => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
    };
  }, [onClose]);

  const isFolder = node?.type === 'directory';

  return (
    <div
      data-testid="filetree-context-menu"
      role="menu"
      className="fixed z-50 w-44 rounded-mc-lg border border-mc-border bg-mc-surface p-1 shadow-lg"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      {(!node || isFolder) && (
        <>
          <button
            data-testid="ctx-new-file"
            role="menuitem"
            onClick={onNewFile}
            className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text"
          >
            新建文件
          </button>
          <button
            data-testid="ctx-new-folder"
            role="menuitem"
            onClick={onNewFolder}
            className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text"
          >
            新建文件夹
          </button>
        </>
      )}
      {node && (
        <>
          <button
            data-testid="ctx-rename"
            role="menuitem"
            onClick={() => onRename(node)}
            className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text"
          >
            重命名
          </button>
          <button
            data-testid="ctx-delete"
            role="menuitem"
            onClick={() => onDelete(node)}
            className="flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs text-mc-redstone hover:bg-mc-surface-2"
          >
            删除
          </button>
        </>
      )}
    </div>
  );
}

export default FileTree;
