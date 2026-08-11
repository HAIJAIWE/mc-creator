import { useState } from 'react';
import { History, Undo2, Trash2, Trash, GitCompare } from 'lucide-react';
import { useSpecHistoryStore } from '../store/spec-history-store.js';
import { useModStore } from '../store/mod-store.js';
import { VersionDiffPanel } from './VersionDiffPanel.js';

interface SpecHistoryPanelProps {
  onClose?: () => void;
  /** 回滚成功后回调（传入回滚后的 spec），便于父组件同步本地编辑器状态 */
  onRollback?: (spec: unknown) => void;
}

/**
 * Spec 版本历史面板。
 * 展示所有记录的 Spec 快照，支持回滚到指定版本与删除单条 / 清空全部。
 * 回滚时直接 setState({ spec })，绕过 setSpec 以避免触发新的历史记录。
 */
export function SpecHistoryPanel({ onClose, onRollback }: SpecHistoryPanelProps) {
  const versions = useSpecHistoryStore((s) => s.versions);
  const currentIndex = useSpecHistoryStore((s) => s.currentIndex);
  const rollbackTo = useSpecHistoryStore((s) => s.rollbackTo);
  const removeVersion = useSpecHistoryStore((s) => s.removeVersion);
  const clearHistory = useSpecHistoryStore((s) => s.clearHistory);
  const [showDiff, setShowDiff] = useState(false);

  const handleRollback = (id: string) => {
    const spec = rollbackTo(id);
    if (spec !== null) {
      // 直接设置 spec，绕过 setSpec 避免回滚操作本身被记录为新版本
      useModStore.setState({ spec: spec as never });
      onRollback?.(spec);
    }
  };

  const handleRemove = (id: string) => {
    if (window.confirm('确定删除该历史版本？此操作不可恢复。')) {
      removeVersion(id);
    }
  };

  const handleClear = () => {
    if (window.confirm(`确定清空全部 ${versions.length} 个历史版本？此操作不可恢复。`)) {
      clearHistory();
    }
  };

  // 倒序展示：最新在上
  const ordered = [...versions].reverse();

  return (
    <div className="flex h-full flex-col">
      {/* 标题栏 */}
      <div className="mc-section-title border-b border-mc-border flex items-center gap-2">
        <History className="h-4 w-4" /> 历史版本
        {versions.length >= 2 && (
          <button
            onClick={() => setShowDiff((v) => !v)}
            className="rounded-mc px-1.5 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            title="对比两个版本的差异"
          >
            <GitCompare className="h-3 w-3 inline" /> {showDiff ? '返回列表' : '对比版本'}
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto rounded-mc px-1.5 py-0.5 text-xs text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            title="关闭"
          >
            ✕
          </button>
        )}
      </div>

      {/* 版本对比视图 */}
      {showDiff ? (
        <VersionDiffPanel versions={versions} onClose={() => setShowDiff(false)} />
      ) : (
        /* 版本列表 */
        <div className="flex-1 overflow-y-auto">
          {ordered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-xs text-mc-dim">
              <div className="flex h-12 w-12 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
                <History className="h-6 w-6 text-mc-mute" />
              </div>
              暂无历史版本
            </div>
          ) : (
            <ul className="divide-y divide-mc-border">
              {ordered.map((v) => {
                // ordered 是倒序的，需要换算回原索引以判断是否为当前激活版本
                const originalIndex = versions.findIndex((x) => x.id === v.id);
                const active = originalIndex === currentIndex;
                return (
                  <li
                    key={v.id}
                    className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                      active ? 'bg-mc-accent/15' : 'hover:bg-mc-surface-2/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`font-mono ${active ? 'text-mc-accent' : 'text-mc-text'}`}
                          title={v.label}
                        >
                          {v.label}
                        </span>
                        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-xs text-mc-dim">
                          {v.generatorType}
                        </span>
                        {active && <span className="text-xs text-mc-accent">当前</span>}
                      </div>
                      {v.description && (
                        <div className="mt-0.5 truncate text-mc-mute" title={v.description}>
                          {v.description}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button
                        onClick={() => handleRollback(v.id)}
                        disabled={active}
                        className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text disabled:cursor-not-allowed disabled:opacity-40"
                        title={active ? '已是当前版本' : '回滚到此版本'}
                      >
                        <Undo2 className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => handleRemove(v.id)}
                        className="rounded-mc p-1 text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-redstone"
                        title="删除此版本"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* 底部操作栏 */}
      <div className="flex items-center justify-between border-t border-mc-border px-3 py-2">
        <span className="text-xs text-mc-mute">
          共 {versions.length} 个版本
          {versions.length > 0 && currentIndex >= 0 ? ` · 当前 #${currentIndex + 1}` : ''}
        </span>
        <button
          onClick={handleClear}
          disabled={versions.length === 0}
          className="mc-btn-ghost !px-2 !py-1 disabled:cursor-not-allowed disabled:opacity-40"
          title="清空所有历史"
        >
          <Trash className="h-3 w-3" /> 清空
        </button>
      </div>
    </div>
  );
}
