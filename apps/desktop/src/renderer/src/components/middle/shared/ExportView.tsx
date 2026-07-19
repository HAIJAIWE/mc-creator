import type { ReactNode } from 'react';
import { Download } from 'lucide-react';

export type ExportFormat = 'json' | 'csv' | 'markdown';

export interface ExportSection<S extends string> {
  /** 导出作用域，如 'all' | 'items' | 'blocks'；'all' 默认不显示 CSV 按钮 */
  scope: S;
  /** 区块标题，如 "完整 Spec"、"物品列表" */
  label: string;
  /** 条目数；scope !== 'all' 时显示在标题后 */
  count?: number;
  /** 覆盖默认格式列表；不传则按 scope==='all' 决定 */
  formats?: ExportFormat[];
}

export interface ExportViewProps<S extends string> {
  /** 主标题，如 "导出 Mod 数据" */
  title: string;
  /** 描述文字 */
  description: string;
  /** 导出区块列表 */
  sections: ExportSection<S>[];
  /** 导出回调 */
  onExport: (format: ExportFormat, scope: S) => void;
  /** 统计区标题，默认 "统计" */
  statsTitle?: string;
  /** 统计区内容（通常是 StatCard 网格）；不传则不渲染统计区 */
  stats?: ReactNode;
}

const DEFAULT_FORMATS_ALL: ExportFormat[] = ['json', 'markdown'];
const DEFAULT_FORMATS_NON_ALL: ExportFormat[] = ['json', 'csv', 'markdown'];

const FORMAT_LABEL: Record<ExportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  markdown: 'Markdown',
};

/**
 * 导出视图：标题 + 描述 + 区块列表（每块含 JSON/CSV/Markdown 按钮）+ 可选统计区。
 *
 * 5 个预览面板（Mod/BehaviorPack/CraftTweaker/Kubejs/ResourcePack）共用。
 * ModpackPreviewPanel 的导出结构差异大（无 sections 概念），保留内联实现。
 *
 * 默认行为：
 * - scope === 'all' 的区块只显示 JSON + Markdown 按钮（还原 Mod/BehaviorPack 原行为）
 * - 其他 scope 显示 JSON + CSV + Markdown 按钮
 * - 调用方可通过 section.formats 覆盖默认格式
 */
export function ExportView<S extends string>({
  title,
  description,
  sections,
  onExport,
  statsTitle = '统计',
  stats,
}: ExportViewProps<S>) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-mc-text">
          <Download className="h-4 w-4 text-mc-accent" />
          {title}
        </h3>
        <p className="mb-3 text-xs text-mc-mute">{description}</p>

        {sections.map((section) => {
          const formats =
            section.formats ??
            (section.scope === 'all' ? DEFAULT_FORMATS_ALL : DEFAULT_FORMATS_NON_ALL);
          return (
            <div
              key={section.scope}
              className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2"
            >
              <div className="mb-1.5 text-[11px] font-medium text-mc-dim">
                {section.label}
                {section.scope !== 'all' && section.count !== undefined && ` (${section.count})`}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {formats.map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => onExport(fmt, section.scope)}
                    className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
                  >
                    <Download className="h-3 w-3" /> {FORMAT_LABEL[fmt]}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {stats && (
        <div className="border-t border-mc-border pt-4">
          <h3 className="mb-2 text-sm font-medium text-mc-text">{statsTitle}</h3>
          {stats}
        </div>
      )}
    </div>
  );
}
