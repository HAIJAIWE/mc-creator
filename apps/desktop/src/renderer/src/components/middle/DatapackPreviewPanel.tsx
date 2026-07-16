import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type {
  DatapackSpec, FunctionSpec, LootTableSpec, PredicateSpec,
  AdvancementSpec, RecipeSpec, TagSpec, SimpleTagSpec,
} from '@mc-creator/shared';

type DatapackTab = 'functions' | 'loot' | 'advancements' | 'recipes' | 'tags';

const TABS: { key: DatapackTab; label: string }[] = [
  { key: 'functions', label: '函数' },
  { key: 'loot', label: '战利品表' },
  { key: 'advancements', label: '进度' },
  { key: 'recipes', label: '配方' },
  { key: 'tags', label: '标签' },
];

/** Datapack 预览面板：5 分类 tab + 表格 + 搜索 */
export function DatapackPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [activeTab, setActiveTab] = useState<DatapackTab>('functions');
  const [query, setQuery] = useState('');

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成数据包 Spec" hint="在右侧 AgentPanel 描述你想要的数据包，生成 Spec 后即可预览" />;
  }

  const dp = spec as unknown as DatapackSpec;
  const lootAll = [...dp.lootTables, ...dp.predicates];
  const tagsAll = [...dp.tags, ...dp.itemTags, ...dp.blockTags];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={dp.packName || dp.packId}
        meta={[
          { label: 'packFormat', value: String(dp.packFormat) },
          { label: '描述', value: dp.description || '—' },
        ]}
        subtitle={`数据包 ID: ${dp.packId}`}
      />

      <div className="flex items-center gap-1 border-b border-mc-border bg-mc-surface px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setActiveTab(t.key); setQuery(''); }}
            className={`rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {t.label}
            <span className="ml-1 text-mc-mute">({countByTab(dp, lootAll.length, tagsAll.length, t.key)})</span>
          </button>
        ))}
      </div>

      <div className="border-b border-mc-border px-3 py-2">
        <SearchInput value={query} onChange={setQuery} placeholder={`搜索${tabLabel(activeTab)}…`} />
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'functions' && <FunctionsTab items={dp.functions} query={query} />}
        {activeTab === 'loot' && <LootTab lootTables={dp.lootTables} predicates={dp.predicates} query={query} />}
        {activeTab === 'advancements' && <AdvancementsTab items={dp.advancements} query={query} />}
        {activeTab === 'recipes' && <RecipesTab items={dp.recipes} query={query} />}
        {activeTab === 'tags' && <TagsTab tags={dp.tags} itemTags={dp.itemTags} blockTags={dp.blockTags} query={query} />}
      </div>

      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        函数 {dp.functions.length} · 战利品表 {dp.lootTables.length} · 进度 {dp.advancements.length} · 配方 {dp.recipes.length} · 标签 {tagsAll.length}
      </div>
    </div>
  );
}

function countByTab(dp: DatapackSpec, lootCount: number, tagCount: number, tab: DatapackTab): number {
  if (tab === 'functions') return dp.functions.length;
  if (tab === 'loot') return lootCount;
  if (tab === 'advancements') return dp.advancements.length;
  if (tab === 'recipes') return dp.recipes.length;
  if (tab === 'tags') return tagCount;
  return 0;
}

function tabLabel(tab: DatapackTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== Tab 组件 =====

function FunctionsTab({ items, query }: { items: FunctionSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((f) => f.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<FunctionSpec>[] = [
    { key: 'id', header: '函数 ID', width: '40%', sortValue: (r) => r.id },
    { key: 'commands', header: '命令数', width: '20%', sortValue: (r) => r.commands.length, render: (r) => String(r.commands.length) },
    { key: 'preview', header: '首条命令', width: '40%', render: (r) => r.commands[0]?.slice(0, 40) ?? '—' },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无函数" />;
}

function LootTab({ lootTables, predicates, query }: { lootTables: LootTableSpec[]; predicates: PredicateSpec[]; query: string }) {
  type LootRow = { kind: 'table' | 'predicate'; path: string; type: string; detail: string };
  const rows: LootRow[] = useMemo(() => [
    ...lootTables.map((l): LootRow => ({ kind: 'table', path: `${l.namespace}:${l.path}`, type: l.type, detail: `${l.pools.length} 池` })),
    ...predicates.map((p): LootRow => ({ kind: 'predicate', path: `${p.namespace}:${p.path}`, type: 'predicate', detail: p.condition.slice(0, 30) })),
  ], [lootTables, predicates]);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.path.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<LootRow>[] = [
    { key: 'kind', header: '类型', width: '15%', sortValue: (r) => r.kind, render: (r) => r.kind === 'table' ? '战利品表' : '谓词' },
    { key: 'path', header: '路径', width: '40%', sortValue: (r) => r.path },
    { key: 'type', header: '子类型', width: '20%', sortValue: (r) => r.type },
    { key: 'detail', header: '详情', width: '25%', render: (r) => r.detail },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => `${r.kind}:${r.path}`} emptyHint="暂无战利品表/谓词" />;
}

function AdvancementsTab({ items, query }: { items: AdvancementSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((a) => a.id.toLowerCase().includes(q) || a.title.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<AdvancementSpec>[] = [
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    { key: 'title', header: '标题', width: '20%', sortValue: (r) => r.title },
    { key: 'icon', header: '图标', width: '20%', sortValue: (r) => r.icon },
    { key: 'trigger', header: '触发器', width: '25%', sortValue: (r) => r.trigger },
    { key: 'description', header: '描述', width: '15%', render: (r) => r.description.slice(0, 30) || '—' },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无进度" />;
}

function RecipesTab({ items, query }: { items: RecipeSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((r) => r.id.toLowerCase().includes(q) || r.result.toLowerCase().includes(q));
  }, [items, query]);

  const typeLabel: Record<string, string> = {
    crafting_shaped: '有序合成',
    crafting_shapeless: '无序合成',
    smelting: '熔炼',
    stonecutting: '切石',
  };

  const columns: Column<RecipeSpec>[] = [
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    { key: 'type', header: '类型', width: '20%', sortValue: (r) => r.type, render: (r) => typeLabel[r.type] ?? r.type },
    { key: 'result', header: '产物', width: '30%', sortValue: (r) => r.result },
    { key: 'count', header: '数量', width: '15%', sortValue: (r) => r.count, render: (r) => String(r.count) },
    { key: 'pattern', header: '形状', width: '15%', render: (r) => r.pattern ? `${r.pattern.length} 行` : (r.ingredients ? `${r.ingredients.length} 材料` : '—') },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无配方" />;
}

function TagsTab({ tags, itemTags, blockTags, query }: { tags: TagSpec[]; itemTags: SimpleTagSpec[]; blockTags: SimpleTagSpec[]; query: string }) {
  type TagRow = { source: string; id: string; type: string; values: number; replace: boolean };
  const rows: TagRow[] = useMemo(() => [
    ...tags.map((t): TagRow => ({ source: 'tag', id: t.id, type: t.type, values: t.values.length, replace: t.replace })),
    ...itemTags.map((t): TagRow => ({ source: 'itemTag', id: t.tag, type: 'item', values: t.values.length, replace: t.replace })),
    ...blockTags.map((t): TagRow => ({ source: 'blockTag', id: t.tag, type: 'block', values: t.values.length, replace: t.replace })),
  ], [tags, itemTags, blockTags]);

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.id.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<TagRow>[] = [
    { key: 'source', header: '来源', width: '15%', sortValue: (r) => r.source, render: (r) => r.source },
    { key: 'id', header: '标签 ID', width: '35%', sortValue: (r) => r.id },
    { key: 'type', header: '类型', width: '15%', sortValue: (r) => r.type },
    { key: 'values', header: '条目数', width: '15%', sortValue: (r) => r.values, render: (r) => String(r.values) },
    { key: 'replace', header: '替换', width: '20%', render: (r) => r.replace ? '是' : '否' },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => `${r.source}:${r.id}`} emptyHint="暂无标签" />;
}
