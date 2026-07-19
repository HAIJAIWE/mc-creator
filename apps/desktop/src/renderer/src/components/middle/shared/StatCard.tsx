/**
 * 统计卡片与卡片网格容器。
 *
 * 两种视觉变体：
 * - `compact`（默认）：紧凑布局，px-2 py-1.5 + text-base，支持 icon 与 sub，
 *   用于 ModPreview / BehaviorPack / CraftTweaker / Kubejs / ResourcePack 面板顶部统计行。
 * - `wide`：宽松布局，p-3 + text-lg，不支持 icon/sub，
 *   用于 ModpackPreviewPanel 的整合包统计区。
 */

export interface StatCardProps {
  label: string;
  value: number | string;
  /** 副标题（仅 compact 变体显示），例如 "3 必需" */
  sub?: string;
  /** 图标节点（仅 compact 变体显示），通常为 lucide-react 图标 */
  icon?: React.ReactNode;
  /** 视觉变体，默认 compact */
  variant?: 'compact' | 'wide';
}

/** 单张统计卡片 */
export function StatCard({ label, value, sub, icon, variant = 'compact' }: StatCardProps) {
  if (variant === 'wide') {
    return (
      <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
        <div className="text-[10px] text-mc-mute">{label}</div>
        <div className="mt-1 font-display text-lg font-bold text-mc-text">{value}</div>
      </div>
    );
  }
  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-mc-mute">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-display text-base font-bold text-mc-text">{value}</div>
      {sub && <div className="text-[9px] text-mc-dim">{sub}</div>}
    </div>
  );
}

export interface StatCardGridProps {
  children: React.ReactNode;
  /**
   * 容器额外 className。默认为紧凑统计行样式：
   * `grid grid-cols-3 gap-2 border-b border-mc-border bg-mc-surface-2/30 p-2 sm:grid-cols-4 md:grid-cols-7`
   *
   * Modpack 等宽布局可传 `grid grid-cols-2 gap-3` 等自定义网格。
   */
  className?: string;
}

/** 统计卡片网格容器（默认为顶部统计行布局） */
export function StatCardGrid({
  children,
  className = 'grid grid-cols-3 gap-2 border-b border-mc-border bg-mc-surface-2/30 p-2 sm:grid-cols-4 md:grid-cols-7',
}: StatCardGridProps) {
  return <div className={className}>{children}</div>;
}
