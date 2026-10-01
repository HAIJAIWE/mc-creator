import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import {
  DataTable,
  PanelHeader,
  EmptySpecState,
  StatCard,
  StatCardGrid,
  MetadataView,
  ConflictAlert,
  ExportView,
  FilterBar,
  IconTabBar,
  BatchSelectToolbar,
  downloadBlob,
  countLangEntries,
  useBatchSelection,
  useTabCounts,
  useConflictDetection,
  buildExport,
} from './shared/index.js';
import type { ExportFormat } from './shared/index.js';
import type { KubejsSpec } from '@mc-creator/shared';
import { FileText, Boxes, Tag, Flag, Languages, BookOpen, Database } from 'lucide-react';
import {
  TABS,
  HIDE_COUNT_TABS,
  countByTab,
  countTagType,
  countRegistryType,
  tabLabel,
} from './preview/kubejs/constants.js';
import type {
  KubejsTab,
  RecipeTypeFilter,
  TagTypeFilter,
  RegistryTypeFilter,
  LangRow,
} from './preview/kubejs/constants.js';
import { KJ_CONFLICT_GROUPS } from './preview/kubejs/conflict.js';
import { KJ_EXPORT } from './preview/kubejs/export.js';
import {
  createRecipeColumns,
  createTagColumns,
  createEventColumns,
  createTooltipColumns,
  createRegistryColumns,
  createLangColumns,
} from './preview/kubejs/columns.js';

/** KubeJS 预览面板：8 Tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + ID 重复检测 */
export function KubejsPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<KubejsTab>('recipes');
  const [query, setQuery] = useState('');
  const [recipeTypeFilter, setRecipeTypeFilter] = useState<RecipeTypeFilter>('all');
  const [tagTypeFilter, setTagTypeFilter] = useState<TagTypeFilter>('all');
  const [registryTypeFilter, setRegistryTypeFilter] = useState<RegistryTypeFilter>('all');
  const recipeSelection = useBatchSelection<string>();

  const kj = spec as unknown as KubejsSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!kj) {
      return {
        recipes: 0,
        tags: 0,
        events: 0,
        tooltips: 0,
        registry: 0,
        langCount: 0,
        langEntries: 0,
        advancedTooltips: 0,
        replaceTags: 0,
        customRecipes: 0,
        totalRegistryEntries: 0,
      };
    }
    const { entries: langEntries, languages: langCount } = countLangEntries(kj.lang);
    return {
      recipes: kj.recipes.length,
      tags: kj.tags.length,
      events: kj.events.length,
      tooltips: kj.tooltips.length,
      registry: kj.registry.length,
      langCount,
      langEntries,
      advancedTooltips: kj.tooltips.filter((t) => t.advanced).length,
      replaceTags: kj.tags.filter((t) => t.replace).length,
      customRecipes: kj.recipes.filter((r) => r.type === 'custom').length,
      totalRegistryEntries: kj.registry.reduce(
        (sum, r) => sum + r.items.length + r.blocks.length,
        0,
      ),
    };
  }, [kj]);

  // ===== 配方类型分布 =====
  const recipeTypeStats = useMemo(() => {
    if (!kj) return { shaped: 0, shapeless: 0, smelting: 0, stonecutting: 0, custom: 0 };
    const dist = { shaped: 0, shapeless: 0, smelting: 0, stonecutting: 0, custom: 0 };
    for (const r of kj.recipes) {
      dist[r.type as keyof typeof dist]++;
    }
    return dist;
  }, [kj]);

  // ===== ID 重复检测 =====
  const { totalConflicts, conflictList } = useConflictDetection(kj, KJ_CONFLICT_GROUPS);

  // ===== 配方筛选 =====
  const filteredRecipes = useMemo(() => {
    if (!kj) return [];
    let result = kj.recipes;
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
  }, [kj, query, recipeTypeFilter]);

  // ===== 标签筛选 =====
  const filteredTags = useMemo(() => {
    if (!kj) return [];
    let result = kj.tags;
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
  }, [kj, query, tagTypeFilter]);

  // ===== 事件筛选 =====
  const filteredEvents = useMemo(() => {
    if (!kj) return [];
    if (!query) return kj.events;
    const q = query.toLowerCase();
    return kj.events.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.type.toLowerCase().includes(q) ||
        e.target.toLowerCase().includes(q),
    );
  }, [kj, query]);

  // ===== 工具提示筛选 =====
  const filteredTooltips = useMemo(() => {
    if (!kj) return [];
    if (!query) return kj.tooltips;
    const q = query.toLowerCase();
    return kj.tooltips.filter((t) => t.itemId.toLowerCase().includes(q));
  }, [kj, query]);

  // ===== 注册表筛选 =====
  const filteredRegistry = useMemo(() => {
    if (!kj) return [];
    let result = kj.registry;
    if (registryTypeFilter !== 'all') {
      result = result.filter((r) => r.type === registryTypeFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (r) => r.id.toLowerCase().includes(q) || r.type.toLowerCase().includes(q),
      );
    }
    return result;
  }, [kj, query, registryTypeFilter]);

  // ===== 语言条目展开为行 =====
  const langRows = useMemo<LangRow[]>(() => {
    if (!kj?.lang) return [];
    const rows: LangRow[] = [];
    for (const [langCode, dict] of Object.entries(kj.lang)) {
      for (const [key, value] of Object.entries(dict)) {
        rows.push({ lang: langCode, key, value });
      }
    }
    return rows;
  }, [kj]);

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
      if (!kj) return;
      const idSet = new Set(ids);
      const updated = {
        ...kj,
        recipes: kj.recipes.filter((r) => !idSet.has(r.id)),
      };
      setSpec(updated as unknown as typeof spec);
      recipeSelection.clear();
    },
    [kj, setSpec, recipeSelection],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(
    TABS,
    kj,
    (spec, tab) => countByTab(spec, tab, stats.langEntries),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((tab: KubejsTab) => {
    setActiveTab(tab);
    setQuery('');
    setRecipeTypeFilter('all');
    setTagTypeFilter('all');
    setRegistryTypeFilter('all');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (
      format: ExportFormat,
      scope: 'all' | 'recipes' | 'tags' | 'events' | 'tooltips' | 'registry' | 'lang',
    ) => {
      if (!kj) return;
      const out = buildExport(kj, KJ_EXPORT, format, scope);
      if (!out) return;
      downloadBlob(out.content, out.filename, 'text/plain');
    },
    [kj],
  );

  if (!spec || !kj) {
    return <EmptySpecState label="KubeJS" describe="KubeJS 脚本" />;
  }

  // ===== 列表列定义 =====
  const recipeColumns = createRecipeColumns(recipeSelection, removeRecipes);
  const tagColumns = createTagColumns();
  const eventColumns = createEventColumns();
  const tooltipColumns = createTooltipColumns();
  const registryColumns = createRegistryColumns();
  const langColumns = createLangColumns();

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={kj.packName || kj.packId}
        meta={[
          { label: 'packFormat', value: String(kj.packFormat) },
          { label: 'MC 版本', value: kj.mcVersion || '—' },
          { label: '描述', value: kj.description || '—' },
        ]}
        subtitle={`脚本包 ID: ${kj.packId}`}
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
          label="注册表"
          value={stats.registry}
          sub={`${stats.totalRegistryEntries} 条目`}
          icon={<Database className="h-3 w-3" />}
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
      </StatCardGrid>

      {/* 冲突检测告警 */}
      <ConflictAlert totalConflicts={totalConflicts} conflicts={conflictList} />

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
              <option value="all">全部类型 ({kj.recipes.length})</option>
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
              <option value="all">全部类型 ({kj.tags.length})</option>
              <option value="item">物品 ({countTagType(kj, 'item')})</option>
              <option value="block">方块 ({countTagType(kj, 'block')})</option>
              <option value="entity_type">实体 ({countTagType(kj, 'entity_type')})</option>
              <option value="fluid">流体 ({countTagType(kj, 'fluid')})</option>
              <option value="function">函数 ({countTagType(kj, 'function')})</option>
            </select>
          )}
          {activeTab === 'registry' && (
            <select
              value={registryTypeFilter}
              onChange={(e) => setRegistryTypeFilter(e.target.value as RegistryTypeFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部类型 ({kj.registry.length})</option>
              <option value="item">物品 ({countRegistryType(kj, 'item')})</option>
              <option value="block">方块 ({countRegistryType(kj, 'block')})</option>
              <option value="sound">音效 ({countRegistryType(kj, 'sound')})</option>
              <option value="fluid">流体 ({countRegistryType(kj, 'fluid')})</option>
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
        {activeTab === 'registry' && (
          <DataTable
            columns={registryColumns}
            data={filteredRegistry}
            rowKey={(r) => r.id}
            emptyHint="暂无注册表"
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
        {activeTab === 'metadata' && (
          <MetadataView
            rows={[
              { label: 'Pack ID', value: kj.packId },
              { label: 'Pack Name', value: kj.packName },
              { label: '描述', value: kj.description || '—' },
              { label: 'packFormat', value: String(kj.packFormat) },
              { label: 'MC 版本', value: kj.mcVersion || '—' },
              { label: '语言列表', value: Object.keys(kj.lang ?? {}).join(', ') || '—' },
            ]}
          />
        )}
        {activeTab === 'export' && (
          <ExportView
            title="导出 KubeJS 数据"
            description="将当前 KubeJS 脚本的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'recipes', label: '配方列表', count: kj.recipes.length },
              { scope: 'tags', label: '标签列表', count: kj.tags.length },
              { scope: 'events', label: '事件列表', count: kj.events.length },
              { scope: 'tooltips', label: '工具提示', count: kj.tooltips.length },
              { scope: 'registry', label: '注册表', count: kj.registry.length },
              { scope: 'lang', label: '语言条目', count: stats.langEntries },
            ]}
            onExport={exportData}
            statsTitle="KubeJS 统计"
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
                <StatCard
                  label="注册表"
                  value={stats.registry}
                  sub={`${stats.totalRegistryEntries} 条目`}
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
            配方 {kj.recipes.length} · 显示 {filteredRecipes.length} · 有序 {recipeTypeStats.shaped}{' '}
            · 无序 {recipeTypeStats.shapeless} · 熔炼 {recipeTypeStats.smelting} · 切石{' '}
            {recipeTypeStats.stonecutting} · 自定义 {recipeTypeStats.custom}
          </>
        )}
        {activeTab === 'tags' && (
          <>
            标签 {kj.tags.length} · 显示 {filteredTags.length} · 替换 {stats.replaceTags}
          </>
        )}
        {activeTab === 'events' && (
          <>
            事件 {kj.events.length} · 显示 {filteredEvents.length}
          </>
        )}
        {activeTab === 'tooltips' && (
          <>
            工具提示 {kj.tooltips.length} · 显示 {filteredTooltips.length} · 高级{' '}
            {stats.advancedTooltips}
          </>
        )}
        {activeTab === 'registry' && (
          <>
            注册表 {kj.registry.length} · 显示 {filteredRegistry.length} · 总条目{' '}
            {stats.totalRegistryEntries}
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
