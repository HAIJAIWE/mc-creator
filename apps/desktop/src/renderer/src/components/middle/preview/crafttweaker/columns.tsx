import { CheckSquare, Square, Trash2 } from 'lucide-react';
import type { Column } from '../../shared/index.js';
import type {
  CraftTweakerRecipeSpec,
  CraftTweakerTagSpec,
  CraftTweakerEventSpec,
  CraftTweakerTooltipSpec,
} from '@mc-creator/shared';
import {
  RECIPE_TYPE_LABEL,
  RECIPE_TYPE_COLOR,
  TAG_TYPE_LABEL,
  TAG_TYPE_COLOR,
} from './constants.js';
import type { LangRow } from './constants.js';

/** 批量选择需要的最小接口（useBatchSelection 返回值结构兼容） */
interface SelectableSet {
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
}

/** 配方列定义 */
export function createRecipeColumns(
  selection: SelectableSet,
  onRemove: (ids: string[]) => void,
): Column<CraftTweakerRecipeSpec>[] {
  return [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selection.isSelected(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'id',
      header: 'ID',
      width: '18%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${RECIPE_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {RECIPE_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    { key: 'result', header: '产物', width: '28%', sortValue: (r) => r.result },
    {
      key: 'count',
      header: '数量',
      width: '8%',
      sortValue: (r) => r.count,
      render: (r) => String(r.count),
    },
    {
      key: 'pattern',
      header: '形状/材料',
      width: '20%',
      render: (r) =>
        r.pattern
          ? `${r.pattern.length} 行`
          : r.ingredients
            ? `${r.ingredients.length} 材料`
            : r.customCode
              ? '自定义代码'
              : '—',
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];
}

/** 标签列定义 */
export function createTagColumns(): Column<CraftTweakerTagSpec>[] {
  return [
    {
      key: 'id',
      header: '标签 ID',
      width: '28%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${TAG_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {TAG_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    {
      key: 'values',
      header: '条目数',
      width: '12%',
      sortValue: (r) => r.values.length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {r.values.length}
        </span>
      ),
    },
    {
      key: 'replace',
      header: '替换模式',
      width: '14%',
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
      width: '34%',
      render: (r) => (r.values.length > 0 ? r.values.slice(0, 3).join(', ') : '—'),
    },
  ];
}

/** 事件列定义 */
export function createEventColumns(): Column<CraftTweakerEventSpec>[] {
  return [
    {
      key: 'id',
      header: '事件 ID',
      width: '18%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '事件类型',
      width: '22%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span className="rounded-mc bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
          {r.type}
        </span>
      ),
    },
    {
      key: 'target',
      header: '目标',
      width: '20%',
      sortValue: (r) => r.target,
      render: (r) => r.target || '—',
    },
    {
      key: 'handler',
      header: 'handler 预览',
      width: '40%',
      render: (r) => {
        const firstLine = r.handler.split('\n')[0] ?? '';
        return (
          <span className="font-mono text-[10px] text-mc-dim">
            {firstLine.length > 50 ? firstLine.slice(0, 50) + '…' : firstLine || '—'}
          </span>
        );
      },
    },
  ];
}

/** 工具提示列定义 */
export function createTooltipColumns(): Column<CraftTweakerTooltipSpec>[] {
  return [
    {
      key: 'itemId',
      header: '物品 ID',
      width: '32%',
      sortValue: (r) => r.itemId,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.itemId}</span>,
    },
    {
      key: 'lines',
      header: '行数',
      width: '10%',
      sortValue: (r) => r.lines.length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {r.lines.length}
        </span>
      ),
    },
    {
      key: 'advanced',
      header: '高级',
      width: '10%',
      render: (r) =>
        r.advanced ? (
          <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
            高级
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">普通</span>
        ),
    },
    {
      key: 'preview',
      header: '首行预览',
      width: '48%',
      render: (r) => (
        <span className="text-[11px] text-mc-dim">{r.lines[0]?.slice(0, 50) ?? '—'}</span>
      ),
    },
  ];
}

/** 语言列定义 */
export function createLangColumns(): Column<LangRow>[] {
  return [
    {
      key: 'lang',
      header: '语言',
      width: '12%',
      sortValue: (r) => r.lang,
      render: (r) => (
        <span className="rounded-mc bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400">
          {r.lang}
        </span>
      ),
    },
    {
      key: 'key',
      header: '键',
      width: '38%',
      sortValue: (r) => r.key,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.key}</span>,
    },
    {
      key: 'value',
      header: '值',
      width: '50%',
      render: (r) => <span className="text-[11px] text-mc-dim">{r.value}</span>,
    },
  ];
}
