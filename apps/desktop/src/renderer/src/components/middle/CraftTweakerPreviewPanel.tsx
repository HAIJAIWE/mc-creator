import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type {
  CraftTweakerSpec,
  CraftTweakerRecipeSpec,
  CraftTweakerTagSpec,
  CraftTweakerEventSpec,
  CraftTweakerTooltipSpec,
} from '@mc-creator/shared';

type CraftTweakerTab = 'recipes' | 'tags' | 'events' | 'tooltips';

const TABS: { key: CraftTweakerTab; label: string }[] = [
  { key: 'recipes', label: '配方' },
  { key: 'tags', label: '标签' },
  { key: 'events', label: '事件' },
  { key: 'tooltips', label: '工具提示' },
];

/** CraftTweaker 预览面板：4 分类 tab + 表格 + 搜索（无 registry） */
export function CraftTweakerPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [activeTab, setActiveTab] = useState<CraftTweakerTab>('recipes');
  const [query, setQuery] = useState('');

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成 CraftTweaker Spec"
        hint="在右侧 AgentPanel 描述你想要的 ZenScript 脚本，生成 Spec 后即可预览"
      />
    );
  }

  const ct = spec as unknown as CraftTweakerSpec;
  const langCount = Object.keys(ct.lang ?? {}).length;

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

      <div className="flex items-center gap-1 border-b border-mc-border bg-mc-surface px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setActiveTab(t.key);
              setQuery('');
            }}
            className={`rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {t.label}
            <span className="ml-1 text-mc-mute">({countByTab(ct, t.key)})</span>
          </button>
        ))}
      </div>

      <div className="border-b border-mc-border px-3 py-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={`搜索${tabLabel(activeTab)}…`}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'recipes' && <RecipesTab items={ct.recipes} query={query} />}
        {activeTab === 'tags' && <TagsTab items={ct.tags} query={query} />}
        {activeTab === 'events' && <EventsTab items={ct.events} query={query} />}
        {activeTab === 'tooltips' && <TooltipsTab items={ct.tooltips} query={query} />}
      </div>

      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        配方 {ct.recipes.length} · 标签 {ct.tags.length} · 事件 {ct.events.length} · 工具提示{' '}
        {ct.tooltips.length} · 语言 {langCount}
      </div>
    </div>
  );
}

function countByTab(ct: CraftTweakerSpec, tab: CraftTweakerTab): number {
  if (tab === 'recipes') return ct.recipes.length;
  if (tab === 'tags') return ct.tags.length;
  if (tab === 'events') return ct.events.length;
  if (tab === 'tooltips') return ct.tooltips.length;
  return 0;
}

function tabLabel(tab: CraftTweakerTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== Tab 组件 =====

function RecipesTab({ items, query }: { items: CraftTweakerRecipeSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (r) => r.id.toLowerCase().includes(q) || r.result.toLowerCase().includes(q),
    );
  }, [items, query]);

  const typeLabel: Record<string, string> = {
    shaped: '有序合成',
    shapeless: '无序合成',
    smelting: '熔炼',
    stonecutting: '切石',
    custom: '自定义',
  };

  const columns: Column<CraftTweakerRecipeSpec>[] = [
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    {
      key: 'type',
      header: '类型',
      width: '15%',
      sortValue: (r) => r.type,
      render: (r) => typeLabel[r.type] ?? r.type,
    },
    { key: 'result', header: '产物', width: '30%', sortValue: (r) => r.result },
    {
      key: 'count',
      header: '数量',
      width: '10%',
      sortValue: (r) => r.count,
      render: (r) => String(r.count),
    },
    {
      key: 'pattern',
      header: '形状/材料',
      width: '25%',
      render: (r) =>
        r.pattern
          ? `${r.pattern.length} 行`
          : r.ingredients
            ? `${r.ingredients.length} 材料`
            : r.customCode
              ? '自定义代码'
              : '—',
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无配方" />;
}

function TagsTab({ items, query }: { items: CraftTweakerTagSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((t) => t.id.toLowerCase().includes(q) || t.type.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<CraftTweakerTagSpec>[] = [
    { key: 'id', header: '标签 ID', width: '30%', sortValue: (t) => t.id },
    { key: 'type', header: '类型', width: '15%', sortValue: (t) => t.type },
    {
      key: 'values',
      header: '条目数',
      width: '15%',
      sortValue: (t) => t.values.length,
      render: (t) => String(t.values.length),
    },
    {
      key: 'replace',
      header: '替换模式',
      width: '15%',
      render: (t) => (t.replace ? '是' : '否'),
    },
    {
      key: 'preview',
      header: '前 2 个条目',
      width: '25%',
      render: (t) => (t.values.length > 0 ? t.values.slice(0, 2).join(', ') : '—'),
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(t) => t.id} emptyHint="暂无标签" />;
}

function EventsTab({ items, query }: { items: CraftTweakerEventSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q),
    );
  }, [items, query]);

  const columns: Column<CraftTweakerEventSpec>[] = [
    { key: 'id', header: '事件 ID', width: '20%', sortValue: (e) => e.id },
    { key: 'type', header: '事件类型', width: '25%', sortValue: (e) => e.type },
    {
      key: 'target',
      header: '目标',
      width: '20%',
      sortValue: (e) => e.target,
      render: (e) => e.target || '—',
    },
    {
      key: 'handler',
      header: 'handler 预览',
      width: '35%',
      render: (e) => {
        const firstLine = e.handler.split('\n')[0] ?? '';
        return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine || '—';
      },
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(e) => e.id} emptyHint="暂无事件" />;
}

function TooltipsTab({ items, query }: { items: CraftTweakerTooltipSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((t) => t.itemId.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<CraftTweakerTooltipSpec>[] = [
    { key: 'itemId', header: '物品 ID', width: '35%', sortValue: (t) => t.itemId },
    {
      key: 'lines',
      header: '行数',
      width: '10%',
      sortValue: (t) => t.lines.length,
      render: (t) => String(t.lines.length),
    },
    {
      key: 'advanced',
      header: '高级',
      width: '10%',
      render: (t) => (t.advanced ? '是' : '否'),
    },
    {
      key: 'preview',
      header: '首行预览',
      width: '45%',
      render: (t) => t.lines[0]?.slice(0, 40) ?? '—',
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(t) => t.itemId}
      emptyHint="暂无工具提示"
    />
  );
}
