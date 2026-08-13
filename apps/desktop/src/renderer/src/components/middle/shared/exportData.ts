/**
 * 预览面板导出序列化层。
 *
 * 5 个面板（Mod/BehaviorPack/CraftTweaker/Kubejs/ResourcePack)的 exportData
 * 骨架完全一致：`scope 解析 → json | csv | md → downloadBlob`。
 * 本模块抽取该骨架，各面板以 ExportHandler 配置声明每个 scope 的序列化方式。
 *
 * 行为约定（与原内联实现逐字节一致）：
 * - json：整个 scope 数据 JSON.stringify(data, null, 2)
 * - csv：scope.toCsv 优先；没有时（如 'all'）fallback 到 JSON
 * - markdown：scope.toMd 优先；没有时 fallback 到 JSON
 * - 文件名：`${prefix}-${scopeKey}.${ext}`，ext 为 json / csv / md
 */

import type { ExportFormat } from './ExportView.js';

export type { ExportFormat };

export interface ExportScope<S> {
  /** 该 scope 的 JSON 数据源（'all' 时通常是整个 spec） */
  data: (spec: S) => unknown;
  /** CSV 序列化；省略时 fallback 到 JSON */
  toCsv?: (spec: S) => string;
  /** Markdown 序列化；省略时 fallback 到 JSON */
  toMd?: (spec: S) => string;
}

export interface ExportHandler<S> {
  /** 文件名前缀（modId / packId / namespace 等） */
  prefix: (spec: S) => string;
  /** scope key → 序列化配置 */
  scopes: Record<string, ExportScope<S>>;
}

/**
 * 按 scope + format 构建导出内容与文件名。scope 未注册时返回 null。
 */
export function buildExport<S>(
  spec: S,
  handler: ExportHandler<S>,
  format: ExportFormat,
  scopeKey: string,
): { content: string; filename: string } | null {
  const scope = handler.scopes[scopeKey];
  if (!scope) return null;
  const data = scope.data(spec);
  let content: string;
  if (format === 'json') {
    content = JSON.stringify(data, null, 2);
  } else if (format === 'csv') {
    content = scope.toCsv ? scope.toCsv(spec) : JSON.stringify(data, null, 2);
  } else {
    content = scope.toMd ? scope.toMd(spec) : JSON.stringify(data, null, 2);
  }
  const ext = format === 'markdown' ? 'md' : format;
  return { content, filename: `${handler.prefix(spec)}-${scopeKey}.${ext}` };
}

/**
 * 生成一个 Markdown 表格（单 scope 列表导出）。
 * 输出形如：
 * ```
 * # 标题
 *
 * 共 N 个条目
 *
 * | A | B |
 * |---|---|
 * | v1 | v2 |
 * ```
 */
export function toMdTable(
  title: string,
  countLine: string,
  headers: string[],
  rows: string[][],
): string {
  const lines: string[] = [title, '', countLine, ''];
  lines.push(`| ${headers.join(' | ')} |`);
  lines.push(`|${headers.map(() => '---').join('|')}|`);
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

/**
 * 生成一个 Markdown 概述（'all' scope 导出）：标题 + 元信息 + 若干小节。
 * 小节之间以空行分隔，末尾不带多余空行。
 */
export function toMdOverview(
  title: string,
  meta: string[],
  sections: { heading: string; lines: string[] }[],
): string {
  const lines: string[] = [title, '', ...meta, ''];
  sections.forEach((s, i) => {
    lines.push(`## ${s.heading}`, '');
    lines.push(...s.lines);
    if (i < sections.length - 1) lines.push('');
  });
  return lines.join('\n');
}
