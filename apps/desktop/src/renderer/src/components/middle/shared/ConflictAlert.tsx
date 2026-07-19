import { AlertTriangle } from 'lucide-react';

export interface ConflictItem {
  /** 完整文案标签，如 "物品 ID 重复"、"依赖重复" */
  label: string;
  count: number;
}

export interface ConflictAlertProps {
  /** 冲突总数；<= 0 时不渲染 */
  totalConflicts: number;
  /** 各类冲突明细；组件内部按 count > 0 过滤 */
  conflicts: ConflictItem[];
}

/**
 * 冲突检测告警条：黄色背景 + AlertTriangle 图标 + "检测到 N 处冲突：..." 文案。
 * 6 个预览面板（Mod/BehaviorPack/CraftTweaker/Kubejs/ResourcePack/Modpack）共用。
 *
 * 渲染规则：
 * - totalConflicts <= 0 时返回 null
 * - conflicts 按 count > 0 过滤
 * - 第一项前导一个空格，后续项前导 " · "（与原各面板内联实现一致）
 */
export function ConflictAlert({ totalConflicts, conflicts }: ConflictAlertProps) {
  if (totalConflicts <= 0) return null;
  const active = conflicts.filter((c) => c.count > 0);
  return (
    <div className="flex items-start gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
      <div className="text-[11px] text-yellow-300">
        检测到 <strong>{totalConflicts}</strong> 处冲突：
        {active.map((c, i) => (
          <span key={c.label}>
            {i === 0 ? ' ' : ' · '}
            {c.label} {c.count} 处
          </span>
        ))}
      </div>
    </div>
  );
}
