import { memo } from 'react';
import { McIcon } from '../../../../assets/mc-ui/McIcon.js';
import { NODE_COLORS } from './portColors.js';

export type NodeDebugState = 'breakpoint' | 'debugging' | null;
export type NodeErrorState = 'error' | 'warning' | null;

interface McNodeHeaderProps {
  icon: string;
  title: string;
  /** Tailwind 颜色类名（如 'mc-item'），用于查 NODE_COLORS hex 值 */
  colorClass: string;
  badge?: string;
  collapsed: boolean;
  debugState?: NodeDebugState;
  errorState?: NodeErrorState;
  onToggleCollapse: () => void;
  onOpenDrawer: () => void;
}

/**
 * MC 风格 3D 凸起灰色头部条。
 * - 背景 #c6c6c6（mc-btn），3D 凸起边框（上/左白、下/右黑）
 * - 左侧 4px 类别色条 + 像素图标 + 像素字体标题
 * - 右侧徽章 + 调试/错误标记 + 设置按钮 + 折叠按钮
 */
function McNodeHeaderComponent({
  icon,
  title,
  colorClass,
  badge,
  collapsed,
  debugState,
  errorState,
  onToggleCollapse,
  onOpenDrawer,
}: McNodeHeaderProps) {
  const colorHex = NODE_COLORS[colorClass] ?? '#9a9a9a';

  return (
    <div
      className="flex items-center gap-1.5 border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2"
      style={{ height: 28 }}
    >
      {/* 左侧类别色条 */}
      <div className="h-4 w-1" style={{ backgroundColor: colorHex }} />

      {/* 图标 */}
      <McIcon scope="pixel" name={icon} size={14} className="shrink-0" />

      {/* 标题 */}
      <span className="truncate text-[10px] font-medium" style={{ color: colorHex }}>
        {title}
      </span>

      {/* 徽章 */}
      {badge && <span className="text-[10px] text-mc-text">{badge}</span>}

      {/* 调试标记 */}
      {debugState === 'debugging' && (
        <span aria-label="调试中" className="text-[10px]" style={{ color: '#22d3ee' }}>
          ●
        </span>
      )}
      {debugState === 'breakpoint' && (
        <span aria-label="断点" className="text-[10px]" style={{ color: '#c084fc' }}>
          ◆
        </span>
      )}

      {/* 错误标记 */}
      {errorState === 'error' && (
        <span aria-label="错误" className="text-[10px] text-red-500">
          ✗
        </span>
      )}
      {errorState === 'warning' && (
        <span aria-label="警告" className="text-[10px] text-yellow-400">
          ⚠
        </span>
      )}

      {/* 设置按钮 */}
      <button
        type="button"
        aria-label="设置"
        onClick={onOpenDrawer}
        className="ml-auto border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[10px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        ⚙
      </button>

      {/* 折叠按钮 */}
      <button
        type="button"
        aria-label="折叠"
        onClick={onToggleCollapse}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[10px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        {collapsed ? '▸' : '▾'}
      </button>
    </div>
  );
}

export const McNodeHeader = memo(McNodeHeaderComponent);
