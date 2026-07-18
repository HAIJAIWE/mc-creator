import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type { ModSpec, ItemSpec, BlockSpec, ModDependencySpec } from '@mc-creator/shared';

type ModTab = 'items' | 'blocks' | 'dependencies' | 'metadata';

const TABS: { key: ModTab; label: string }[] = [
  { key: 'items', label: '物品' },
  { key: 'blocks', label: '方块' },
  { key: 'dependencies', label: '依赖' },
  { key: 'metadata', label: '元数据' },
];

/** Mod 预览面板：4 分类 tab + 表格 + 搜索 */
export function ModPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [activeTab, setActiveTab] = useState<ModTab>('items');
  const [query, setQuery] = useState('');

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成 Mod Spec"
        hint="在右侧 AgentPanel 描述你想要的 mod，生成 Spec 后即可预览"
      />
    );
  }

  const mod = spec as unknown as ModSpec;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={mod.name || mod.modId}
        meta={[
          { label: 'modId', value: mod.modId },
          { label: '版本', value: mod.version },
          { label: 'License', value: mod.license },
        ]}
        subtitle={mod.description}
      />

      {/* Tab 切换 */}
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
            <span className="ml-1 text-mc-mute">({countByTab(mod, t.key)})</span>
          </button>
        ))}
      </div>

      {/* 搜索框（元数据 tab 不显示） */}
      {activeTab !== 'metadata' && (
        <div className="border-b border-mc-border px-3 py-2">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder={`搜索${tabLabel(activeTab)}…`}
          />
        </div>
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'items' && <ItemsTab items={mod.items} query={query} />}
        {activeTab === 'blocks' && <BlocksTab blocks={mod.blocks} query={query} />}
        {activeTab === 'dependencies' && <DepsTab deps={mod.dependencies} query={query} />}
        {activeTab === 'metadata' && <MetadataTab mod={mod} />}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        物品 {mod.items.length} · 方块 {mod.blocks.length} · 依赖 {mod.dependencies.length}
      </div>
    </div>
  );
}

function countByTab(mod: ModSpec, tab: ModTab): number {
  if (tab === 'items') return mod.items.length;
  if (tab === 'blocks') return mod.blocks.length;
  if (tab === 'dependencies') return mod.dependencies.length;
  return 0;
}

function tabLabel(tab: ModTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== Tab 组件 =====

function ItemsTab({ items, query }: { items: ItemSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<ItemSpec>[] = [
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '20%', sortValue: (r) => r.name },
    { key: 'rarity', header: '稀有度', width: '12%', sortValue: (r) => r.rarity },
    { key: 'maxStackSize', header: '堆叠', width: '10%', sortValue: (r) => r.maxStackSize },
    { key: 'maxDamage', header: '耐久', width: '10%', sortValue: (r) => r.maxDamage },
    { key: 'fuelTick', header: '燃料', width: '10%', sortValue: (r) => r.fuelTick },
    {
      key: 'food',
      header: '食物',
      width: '18%',
      render: (r) => (r.food ? `饥饿 ${r.food.hunger}/饱和 ${r.food.saturation}` : '—'),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => r.id}
      emptyHint="暂无物品，在 Spec 中添加 items"
    />
  );
}

function BlocksTab({ blocks, query }: { blocks: BlockSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return blocks;
    const q = query.toLowerCase();
    return blocks.filter((b) => b.id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q));
  }, [blocks, query]);

  const columns: Column<BlockSpec>[] = [
    { key: 'id', header: 'ID', width: '18%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '18%', sortValue: (r) => r.name },
    { key: 'material', header: '材质', width: '10%', sortValue: (r) => r.material },
    { key: 'hardness', header: '硬度', width: '10%', sortValue: (r) => r.hardness },
    { key: 'lightLevel', header: '发光', width: '10%', sortValue: (r) => r.lightLevel },
    { key: 'resistance', header: '抗性', width: '10%', sortValue: (r) => r.resistance },
    { key: 'soundType', header: '声音', width: '12%', sortValue: (r) => r.soundType },
    {
      key: 'dropSelf',
      header: '掉落',
      width: '12%',
      render: (r) => (r.dropSelf ? '自身' : r.dropItem || '无'),
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => r.id}
      emptyHint="暂无方块，在 Spec 中添加 blocks"
    />
  );
}

function DepsTab({ deps, query }: { deps: ModDependencySpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return deps;
    const q = query.toLowerCase();
    return deps.filter((d) => d.modId.toLowerCase().includes(q));
  }, [deps, query]);

  const columns: Column<ModDependencySpec>[] = [
    { key: 'modId', header: 'Mod ID', width: '40%', sortValue: (r) => r.modId },
    { key: 'version', header: '版本', width: '30%', sortValue: (r) => r.version },
    { key: 'mandatory', header: '必需', width: '30%', render: (r) => (r.mandatory ? '是' : '否') },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.modId} emptyHint="暂无依赖" />
  );
}

function MetadataTab({ mod }: { mod: ModSpec }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Mod ID', value: mod.modId },
    { label: '名称', value: mod.name },
    { label: '版本', value: mod.version },
    { label: 'License', value: mod.license },
    { label: '作者', value: mod.authors.join(', ') || '—' },
    { label: '致谢', value: mod.credits || '—' },
    { label: '网站', value: mod.website || '—' },
    { label: '描述', value: mod.description || '—' },
  ];

  return (
    <div className="p-4">
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
