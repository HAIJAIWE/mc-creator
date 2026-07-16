import { useState, useMemo } from 'react';

/** 列定义 */
export interface Column<T> {
  key: keyof T | string;
  header: string;
  width?: string;
  /** 单元格渲染（默认显示原始值） */
  render?: (row: T) => React.ReactNode;
  /** 排序函数（不提供则不可排序） */
  sortValue?: (row: T) => string | number;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  emptyHint?: string;
}

/** 通用表格：支持列头排序，无分页（数据量小） */
export function DataTable<T>({ columns, data, rowKey, emptyHint = '暂无数据' }: DataTableProps<T>) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = useMemo(() => {
    if (sortCol === null) return data;
    const col = columns[sortCol];
    if (!col?.sortValue) return data;
    const fn = col.sortValue;
    return [...data].sort((a, b) => {
      const va = fn(a);
      const vb = fn(b);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, columns, sortCol, sortDir]);

  const toggleSort = (idx: number) => {
    const col = columns[idx];
    if (!col?.sortValue) return;
    if (sortCol === idx) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(idx);
      setSortDir('asc');
    }
  };

  if (data.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">{emptyHint}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-mc-border bg-mc-surface-2/60">
            {columns.map((col, idx) => (
              <th
                key={String(col.key)}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => toggleSort(idx)}
                className={`px-2 py-1.5 text-left font-medium text-mc-dim ${
                  col.sortValue ? 'cursor-pointer hover:text-mc-text' : ''
                }`}
              >
                {col.header}
                {sortCol === idx && (
                  <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              className="border-b border-mc-border/60 hover:bg-mc-surface-2/40"
            >
              {columns.map((col) => (
                <td key={String(col.key)} className="px-2 py-1.5 text-mc-text">
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key as string] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
