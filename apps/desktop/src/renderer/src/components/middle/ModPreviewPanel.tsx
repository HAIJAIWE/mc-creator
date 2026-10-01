import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import {
  DataTable,
  PanelHeader,
  ConflictAlert,
  ExportView,
  FilterBar,
  EmptySpecState,
  StatCard,
  StatCardGrid,
  MetadataView,
  IconTabBar,
  BatchSelectToolbar,
  downloadBlob,
  useBatchSelection,
  useTabCounts,
  useConflictDetection,
  buildExport,
} from './shared/index.js';
import type { ExportFormat } from './shared/index.js';
import type { ModSpec } from '@mc-creator/shared';
import { FileText, Boxes, Package, Trophy, Tag, FunctionSquare, Layers } from 'lucide-react';
import {
  TABS,
  HIDE_COUNT_TABS,
  ITEM_CATEGORY_LABEL,
  countByTab,
  tabLabel,
} from './preview/mod/constants.js';
import type {
  ModTab,
  ItemRarityFilter,
  ItemCategoryFilter,
  BlockMaterialFilter,
} from './preview/mod/constants.js';
import { MOD_CONFLICT_GROUPS } from './preview/mod/conflict.js';
import { MOD_EXPORT } from './preview/mod/export.js';
import { TagsTab, FunctionsTab } from './preview/mod/tabs.js';
import {
  createItemColumns,
  createBlockColumns,
  createDependencyColumns,
  createLootColumns,
  createAdvancementColumns,
} from './preview/mod/columns.js';

/** Mod 预览面板：9 分类 tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + 冲突检测 */
export function ModPreviewPanel() {
  const { spec, setSpec, unimplemented } = useModStore(
    (s) => ({ spec: s.spec, setSpec: s.setSpec, unimplemented: s.unimplemented }),
    shallow,
  );
  const [activeTab, setActiveTab] = useState<ModTab>('items');
  const [query, setQuery] = useState('');
  const [rarityFilter, setRarityFilter] = useState<ItemRarityFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<ItemCategoryFilter>('all');
  const [materialFilter, setMaterialFilter] = useState<BlockMaterialFilter>('all');
  const itemSelection = useBatchSelection<string>();
  const blockSelection = useBatchSelection<string>();

  const mod = spec as unknown as ModSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!mod) {
      return {
        items: 0,
        blocks: 0,
        deps: 0,
        loot: 0,
        advancements: 0,
        tags: 0,
        functions: 0,
        mandatoryDeps: 0,
        foodItems: 0,
        fuelItems: 0,
      };
    }
    return {
      items: mod.items.length,
      blocks: mod.blocks.length,
      deps: mod.dependencies.length,
      loot: mod.lootTables.length,
      advancements: mod.advancements.length,
      tags: mod.tags.length,
      functions: mod.functions.length,
      mandatoryDeps: mod.dependencies.filter((d) => d.mandatory).length,
      foodItems: mod.items.filter((i) => i.food).length,
      fuelItems: mod.items.filter((i) => i.fuelTick > 0).length,
    };
  }, [mod]);

  // ===== 稀有度分布 =====
  const rarityDistribution = useMemo(() => {
    if (!mod) return { common: 0, uncommon: 0, rare: 0, epic: 0 };
    const dist = { common: 0, uncommon: 0, rare: 0, epic: 0 };
    for (const item of mod.items) {
      dist[item.rarity as keyof typeof dist]++;
    }
    return dist;
  }, [mod]);

  // ===== 冲突检测：id 重复 =====
  const { totalConflicts, conflictList } = useConflictDetection(mod, MOD_CONFLICT_GROUPS);

  // ===== 物品筛选 =====
  const filteredItems = useMemo(() => {
    if (!mod) return [];
    let result = mod.items;
    if (rarityFilter !== 'all') {
      result = result.filter((i) => i.rarity === rarityFilter);
    }
    if (categoryFilter !== 'all') {
      result = result.filter((i) => i.itemCategory === categoryFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (i) => i.id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
      );
    }
    return result;
  }, [mod, query, rarityFilter, categoryFilter]);

  // ===== 方块筛选 =====
  const filteredBlocks = useMemo(() => {
    if (!mod) return [];
    let result = mod.blocks;
    if (materialFilter !== 'all') {
      result = result.filter((b) => b.material === materialFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (b) => b.id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q),
      );
    }
    return result;
  }, [mod, query, materialFilter]);

  // ===== 依赖筛选 =====
  const filteredDeps = useMemo(() => {
    if (!mod) return [];
    if (!query) return mod.dependencies;
    const q = query.toLowerCase();
    return mod.dependencies.filter((d) => d.modId.toLowerCase().includes(q));
  }, [mod, query]);

  // ===== 战利品筛选 =====
  const filteredLoot = useMemo(() => {
    if (!mod) return [];
    if (!query) return mod.lootTables;
    const q = query.toLowerCase();
    return mod.lootTables.filter((l) => l.id.toLowerCase().includes(q));
  }, [mod, query]);

  // ===== 进度筛选 =====
  const filteredAdvancements = useMemo(() => {
    if (!mod) return [];
    if (!query) return mod.advancements;
    const q = query.toLowerCase();
    return mod.advancements.filter(
      (a) =>
        a.id.toLowerCase().includes(q) ||
        (a.display?.title ?? '').toLowerCase().includes(q) ||
        (a.display?.description ?? '').toLowerCase().includes(q),
    );
  }, [mod, query]);

  // ===== 批量选择操作（hooks 必须在 early return 之前）=====
  const removeItems = useCallback(
    (ids: string[]) => {
      if (!mod) return;
      const idSet = new Set(ids);
      const updated = { ...mod, items: mod.items.filter((i) => !idSet.has(i.id)) };
      setSpec(updated as unknown as typeof spec);
      itemSelection.clear();
    },
    [mod, setSpec, itemSelection],
  );

  const removeBlocks = useCallback(
    (ids: string[]) => {
      if (!mod) return;
      const idSet = new Set(ids);
      const updated = { ...mod, blocks: mod.blocks.filter((b) => !idSet.has(b.id)) };
      setSpec(updated as unknown as typeof spec);
      blockSelection.clear();
    },
    [mod, setSpec, blockSelection],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(TABS, mod, countByTab, HIDE_COUNT_TABS);

  const handleTabSelect = useCallback((tab: ModTab) => {
    setActiveTab(tab);
    setQuery('');
    setRarityFilter('all');
    setCategoryFilter('all');
    setMaterialFilter('all');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (format: ExportFormat, scope: 'all' | 'items' | 'blocks' | 'deps') => {
      if (!mod) return;
      const out = buildExport(mod, MOD_EXPORT, format, scope);
      if (!out) return;
      downloadBlob(out.content, out.filename);
    },
    [mod],
  );

  if (!spec || !mod) {
    return (
      <EmptySpecState
        label="Mod"
        describe="mod"
        action={{
          label: '打开命令面板',
          onClick: () => window.dispatchEvent(new Event('mc:open-command-palette')),
        }}
      />
    );
  }

  // ===== 列表列定义 =====
  const itemColumns = createItemColumns(itemSelection, removeItems);
  const blockColumns = createBlockColumns(blockSelection, removeBlocks);
  const depColumns = createDependencyColumns();
  const lootColumns = createLootColumns();
  const advancementColumns = createAdvancementColumns();

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={mod.name || mod.modId}
        meta={[
          { label: 'modId', value: mod.modId },
          { label: '版本', value: mod.version },
          { label: 'License', value: mod.license },
          { label: '作者', value: mod.authors.join(', ') || '—' },
        ]}
        subtitle={mod.description}
      />

      {/* 顶部统计卡片行 */}
      <StatCardGrid>
        <StatCard label="物品" value={stats.items} icon={<Boxes className="h-3 w-3" />} />
        <StatCard label="方块" value={stats.blocks} icon={<Layers className="h-3 w-3" />} />
        <StatCard
          label="依赖"
          value={stats.deps}
          sub={`${stats.mandatoryDeps} 必需`}
          icon={<Package className="h-3 w-3" />}
        />
        <StatCard label="战利品" value={stats.loot} icon={<FileText className="h-3 w-3" />} />
        <StatCard label="进度" value={stats.advancements} icon={<Trophy className="h-3 w-3" />} />
        <StatCard label="标签" value={stats.tags} icon={<Tag className="h-3 w-3" />} />
        <StatCard
          label="函数"
          value={stats.functions}
          icon={<FunctionSquare className="h-3 w-3" />}
        />
      </StatCardGrid>

      {/* 未实现清单横幅（Task 1.1：产物含 MC-Creator unsupported 占位时展示） */}
      {unimplemented.length > 0 && (
        <div
          role="alert"
          className="mx-3 mt-2 rounded border border-yellow-500/60 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-200"
        >
          <div className="font-semibold">
            有 {unimplemented.length} 项内容未能自动生成（已用安全占位代替，见 docs/unsupported.md）
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {unimplemented.slice(0, 8).map((u, i) => (
              <li key={i}>
                {u.kind}={u.type}
                {u.id ? `（id=${u.id}）` : ''}：{u.reason}
              </li>
            ))}
          </ul>
          {unimplemented.length > 8 && (
            <div className="mt-1 opacity-80">
              …等 {unimplemented.length} 项，导出 zip 的 UNIMPLEMENTED.md 含完整清单
            </div>
          )}
        </div>
      )}

      {/* 冲突检测告警 */}
      <ConflictAlert totalConflicts={totalConflicts} conflicts={conflictList} />

      {/* Tab 切换 */}
      <IconTabBar tabs={tabs} activeTab={activeTab} onSelect={handleTabSelect} />

      {/* 搜索 + 高级筛选栏 */}
      {activeTab !== 'metadata' && activeTab !== 'export' && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={`搜索${tabLabel(activeTab)}…`}
        >
          {activeTab === 'items' && (
            <>
              <select
                value={rarityFilter}
                onChange={(e) => setRarityFilter(e.target.value as ItemRarityFilter)}
                className="mc-select !py-1 !text-xs"
              >
                <option value="all">全部稀有度</option>
                <option value="common">普通 ({rarityDistribution.common})</option>
                <option value="uncommon">少见 ({rarityDistribution.uncommon})</option>
                <option value="rare">稀有 ({rarityDistribution.rare})</option>
                <option value="epic">史诗 ({rarityDistribution.epic})</option>
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as ItemCategoryFilter)}
                className="mc-select !py-1 !text-xs"
              >
                <option value="all">全部类别</option>
                {Object.entries(ITEM_CATEGORY_LABEL).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}
          {activeTab === 'blocks' && (
            <select
              value={materialFilter}
              onChange={(e) => setMaterialFilter(e.target.value as BlockMaterialFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部材质</option>
              {(
                [
                  'wood',
                  'stone',
                  'metal',
                  'rock',
                  'cloth',
                  'plant',
                  'sand',
                  'glass',
                  'ice',
                  'water',
                  'lava',
                ] as BlockMaterialFilter[]
              )
                .filter((m) => m !== 'all')
                .map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
            </select>
          )}
        </FilterBar>
      )}

      {/* 物品批量操作栏 */}
      {activeTab === 'items' && (
        <BatchSelectToolbar
          selectedCount={itemSelection.size}
          onBatchRemove={() => removeItems(Array.from(itemSelection.selected))}
          onClearSelection={itemSelection.clear}
        />
      )}

      {/* 方块批量操作栏 */}
      {activeTab === 'blocks' && (
        <BatchSelectToolbar
          selectedCount={blockSelection.size}
          onBatchRemove={() => removeBlocks(Array.from(blockSelection.selected))}
          onClearSelection={blockSelection.clear}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'items' && (
          <DataTable
            columns={itemColumns}
            data={filteredItems}
            rowKey={(r) => r.id}
            emptyHint="暂无物品，在 Spec 中添加 items"
          />
        )}
        {activeTab === 'blocks' && (
          <DataTable
            columns={blockColumns}
            data={filteredBlocks}
            rowKey={(r) => r.id}
            emptyHint="暂无方块，在 Spec 中添加 blocks"
          />
        )}
        {activeTab === 'dependencies' && (
          <DataTable
            columns={depColumns}
            data={filteredDeps}
            rowKey={(r) => r.modId}
            emptyHint="暂无依赖"
          />
        )}
        {activeTab === 'loot' && (
          <DataTable
            columns={lootColumns}
            data={filteredLoot}
            rowKey={(r) => r.id}
            emptyHint="暂无战利品表"
          />
        )}
        {activeTab === 'advancements' && (
          <DataTable
            columns={advancementColumns}
            data={filteredAdvancements}
            rowKey={(r) => r.id}
            emptyHint="暂无进度/成就"
          />
        )}
        {activeTab === 'tags' && <TagsTab tags={mod.tags} query={query} />}
        {activeTab === 'functions' && <FunctionsTab functions={mod.functions} query={query} />}
        {activeTab === 'metadata' && (
          <MetadataView
            rows={[
              { label: 'Mod ID', value: mod.modId },
              { label: '名称', value: mod.name },
              { label: '版本', value: mod.version },
              { label: 'License', value: mod.license },
              { label: '作者', value: mod.authors.join(', ') || '—' },
              { label: '致谢', value: mod.credits || '—' },
              { label: '网站', value: mod.website || '—' },
              { label: '描述', value: mod.description || '—' },
            ]}
          />
        )}
        {activeTab === 'export' && (
          <ExportView
            title="导出 Mod 数据"
            description="将当前 Mod 的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'items', label: '物品列表', count: mod.items.length },
              { scope: 'blocks', label: '方块列表', count: mod.blocks.length },
              { scope: 'deps', label: '依赖列表', count: mod.dependencies.length },
            ]}
            onExport={exportData}
            statsTitle="Mod 统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="物品总数" value={stats.items} />
                <StatCard label="方块总数" value={stats.blocks} />
                <StatCard label="依赖数" value={stats.deps} sub={`${stats.mandatoryDeps} 必需`} />
                <StatCard label="战利品表" value={stats.loot} />
                <StatCard label="进度/成就" value={stats.advancements} />
                <StatCard label="标签" value={stats.tags} />
                <StatCard label="函数" value={stats.functions} />
                <StatCard label="食物物品" value={stats.foodItems} />
                <StatCard label="燃料物品" value={stats.fuelItems} />
                <StatCard
                  label="普通稀有度"
                  value={rarityDistribution.common}
                  icon={<span className="text-[8px] text-mc-dim">●</span>}
                />
                <StatCard
                  label="少见稀有度"
                  value={rarityDistribution.uncommon}
                  icon={<span className="text-[8px] text-yellow-400">●</span>}
                />
                <StatCard
                  label="稀有稀有度"
                  value={rarityDistribution.rare}
                  icon={<span className="text-[8px] text-blue-400">●</span>}
                />
                <StatCard
                  label="史诗稀有度"
                  value={rarityDistribution.epic}
                  icon={<span className="text-[8px] text-purple-400">●</span>}
                />
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'items' && (
          <>
            物品 {mod.items.length} · 显示 {filteredItems.length} · 食物 {stats.foodItems} · 燃料{' '}
            {stats.fuelItems}
          </>
        )}
        {activeTab === 'blocks' && (
          <>
            方块 {mod.blocks.length} · 显示 {filteredBlocks.length}
          </>
        )}
        {activeTab === 'dependencies' && (
          <>
            依赖 {mod.dependencies.length} · 显示 {filteredDeps.length} · 必需 {stats.mandatoryDeps}
          </>
        )}
        {activeTab === 'loot' && (
          <>
            战利品表 {mod.lootTables.length} · 显示 {filteredLoot.length}
          </>
        )}
        {activeTab === 'advancements' && (
          <>
            进度 {mod.advancements.length} · 显示 {filteredAdvancements.length}
          </>
        )}
        {activeTab === 'tags' && <>标签 {mod.tags.length}</>}
        {activeTab === 'functions' && <>函数 {mod.functions.length}</>}
        {activeTab === 'metadata' && <>元数据</>}
        {activeTab === 'export' && <>导出</>}
      </div>
    </div>
  );
}
