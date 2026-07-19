import { Trash2 } from 'lucide-react';

export interface BatchSelectToolbarProps {
  /** 已选条目数；<= 0 时不渲染 */
  selectedCount: number;
  /** 批量移除回调 */
  onBatchRemove: () => void;
  /** 清空选择回调 */
  onClearSelection: () => void;
  /** 移除按钮文案，默认"批量移除" */
  removeLabel?: string;
  /** 外层容器 className */
  className?: string;
}

/**
 * 批量选择工具栏：选中条目数 + 批量移除 + 取消选择。
 *
 * 5 个预览面板共用（Mod/BehaviorPack/CraftTweaker/Kubejs/Modpack）。
 * ResourcePack 无批量选择，不使用此组件。
 *
 * 内部条件渲染：selectedCount <= 0 时返回 null。
 * 调用方仍需根据 activeTab 决定是否渲染（不同 tab 的 selectedIds 不同）。
 */
export function BatchSelectToolbar({
  selectedCount,
  onBatchRemove,
  onClearSelection,
  removeLabel = '批量移除',
  className = 'flex items-center gap-2 border-b border-mc-border bg-mc-accent/10 px-3 py-1.5',
}: BatchSelectToolbarProps) {
  if (selectedCount <= 0) return null;
  return (
    <div className={className}>
      <span className="text-[11px] text-mc-text">已选 {selectedCount} 项</span>
      <button
        onClick={onBatchRemove}
        className="flex items-center gap-1 rounded-mc bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/30"
      >
        <Trash2 className="h-3 w-3" /> {removeLabel}
      </button>
      <button
        onClick={onClearSelection}
        className="ml-auto text-[10px] text-mc-dim hover:text-mc-text"
      >
        取消选择
      </button>
    </div>
  );
}
