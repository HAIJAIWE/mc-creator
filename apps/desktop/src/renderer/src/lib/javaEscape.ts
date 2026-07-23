/**
 * Java 字符串字面量转义共享工具。
 *
 * 此前在 `lib/compileVariable.ts`（仅转义 `\` `"`）和
 * `components/lowcode/custom/mustacheRender.ts`（转义 `\` `"` `\n` `\r` `\t`）中重复实现。
 * 现统一为 Java 规范定义的合法转义序列：反斜杠、双引号、换行、回车、Tab。
 *
 * 安全性：
 * - `"` 被转义为 `\"` 后，字段值无法闭合外层字符串字面量，所有内容都被视为字符串数据而非可执行代码。
 * - 反斜杠必须先于引号转义，否则 `\"` 会被错误地变成 `\\` （转义反斜杠 + 关闭引号）。
 * - 不转义 `(` `)` `;` —— 这些字符在 Java 字符串字面量内是普通字符，
 *   加反斜杠转义反而会生成非法 Java 转义序列 `\( \) \;` 导致编译失败。
 */

/** Java 字符串字面量转义：先转义反斜杠再转义引号 + 换行/回车/Tab */
export function escapeJavaStringLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
