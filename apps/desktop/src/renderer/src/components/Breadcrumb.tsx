import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import { getFileIconName } from '../lib/file-utils.js';

function iconForSegment(segment: string, isLast: boolean): string {
  if (!isLast) return 'folder';
  return getFileIconName(segment);
}

interface BreadcrumbProps {
  /** 完整文件路径，用 / 分隔 */
  filePath: string;
}

/**
 * 面包屑导航：显示文件路径的各段（目录 + 文件名），点击目录段可选中该目录下第一个文件。
 * 位于编辑器顶部与标签页之间。
 */
export function Breadcrumb({ filePath }: BreadcrumbProps) {
  const files = useModStore((s) => s.files);
  const selectFile = useModStore((s) => s.selectFile);

  const segments = filePath.split('/');
  // 构建每段的完整路径前缀
  const paths: string[] = [];
  for (let i = 1; i <= segments.length; i++) {
    paths.push(segments.slice(0, i).join('/'));
  }

  const handleClick = useCallback(
    (prefix: string, isLast: boolean) => {
      // 点击最后一段（文件名）无操作（当前文件已选中）
      if (isLast) return;
      // 点击目录段：选中该目录下第一个文件
      const firstFile = files.find((f) => f.path.startsWith(prefix + '/'));
      if (firstFile) selectFile(firstFile.path);
      // 目录下无文件时静默忽略（按钮已通过 cursor-not-allowed 暗示不可点击）
    },
    [files, selectFile],
  );

  return (
    <div
      className="flex items-center gap-0.5 overflow-x-auto border-b border-mc-border bg-mc-surface px-3 py-1"
      aria-label="面包屑导航"
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        const hasFiles = isLast || files.some((f) => f.path.startsWith(paths[i] + '/'));
        return (
          <span key={i} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-mc-mute" />}
            <button
              onClick={() => handleClick(paths[i], isLast)}
              className={`flex items-center gap-1 rounded-mc px-1 py-0.5 text-xs transition-colors ${
                isLast
                  ? 'text-mc-text font-medium'
                  : hasFiles
                    ? 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text cursor-pointer'
                    : 'text-mc-mute cursor-not-allowed'
              }`}
            >
              <McIcon
                scope="pixel"
                name={iconForSegment(seg, isLast)}
                size={12}
                className="shrink-0 text-mc-mute"
              />
              <span className="truncate max-w-24">{seg}</span>
            </button>
          </span>
        );
      })}
    </div>
  );
}
