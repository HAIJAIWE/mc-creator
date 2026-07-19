import { useState, useMemo, useCallback } from 'react';
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
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  AlertTriangle,
  FileText,
  Boxes,
  Package,
  Users,
  Flag,
} from 'lucide-react';

type BehaviorPackTab = 'entities' | 'recipes' | 'loot' | 'dependencies' | 'metadata' | 'export';

type RecipeTypeFilter = 'all' | 'shaped_crafting' | 'shapeless_crafting' | 'furnace';

const TABS: { key: BehaviorPackTab; label: string; icon: typeof Boxes }[] = [
  { key: 'entities', label: '实体', icon: Users },
  { key: 'recipes', label: '配方', icon: Boxes },
  { key: 'loot', label: '战利品表', icon: FileText },
  { key: 'dependencies', label: '依赖', icon: Package },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const RECIPE_TYPE_LABEL: Record<string, string> = {
  shaped_crafting: '有序合成',
  shapeless_crafting: '无序合成',
  furnace: '熔炼',
};

const RECIPE_TYPE_COLOR: Record<string, string> = {
  shaped_crafting: 'bg-blue-500/20 text-blue-400',
  shapeless_crafting: 'bg-green-500/20 text-green-400',
  furnace: 'bg-orange-500/20 text-orange-400',
};

/** BehaviorPack 预览面板：6 Tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + UUID 重复检测 */
export function BehaviorPackPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<BehaviorPackTab>('entities');
  const [query, setQuery] = useState('');
  const [recipeTypeFilter, setRecipeTypeFilter] = useState<RecipeTypeFilter>('all');
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());

  const bp = spec as unknown as BehaviorPackSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!bp) {
      return {
        entities: 0,
        recipes: 0,
        loot: 0,
        deps: 0,
        totalComponents: 0,
        totalEvents: 0,
        totalLootEntries: 0,
        hasUuid: false,
      };
    }
    return {
      entities: bp.entities.length,
      recipes: bp.recipes.length,
      loot: bp.lootTables.length,
      deps: bp.dependencies.length,
      totalComponents: bp.entities.reduce((sum, e) => sum + Object.keys(e.components).length, 0),
      totalEvents: bp.entities.reduce((sum, e) => sum + Object.keys(e.events).length, 0),
      totalLootEntries: bp.lootTables.reduce(
        (sum, l) => sum + l.pools.reduce((s, p) => s + p.entries.length, 0),
        0,
      ),
      hasUuid: Boolean(bp.header.uuid),
    };
  }, [bp]);

  // ===== 配方类型分布 =====
  const recipeTypeStats = useMemo(() => {
    if (!bp) return { shaped_crafting: 0, shapeless_crafting: 0, furnace: 0 };
    const dist = { shaped_crafting: 0, shapeless_crafting: 0, furnace: 0 };
    for (const r of bp.recipes) {
      dist[r.type as keyof typeof dist]++;
    }
    return dist;
  }, [bp]);

  // ===== UUID 重复检测 =====
  const conflicts = useMemo(() => {
    if (!bp) return { duplicateEntityIds: [], duplicateRecipeIds: [], duplicateLootPaths: [] };
    const entityIds = new Map<string, number>();
    const recipeIds = new Map<string, number>();
    const lootPaths = new Map<string, number>();
    for (const e of bp.entities) {
      entityIds.set(e.identifier, (entityIds.get(e.identifier) ?? 0) + 1);
    }
    for (const r of bp.recipes) {
      recipeIds.set(r.identifier, (recipeIds.get(r.identifier) ?? 0) + 1);
    }
    for (const l of bp.lootTables) {
      lootPaths.set(l.path, (lootPaths.get(l.path) ?? 0) + 1);
    }
    return {
      duplicateEntityIds: Array.from(entityIds.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count })),
      duplicateRecipeIds: Array.from(recipeIds.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count })),
      duplicateLootPaths: Array.from(lootPaths.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => ({ id, count })),
    };
  }, [bp]);

  const totalConflicts =
    conflicts.duplicateEntityIds.length +
    conflicts.duplicateRecipeIds.length +
    conflicts.duplicateLootPaths.length;

  // ===== 实体筛选 =====
  const filteredEntities = useMemo(() => {
    if (!bp) return [];
    if (!query) return bp.entities;
    const q = query.toLowerCase();
    return bp.entities.filter((e) => e.identifier.toLowerCase().includes(q));
  }, [bp, query]);

  // ===== 配方筛选 =====
  const filteredRecipes = useMemo(() => {
    if (!bp) return [];
    let result = bp.recipes;
    if (recipeTypeFilter !== 'all') {
      result = result.filter((r) => r.type === recipeTypeFilter);
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (r) => r.identifier.toLowerCase().includes(q) || r.result.toLowerCase().includes(q),
      );
    }
    return result;
  }, [bp, query, recipeTypeFilter]);

  // ===== 战利品表筛选 =====
  const filteredLoot = useMemo(() => {
    if (!bp) return [];
    if (!query) return bp.lootTables;
    const q = query.toLowerCase();
    return bp.lootTables.filter((l) => l.path.toLowerCase().includes(q));
  }, [bp, query]);

  // ===== 批量选择操作 =====
  const toggleEntitySelect = useCallback((id: string) => {
    setSelectedEntityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleRecipeSelect = useCallback((id: string) => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeEntities = useCallback(
    (ids: string[]) => {
      if (!bp) return;
      const idSet = new Set(ids);
      const updated = {
        ...bp,
        entities: bp.entities.filter((e) => !idSet.has(e.identifier)),
      };
      setSpec(updated as unknown as typeof spec);
      setSelectedEntityIds(new Set());
    },
    [bp, setSpec],
  );

  const removeRecipes = useCallback(
    (ids: string[]) => {
      if (!bp) return;
      const idSet = new Set(ids);
      const updated = {
        ...bp,
        recipes: bp.recipes.filter((r) => !idSet.has(r.identifier)),
      };
      setSpec(updated as unknown as typeof spec);
      setSelectedRecipeIds(new Set());
    },
    [bp, setSpec],
  );

  // ===== 导出函数 =====
  const exportData = useCallback(
    (format: 'json' | 'csv' | 'markdown', scope: 'all' | 'entities' | 'recipes' | 'loot') => {
      if (!bp) return;
      let data: unknown;
      let filename = '';
      let content = '';

      if (scope === 'all') {
        data = bp;
      } else if (scope === 'entities') {
        data = bp.entities;
      } else if (scope === 'recipes') {
        data = bp.recipes;
      } else {
        data = bp.lootTables;
      }

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `${bp.packId}-${scope}.json`;
      } else if (format === 'csv') {
        if (scope === 'entities') {
          const rows = ['Identifier,Components,Events,DescriptionGroups'];
          for (const e of bp.entities) {
            rows.push(
              `"${e.identifier}",${Object.keys(e.components).length},${Object.keys(e.events).length},${e.description_groups.length}`,
            );
          }
          content = rows.join('\n');
        } else if (scope === 'recipes') {
          const rows = ['Identifier,Type,Result,Count'];
          for (const r of bp.recipes) {
            rows.push(`"${r.identifier}","${r.type}","${r.result}",${r.count}`);
          }
          content = rows.join('\n');
        } else if (scope === 'loot') {
          const rows = ['Path,Pools,TotalEntries'];
          for (const l of bp.lootTables) {
            const totalEntries = l.pools.reduce((s, p) => s + p.entries.length, 0);
            rows.push(`"${l.path}",${l.pools.length},${totalEntries}`);
          }
          content = rows.join('\n');
        } else {
          content = JSON.stringify(data, null, 2);
        }
        filename = `${bp.packId}-${scope}.csv`;
      } else {
        // markdown
        const lines: string[] = [];
        if (scope === 'all') {
          lines.push(`# ${bp.packName || bp.packId}`, '');
          lines.push(`- **Pack ID**: ${bp.packId}`);
          lines.push(`- **Format**: ${bp.packFormat}`);
          lines.push(`- **描述**: ${bp.description || '—'}`);
          lines.push('');
          lines.push('## 实体列表', '');
          for (const e of bp.entities) {
            lines.push(
              `- \`${e.identifier}\` — ${Object.keys(e.components).length} 组件 / ${Object.keys(e.events).length} 事件`,
            );
          }
          lines.push('');
          lines.push('## 配方列表', '');
          for (const r of bp.recipes) {
            lines.push(
              `- \`${r.identifier}\` — ${RECIPE_TYPE_LABEL[r.type] ?? r.type} → ${r.result} x${r.count}`,
            );
          }
          lines.push('');
          lines.push('## 战利品表', '');
          for (const l of bp.lootTables) {
            lines.push(`- \`${l.path}\` — ${l.pools.length} 池`);
          }
        } else if (scope === 'entities') {
          lines.push(`# ${bp.packName || bp.packId} - 实体列表`, '');
          lines.push(`共 ${bp.entities.length} 个实体`, '');
          lines.push('| Identifier | 组件数 | 事件数 |', '|---|---|---|');
          for (const e of bp.entities) {
            lines.push(
              `| \`${e.identifier}\` | ${Object.keys(e.components).length} | ${Object.keys(e.events).length} |`,
            );
          }
        } else if (scope === 'recipes') {
          lines.push(`# ${bp.packName || bp.packId} - 配方列表`, '');
          lines.push(`共 ${bp.recipes.length} 个配方`, '');
          lines.push('| Identifier | 类型 | 产物 | 数量 |', '|---|---|---|---|');
          for (const r of bp.recipes) {
            lines.push(
              `| \`${r.identifier}\` | ${RECIPE_TYPE_LABEL[r.type] ?? r.type} | ${r.result} | ${r.count} |`,
            );
          }
        } else if (scope === 'loot') {
          lines.push(`# ${bp.packName || bp.packId} - 战利品表`, '');
          lines.push(`共 ${bp.lootTables.length} 个战利品表`, '');
          lines.push('| Path | 池数 | 总条目 |', '|---|---|---|');
          for (const l of bp.lootTables) {
            const totalEntries = l.pools.reduce((s, p) => s + p.entries.length, 0);
            lines.push(`| \`${l.path}\` | ${l.pools.length} | ${totalEntries} |`);
          }
        }
        content = lines.join('\n');
        filename = `${bp.packId}-${scope}.md`;
      }

      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [bp],
  );

  if (!spec || !bp) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成行为包 Spec"
        hint="在右侧 AgentPanel 描述你想要的行为包，生成 Spec 后即可预览"
      />
    );
  }

  // ===== 实体列定义 =====
  const entityColumns: Column<BpEntitySpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleEntitySelect(r.identifier);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selectedEntityIds.has(r.identifier) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'identifier',
      header: '标识符',
      width: '40%',
      sortValue: (r) => r.identifier,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.identifier}</span>,
    },
    {
      key: 'components',
      header: '组件数',
      width: '15%',
      sortValue: (r) => Object.keys(r.components).length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {Object.keys(r.components).length}
        </span>
      ),
    },
    {
      key: 'events',
      header: '事件数',
      width: '15%',
      sortValue: (r) => Object.keys(r.events).length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {Object.keys(r.events).length}
        </span>
      ),
    },
    {
      key: 'groups',
      header: '描述组',
      width: '20%',
      sortValue: (r) => r.description_groups.length,
      render: (r) =>
        r.description_groups.length > 0 ? r.description_groups.slice(0, 2).join(', ') : '—',
    },
    {
      key: 'actions',
      header: '',
      width: '6%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeEntities([r.identifier]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];

  // ===== 配方列定义 =====
  const recipeColumns: Column<BpRecipeSpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleRecipeSelect(r.identifier);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selectedRecipeIds.has(r.identifier) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'identifier',
      header: '标识符',
      width: '30%',
      sortValue: (r) => r.identifier,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.identifier}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '15%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${RECIPE_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {RECIPE_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
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
      width: '11%',
      render: (r) =>
        r.pattern ? `${r.pattern.length} 行` : r.items ? `${r.items.length} 材料` : '—',
    },
  ];

  // ===== 战利品表列定义 =====
  const lootColumns: Column<BpLootTableSpec>[] = [
    {
      key: 'path',
      header: '路径',
      width: '50%',
      sortValue: (r) => r.path,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.path}</span>,
    },
    {
      key: 'pools',
      header: '池数',
      width: '20%',
      sortValue: (r) => r.pools.length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {r.pools.length}
        </span>
      ),
    },
    {
      key: 'entries',
      header: '总条目',
      width: '30%',
      sortValue: (r) => r.pools.reduce((sum, p) => sum + p.entries.length, 0),
      render: (r) => String(r.pools.reduce((sum, p) => sum + p.entries.length, 0)),
    },
  ];

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={bp.packName || bp.packId}
        meta={[
          { label: 'packFormat', value: String(bp.packFormat) },
          { label: 'MC', value: bp.mcVersion.join('.') },
          { label: '描述', value: bp.description || '—' },
        ]}
        subtitle={`行为包 ID: ${bp.packId}`}
      />

      {/* 统计卡片行 */}
      <div className="grid grid-cols-3 gap-2 border-b border-mc-border bg-mc-surface-2/30 p-2 sm:grid-cols-4 md:grid-cols-7">
        <StatCard label="实体" value={stats.entities} icon={<Users className="h-3 w-3" />} />
        <StatCard label="配方" value={stats.recipes} icon={<Boxes className="h-3 w-3" />} />
        <StatCard label="战利品表" value={stats.loot} icon={<FileText className="h-3 w-3" />} />
        <StatCard label="依赖" value={stats.deps} icon={<Package className="h-3 w-3" />} />
        <StatCard
          label="组件总数"
          value={stats.totalComponents}
          icon={<Flag className="h-3 w-3" />}
        />
        <StatCard label="事件总数" value={stats.totalEvents} icon={<Flag className="h-3 w-3" />} />
        <StatCard
          label="战利品条目"
          value={stats.totalLootEntries}
          icon={<Flag className="h-3 w-3" />}
        />
      </div>

      {/* 冲突检测告警 */}
      {totalConflicts > 0 && (
        <div className="flex items-start gap-2 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-yellow-400" />
          <div className="text-[11px] text-yellow-300">
            检测到 <strong>{totalConflicts}</strong> 处冲突：
            {conflicts.duplicateEntityIds.length > 0 &&
              ` 实体标识符重复 ${conflicts.duplicateEntityIds.length} 处`}
            {conflicts.duplicateRecipeIds.length > 0 &&
              ` · 配方标识符重复 ${conflicts.duplicateRecipeIds.length} 处`}
            {conflicts.duplicateLootPaths.length > 0 &&
              ` · 战利品表路径重复 ${conflicts.duplicateLootPaths.length} 处`}
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-mc-border bg-mc-surface px-2 py-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setActiveTab(t.key);
              setQuery('');
              setRecipeTypeFilter('all');
            }}
            className={`flex items-center gap-1 rounded-mc px-2.5 py-1 text-[11px] font-medium transition-colors ${
              activeTab === t.key
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            <t.icon className="h-3 w-3" />
            {t.label}
            {t.key !== 'metadata' && t.key !== 'export' && (
              <span className="ml-0.5 text-mc-mute">({countByTab(bp, t.key)})</span>
            )}
          </button>
        ))}
      </div>

      {/* 搜索 + 筛选栏 */}
      {activeTab !== 'metadata' && activeTab !== 'export' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-mc-border px-3 py-2">
          <div className="flex-1 min-w-[180px]">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder={`搜索${tabLabel(activeTab)}…`}
            />
          </div>
          {activeTab === 'recipes' && (
            <select
              value={recipeTypeFilter}
              onChange={(e) => setRecipeTypeFilter(e.target.value as RecipeTypeFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部类型 ({bp.recipes.length})</option>
              <option value="shaped_crafting">有序合成 ({recipeTypeStats.shaped_crafting})</option>
              <option value="shapeless_crafting">
                无序合成 ({recipeTypeStats.shapeless_crafting})
              </option>
              <option value="furnace">熔炼 ({recipeTypeStats.furnace})</option>
            </select>
          )}
        </div>
      )}

      {/* 实体批量操作栏 */}
      {activeTab === 'entities' && selectedEntityIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-mc-border bg-mc-accent/10 px-3 py-1.5">
          <span className="text-[11px] text-mc-text">已选 {selectedEntityIds.size} 项</span>
          <button
            onClick={() => removeEntities(Array.from(selectedEntityIds))}
            className="flex items-center gap-1 rounded-mc bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/30"
          >
            <Trash2 className="h-3 w-3" /> 批量移除
          </button>
          <button
            onClick={() => setSelectedEntityIds(new Set())}
            className="ml-auto text-[10px] text-mc-dim hover:text-mc-text"
          >
            取消选择
          </button>
        </div>
      )}

      {/* 配方批量操作栏 */}
      {activeTab === 'recipes' && selectedRecipeIds.size > 0 && (
        <div className="flex items-center gap-2 border-b border-mc-border bg-mc-accent/10 px-3 py-1.5">
          <span className="text-[11px] text-mc-text">已选 {selectedRecipeIds.size} 项</span>
          <button
            onClick={() => removeRecipes(Array.from(selectedRecipeIds))}
            className="flex items-center gap-1 rounded-mc bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/30"
          >
            <Trash2 className="h-3 w-3" /> 批量移除
          </button>
          <button
            onClick={() => setSelectedRecipeIds(new Set())}
            className="ml-auto text-[10px] text-mc-dim hover:text-mc-text"
          >
            取消选择
          </button>
        </div>
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'entities' && (
          <DataTable
            columns={entityColumns}
            data={filteredEntities}
            rowKey={(r) => r.identifier}
            emptyHint="暂无实体"
          />
        )}
        {activeTab === 'recipes' && (
          <DataTable
            columns={recipeColumns}
            data={filteredRecipes}
            rowKey={(r) => r.identifier}
            emptyHint="暂无配方"
          />
        )}
        {activeTab === 'loot' && (
          <DataTable
            columns={lootColumns}
            data={filteredLoot}
            rowKey={(r) => r.path}
            emptyHint="暂无战利品表"
          />
        )}
        {activeTab === 'dependencies' && <DepsView deps={bp.dependencies} />}
        {activeTab === 'metadata' && <MetadataView bp={bp} />}
        {activeTab === 'export' && (
          <ExportView
            bp={bp}
            stats={stats}
            recipeTypeStats={recipeTypeStats}
            onExport={exportData}
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'entities' && (
          <>
            实体 {bp.entities.length} · 显示 {filteredEntities.length} · 组件{' '}
            {stats.totalComponents} · 事件 {stats.totalEvents}
          </>
        )}
        {activeTab === 'recipes' && (
          <>
            配方 {bp.recipes.length} · 显示 {filteredRecipes.length} · 有序{' '}
            {recipeTypeStats.shaped_crafting} · 无序 {recipeTypeStats.shapeless_crafting} · 熔炼{' '}
            {recipeTypeStats.furnace}
          </>
        )}
        {activeTab === 'loot' && (
          <>
            战利品表 {bp.lootTables.length} · 显示 {filteredLoot.length} · 条目{' '}
            {stats.totalLootEntries}
          </>
        )}
        {activeTab === 'dependencies' && <>依赖 {bp.dependencies.length}</>}
        {activeTab === 'metadata' && <>元数据</>}
        {activeTab === 'export' && <>导出</>}
      </div>
    </div>
  );
}

function countByTab(bp: BehaviorPackSpec, tab: BehaviorPackTab): number {
  if (tab === 'entities') return bp.entities.length;
  if (tab === 'recipes') return bp.recipes.length;
  if (tab === 'loot') return bp.lootTables.length;
  if (tab === 'dependencies') return bp.dependencies.length;
  return 0;
}

function tabLabel(tab: BehaviorPackTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== 统计卡片 =====
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2/60 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[10px] text-mc-mute">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-display text-base font-bold text-mc-text">{value}</div>
    </div>
  );
}

// ===== 依赖视图 =====
function DepsView({ deps }: { deps: BehaviorPackSpec['dependencies'] }) {
  if (deps.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-xs text-mc-mute">
        暂无依赖（行为包 UUID 依赖）
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-3">
      {deps.map((d, idx) => (
        <div
          key={`${d.uuid}-${idx}`}
          className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2"
        >
          <div className="flex items-center gap-2">
            <Package className="h-3 w-3 text-mc-accent" />
            <span className="font-mono text-[11px] text-mc-text">{d.uuid}</span>
          </div>
          <div className="mt-1 text-[10px] text-mc-mute">版本: {d.version.join('.')}</div>
        </div>
      ))}
    </div>
  );
}

// ===== 元数据视图 =====
function MetadataView({ bp }: { bp: BehaviorPackSpec }) {
  const rows: { label: string; value: string }[] = [
    { label: 'Pack ID', value: bp.packId },
    { label: 'Pack Name', value: bp.packName },
    { label: '描述', value: bp.description || '—' },
    { label: 'packFormat', value: String(bp.packFormat) },
    { label: 'MC 版本', value: bp.mcVersion.join('.') },
    { label: 'Header UUID', value: bp.header.uuid || '—' },
    {
      label: 'Header 版本',
      value: bp.header.version ? bp.header.version.join('.') : '—',
    },
    {
      label: 'Min Engine',
      value: bp.header.min_engine_version ? bp.header.min_engine_version.join('.') : '—',
    },
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

// ===== 导出视图 =====
function ExportView({
  bp,
  stats,
  recipeTypeStats,
  onExport,
}: {
  bp: BehaviorPackSpec;
  stats: {
    entities: number;
    recipes: number;
    loot: number;
    deps: number;
    totalComponents: number;
    totalEvents: number;
    totalLootEntries: number;
    hasUuid: boolean;
  };
  recipeTypeStats: { shaped_crafting: number; shapeless_crafting: number; furnace: number };
  onExport: (
    format: 'json' | 'csv' | 'markdown',
    scope: 'all' | 'entities' | 'recipes' | 'loot',
  ) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div>
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-mc-text">
          <Download className="h-4 w-4 text-mc-accent" />
          导出行为包数据
        </h3>
        <p className="mb-3 text-xs text-mc-mute">
          将当前行为包的 Spec 数据导出为不同格式，方便分享、文档归档或迁移
        </p>

        {/* 完整 Spec */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">完整 Spec</div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onExport('json', 'all')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> JSON
            </button>
            <button
              onClick={() => onExport('markdown', 'all')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> Markdown
            </button>
          </div>
        </div>

        {/* 实体列表 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">
            实体列表 ({bp.entities.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onExport('json', 'entities')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> JSON
            </button>
            <button
              onClick={() => onExport('csv', 'entities')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <button
              onClick={() => onExport('markdown', 'entities')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> Markdown
            </button>
          </div>
        </div>

        {/* 配方列表 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">
            配方列表 ({bp.recipes.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onExport('json', 'recipes')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> JSON
            </button>
            <button
              onClick={() => onExport('csv', 'recipes')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <button
              onClick={() => onExport('markdown', 'recipes')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> Markdown
            </button>
          </div>
        </div>

        {/* 战利品表 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">
            战利品表 ({bp.lootTables.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onExport('json', 'loot')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> JSON
            </button>
            <button
              onClick={() => onExport('csv', 'loot')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> CSV
            </button>
            <button
              onClick={() => onExport('markdown', 'loot')}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
            >
              <Download className="h-3 w-3" /> Markdown
            </button>
          </div>
        </div>
      </div>

      {/* 统计概览 */}
      <div className="border-t border-mc-border pt-4">
        <h3 className="mb-2 text-sm font-medium text-mc-text">行为包统计</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          <StatCard label="实体总数" value={stats.entities} />
          <StatCard label="配方总数" value={stats.recipes} />
          <StatCard label="战利品表" value={stats.loot} />
          <StatCard label="UUID 依赖" value={stats.deps} />
          <StatCard label="组件总数" value={stats.totalComponents} />
          <StatCard label="事件总数" value={stats.totalEvents} />
          <StatCard label="战利品条目" value={stats.totalLootEntries} />
          <StatCard label="有序合成" value={recipeTypeStats.shaped_crafting} />
          <StatCard label="无序合成" value={recipeTypeStats.shapeless_crafting} />
          <StatCard label="熔炼配方" value={recipeTypeStats.furnace} />
        </div>
      </div>
    </div>
  );
}
