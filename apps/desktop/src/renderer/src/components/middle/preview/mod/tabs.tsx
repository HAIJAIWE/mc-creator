import { useMemo } from 'react';
import { DataTable } from '../../shared/index.js';
import type { Column } from '../../shared/index.js';
import { FunctionSquare } from 'lucide-react';
import type { ModSpec } from '@mc-creator/shared';

/** 标签 Tab：按 query 过滤后以表格展示 */
export function TagsTab({ tags, query }: { tags: ModSpec['tags']; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return tags;
    const q = query.toLowerCase();
    return tags.filter(
      (t) => t.id.toLowerCase().includes(q) || t.values.some((v) => v.toLowerCase().includes(q)),
    );
  }, [tags, query]);

  const columns: Column<(typeof tags)[number]>[] = [
    { key: 'id', header: '标签 ID', width: '30%', sortValue: (r) => r.id },
    {
      key: 'values',
      header: '条目数',
      width: '10%',
      sortValue: (r) => r.values.length,
      render: (r) => String(r.values.length),
    },
    {
      key: 'replace',
      header: '替换模式',
      width: '12%',
      render: (r) =>
        r.replace ? (
          <span className="rounded-mc bg-orange-500/20 px-1.5 py-0.5 text-[10px] text-orange-400">
            替换
          </span>
        ) : (
          <span className="rounded-mc bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">
            追加
          </span>
        ),
    },
    {
      key: 'preview',
      header: '前 3 个条目',
      width: '48%',
      render: (r) => (r.values.length > 0 ? r.values.slice(0, 3).join(', ') : '—'),
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无标签" />;
}

/** 函数 Tab：按 query 过滤后以卡片列表展示命令 */
export function FunctionsTab({
  functions,
  query,
}: {
  functions: ModSpec['functions'];
  query: string;
}) {
  const filtered = useMemo(() => {
    if (!query) return functions;
    const q = query.toLowerCase();
    return functions.filter(
      (f) => f.id.toLowerCase().includes(q) || f.commands.some((c) => c.toLowerCase().includes(q)),
    );
  }, [functions, query]);

  if (filtered.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无函数</div>;
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {filtered.map((f) => (
        <div key={f.id} className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1 flex items-center gap-2">
            <FunctionSquare className="h-3 w-3 text-mc-accent" />
            <span className="font-mono text-xs font-medium text-mc-text">{f.id}</span>
            <span className="text-[10px] text-mc-mute">· {f.commands.length} 行命令</span>
          </div>
          <pre className="max-h-32 overflow-auto rounded-mc bg-mc-bg p-2 text-[10px] text-mc-dim whitespace-pre-wrap">
            {f.commands.join('\n')}
          </pre>
        </div>
      ))}
    </div>
  );
}
