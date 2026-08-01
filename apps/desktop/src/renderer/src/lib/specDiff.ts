/**
 * Spec 版本差异对比工具：递归比较两个对象,输出字段级差异列表。
 * 用于 Spec 历史版本对比（Task 5）。
 */

export interface SpecDiffEntry {
  /** 字段路径（如 'items[0].maxStackSize'） */
  path: string;
  /** 旧值（undefined = 新增） */
  oldValue: unknown;
  /** 新值（undefined = 删除） */
  newValue: unknown;
  /** 变化类型 */
  kind: 'added' | 'removed' | 'changed';
}

/**
 * 递归 diff 两个 JSON 值。
 * - 对象：逐键比较
 * - 数组：按索引比较（简单方案，不做 LCS）
 * - 值不同 → changed
 */
export function diffSpecValues(
  oldVal: unknown,
  newVal: unknown,
  path = '',
  depth = 0,
  maxDepth = 8,
): SpecDiffEntry[] {
  const entries: SpecDiffEntry[] = [];
  if (depth > maxDepth) return entries;

  // 类型不同或基本类型不同 → changed
  if (
    oldVal === null ||
    newVal === null ||
    typeof oldVal !== 'object' ||
    typeof newVal !== 'object'
  ) {
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      entries.push({ path: path || '(root)', oldValue: oldVal, newValue: newVal, kind: 'changed' });
    }
    return entries;
  }

  if (Array.isArray(oldVal) && Array.isArray(newVal)) {
    const maxLen = Math.max(oldVal.length, newVal.length);
    for (let i = 0; i < maxLen; i++) {
      const p = `${path}[${i}]`;
      if (i >= oldVal.length) {
        entries.push({ path: p, oldValue: undefined, newValue: newVal[i], kind: 'added' });
      } else if (i >= newVal.length) {
        entries.push({ path: p, oldValue: oldVal[i], newValue: undefined, kind: 'removed' });
      } else {
        entries.push(...diffSpecValues(oldVal[i], newVal[i], p, depth + 1, maxDepth));
      }
    }
    return entries;
  }

  // 对象：合并键集合
  const oldObj = oldVal as Record<string, unknown>;
  const newObj = newVal as Record<string, unknown>;
  const keys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
  for (const key of keys) {
    const p = path ? `${path}.${key}` : key;
    if (!(key in oldObj)) {
      entries.push({ path: p, oldValue: undefined, newValue: newObj[key], kind: 'added' });
    } else if (!(key in newObj)) {
      entries.push({ path: p, oldValue: oldObj[key], newValue: undefined, kind: 'removed' });
    } else {
      entries.push(...diffSpecValues(oldObj[key], newObj[key], p, depth + 1, maxDepth));
    }
  }
  return entries;
}

/** 汇总统计：按 kind 计数 */
export function summarizeDiff(entries: SpecDiffEntry[]): {
  added: number;
  removed: number;
  changed: number;
} {
  return {
    added: entries.filter((e) => e.kind === 'added').length,
    removed: entries.filter((e) => e.kind === 'removed').length,
    changed: entries.filter((e) => e.kind === 'changed').length,
  };
}

/** 格式化值用于展示（截断长字符串） */
export function formatDiffValue(value: unknown): string {
  if (value === undefined) return '<缺失>';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    const s = JSON.stringify(value);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  }
  const s = String(value);
  return s.length > 120 ? s.slice(0, 120) + '…' : s;
}
