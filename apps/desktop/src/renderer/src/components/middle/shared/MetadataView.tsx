/**
 * 元数据视图：以双列表格展示 spec 的元数据字段。
 *
 * 各预览面板的 MetadataTab/MetadataView 仅 rows 数组内容不同，
 * 表格结构完全一致，提取为共用组件后调用方只需准备 rows。
 */

export interface MetadataRow {
  label: string;
  value: string;
}

export interface MetadataViewProps {
  rows: MetadataRow[];
  /** 容器 padding，默认 'p-4' */
  className?: string;
}

/** 元数据表格视图 */
export function MetadataView({ rows, className = 'p-4' }: MetadataViewProps) {
  return (
    <div className={className}>
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-mc-border/60">
              <td className="w-32 px-2 py-1.5 font-medium text-mc-dim">{r.label}</td>
              <td className="px-2 py-1.5 text-mc-text">{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
