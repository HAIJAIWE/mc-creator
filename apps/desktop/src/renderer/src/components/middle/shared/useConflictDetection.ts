import { useMemo } from 'react';

/**
 * 一组冲突检测定义：key 为结果字段名，label 为展示名称，detect 执行实际检测。
 * 通常定义为模块级常量以保持引用稳定。
 */
export interface ConflictGroup<S> {
  /** 检测结果字段名，如 'duplicateItemIds' */
  key: string;
  /** 冲突类型的展示名称，如 '物品 ID 重复' */
  label: string;
  /** 执行重复检测，返回 findDuplicates 的结果 */
  detect: (spec: S) => { id: string; count: number }[];
}

export interface ConflictDetection {
  /** 按 key 分组的检测结果（spec 为 null 时各字段为空数组） */
  conflicts: Record<string, { id: string; count: number }[]>;
  /** 总冲突数（各组计数之和） */
  totalConflicts: number;
  /** 供 ConflictAlert 直接使用的 { label, count }[] */
  conflictList: { label: string; count: number }[];
}

/**
 * 统一 5 个预览面板（Mod/BehaviorPack/CraftTweaker/Kubejs/ResourcePack）的
 * 冲突检测配线：`conflicts useMemo(findDuplicates...) → totalConflicts 求和 → ConflictAlert`。
 *
 * @example
 * ```tsx
 * const MOD_CONFLICT_GROUPS: ConflictGroup<ModSpec>[] = [
 *   { key: 'duplicateItemIds', label: '物品 ID 重复', detect: (m) => findDuplicates(m.items, (i) => i.id) },
 *   { key: 'duplicateBlockIds', label: '方块 ID 重复', detect: (m) => findDuplicates(m.blocks, (b) => b.id) },
 * ];
 * const { conflicts, totalConflicts, conflictList } = useConflictDetection(mod, MOD_CONFLICT_GROUPS);
 * <ConflictAlert totalConflicts={totalConflicts} conflicts={conflictList} />
 * ```
 */
export function useConflictDetection<S>(
  spec: S | null,
  groups: ReadonlyArray<ConflictGroup<S>>,
): ConflictDetection {
  return useMemo(() => {
    const conflicts: Record<string, { id: string; count: number }[]> = {};
    for (const g of groups) conflicts[g.key] = [];
    if (spec) {
      for (const g of groups) {
        conflicts[g.key] = g.detect(spec);
      }
    }
    const totalConflicts = groups.reduce((sum, g) => sum + conflicts[g.key].length, 0);
    return {
      conflicts,
      totalConflicts,
      conflictList: groups.map((g) => ({ label: g.label, count: conflicts[g.key].length })),
    };
  }, [spec, groups]);
}
