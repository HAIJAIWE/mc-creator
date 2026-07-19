/**
 * 预览面板共用工具函数。
 *
 * findDuplicates：统一各面板冲突检测的 Map<string, number> 模式
 * downloadBlob：统一各面板导出功能的 Blob + URL.createObjectURL + a.click() 模式
 */

/**
 * 检测列表中重复的 key，返回重复项（出现次数 > 1）的 id 与出现次数。
 *
 * @example
 * ```ts
 * const dupes = findDuplicates(mod.items, (i) => i.id);
 * // dupes: [{ id: 'ruby', count: 2 }, { id: 'sapphire', count: 3 }]
 * ```
 */
export function findDuplicates<T>(
  items: T[],
  keyFn: (item: T) => string,
): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({ id, count }));
}

/**
 * 触发浏览器下载：将字符串内容作为 Blob 下载到本地。
 *
 * @param content 文件内容字符串
 * @param filename 下载文件名（含扩展名）
 * @param mime MIME 类型，默认 'text/plain'
 *
 * @example
 * ```ts
 * downloadBlob(JSON.stringify(spec, null, 2), 'mod-spec.json', 'application/json');
 * downloadBlob(csvText, 'items.csv', 'text/csv');
 * ```
 */
export function downloadBlob(content: string, filename: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
