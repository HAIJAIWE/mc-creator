/**
 * 轻量 Mustache 渲染（自实现，不引第三方库）
 *
 * P0-2 升级：在原有 {{field:key}} 基础上新增块级语法
 * - {{#if key}}...{{else}}...{{/if}}：条件分支（按 truthy 判断）
 * - {{#each array}}...{{/each}}：数组遍历
 * - {{this}}：循环内引用当前项
 * - {{this.field}}：循环内访问当前项子字段
 *
 * 安全性：
 * - 所有插值（field / this / thisField）都经 escapeJavaStringLiteral 转义，
 *   防止用户输入闭合字符串字面量造成代码注入。
 * - 块语法（#if/#each/else/endif/endeach）必须正确闭合；未闭合时保留起始标签原文（容错）。
 * - 字段缺失时保留原占位符，便于用户发现遗漏。
 *
 * 对标 MCreator 的 FreeMarker 模板：本实现覆盖最常用的条件/循环/插值三类，
 * 复杂特性（宏、继承、@last 等）暂不支持，未识别的标签原样保留。
 */

import { escapeJavaStringLiteral } from '../../../lib/javaEscape.js';

// ============================================================
// Tokenizer
// ============================================================

const TOKEN_PATTERN = /\{\{[^{}]+\}\}/g;

type Token =
  | { type: 'text'; value: string }
  | { type: 'field'; key: string; raw: string }
  | { type: 'this'; raw: string }
  | { type: 'thisField'; key: string; raw: string }
  | { type: 'if'; key: string; raw: string }
  | { type: 'each'; key: string; raw: string }
  | { type: 'else'; raw: string }
  | { type: 'endif'; raw: string }
  | { type: 'endeach'; raw: string }
  | { type: 'unknown'; raw: string };

function tokenize(template: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  const re = new RegExp(TOKEN_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const tag = raw.slice(2, -2).trim(); // strip {{ }} + trim
    if (tag.startsWith('#if ')) {
      tokens.push({ type: 'if', key: tag.slice(4).trim(), raw });
    } else if (tag.startsWith('#each ')) {
      tokens.push({ type: 'each', key: tag.slice(6).trim(), raw });
    } else if (tag === 'else') {
      tokens.push({ type: 'else', raw });
    } else if (tag === '/if') {
      tokens.push({ type: 'endif', raw });
    } else if (tag === '/each') {
      tokens.push({ type: 'endeach', raw });
    } else if (tag === 'this') {
      tokens.push({ type: 'this', raw });
    } else if (tag.startsWith('this.')) {
      tokens.push({ type: 'thisField', key: tag.slice(5).trim(), raw });
    } else if (tag.startsWith('field:')) {
      tokens.push({ type: 'field', key: tag.slice(6).trim(), raw });
    } else {
      // 未识别的标签（如 {{#unless @last}}、{{@last}} 等），原样保留
      tokens.push({ type: 'unknown', raw });
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < template.length) {
    tokens.push({ type: 'text', value: template.slice(lastIndex) });
  }
  return tokens;
}

// ============================================================
// 渲染辅助
// ============================================================

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return Boolean(v);
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * 寻找块起始 token 的匹配闭合 token 索引（支持嵌套同类块）。
 * 返回 { closeIndex, elseIndex }：
 * - closeIndex：闭合 token 索引（未闭合返回 -1）
 * - elseIndex：else token 索引（仅 if 块有效，无 else 返回 -1）
 */
function findBlockEnd(
  tokens: Token[],
  startIdx: number,
  blockType: 'if' | 'each',
): { closeIndex: number; elseIndex: number } {
  const closeType = blockType === 'if' ? 'endif' : 'endeach';
  let depth = 1;
  let elseIdx = -1;
  for (let j = startIdx + 1; j < tokens.length; j++) {
    const t = tokens[j]!;
    if (t.type === blockType) {
      depth++;
    } else if (t.type === closeType) {
      depth--;
      if (depth === 0) {
        return { closeIndex: j, elseIndex: elseIdx };
      }
    } else if (t.type === 'else' && blockType === 'if' && depth === 1 && elseIdx === -1) {
      elseIdx = j;
    }
  }
  return { closeIndex: -1, elseIndex: -1 };
}

// ============================================================
// 渲染主循环
// ============================================================

function renderTokens(
  tokens: Token[],
  fields: Record<string, unknown>,
  currentThis: unknown,
): string {
  let result = '';
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    switch (tok.type) {
      case 'text':
        result += tok.value;
        i++;
        break;
      case 'field': {
        if (!(tok.key in fields)) {
          result += tok.raw; // 字段缺失保留原占位符
        } else {
          result += escapeJavaStringLiteral(renderValue(fields[tok.key]));
        }
        i++;
        break;
      }
      case 'this': {
        result += escapeJavaStringLiteral(renderValue(currentThis));
        i++;
        break;
      }
      case 'thisField': {
        const obj =
          currentThis !== null && typeof currentThis === 'object'
            ? (currentThis as Record<string, unknown>)
            : null;
        if (obj && tok.key in obj) {
          result += escapeJavaStringLiteral(renderValue(obj[tok.key]));
        } else {
          result += tok.raw; // 子字段缺失保留原占位符
        }
        i++;
        break;
      }
      case 'if':
      case 'each': {
        const { closeIndex, elseIndex } = findBlockEnd(tokens, i, tok.type);
        if (closeIndex === -1) {
          // 未闭合，保留起始标签原文，继续渲染后续 token（容错）
          result += tok.raw;
          i++;
          break;
        }
        const bodyTokens =
          elseIndex === -1 ? tokens.slice(i + 1, closeIndex) : tokens.slice(i + 1, elseIndex);
        const elseTokens = elseIndex === -1 ? [] : tokens.slice(elseIndex + 1, closeIndex);

        if (tok.type === 'if') {
          // 作用域链：循环内时优先从 currentThis 取值，外层 fields 作为 fallback
          // 这与 Mustache 标准行为一致，使 {{#if active}} 在 {{#each}} 内可访问当前项字段
          const thisObj =
            currentThis !== null && typeof currentThis === 'object'
              ? (currentThis as Record<string, unknown>)
              : null;
          let condVal: unknown;
          if (thisObj && tok.key in thisObj) {
            condVal = thisObj[tok.key];
          } else if (tok.key in fields) {
            condVal = fields[tok.key];
          } else {
            condVal = undefined;
          }
          if (isTruthy(condVal)) {
            result += renderTokens(bodyTokens, fields, currentThis);
          } else {
            result += renderTokens(elseTokens, fields, currentThis);
          }
        } else {
          // each：取值与 if 一致走作用域链（嵌套 each 内优先当前项，外层 fields 兜底）
          const thisObj =
            currentThis !== null && typeof currentThis === 'object'
              ? (currentThis as Record<string, unknown>)
              : null;
          const arr =
            thisObj && tok.key in thisObj
              ? thisObj[tok.key]
              : tok.key in fields
                ? fields[tok.key]
                : undefined;
          let items: unknown[] = [];
          if (Array.isArray(arr)) {
            items = arr;
          } else if (arr !== null && arr !== undefined) {
            // 非数组视为单元素遍历
            items = [arr];
          }
          for (const item of items) {
            result += renderTokens(bodyTokens, fields, item);
          }
        }
        i = closeIndex + 1; // 跳过闭合标签
        break;
      }
      case 'else':
      case 'endif':
      case 'endeach':
      case 'unknown':
        // 孤立的闭合标签/else/未识别标签：原样保留
        result += tok.raw;
        i++;
        break;
    }
  }
  return result;
}

export function renderMustache(template: string, fields: Record<string, unknown>): string {
  const tokens = tokenize(template);
  return renderTokens(tokens, fields, undefined);
}
