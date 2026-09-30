/** Task 1.1：未实现清单导出（UNIMPLEMENTED.md）内容构建，与 ModPreviewPanel 横幅同源。 */

export interface UnimplementedEntry {
  kind: string;
  type: string;
  id: string;
  reason: string;
}

/** 有条目时返回 UNIMPLEMENTED.md 文本，无条目时返回 null（调用方决定是否附加）。 */
export function buildUnimplementedMd(items: UnimplementedEntry[]): string | null {
  if (items.length === 0) return null;
  const lines = [
    '# UNIMPLEMENTED — 未自动生成的内容清单',
    '',
    `共 ${items.length} 项。产物中对应位置有 \`// MC-Creator: unsupported(...)\` 安全占位注释，`,
    '项目可正常编译，但以下语义需要你按说明补齐。详见 docs/unsupported.md。',
    '',
    ...items.map(
      (u, i) =>
        `## ${i + 1}. ${u.kind} = ${u.type}${u.id ? `（id=${u.id}）` : ''}\n\n${u.reason}\n`,
    ),
  ];
  return lines.join('\n');
}

/** 导出文件列表附加 UNIMPLEMENTED.md（有条目时），供 exportZip 调用点复用。 */
export function withUnimplementedMd(
  files: { path: string; content: string }[],
  items: UnimplementedEntry[],
): { path: string; content: string }[] {
  const md = buildUnimplementedMd(items);
  if (!md) return files;
  if (files.some((f) => f.path === 'UNIMPLEMENTED.md')) return files;
  return [...files, { path: 'UNIMPLEMENTED.md', content: md }];
}
