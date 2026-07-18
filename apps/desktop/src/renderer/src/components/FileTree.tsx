import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { Folder, FolderOpen, ChevronRight, ChevronDown } from 'lucide-react';
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
  const { flatNodes, selectedFile, onToggle, onSelect } = data;
  const { node, depth, hasChildren, isExpanded } = flatNodes[index];
  const paddingLeft = depth * 12 + 8;

  if (node.type === 'folder') {
    const FolderIcon = isExpanded ? FolderOpen : Folder;
    return (
      <div style={style}>
        <button
          onClick={() => onToggle(node.path)}
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
    <div style={style}>
      <button
        onClick={() => onSelect(node.path)}
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

export function FileTree() {
  // P3 性能：用 shallow 选择器仅订阅 files/selectedFile/selectFile，避免 buildLog/loading 流式更新时重渲染
  const { files, selectedFile, selectFile } = useModStore(
    (s) => ({ files: s.files, selectedFile: s.selectedFile, selectFile: s.selectFile }),
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

  const rowData: RowData = useMemo(
    () => ({ flatNodes, selectedFile, onToggle: toggleExpand, onSelect: selectFile }),
    [flatNodes, selectedFile, toggleExpand, selectFile],
  );
  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <Folder className="h-6 w-6 text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">暂无生成文件</div>
        <div className="text-xs text-mc-mute">在右侧 AI 智能体中描述你的需求</div>
        <div className="text-xs text-mc-mute">然后点击「生成代码」创建文件</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
    </div>
  );
}
