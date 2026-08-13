import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import {
  DataTable,
  PanelHeader,
  EmptyState,
  StatCard,
  StatCardGrid,
  MetadataView,
  ConflictAlert,
  ExportView,
  FilterBar,
  IconTabBar,
  BatchSelectToolbar,
  findDuplicates,
  downloadBlob,
  useBatchSelection,
  useTabCounts,
} from './shared/index.js';
import type { Column, TabItem } from './shared/index.js';
import type {
  CraftTweakerSpec,
  CraftTweakerRecipeSpec,
  CraftTweakerTagSpec,
  CraftTweakerEventSpec,
  CraftTweakerTooltipSpec,
} from '@mc-creator/shared';
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  FileText,
  Boxes,
  Tag,
  Flag,
  Languages,
  BookOpen,
} from 'lucide-react';

type CraftTweakerTab = 'recipes' | 'tags' | 'events' | 'tooltips' | 'lang' | 'metadata' | 'export';

type RecipeTypeFilter = 'all' | 'shaped' | 'shapeless' | 'smelting' | 'stonecutting' | 'custom';
type TagTypeFilter = 'all' | 'item' | 'block' | 'entity_type' | 'fluid';

const TABS: { key: CraftTweakerTab; label: string; icon: typeof Boxes }[] = [
  { key: 'recipes', label: '配方', icon: Boxes },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'events', label: '事件', icon: Flag },
  { key: 'tooltips', label: '工具提示', icon: BookOpen },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<CraftTweakerTab>(['metadata', 'export']);

const RECIPE_TYPE_LABEL: Record<string, string> = {
  shaped: '有序合成',
  shapeless: '无序合成',
  smelting: '熔炼',
  stonecutting: '切石',
  custom: '自定义',
};

const RECIPE_TYPE_COLOR: Record<string, string> = {
  shaped: 'bg-blue-500/20 text-blue-400',
  shapeless: 'bg-green-500/20 text-green-400',
  smelting: 'bg-orange-500/20 text-orange-400',
  stonecutting: 'bg-yellow-500/20 text-yellow-400',
  custom: 'bg-purple-500/20 text-purple-400',
};

const TAG_TYPE_LABEL: Record<string, string> = {
  item: '物品',
  block: '方块',
  entity_type: '实体',
  fluid: '流体',
};

const TAG_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  entity_type: 'bg-orange-500/20 text-orange-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
};

interface LangRow {
  lang: string;
  key: string;
  value: string;
}

/** CraftTweaker 预览面板：7 Tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + ID 重复检测 */
export function CraftTweakerPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<CraftTweakerTab>('recipes');
  const [query, setQuery] = useState('');
  const [recipeTypeFilter, setRecipeTypeFilter] = useState<RecipeTypeFilter>('all');
  const [tagTypeFilter, setTagTypeFilter] = useState<TagTypeFilter>('all');
  const recipeSelection = useBatchSelection<string>();

  const ct = spec as unknown as CraftTweakerSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!ct) {
      return {
        recipes: 0,
        tags: 0,
        events: 0,
        tooltips: 0,
        langCount: 0,
        langEntries: 0,
        advancedTooltips: 0,
        replaceTags: 0,
        customRecipes: 0,
      };
    }
    const langEntries = Object.values(ct.lang ?? {}).reduce(
      (sum, dict) => sum + Object.keys(dict).length,
      0,
    );
    return {
      recipes: ct.recipes.length,
      tags: ct.tags.length,
      events: ct.events.length,
      tooltips: ct.tooltips.length,
      langCount: Object.keys(ct.lang ?? {}).length,
      langEntries,
      advancedTooltips: ct.tooltips.filter((t) => t.advanced).length,
      replaceTags: ct.tags.filter((t) => t.replace).length,
      customRecipes: ct.recipes.filter((r) => r.type === 'custom').length,
    };
  }, [ct]);

  // ===== 配方类型分布 =====
  const recipeTypeStats = useMemo(() => {
    if (!ct) return { shaped: 0, shapeless: 0, smelting: 0, stonecutting: 0, custom: 0 };
    const dist = { shaped: 0, shapeless: 0, smelting: 0, stonecutting: 0, custom: 0 };
    for (const r of ct.recipes) {
      dist[r.type as keyof typeof dist]++;
    }
    return dist;
  }, [ct]);

  // ===== ID 重复检测 =====
  const conflicts = useMemo(() => {
    if (!ct)
      return {
        duplicateRecipeIds: [],
        duplicateTagIds: [],
        duplicateEventIds: [],
        duplicateTooltipIds: [],
      };
    return {
      duplicateRecipeIds: findDuplicates(ct.recipes, (r) => r.id),
      duplicateTagIds: findDuplicates(ct.tags, (t) => t.id),
      duplicateEventIds: findDuplicates(ct.events, (e) => e.id),
      duplicateTooltipIds: findDuplicates(ct.tooltips, (t) => t.itemId),
    };
  }, [ct]);

  const totalConflicts =
    conflicts.duplicateRecipeIds.length +
    conflicts.duplicateTagIds.length +
    conflicts.duplicateEventIds.length +
    conflicts.duplicateTooltipIds.length;

  // ===== 配方筛选 =====
  const filteredRecipes = useMemo(() => {
    if (!ct) return [];
    let result = ct.recipes;
    if (recipeTypeFilter !== 'all') {
      result = result.filter((r) => r.type === recipeTypeFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (r) => r.id.toLowerCase().includes(q) || r.result.toLowerCase().includes(q),
      );
    }
    return result;
  }, [ct, query, recipeTypeFilter]);

  // ===== 标签筛选 =====
  const filteredTags = useMemo(() => {
    if (!ct) return [];
    let result = ct.tags;
    if (tagTypeFilter !== 'all') {
      result = result.filter((t) => t.type === tagTypeFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (t) => t.id.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
      );
    }
    return result;
  }, [ct, query, tagTypeFilter]);

  // ===== 事件筛选 =====
  const filteredEvents = useMemo(() => {
    if (!ct) return [];
    if (!query) return ct.events;
    const q = query.toLowerCase();
    return ct.events.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q),
    );
  }, [ct, query]);

  // ===== 工具提示筛选 =====
  const filteredTooltips = useMemo(() => {
    if (!ct) return [];
    if (!query) return ct.tooltips;
    const q = query.toLowerCase();
    return ct.tooltips.filter((t) => t.itemId.toLowerCase().includes(q));
  }, [ct, query]);

  // ===== 语言条目展开为行 =====
  const langRows = useMemo<LangRow[]>(() => {
    if (!ct?.lang) return [];
    const rows: LangRow[] = [];
    for (const [langCode, dict] of Object.entries(ct.lang)) {
      for (const [key, value] of Object.entries(dict)) {
        rows.push({ lang: langCode, key, value });
      }
    }
    return rows;
  }, [ct]);

  // ===== 元数据行（供 MetadataView 渲染）=====
  const metadataRows = useMemo(() => {
    if (!ct) return [];
    return [
      { label: 'Pack ID', value: ct.packId },
      { label: 'Pack Name', value: ct.packName },
      { label: '描述', value: ct.description || '—' },
      { label: 'packFormat', value: String(ct.packFormat) },
      { label: 'MC 版本', value: ct.mcVersion || '—' },
      {
        label: '语言列表',
        value: Object.keys(ct.lang ?? {}).join(', ') || '—',
      },
    ];
  }, [ct]);

  const filteredLangRows = useMemo(() => {
    if (!query) return langRows;
    const q = query.toLowerCase();
    return langRows.filter(
      (r) =>
        r.lang.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q) ||
        r.value.toLowerCase().includes(q),
    );
  }, [langRows, query]);

  // ===== 批量选择操作 =====
  const removeRecipes = useCallback(
    (ids: string[]) => {
      if (!ct) return;
      const idSet = new Set(ids);
      const updated = {
        ...ct,
        recipes: ct.recipes.filter((r) => !idSet.has(r.id)),
      };
      setSpec(updated as unknown as typeof spec);
      recipeSelection.clear();
    },
    [ct, setSpec],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(
    TABS,
    ct,
    (spec, tab) => countByTab(spec, tab, stats.langEntries),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((tab: CraftTweakerTab) => {
    setActiveTab(tab);
    setQuery('');
    setRecipeTypeFilter('all');
    setTagTypeFilter('all');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (
      format: 'json' | 'csv' | 'markdown',
      scope: 'all' | 'recipes' | 'tags' | 'events' | 'tooltips' | 'lang',
    ) => {
      if (!ct) return;
      let data: unknown;
      let filename = '';
      let content = '';

      if (scope === 'all') {
        data = ct;
      } else if (scope === 'recipes') {
        data = ct.recipes;
      } else if (scope === 'tags') {
        data = ct.tags;
      } else if (scope === 'events') {
        data = ct.events;
      } else if (scope === 'tooltips') {
        data = ct.tooltips;
      } else {
        data = ct.lang;
      }

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `${ct.packId}-${scope}.json`;
      } else if (format === 'csv') {
        if (scope === 'recipes') {
          const rows = ['ID,Type,Result,Count'];
          for (const r of ct.recipes) {
            rows.push(`"${r.id}","${r.type}","${r.result}",${r.count}`);
          }
          content = rows.join('\n');
        } else if (scope === 'tags') {
          const rows = ['ID,Type,Values,Replace'];
          for (const t of ct.tags) {
            rows.push(`"${t.id}","${t.type}","${t.values.join(';')}",${t.replace ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'events') {
          const rows = ['ID,Type,Target'];
          for (const e of ct.events) {
            rows.push(`"${e.id}","${e.type}","${e.target}"`);
          }
          content = rows.join('\n');
        } else if (scope === 'tooltips') {
          const rows = ['ItemID,Lines,Advanced'];
          for (const t of ct.tooltips) {
            rows.push(`"${t.itemId}",${t.lines.length},${t.advanced ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'lang') {
          const rows = ['Lang,Key,Value'];
          for (const [langCode, dict] of Object.entries(ct.lang ?? {})) {
            for (const [k, v] of Object.entries(dict)) {
              rows.push(`"${langCode}","${k}","${v.replace(/"/g, '""')}"`);
            }
          }
          content = rows.join('\n');
        } else {
          content = JSON.stringify(data, null, 2);
        }
        filename = `${ct.packId}-${scope}.csv`;
      } else {
        // markdown
        const lines: string[] = [];
        if (scope === 'all') {
          lines.push(`# ${ct.packName || ct.packId}`, '');
          lines.push(`- **Pack ID**: ${ct.packId}`);
          lines.push(`- **Format**: ${ct.packFormat}`);
          lines.push(`- **MC 版本**: ${ct.mcVersion}`);
          lines.push(`- **描述**: ${ct.description || '—'}`);
          lines.push('');
          lines.push('## 配方列表', '');
          for (const r of ct.recipes) {
            lines.push(
              `- \`${r.id}\` — ${RECIPE_TYPE_LABEL[r.type] ?? r.type} → ${r.result} x${r.count}`,
            );
          }
          lines.push('');
          lines.push('## 标签列表', '');
          for (const t of ct.tags) {
            lines.push(
              `- \`${t.id}\` — ${TAG_TYPE_LABEL[t.type] ?? t.type} (${t.values.length} 条目)`,
            );
          }
          lines.push('');
          lines.push('## 事件列表', '');
          for (const e of ct.events) {
            lines.push(`- \`${e.id}\` — ${e.type} (${e.target || '—'})`);
          }
          lines.push('');
          lines.push('## 工具提示', '');
          for (const t of ct.tooltips) {
            lines.push(`- \`${t.itemId}\` — ${t.lines.length} 行${t.advanced ? ' (高级)' : ''}`);
          }
        } else if (scope === 'recipes') {
          lines.push(`# ${ct.packName || ct.packId} - 配方列表`, '');
          lines.push(`共 ${ct.recipes.length} 个配方`, '');
          lines.push('| ID | 类型 | 产物 | 数量 |', '|---|---|---|---|');
          for (const r of ct.recipes) {
            lines.push(
              `| \`${r.id}\` | ${RECIPE_TYPE_LABEL[r.type] ?? r.type} | ${r.result} | ${r.count} |`,
            );
          }
        } else if (scope === 'tags') {
          lines.push(`# ${ct.packName || ct.packId} - 标签列表`, '');
          lines.push(`共 ${ct.tags.length} 个标签`, '');
          lines.push('| ID | 类型 | 条目数 | 替换 |', '|---|---|---|---|');
          for (const t of ct.tags) {
            lines.push(
              `| \`${t.id}\` | ${TAG_TYPE_LABEL[t.type] ?? t.type} | ${t.values.length} | ${t.replace ? '是' : '否'} |`,
            );
          }
        } else if (scope === 'events') {
          lines.push(`# ${ct.packName || ct.packId} - 事件列表`, '');
          lines.push(`共 ${ct.events.length} 个事件`, '');
          lines.push('| ID | 类型 | 目标 |', '|---|---|---|');
          for (const e of ct.events) {
            lines.push(`| \`${e.id}\` | ${e.type} | ${e.target || '—'} |`);
          }
        } else if (scope === 'tooltips') {
          lines.push(`# ${ct.packName || ct.packId} - 工具提示`, '');
          lines.push(`共 ${ct.tooltips.length} 个工具提示`, '');
          lines.push('| 物品 ID | 行数 | 高级 |', '|---|---|---|');
          for (const t of ct.tooltips) {
            lines.push(`| \`${t.itemId}\` | ${t.lines.length} | ${t.advanced ? '是' : '否'} |`);
          }
        } else if (scope === 'lang') {
          lines.push(`# ${ct.packName || ct.packId} - 语言条目`, '');
          lines.push(`共 ${stats.langEntries} 条翻译，覆盖 ${stats.langCount} 种语言`, '');
          lines.push('| 语言 | 键 | 值 |', '|---|---|---|');
          for (const [langCode, dict] of Object.entries(ct.lang ?? {})) {
            for (const [k, v] of Object.entries(dict)) {
              lines.push(`| ${langCode} | \`${k}\` | ${v} |`);
            }
          }
        }
        content = lines.join('\n');
        filename = `${ct.packId}-${scope}.md`;
      }

      downloadBlob(content, filename, 'text/plain');
    },
    [ct, stats.langEntries, stats.langCount],
  );

  if (!spec || !ct) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成 CraftTweaker Spec"
        hint="在右侧 AgentPanel 描述你想要的 ZenScript 脚本，生成 Spec 后即可预览"
      />
    );
  }

  // ===== 配方列定义 =====
  const recipeColumns: Column<CraftTweakerRecipeSpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            recipeSelection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {recipeSelection.isSelected(r.id) ? (
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
            removeRecipes([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];

  // ===== 标签列定义 =====
  const tagColumns: Column<CraftTweakerTagSpec>[] = [
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

  // ===== 事件列定义 =====
  const eventColumns: Column<CraftTweakerEventSpec>[] = [
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

  // ===== 工具提示列定义 =====
  const tooltipColumns: Column<CraftTweakerTooltipSpec>[] = [
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

  // ===== 语言列定义 =====
  const langColumns: Column<LangRow>[] = [
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

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={ct.packName || ct.packId}
        meta={[
          { label: 'packFormat', value: String(ct.packFormat) },
          { label: 'MC 版本', value: ct.mcVersion || '—' },
          { label: '描述', value: ct.description || '—' },
        ]}
        subtitle={`脚本包 ID: ${ct.packId}`}
      />

      {/* 统计卡片行 */}
      <StatCardGrid>
        <StatCard label="配方" value={stats.recipes} icon={<Boxes className="h-3 w-3" />} />
        <StatCard
          label="标签"
          value={stats.tags}
          sub={`${stats.replaceTags} 替换`}
          icon={<Tag className="h-3 w-3" />}
        />
        <StatCard label="事件" value={stats.events} icon={<Flag className="h-3 w-3" />} />
        <StatCard
          label="工具提示"
          value={stats.tooltips}
          sub={`${stats.advancedTooltips} 高级`}
          icon={<BookOpen className="h-3 w-3" />}
        />
        <StatCard
          label="语言种类"
          value={stats.langCount}
          icon={<Languages className="h-3 w-3" />}
        />
        <StatCard
          label="翻译条目"
          value={stats.langEntries}
          icon={<FileText className="h-3 w-3" />}
        />
        <StatCard
          label="自定义配方"
          value={stats.customRecipes}
          icon={<Boxes className="h-3 w-3" />}
        />
      </StatCardGrid>

      {/* 冲突检测告警 */}
      <ConflictAlert
        totalConflicts={totalConflicts}
        conflicts={[
          { label: '配方 ID 重复', count: conflicts.duplicateRecipeIds.length },
          { label: '标签 ID 重复', count: conflicts.duplicateTagIds.length },
          { label: '事件 ID 重复', count: conflicts.duplicateEventIds.length },
          { label: '工具提示 ID 重复', count: conflicts.duplicateTooltipIds.length },
        ]}
      />

      {/* Tab 切换 */}
      <IconTabBar tabs={tabs} activeTab={activeTab} onSelect={handleTabSelect} />

      {/* 搜索 + 筛选栏 */}
      {activeTab !== 'metadata' && activeTab !== 'export' && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={`搜索${tabLabel(activeTab)}…`}
        >
          {activeTab === 'recipes' && (
            <select
              value={recipeTypeFilter}
              onChange={(e) => setRecipeTypeFilter(e.target.value as RecipeTypeFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部类型 ({ct.recipes.length})</option>
              <option value="shaped">有序合成 ({recipeTypeStats.shaped})</option>
              <option value="shapeless">无序合成 ({recipeTypeStats.shapeless})</option>
              <option value="smelting">熔炼 ({recipeTypeStats.smelting})</option>
              <option value="stonecutting">切石 ({recipeTypeStats.stonecutting})</option>
              <option value="custom">自定义 ({recipeTypeStats.custom})</option>
            </select>
          )}
          {activeTab === 'tags' && (
            <select
              value={tagTypeFilter}
              onChange={(e) => setTagTypeFilter(e.target.value as TagTypeFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部类型 ({ct.tags.length})</option>
              <option value="item">物品 ({countTagType(ct, 'item')})</option>
              <option value="block">方块 ({countTagType(ct, 'block')})</option>
              <option value="entity_type">实体 ({countTagType(ct, 'entity_type')})</option>
              <option value="fluid">流体 ({countTagType(ct, 'fluid')})</option>
            </select>
          )}
        </FilterBar>
      )}

      {/* 配方批量操作栏 */}
      {activeTab === 'recipes' && (
        <BatchSelectToolbar
          selectedCount={recipeSelection.size}
          onBatchRemove={() => removeRecipes(Array.from(recipeSelection.selected))}
          onClearSelection={recipeSelection.clear}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'recipes' && (
          <DataTable
            columns={recipeColumns}
            data={filteredRecipes}
            rowKey={(r) => r.id}
            emptyHint="暂无配方"
          />
        )}
        {activeTab === 'tags' && (
          <DataTable
            columns={tagColumns}
            data={filteredTags}
            rowKey={(r) => r.id}
            emptyHint="暂无标签"
          />
        )}
        {activeTab === 'events' && (
          <DataTable
            columns={eventColumns}
            data={filteredEvents}
            rowKey={(r) => r.id}
            emptyHint="暂无事件"
          />
        )}
        {activeTab === 'tooltips' && (
          <DataTable
            columns={tooltipColumns}
            data={filteredTooltips}
            rowKey={(r) => r.itemId}
            emptyHint="暂无工具提示"
          />
        )}
        {activeTab === 'lang' && (
          <DataTable
            columns={langColumns}
            data={filteredLangRows}
            rowKey={(r) => `${r.lang}:${r.key}`}
            emptyHint="暂无语言条目"
          />
        )}
        {activeTab === 'metadata' && <MetadataView rows={metadataRows} />}
        {activeTab === 'export' && (
          <ExportView
            title="导出 CraftTweaker 数据"
            description="将当前 CraftTweaker 脚本的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'recipes', label: '配方列表', count: ct.recipes.length },
              { scope: 'tags', label: '标签列表', count: ct.tags.length },
              { scope: 'events', label: '事件列表', count: ct.events.length },
              { scope: 'tooltips', label: '工具提示', count: ct.tooltips.length },
              { scope: 'lang', label: '语言条目', count: stats.langEntries },
            ]}
            onExport={exportData}
            statsTitle="CraftTweaker 统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="配方总数" value={stats.recipes} />
                <StatCard label="标签总数" value={stats.tags} sub={`${stats.replaceTags} 替换`} />
                <StatCard label="事件总数" value={stats.events} />
                <StatCard
                  label="工具提示"
                  value={stats.tooltips}
                  sub={`${stats.advancedTooltips} 高级`}
                />
                <StatCard label="语言种类" value={stats.langCount} />
                <StatCard label="翻译条目" value={stats.langEntries} />
                <StatCard label="有序合成" value={recipeTypeStats.shaped} />
                <StatCard label="无序合成" value={recipeTypeStats.shapeless} />
                <StatCard label="熔炼配方" value={recipeTypeStats.smelting} />
                <StatCard label="切石配方" value={recipeTypeStats.stonecutting} />
                <StatCard label="自定义配方" value={recipeTypeStats.custom} />
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'recipes' && (
          <>
            配方 {ct.recipes.length} · 显示 {filteredRecipes.length} · 有序 {recipeTypeStats.shaped}{' '}
            · 无序 {recipeTypeStats.shapeless} · 熔炼 {recipeTypeStats.smelting} · 切石{' '}
            {recipeTypeStats.stonecutting} · 自定义 {recipeTypeStats.custom}
          </>
        )}
        {activeTab === 'tags' && (
          <>
            标签 {ct.tags.length} · 显示 {filteredTags.length} · 替换 {stats.replaceTags}
          </>
        )}
        {activeTab === 'events' && (
          <>
            事件 {ct.events.length} · 显示 {filteredEvents.length}
          </>
        )}
        {activeTab === 'tooltips' && (
          <>
            工具提示 {ct.tooltips.length} · 显示 {filteredTooltips.length} · 高级{' '}
            {stats.advancedTooltips}
          </>
        )}
        {activeTab === 'lang' && (
          <>
            语言 {stats.langCount} 种 · 条目 {stats.langEntries} · 显示 {filteredLangRows.length}
          </>
        )}
        {activeTab === 'metadata' && <>元数据</>}
        {activeTab === 'export' && <>导出</>}
      </div>
    </div>
  );
}

function countByTab(ct: CraftTweakerSpec, tab: CraftTweakerTab, langEntries: number): number {
  if (tab === 'recipes') return ct.recipes.length;
  if (tab === 'tags') return ct.tags.length;
  if (tab === 'events') return ct.events.length;
  if (tab === 'tooltips') return ct.tooltips.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

function countTagType(ct: CraftTweakerSpec, type: string): number {
  return ct.tags.filter((t) => t.type === type).length;
}

function tabLabel(tab: CraftTweakerTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
