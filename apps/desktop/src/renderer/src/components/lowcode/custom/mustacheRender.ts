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

/**
 * Java 字符串字面量转义（防止字段值注入 Java 代码）。
 *
 * 仅转义 Java 规范定义的合法转义序列：`\`、`"`、换行、回车、Tab。
 * 不转义 `(`、`)`、`;` —— 这些字符在 Java 字符串字面量内是普通字符，
 * 加反斜杠转义反而会生成非法 Java 转义序列 `\( \) \;` 导致编译失败。
 *
 * 安全性来源：`"` 被转义为 `\"` 后，字段值无法闭合外层字符串字面量，
 * 所有内容（包括 `evil()` 这类片段）都被视为字符串数据而非可执行代码。
 * 反斜杠必须先于引号转义，否则 `\"` 会被错误地变成 `\\"` （转义反斜杠 + 关闭引号）。
 */
function escapeJavaString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
