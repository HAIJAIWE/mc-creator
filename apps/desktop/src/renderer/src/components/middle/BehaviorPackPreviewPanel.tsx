import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type {
  BehaviorPackSpec,
  BpEntitySpec,
  BpRecipeSpec,
  BpLootTableSpec,
} from '@mc-creator/shared';

type BehaviorPackTab = 'entities' | 'recipes' | 'loot';

const TABS: { key: BehaviorPackTab; label: string }[] = [
  { key: 'entities', label: '实体' },
  { key: 'recipes', label: '配方' },
  { key: 'loot', label: '战利品表' },
];

/** BehaviorPack 预览面板：3 分类 tab + 表格 + 搜索 */
export function BehaviorPackPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [activeTab, setActiveTab] = useState<BehaviorPackTab>('entities');
  const [query, setQuery] = useState('');

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成行为包 Spec"
        hint="在右侧 AgentPanel 描述你想要的行为包，生成 Spec 后即可预览"
      />
    );
  }

  const bp = spec as unknown as BehaviorPackSpec;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={bp.packName || bp.packId}
        meta={[
          { label: 'packFormat', value: String(bp.packFormat) },
          { label: '描述', value: bp.description || '—' },
        ]}
        subtitle={`行为包 ID: ${bp.packId}`}
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
            <span className="ml-1 text-mc-mute">({countByTab(bp, t.key)})</span>
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
        {activeTab === 'entities' && <EntitiesTab items={bp.entities} query={query} />}
        {activeTab === 'recipes' && <RecipesTab items={bp.recipes} query={query} />}
        {activeTab === 'loot' && <LootTab items={bp.lootTables} query={query} />}
      </div>

      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        实体 {bp.entities.length} · 配方 {bp.recipes.length} · 战利品表 {bp.lootTables.length}
      </div>
    </div>
  );
}

function countByTab(bp: BehaviorPackSpec, tab: BehaviorPackTab): number {
  if (tab === 'entities') return bp.entities.length;
  if (tab === 'recipes') return bp.recipes.length;
  if (tab === 'loot') return bp.lootTables.length;
  return 0;
}

function tabLabel(tab: BehaviorPackTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== Tab 组件 =====

function EntitiesTab({ items, query }: { items: BpEntitySpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((e) => e.identifier.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<BpEntitySpec>[] = [
    {
      key: 'identifier',
      header: '标识符',
      width: '40%',
      sortValue: (r) => r.identifier,
    },
    {
      key: 'components',
      header: '组件数',
      width: '20%',
      sortValue: (r) => Object.keys(r.components).length,
      render: (r) => String(Object.keys(r.components).length),
    },
    {
      key: 'events',
      header: '事件数',
      width: '20%',
      sortValue: (r) => Object.keys(r.events).length,
      render: (r) => String(Object.keys(r.events).length),
    },
    {
      key: 'groups',
      header: '描述组',
      width: '20%',
      sortValue: (r) => r.description_groups.length,
      render: (r) => String(r.description_groups.length),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => r.identifier}
      emptyHint="暂无实体"
    />
  );
}

function RecipesTab({ items, query }: { items: BpRecipeSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (r) => r.identifier.toLowerCase().includes(q) || r.result.toLowerCase().includes(q),
    );
  }, [items, query]);

  const typeLabel: Record<string, string> = {
    shaped_crafting: '有序合成',
    shapeless_crafting: '无序合成',
    furnace: '熔炼',
  };

  const columns: Column<BpRecipeSpec>[] = [
    {
      key: 'identifier',
      header: '标识符',
      width: '30%',
      sortValue: (r) => r.identifier,
    },
    {
      key: 'type',
      header: '类型',
      width: '20%',
      sortValue: (r) => r.type,
      render: (r) => typeLabel[r.type] ?? r.type,
    },
    {
      key: 'result',
      header: '产物',
      width: '30%',
      sortValue: (r) => r.result,
    },
    {
      key: 'count',
      header: '数量',
      width: '20%',
      sortValue: (r) => r.count,
      render: (r) => String(r.count),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => r.identifier}
      emptyHint="暂无配方"
    />
  );
}

function LootTab({ items, query }: { items: BpLootTableSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((l) => l.path.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<BpLootTableSpec>[] = [
    {
      key: 'path',
      header: '路径',
      width: '50%',
      sortValue: (r) => r.path,
    },
    {
      key: 'pools',
      header: '池数',
      width: '25%',
      sortValue: (r) => r.pools.length,
      render: (r) => String(r.pools.length),
    },
    {
      key: 'entries',
      header: '总条目',
      width: '25%',
      sortValue: (r) => r.pools.reduce((sum, p) => sum + p.entries.length, 0),
      render: (r) => String(r.pools.reduce((sum, p) => sum + p.entries.length, 0)),
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.path} emptyHint="暂无战利品表" />
  );
}
