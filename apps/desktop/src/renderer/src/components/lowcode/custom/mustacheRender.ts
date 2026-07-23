/**
 * 轻量 Mustache 渲染（自实现，不引第三方库）
 *
 * 仅支持 {{field:key}} 语法：用 fields[key] 替换占位符。
 * 替换值做 Java 字符串转义（转义双引号、反斜杠、换行），防止代码注入。
 * 字段缺失时保留原占位符（便于用户发现遗漏）。
 */

import { escapeJavaStringLiteral } from '../../../lib/javaEscape.js';

const FIELD_PATTERN = /\{\{field:([a-zA-Z0-9_]+)\}\}/g;

export function renderMustache(template: string, fields: Record<string, unknown>): string {
  return template.replace(FIELD_PATTERN, (match, key: string) => {
    if (!(key in fields)) return match;
    const raw = fields[key];
    const str = raw === null || raw === undefined ? '' : String(raw);
    return escapeJavaStringLiteral(str);
  });
}

// 转义实现见 `lib/javaEscape.ts`（与 compileVariable 共享同一实现，避免重复定义）。
