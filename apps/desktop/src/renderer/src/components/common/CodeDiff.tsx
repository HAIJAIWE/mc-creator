import { useMemo, useState, useCallback, useEffect, useRef, forwardRef } from 'react';
import { ChevronUp, ChevronDown, Columns, Minimize2 } from 'lucide-react';

/** 差异块类型 */
export type DiffChunkType = 'added' | 'removed' | 'changed' | 'unchanged';

/** 单个差异块 */
export interface DiffChunk {
  type: DiffChunkType;
  lines: DiffLine[];
  startLineOld: number | null; // 对于 added 为 null
  startLineNew: number | null; // 对于 removed 为 null
  endLineOld: number | null;
  endLineNew: number | null;
}

/** 单行差异 */
export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumberOld: number | null;
  lineNumberNew: number | null;
}

/** 差异统计 */
export interface DiffStats {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** CodeDiff 组件 Props */
export interface CodeDiffProps {
  /** 旧版本内容（服务器版本） */
  oldContent: string;
  /** 新版本内容（本地版本） */
  newContent: string;
  /** 旧版本标签 */
  oldLabel?: string;
  /** 新版本标签 */
  newLabel?: string;
  /** 是否只读模式 */
  readOnly?: boolean;
  /** 是否显示行号 */
  showLineNumbers?: boolean;
  /** 视图模式 */
  viewMode?: 'side-by-side' | 'inline';
  /** 切换视图模式回调 */
  onViewModeChange?: (mode: 'side-by-side' | 'inline') => void;
  /** 最大高度 */
  maxHeight?: string;
  /** 语言标识（用于语法高亮） */
  language?: string;
  /** 点击差异块导航回调 */
  onChunkClick?: (index: number) => void;
  /** 当前高亮的差异块索引 */
  activeChunkIndex?: number;
}

/**
 * 计算行级差异，返回结构化的 DiffChunk 数组
 */
export function computeDiffChunks(oldContent: string, newContent: string): DiffChunk[] {
  // 使用 diff 库计算逐行差异
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { diffLines } = require('diff');
  const diffs = diffLines(oldContent, newContent, { newlineIsToken: true });

  const chunks: DiffChunk[] = [];
  let lineOld = 1;
  let lineNew = 1;
  let currentChunk: DiffChunk | null = null;

  for (const part of diffs) {
    const lines = part.value.split('\n');
    // 处理末尾空行
    const actualLines = lines.length > 0 && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;

    if (part.added) {
      // 新增行
      const addedLines: DiffLine[] = actualLines.map((content: string) => ({
        type: 'added' as const,
        content,
        lineNumberOld: null,
        lineNumberNew: lineNew++,
      }));

      if (currentChunk && currentChunk.type === 'added') {
        currentChunk.lines.push(...addedLines);
        currentChunk.endLineNew = lineNew - 1;
      } else {
        currentChunk = {
          type: 'added',
          lines: addedLines,
          startLineOld: null,
          startLineNew: addedLines[0]?.lineNumberNew ?? lineNew,
          endLineOld: null,
          endLineNew: lineNew - 1,
        };
        chunks.push(currentChunk);
      }
    } else if (part.removed) {
      // 删除行
      const removedLines: DiffLine[] = actualLines.map((content: string) => ({
        type: 'removed' as const,
        content,
        lineNumberOld: lineOld++,
        lineNumberNew: null,
      }));

      if (currentChunk && currentChunk.type === 'removed') {
        currentChunk.lines.push(...removedLines);
        currentChunk.endLineOld = lineOld - 1;
      } else {
        currentChunk = {
          type: 'removed',
          lines: removedLines,
          startLineOld: removedLines[0]?.lineNumberOld ?? lineOld,
          startLineNew: null,
          endLineOld: lineOld - 1,
          endLineNew: null,
        };
        chunks.push(currentChunk);
      }
    } else {
      // 未变更行
      const unchangedLines: DiffLine[] = actualLines.map((content: string) => ({
        type: 'unchanged' as const,
        content,
        lineNumberOld: lineOld++,
        lineNumberNew: lineNew++,
      }));

      if (currentChunk && currentChunk.type === 'unchanged') {
        currentChunk.lines.push(...unchangedLines);
        currentChunk.endLineOld = lineOld - 1;
        currentChunk.endLineNew = lineNew - 1;
      } else {
        currentChunk = {
          type: 'unchanged',
          lines: unchangedLines,
          startLineOld: unchangedLines[0]?.lineNumberOld ?? lineOld,
          startLineNew: unchangedLines[0]?.lineNumberNew ?? lineNew,
          endLineOld: lineOld - 1,
          endLineNew: lineNew - 1,
        };
        chunks.push(currentChunk);
      }
    }
  }

  // 合并相邻的 added/removed 为 changed
  const mergedChunks: DiffChunk[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (
      chunk.type === 'removed' &&
      i + 1 < chunks.length &&
      chunks[i + 1].type === 'added'
    ) {
      // 合并为 changed 类型
      const nextChunk = chunks[i + 1];
      const mergedLines: DiffLine[] = [
        ...chunk.lines.map((l) => ({ ...l, type: 'removed' as const })),
        ...nextChunk.lines.map((l) => ({ ...l, type: 'added' as const })),
      ];
      mergedChunks.push({
        type: 'changed',
        lines: mergedLines,
        startLineOld: chunk.startLineOld,
        startLineNew: nextChunk.startLineNew,
        endLineOld: chunk.endLineOld,
        endLineNew: nextChunk.endLineNew,
      });
      i++; // 跳过下一个
    } else {
      mergedChunks.push(chunk);
    }
  }

  return mergedChunks;
}

/**
 * 计算差异统计
 */
export function computeDiffStats(chunks: DiffChunk[]): DiffStats {
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const chunk of chunks) {
    switch (chunk.type) {
      case 'added':
        added += chunk.lines.length;
        break;
      case 'removed':
        removed += chunk.lines.length;
        break;
      case 'changed':
        changed += chunk.lines.length;
        break;
      case 'unchanged':
        unchanged += chunk.lines.length;
        break;
    }
  }

  return { added, removed, changed, unchanged };
}

/**
 * 单行渲染组件
 */
function DiffLineView({
  line,
  showLineNumbers,
}: {
  line: DiffLine;
  showLineNumbers: boolean;
}) {
  const typeColors: Record<DiffLine['type'], string> = {
    added: 'bg-mc-accent/10 border-l-2 border-mc-accent',
    removed: 'bg-mc-redstone/10 border-l-2 border-mc-redstone',
    unchanged: '',
  };

  const typeTextColors: Record<DiffLine['type'], string> = {
    added: 'text-mc-accent',
    removed: 'text-mc-redstone',
    unchanged: 'text-mc-text',
  };

  const lineClass = typeColors[line.type] || '';
  const textClass = typeTextColors[line.type] || '';

  return (
    <div className={`flex ${lineClass}`}>
      {showLineNumbers && (
        <div className="flex-shrink-0 w-16 px-2 text-right text-[10px] text-mc-mute select-none border-r border-mc-border bg-mc-surface">
          {line.type === 'added' ? '+' : ''}
          {line.lineNumberOld !== null && line.lineNumberNew !== null
            ? `${line.lineNumberOld} → ${line.lineNumberNew}`
            : line.lineNumberOld !== null
            ? `${line.lineNumberOld} → —`
            : line.lineNumberNew !== null
            ? `— → ${line.lineNumberNew}`
            : '—'}
        </div>
      )}
      <div
        className={`flex-1 min-w-0 px-2 py-0.5 font-mono text-[11px] leading-5 ${textClass} whitespace-pre ${
          line.type !== 'unchanged' ? 'font-medium' : ''
        }`}
      >
        {line.content || '␍'}
      </div>
    </div>
  );
}

/**
 * 侧边栏差异块渲染（Side-by-side 模式）
 */
interface SideBySideChunkProps {
  chunk: DiffChunk;
  index: number;
  showLineNumbers: boolean;
  isActive: boolean;
  onClick: () => void;
}

const SideBySideChunk = forwardRef<HTMLDivElement, SideBySideChunkProps>(
  ({ chunk, index, showLineNumbers, isActive, onClick }, ref) => {
    const typeColors: Record<DiffChunkType, { bg: string; border: string; badge: string }> = {
      added: { bg: 'bg-mc-accent/5', border: 'border-mc-accent', badge: 'bg-mc-accent text-mc-bg' },
      removed: { bg: 'bg-mc-redstone/5', border: 'border-mc-redstone', badge: 'bg-mc-redstone text-mc-bg' },
      changed: { bg: 'bg-mc-gold/5', border: 'border-mc-gold', badge: 'bg-mc-gold text-mc-bg' },
      unchanged: { bg: '', border: 'border-mc-border', badge: 'bg-mc-dim text-mc-text' },
    };

    const colors = typeColors[chunk.type];
    const typeLabels: Record<DiffChunkType, string> = {
      added: '新增',
      removed: '删除',
      changed: '修改',
      unchanged: '未变',
    };

    return (
      <div
        ref={ref}
        className={`group rounded-mc border ${colors.border} ${colors.bg} ${isActive ? 'ring-2 ring-mc-accent' : ''}`}
        onClick={onClick}
        data-chunk-index={index}
      >
        <div className="flex items-center gap-2 px-2 py-1 border-b border-mc-border/50 bg-mc-surface/50">
          <span
            className={`px-1.5 py-0.5 rounded-mc text-[9px] font-medium ${colors.badge}`}
          >
            {typeLabels[chunk.type]}
          </span>
          <span className="text-[10px] text-mc-mute font-mono">
            {chunk.startLineOld !== null && chunk.endLineOld !== null
              ? `${chunk.startLineOld}-${chunk.endLineOld}`
              : '—'}
            {' → '}
            {chunk.startLineNew !== null && chunk.endLineNew !== null
              ? `${chunk.startLineNew}-${chunk.endLineNew}`
              : '—'}
          </span>
        </div>
        <div className="grid grid-cols-2">
          {/* 左侧：旧版本 */}
          <div className="border-r border-mc-border/50 bg-mc-bg/50">
            {chunk.lines
              .filter((l) => l.type === 'removed' || l.type === 'unchanged')
              .map((line, i) => (
                <DiffLineView key={i} line={line} showLineNumbers={showLineNumbers} />
              ))}
            {chunk.type === 'added' && (
              <div className="h-6 flex items-center justify-center text-mc-mute text-[10px] px-2">
                （此块在旧版本中不存在）
              </div>
            )}
          </div>
          {/* 右侧：新版本 */}
          <div>
            {chunk.lines
              .filter((l) => l.type === 'added' || l.type === 'unchanged')
              .map((line, i) => (
                <DiffLineView key={i} line={line} showLineNumbers={showLineNumbers} />
              ))}
            {chunk.type === 'removed' && (
              <div className="h-6 flex items-center justify-center text-mc-mute text-[10px] px-2">
                （此块在新版本中已删除）
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
);

SideBySideChunk.displayName = 'SideBySideChunk';

/**
 * 内联模式差异块渲染
 */
interface InlineChunkProps {
  chunk: DiffChunk;
  index: number;
  showLineNumbers: boolean;
  isActive: boolean;
  onClick: () => void;
}

const InlineChunk = forwardRef<HTMLDivElement, InlineChunkProps>(
  ({ chunk, index, showLineNumbers, isActive, onClick }, ref) => {
    const typeColors: Record<DiffChunkType, { bg: string; border: string; badge: string }> = {
      added: { bg: 'bg-mc-accent/5', border: 'border-mc-accent', badge: 'bg-mc-accent text-mc-bg' },
      removed: { bg: 'bg-mc-redstone/5', border: 'border-mc-redstone', badge: 'bg-mc-redstone text-mc-bg' },
      changed: { bg: 'bg-mc-gold/5', border: 'border-mc-gold', badge: 'bg-mc-gold text-mc-bg' },
      unchanged: { bg: '', border: 'border-mc-border', badge: 'bg-mc-dim text-mc-text' },
    };

    const colors = typeColors[chunk.type];
    const typeLabels: Record<DiffChunkType, string> = {
      added: '新增',
      removed: '删除',
      changed: '修改',
      unchanged: '未变',
    };

    return (
      <div
        ref={ref}
        className={`group rounded-mc border ${colors.border} ${colors.bg} ${isActive ? 'ring-2 ring-mc-accent' : ''}`}
        onClick={onClick}
        data-chunk-index={index}
      >
        <div className="flex items-center gap-2 px-2 py-1 border-b border-mc-border/50 bg-mc-surface/50">
          <span
            className={`px-1.5 py-0.5 rounded-mc text-[9px] font-medium ${colors.badge}`}
          >
            {typeLabels[chunk.type]}
          </span>
          <span className="text-[10px] text-mc-mute font-mono">
            {chunk.startLineOld !== null && chunk.endLineOld !== null
              ? `${chunk.startLineOld}-${chunk.endLineOld}`
              : '—'}
            {' → '}
            {chunk.startLineNew !== null && chunk.endLineNew !== null
              ? `${chunk.startLineNew}-${chunk.endLineNew}`
              : '—'}
          </span>
        </div>
        <div className="space-y-0">
          {chunk.lines.map((line, i) => (
            <DiffLineView key={i} line={line} showLineNumbers={showLineNumbers} />
          ))}
        </div>
      </div>
    );
  }
);

InlineChunk.displayName = 'InlineChunk';

/**
 * 代码差异对比组件
 */
export function CodeDiff({
  oldContent,
  newContent,
  oldLabel = '服务器版本',
  newLabel = '本地版本',
  readOnly = true,
  showLineNumbers = true,
  viewMode = 'side-by-side',
  onViewModeChange,
  maxHeight = '60vh',
  language,
  onChunkClick,
  activeChunkIndex,
}: CodeDiffProps) {
  const chunks = useMemo(() => computeDiffChunks(oldContent, newContent), [oldContent, newContent]);
  const stats = useMemo(() => computeDiffStats(chunks), [chunks]);
  const [collapsedUnchanged, setCollapsedUnchanged] = useState(false);
  const chunkRefs = useRef<(HTMLDivElement | null)[]>([]);

  // 键盘导航：F7 / Shift+F7
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F7') {
        e.preventDefault();
        if (e.shiftKey) {
          // 上一个差异块
          navigateChunk(-1);
        } else {
          // 下一个差异块
          navigateChunk(1);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [chunks, activeChunkIndex, onChunkClick]);

  const navigateChunk = useCallback(
    (direction: number) => {
      const diffChunks = chunks.filter((c) => c.type !== 'unchanged');
      if (diffChunks.length === 0) return;

      let currentIndex = diffChunks.findIndex((c) => chunks.indexOf(c) === activeChunkIndex);
      if (currentIndex === -1) {
        currentIndex = direction > 0 ? -1 : diffChunks.length;
      }

      const nextIndex = (currentIndex + direction + diffChunks.length) % diffChunks.length;
      const targetChunk = diffChunks[nextIndex];
      const targetChunkIndex = chunks.indexOf(targetChunk);
      onChunkClick?.(targetChunkIndex);
    },
    [chunks, activeChunkIndex, onChunkClick]
  );

  // 滚动到激活的差异块
  useEffect(() => {
    if (activeChunkIndex !== undefined && chunkRefs.current[activeChunkIndex]) {
      chunkRefs.current[activeChunkIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeChunkIndex]);

  // 过滤显示的块
  const displayChunks = collapsedUnchanged
    ? chunks.filter((c) => c.type !== 'unchanged')
    : chunks;

  return (
    <div className="flex flex-col h-full bg-mc-bg">
      {/* 工具栏 */}
      <div className="flex items-center justify-between border-b border-mc-border bg-mc-surface px-3 py-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-mc-dim">{oldLabel}</span>
            <span className="px-1.5 py-0.5 rounded-mc text-[9px] font-medium bg-mc-redstone/10 text-mc-redstone border border-mc-redstone/30">
              旧
            </span>
          </div>
          <span className="text-mc-mute">→</span>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-mc-dim">{newLabel}</span>
            <span className="px-1.5 py-0.5 rounded-mc text-[9px] font-medium bg-mc-accent/10 text-mc-accent border border-mc-accent/30">
              新
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* 统计信息 */}
          <div className="flex items-center gap-3 text-xs hidden sm:flex">
            <span className="text-mc-accent">+{stats.added}</span>
            <span className="text-mc-redstone">-{stats.removed}</span>
            <span className="text-mc-gold">~{stats.changed}</span>
            <span className="text-mc-dim">={stats.unchanged}</span>
          </div>

          {/* 折叠未变更 */}
          <label className="flex items-center gap-1.5 text-xs text-mc-dim cursor-pointer">
            <input
              type="checkbox"
              checked={collapsedUnchanged}
              onChange={(e) => setCollapsedUnchanged(e.target.checked)}
              className="rounded-mc border-mc-border"
            />
            折叠未变更
          </label>

          {/* 视图模式切换 */}
          <div className="flex items-center gap-1 border border-mc-border rounded-mc p-0.5 bg-mc-surface">
            <button
              onClick={() => onViewModeChange?.('side-by-side')}
              className={`px-2 py-1 rounded-mc text-xs transition-colors ${
                viewMode === 'side-by-side'
                  ? 'bg-mc-accent text-mc-bg'
                  : 'text-mc-dim hover:text-mc-text'
              }`}
              title="并排模式"
            >
              <Columns className="h-3 w-3" />
            </button>
            <button
              onClick={() => onViewModeChange?.('inline')}
              className={`px-2 py-1 rounded-mc text-xs transition-colors ${
                viewMode === 'inline'
                  ? 'bg-mc-accent text-mc-bg'
                  : 'text-mc-dim hover:text-mc-text'
              }`}
              title="内联模式"
            >
              <Minimize2 className="h-3 w-3" />
            </button>
          </div>

          {/* 导航按钮 */}
          <div className="flex items-center gap-1 border border-mc-border rounded-mc p-0.5 bg-mc-surface">
            <button
              onClick={() => navigateChunk(-1)}
              className="p-1 rounded-mc text-mc-dim hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
              title="上一个差异 (Shift+F7)"
              disabled={chunks.filter((c) => c.type !== 'unchanged').length === 0}
            >
              <ChevronUp className="h-3 w-3" />
            </button>
            <button
              onClick={() => navigateChunk(1)}
              className="p-1 rounded-mc text-mc-dim hover:text-mc-text hover:bg-mc-surface-2 transition-colors"
              title="下一个差异 (F7)"
              disabled={chunks.filter((c) => c.type !== 'unchanged').length === 0}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* 差异内容区域 */}
      <div
        className="flex-1 overflow-auto font-mono text-[11px] leading-5"
        style={{ maxHeight }}
        role="region"
        aria-label="代码差异对比"
      >
        {displayChunks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-mc-mute">
            两个版本完全相同
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {displayChunks.map((chunk, displayIndex) => {
              const originalIndex = chunks.indexOf(chunk);
              const isActive = activeChunkIndex === originalIndex;
              const ChunkComponent = viewMode === 'side-by-side' ? SideBySideChunk : InlineChunk;

              // 确保 ref 数组足够大
              if (chunkRefs.current.length <= originalIndex) {
                chunkRefs.current.length = originalIndex + 1;
              }

              return (
                <ChunkComponent
                  key={originalIndex}
                  ref={(el: HTMLDivElement | null) => {
                    chunkRefs.current[originalIndex] = el;
                  }}
                  chunk={chunk}
                  index={originalIndex}
                  showLineNumbers={showLineNumbers}
                  isActive={isActive}
                  onClick={() => onChunkClick?.(originalIndex)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}