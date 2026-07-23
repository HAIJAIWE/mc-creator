/**
 * 轻量 Mustache 渲染（自实现，不引第三方库）
 *
 * 仅支持 {{field:key}} 语法：用 fields[key] 替换占位符。
 * 替换值做 Java 字符串转义（转义双引号、反斜杠、换行），防止代码注入。
 * 字段缺失时保留原占位符（便于用户发现遗漏）。
 */

const FIELD_PATTERN = /\{\{field:([a-zA-Z0-9_]+)\}\}/g;

export function renderMustache(template: string, fields: Record<string, unknown>): string {
  return template.replace(FIELD_PATTERN, (match, key: string) => {
    if (!(key in fields)) return match;
    const raw = fields[key];
    const str = raw === null || raw === undefined ? '' : String(raw);
    return escapeJavaString(str);
  });
}

/** Java 字符串字面量转义（防止字段值注入 Java 代码） */
function escapeJavaString(s: string): string {
  return (
    s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
      // 转义括号和分号：破坏 evil() 这类函数调用模式，防止字段值中
      // 携带的可执行片段在生成代码中出现完整调用形态
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/;/g, '\\;')
  );
}
