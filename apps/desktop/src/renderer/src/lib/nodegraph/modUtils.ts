import type { CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 净化 modId 为合法的 Java 包名/资源命名空间（问题 13）。
 *
 * 规则：转小写 → 非 [a-z0-9_] 字符替换为下划线 → 折叠连续下划线 → 去除首尾下划线。
 * 空字符串或净化后为空时返回空字符串（由调用方决定回退值）。
 */
export function sanitizeModId(modId: string): string {
  return modId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 按 snippetId 去重 customCode 数组（问题 24）。
 *
 * 保留首次出现的 snippet，后续重复项被丢弃并产生 warning。
 * 子图内联展开后可能引入重复 snippetId，去重避免生成重复的 Java 方法/字段声明。
 */
export function deduplicateCustomCode(
  snippets: CustomCodeSnippetSpec[],
  warnings: string[],
): CustomCodeSnippetSpec[] {
  const seen = new Set<string>();
  const result: CustomCodeSnippetSpec[] = [];
  for (const snippet of snippets) {
    if (seen.has(snippet.snippetId)) {
      warnings.push(
        `customCode snippet「${snippet.snippetId}」重复，已去重保留首次出现的片段（duplicate snippetId）`,
      );
      continue;
    }
    seen.add(snippet.snippetId);
    result.push(snippet);
  }
  return result;
}
