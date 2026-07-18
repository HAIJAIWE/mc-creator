import { useState, useMemo } from 'react';
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
  if (path.endsWith('.gradle') || path.endsWith('.toml') || path.endsWith('.properties')) return 'terminal';
  if (path.endsWith('.png')) return 'image';
  return 'file';
}

function TreeItem({ node, selectedFile, onSelect, depth = 0 }: { node: TreeNode; selectedFile: string | null; onSelect: (path: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(true);
  const FolderIcon = node.type === 'folder' ? (expanded ? FolderOpen : Folder) : null;
  const fileIconName = node.type === 'file' ? getFileIcon(node.path) : null;

  if (node.type === 'folder') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-1 py-1 text-left text-xs text-mc-dim transition-colors hover:bg-mc-surface-2"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {expanded ? <ChevronDown className="h-3 w-3 text-mc-mute" /> : <ChevronRight className="h-3 w-3 text-mc-mute" />}
          {FolderIcon && <FolderIcon className="h-3 w-3 text-mc-accent" />}
          <span className="truncate text-mc-text">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <TreeItem key={child.path} node={child} selectedFile={selectedFile} onSelect={onSelect} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedFile === node.path;
  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex w-full items-center gap-1 border-l-2 py-0.5 pl-2 pr-2 text-left text-xs transition-colors ${
        isSelected
          ? 'border-mc-accent bg-mc-surface-3 text-mc-text'
          : 'border-transparent text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <McIcon scope="pixel" name={fileIconName ?? 'file'} size={12} className="text-mc-mute" />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree() {
  // P3 性能：用 shallow 选择器仅订阅 files/selectedFile/selectFile，避免 buildLog/loading 流式更新时重渲染
  const { files, selectedFile, selectFile } = useModStore(
    (s) => ({ files: s.files, selectedFile: s.selectedFile, selectFile: s.selectFile }),
    shallow,
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

  // P3 性能：仅 files 变化时重建树，避免每次渲染都 O(n) 重建
  const tree = useMemo(() => buildTree(files), [files]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mc-section-title border-b border-mc-border">项目文件</div>
      <div className="p-1">
        {tree.map((node) => (
          <TreeItem key={node.path} node={node} selectedFile={selectedFile} onSelect={selectFile} />
        ))}
      </div>
    </div>
  );
}
