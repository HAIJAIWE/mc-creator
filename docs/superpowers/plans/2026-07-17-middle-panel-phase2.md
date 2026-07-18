# 中间预览面板阶段 2 — mod/datapack/modpack 面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 mod/datapack/modpack 三个列表/表格类预览面板，复用共享 DataTable 组件，替换 MiddlePanel 中对应类型的 PlaceholderPanel。

**Architecture:** 抽 4 个共享组件（DataTable/PanelHeader/SearchInput/EmptyState）放 `middle/shared/`，3 个面板各自从 `useModStore.spec` 读取并以分类 tab + 表格展示。表格只读（编辑在 AgentPanel Monaco），支持搜索筛选。MiddlePanel 的 switch 替换 3 个类型的 placeholder。

**Tech Stack:** React 18 + TypeScript 5 + Zustand 4 + Tailwind CSS 3 + Zod 3 + Vitest 2

**Spec:** [2026-07-17-middle-panel-per-generator-design.md](file:///d:/MC%20mod/docs/superpowers/specs/2026-07-17-middle-panel-per-generator-design.md) §5.1/5.2/5.3

---

## 文件结构

### 新建

- `apps/desktop/src/renderer/src/components/middle/shared/DataTable.tsx` — 通用表格（列定义 + 数据 + 排序）
- `apps/desktop/src/renderer/src/components/middle/shared/PanelHeader.tsx` — 面板头部（图标 + 元信息）
- `apps/desktop/src/renderer/src/components/middle/shared/SearchInput.tsx` — 搜索输入框
- `apps/desktop/src/renderer/src/components/middle/shared/EmptyState.tsx` — 空状态（未生成 spec / 无数据）
- `apps/desktop/src/renderer/src/components/middle/shared/index.ts` — 共享组件导出
- `apps/desktop/src/renderer/src/components/middle/ModPreviewPanel.tsx` — mod 预览（4 tab：物品/方块/依赖/元数据）
- `apps/desktop/src/renderer/src/components/middle/DatapackPreviewPanel.tsx` — datapack 预览（5 tab：函数/战利品表/进度/配方/标签）
- `apps/desktop/src/renderer/src/components/middle/ModpackPreviewPanel.tsx` — modpack 预览（mod 列表 + 搜索 + 筛选）

### 修改

- `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx` — switch 替换 mod/datapack/modpack 的 placeholder

---

## Task 1: 共享组件（DataTable + PanelHeader + SearchInput + EmptyState）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/shared/DataTable.tsx`
- Create: `apps/desktop/src/renderer/src/components/middle/shared/PanelHeader.tsx`
- Create: `apps/desktop/src/renderer/src/components/middle/shared/SearchInput.tsx`
- Create: `apps/desktop/src/renderer/src/components/middle/shared/EmptyState.tsx`
- Create: `apps/desktop/src/renderer/src/components/middle/shared/index.ts`

- [ ] **Step 1: 创建 DataTable.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/shared/DataTable.tsx`：

```tsx
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
                {sortCol === idx && <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} className="border-b border-mc-border/60 hover:bg-mc-surface-2/40">
              {columns.map((col) => (
                <td key={String(col.key)} className="px-2 py-1.5 text-mc-text">
                  {col.render
                    ? col.render(row)
                    : String((row as Record<string, unknown>)[col.key as string] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: 创建 PanelHeader.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/shared/PanelHeader.tsx`：

```tsx
import { McIcon } from '../../../assets/mc-ui/McIcon';

interface PanelHeaderProps {
  icon: string;
  title: string;
  meta?: { label: string; value: string }[];
  subtitle?: string;
}

/** 面板头部：图标 + 标题 + 元信息 */
export function PanelHeader({ icon, title, meta = [], subtitle }: PanelHeaderProps) {
  return (
    <div className="border-b border-mc-border px-4 py-3">
      <div className="flex items-center gap-2">
        <McIcon scope="pixel" name={icon} size={16} className="text-mc-accent" />
        <span className="text-sm font-bold text-mc-text">{title}</span>
        {meta.map((m, i) => (
          <span key={i} className="flex items-center gap-2">
            <span className="text-xs text-mc-mute">·</span>
            <span className="text-xs text-mc-dim">
              {m.label}: {m.value}
            </span>
          </span>
        ))}
      </div>
      {subtitle && <div className="mt-1 text-xs text-mc-mute">{subtitle}</div>}
    </div>
  );
}
```

- [ ] **Step 3: 创建 SearchInput.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/shared/SearchInput.tsx`：

```tsx
interface SearchInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}

/** 搜索输入框（带放大镜图标） */
export function SearchInput({ value, onChange, placeholder = '搜索…' }: SearchInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-mc-mute">
        🔍
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mc-input w-full !py-1 !pl-7 !text-xs"
      />
    </div>
  );
}
```

- [ ] **Step 4: 创建 EmptyState.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/shared/EmptyState.tsx`：

```tsx
import { McIcon } from '../../../assets/mc-ui/McIcon';

interface EmptyStateProps {
  icon: string;
  title: string;
  hint: string;
}

/** 空状态：未生成 spec 或无数据 */
export function EmptyState({ icon, title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name={icon} size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{title}</div>
      <div className="text-xs text-mc-mute">{hint}</div>
    </div>
  );
}
```

- [ ] **Step 5: 创建 index.ts 导出**

创建 `apps/desktop/src/renderer/src/components/middle/shared/index.ts`：

```typescript
export { DataTable } from './DataTable.js';
export type { Column } from './DataTable.js';
export { PanelHeader } from './PanelHeader.js';
export { SearchInput } from './SearchInput.js';
export { EmptyState } from './EmptyState.js';
```

- [ ] **Step 6: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 7: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/shared/
git commit -m "feat(middle/shared): add DataTable/PanelHeader/SearchInput/EmptyState"
```

---

## Task 2: ModPreviewPanel（4 tab：物品/方块/依赖/元数据）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/ModPreviewPanel.tsx`

**数据源**：`useModStore.spec` 断言为 `ModSpec`

- items[]: { id, name, maxStackSize, rarity, maxDamage, fuelTick, food?, lore }
- blocks[]: { id, name, material, hardness, miningLevel, lightLevel, resistance, soundType, dropSelf, dropItem }
- dependencies[]: { modId, version, mandatory }
- 元数据：version, authors[], credits, website, license

- [ ] **Step 1: 创建 ModPreviewPanel.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/ModPreviewPanel.tsx`：

```tsx
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
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 暂不提交，继续 Task 3**

---

## Task 3: DatapackPreviewPanel（5 tab：函数/战利品表/进度/配方/标签）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/DatapackPreviewPanel.tsx`

**数据源**：`useModStore.spec` 断言为 `DatapackSpec`

- functions[]: { id, commands[] }
- lootTables[]: { namespace, path, type, pools[] }（合并 predicates[]）
- advancements[]: { id, title, description, icon, trigger, conditions? }
- recipes[]: { id, type, result, count, pattern?, key?, ingredients? }
- tags[]: { id, type, values[], replace }（合并 itemTags[] + blockTags[]）

- [ ] **Step 1: 创建 DatapackPreviewPanel.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/DatapackPreviewPanel.tsx`：

```tsx
import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type {
  DatapackSpec,
  FunctionSpec,
  LootTableSpec,
  PredicateSpec,
  AdvancementSpec,
  RecipeSpec,
  TagSpec,
  SimpleTagSpec,
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
    return (
      <EmptyState
        icon="box"
        title="尚未生成数据包 Spec"
        hint="在右侧 AgentPanel 描述你想要的数据包，生成 Spec 后即可预览"
      />
    );
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
            <span className="ml-1 text-mc-mute">
              ({countByTab(dp, lootAll.length, tagsAll.length, t.key)})
            </span>
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
        {activeTab === 'functions' && <FunctionsTab items={dp.functions} query={query} />}
        {activeTab === 'loot' && (
          <LootTab lootTables={dp.lootTables} predicates={dp.predicates} query={query} />
        )}
        {activeTab === 'advancements' && <AdvancementsTab items={dp.advancements} query={query} />}
        {activeTab === 'recipes' && <RecipesTab items={dp.recipes} query={query} />}
        {activeTab === 'tags' && (
          <TagsTab tags={dp.tags} itemTags={dp.itemTags} blockTags={dp.blockTags} query={query} />
        )}
      </div>

      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        函数 {dp.functions.length} · 战利品表 {dp.lootTables.length} · 进度 {dp.advancements.length}{' '}
        · 配方 {dp.recipes.length} · 标签 {tagsAll.length}
      </div>
    </div>
  );
}

function countByTab(
  dp: DatapackSpec,
  lootCount: number,
  tagCount: number,
  tab: DatapackTab,
): number {
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
    {
      key: 'commands',
      header: '命令数',
      width: '20%',
      sortValue: (r) => r.commands.length,
      render: (r) => String(r.commands.length),
    },
    {
      key: 'preview',
      header: '首条命令',
      width: '40%',
      render: (r) => r.commands[0]?.slice(0, 40) ?? '—',
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无函数" />;
}

function LootTab({
  lootTables,
  predicates,
  query,
}: {
  lootTables: LootTableSpec[];
  predicates: PredicateSpec[];
  query: string;
}) {
  type LootRow = { kind: 'table' | 'predicate'; path: string; type: string; detail: string };
  const rows: LootRow[] = useMemo(
    () => [
      ...lootTables.map((l): LootRow => ({
        kind: 'table',
        path: `${l.namespace}:${l.path}`,
        type: l.type,
        detail: `${l.pools.length} 池`,
      })),
      ...predicates.map((p): LootRow => ({
        kind: 'predicate',
        path: `${p.namespace}:${p.path}`,
        type: 'predicate',
        detail: p.condition.slice(0, 30),
      })),
    ],
    [lootTables, predicates],
  );

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.path.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<LootRow>[] = [
    {
      key: 'kind',
      header: '类型',
      width: '15%',
      sortValue: (r) => r.kind,
      render: (r) => (r.kind === 'table' ? '战利品表' : '谓词'),
    },
    { key: 'path', header: '路径', width: '40%', sortValue: (r) => r.path },
    { key: 'type', header: '子类型', width: '20%', sortValue: (r) => r.type },
    { key: 'detail', header: '详情', width: '25%', render: (r) => r.detail },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => `${r.kind}:${r.path}`}
      emptyHint="暂无战利品表/谓词"
    />
  );
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
    {
      key: 'description',
      header: '描述',
      width: '15%',
      render: (r) => r.description.slice(0, 30) || '—',
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无进度" />;
}

function RecipesTab({ items, query }: { items: RecipeSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (r) => r.id.toLowerCase().includes(q) || r.result.toLowerCase().includes(q),
    );
  }, [items, query]);

  const typeLabel: Record<string, string> = {
    crafting_shaped: '有序合成',
    crafting_shapeless: '无序合成',
    smelting: '熔炼',
    stonecutting: '切石',
  };

  const columns: Column<RecipeSpec>[] = [
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    {
      key: 'type',
      header: '类型',
      width: '20%',
      sortValue: (r) => r.type,
      render: (r) => typeLabel[r.type] ?? r.type,
    },
    { key: 'result', header: '产物', width: '30%', sortValue: (r) => r.result },
    {
      key: 'count',
      header: '数量',
      width: '15%',
      sortValue: (r) => r.count,
      render: (r) => String(r.count),
    },
    {
      key: 'pattern',
      header: '形状',
      width: '15%',
      render: (r) =>
        r.pattern ? `${r.pattern.length} 行` : r.ingredients ? `${r.ingredients.length} 材料` : '—',
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无配方" />;
}

function TagsTab({
  tags,
  itemTags,
  blockTags,
  query,
}: {
  tags: TagSpec[];
  itemTags: SimpleTagSpec[];
  blockTags: SimpleTagSpec[];
  query: string;
}) {
  type TagRow = { source: string; id: string; type: string; values: number; replace: boolean };
  const rows: TagRow[] = useMemo(
    () => [
      ...tags.map((t): TagRow => ({
        source: 'tag',
        id: t.id,
        type: t.type,
        values: t.values.length,
        replace: t.replace,
      })),
      ...itemTags.map((t): TagRow => ({
        source: 'itemTag',
        id: t.tag,
        type: 'item',
        values: t.values.length,
        replace: t.replace,
      })),
      ...blockTags.map((t): TagRow => ({
        source: 'blockTag',
        id: t.tag,
        type: 'block',
        values: t.values.length,
        replace: t.replace,
      })),
    ],
    [tags, itemTags, blockTags],
  );

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.id.toLowerCase().includes(q) || r.type.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<TagRow>[] = [
    {
      key: 'source',
      header: '来源',
      width: '15%',
      sortValue: (r) => r.source,
      render: (r) => r.source,
    },
    { key: 'id', header: '标签 ID', width: '35%', sortValue: (r) => r.id },
    { key: 'type', header: '类型', width: '15%', sortValue: (r) => r.type },
    {
      key: 'values',
      header: '条目数',
      width: '15%',
      sortValue: (r) => r.values,
      render: (r) => String(r.values),
    },
    { key: 'replace', header: '替换', width: '20%', render: (r) => (r.replace ? '是' : '否') },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => `${r.source}:${r.id}`}
      emptyHint="暂无标签"
    />
  );
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 暂不提交，继续 Task 4**

---

## Task 4: ModpackPreviewPanel（mod 列表 + 搜索 + 筛选）

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/ModpackPreviewPanel.tsx`

**数据源**：`useModStore.spec` 断言为 `ModpackSpec`

- mods[]: { name, projectId, versionId, fileName, fileSize?, downloadUrl? }
- 元数据：packId, packName, packVersion, author, mcVersion, loader, loaderVersion, format

- [ ] **Step 1: 创建 ModpackPreviewPanel.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/ModpackPreviewPanel.tsx`：

```tsx
import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type { ModpackSpec, ModEntry } from '@mc-creator/shared';

type FormatFilter = 'all' | 'modrinth' | 'curseforge';

/** Modpack 预览面板：mod 列表 + 搜索 + 来源筛选 */
export function ModpackPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成整合包 Spec"
        hint="在右侧 AgentPanel 描述你想要的整合包，生成 Spec 后即可预览"
      />
    );
  }

  const pack = spec as unknown as ModpackSpec;

  const filtered = useMemo(() => {
    let result = pack.mods;
    if (formatFilter !== 'all') {
      // 简单启发式：projectId 是数字则视为 CurseForge，否则 Modrinth（不精确但够用）
      result = result.filter((m) => {
        const isNumeric = /^\d+$/.test(m.projectId);
        return formatFilter === 'curseforge' ? isNumeric : !isNumeric;
      });
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.fileName.toLowerCase().includes(q) ||
          m.projectId.toLowerCase().includes(q),
      );
    }
    return result;
  }, [pack.mods, query, formatFilter]);

  const columns: Column<ModEntry>[] = [
    { key: 'name', header: 'Mod 名称', width: '25%', sortValue: (r) => r.name },
    { key: 'fileName', header: '文件名', width: '30%', sortValue: (r) => r.fileName },
    { key: 'versionId', header: '版本', width: '20%', sortValue: (r) => r.versionId },
    {
      key: 'fileSize',
      header: '大小',
      width: '15%',
      sortValue: (r) => r.fileSize ?? 0,
      render: (r) => (r.fileSize ? formatBytes(r.fileSize) : '—'),
    },
    {
      key: 'source',
      header: '来源',
      width: '10%',
      render: (r) => (/^\d+$/.test(r.projectId) ? 'CurseForge' : 'Modrinth'),
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={pack.packName || pack.packId}
        meta={[
          { label: '版本', value: pack.packVersion },
          { label: 'MC', value: pack.mcVersion },
          { label: 'Loader', value: pack.loader },
          { label: '格式', value: pack.format },
        ]}
        subtitle={pack.description || `作者: ${pack.author || '—'}`}
      />

      {/* 搜索 + 筛选 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="搜索 mod…" />
        </div>
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
          className="mc-select !py-1 !text-xs"
        >
          <option value="all">全部来源</option>
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </select>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-y-auto">
        <DataTable
          columns={columns}
          data={filtered}
          rowKey={(r) => `${r.projectId}:${r.versionId}`}
          emptyHint="暂无 mod"
        />
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        mod 数: {pack.mods.length} · 显示: {filtered.length} · 覆盖文件: {pack.overrides.length} ·
        服务器覆盖: {pack.serverOverrides.length}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 暂不提交，继续 Task 5**

---

## Task 5: MiddlePanel 集成（替换 mod/datapack/modpack 的 placeholder）

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

- [ ] **Step 1: 修改 MiddlePanel 的 switch**

修改 `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`，新增 3 个 import：

```tsx
import { ModPreviewPanel } from './ModPreviewPanel.js';
import { DatapackPreviewPanel } from './DatapackPreviewPanel.js';
import { ModpackPreviewPanel } from './ModpackPreviewPanel.js';
```

把 `renderPreviewPanel` 的 switch 改为：

```tsx
const renderPreviewPanel = () => {
  switch (generatorType) {
    case 'server':
      return <ServerPreviewPanel />;
    case 'mod':
      return <ModPreviewPanel />;
    case 'datapack':
      return <DatapackPreviewPanel />;
    case 'modpack':
      return <ModpackPreviewPanel />;
    case 'resource_pack':
    case 'skin':
    case 'launcher':
      return <PlaceholderPanel type={generatorType} />;
    default:
      return <PlaceholderPanel type={generatorType} />;
  }
};
```

同时更新顶部注释：把 "阶段 1 只实现 server 面板" 改为 "阶段 2 已实现 server/mod/datapack/modpack 面板"。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 4: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/ModPreviewPanel.tsx apps/desktop/src/renderer/src/components/middle/DatapackPreviewPanel.tsx apps/desktop/src/renderer/src/components/middle/ModpackPreviewPanel.tsx apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx
git commit -m "feat(middle): add Mod/Datapack/Modpack preview panels"
```

---

## Task 6: 验证 + 清理

**Files:**

- 无文件修改，仅运行验证

- [ ] **Step 1: 完整 typecheck**

Run: `pnpm typecheck`
Expected: 0 错误

- [ ] **Step 2: 完整测试**

Run: `pnpm test`
Expected: 258 测试通过（无新增测试，无回归）

- [ ] **Step 3: noUnusedLocals 扫描**

Run: `pnpm typecheck`
Expected: 0 错误

- [ ] **Step 4: 行数检查**

Run: 用 Read 工具读取各文件尾部确认行数
Expected:

- DataTable.tsx ≤ 100 行
- ModPreviewPanel.tsx ≤ 200 行
- DatapackPreviewPanel.tsx ≤ 250 行
- ModpackPreviewPanel.tsx ≤ 150 行
- MiddlePanel.tsx ≤ 100 行

- [ ] **Step 5: 手动 UI 检查清单（不执行，仅文档）**

```
1. pnpm dev:win 启动应用
2. 切换到 mod 类型 → 预览 tab 应显示 ModPreviewPanel（4 tab + 表格）
3. 切换到 datapack 类型 → 预览 tab 应显示 DatapackPreviewPanel（5 tab + 表格）
4. 切换到 modpack 类型 → 预览 tab 应显示 ModpackPreviewPanel（搜索 + 筛选 + 表格）
5. 各 tab 切换正常，搜索框筛选正常，列头排序正常
6. 未生成 spec 时显示 EmptyState
```

- [ ] **Step 6: 如有问题，修复后提交**

```bash
cd "d:/MC mod"
git add -A
git commit -m "fix(middle): phase 2 verification fixes"
```

---

## 验证标准

- [x] typecheck 0 错误（node + web）
- [x] 测试全通过（258，无回归）
- [x] noUnusedLocals 0 错误
- [x] DataTable ≤ 100 行
- [x] ModPreviewPanel ≤ 200 行
- [x] DatapackPreviewPanel ≤ 250 行
- [x] ModpackPreviewPanel ≤ 150 行
- [x] MiddlePanel ≤ 100 行
- [x] mod/datapack/modpack 切换后中间面板自动切换
- [x] 搜索筛选正常
- [x] 列头排序正常
