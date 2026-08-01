import { useMemo, useState } from 'react';
import { GitCompare, ArrowLeft } from 'lucide-react';
import type { SpecVersion } from '../store/spec-history-store.js';
import {
  diffSpecValues,
  summarizeDiff,
  formatDiffValue,
  type SpecDiffEntry,
} from '../lib/specDiff.js';

interface VersionDiffPanelProps {
  versions: SpecVersion[];
  onClose: () => void;
}

/**
 * 版本对比面板（Task 5）：
 * 选择两个历史版本，展示字段级差异（新增/删除/修改）。
 */
export function VersionDiffPanel({ versions, onClose }: VersionDiffPanelProps) {
  // 默认对比最近两个版本
  const [leftId, setLeftId] = useState<string>(
    versions[versions.length - 2]?.id ?? versions[0]?.id ?? '',
  );
  const [rightId, setRightId] = useState<string>(versions[versions.length - 1]?.id ?? '');

  const left = versions.find((v) => v.id === leftId);
  const right = versions.find((v) => v.id === rightId);

  const entries = useMemo<SpecDiffEntry[]>(() => {
    if (!left || !right) return [];
    return diffSpecValues(left.spec, right.spec);
  }, [left, right]);

  const summary = useMemo(() => summarizeDiff(entries), [entries]);

  const kindStyle: Record<SpecDiffEntry['kind'], string> = {
    added: 'text-mc-accent',
    removed: 'text-mc-redstone',
    changed: 'text-mc-gold',
  };
  const kindLabel: Record<SpecDiffEntry['kind'], string> = {
    added: '新增',
    removed: '删除',
    changed: '修改',
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mc-section-title flex items-center gap-2 border-b border-mc-border">
        <GitCompare className="h-4 w-4" /> 版本对比
        <button
          onClick={onClose}
          className="ml-auto rounded-mc px-1.5 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
          title="返回历史"
        >
          <ArrowLeft className="h-3 w-3 inline" /> 返回
        </button>
      </div>

      {/* 版本选择 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <select
          value={leftId}
          onChange={(e) => setLeftId(e.target.value)}
          className="mc-select flex-1"
          aria-label="选择旧版本"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-mc-dim">→</span>
        <select
          value={rightId}
          onChange={(e) => setRightId(e.target.value)}
          className="mc-select flex-1"
          aria-label="选择新版本"
        >
          {versions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
      </div>

      {/* 差异统计 */}
      {left && right && (
        <div className="flex items-center gap-3 border-b border-mc-border px-3 py-2 text-xs">
          <span className="text-mc-accent">+{summary.added}</span>
          <span className="text-mc-redstone">-{summary.removed}</span>
          <span className="text-mc-gold">~{summary.changed}</span>
          <span className="ml-auto text-mc-mute">共 {entries.length} 处差异</span>
        </div>
      )}

      {/* 差异列表 */}
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-mc-dim">
            {left && right ? '两个版本没有差异' : '请选择两个版本'}
          </div>
        ) : (
          <ul className="divide-y divide-mc-border">
            {entries.map((e, i) => (
              <li key={i} className="px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-medium ${kindStyle[e.kind]}`}>
                    {kindLabel[e.kind]}
                  </span>
                  <code className="truncate font-mono text-[11px] text-mc-text">{e.path}</code>
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div className="min-w-0 rounded-mc bg-mc-surface-2 px-2 py-1">
                    <div className="text-[9px] text-mc-mute">旧</div>
                    <code className="block truncate font-mono text-[10px] text-mc-text">
                      {formatDiffValue(e.oldValue)}
                    </code>
                  </div>
                  <div className="min-w-0 rounded-mc bg-mc-surface-2 px-2 py-1">
                    <div className="text-[9px] text-mc-mute">新</div>
                    <code className="block truncate font-mono text-[10px] text-mc-text">
                      {formatDiffValue(e.newValue)}
                    </code>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
