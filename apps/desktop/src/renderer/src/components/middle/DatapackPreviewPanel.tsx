import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, FilterBar, EmptyState, IconTabBar } from './shared/index.js';
import type { Column, TabItem } from './shared/index.js';
import type {
  DatapackSpec,
  FunctionSpec,
  LootTableSpec,
  PredicateSpec,
  AdvancementSpec,
  RecipeSpec,
  TagSpec,
  SimpleTagSpec,
  DatapackEnchantmentSpec,
  StatusEffectSpec,
  DamageTypeSpec,
  StructureSpec,
  ParticleSpec,
  TrimPatternSpec,
  TrimMaterialSpec,
  InstrumentSpec,
  DimensionSpec,
  DimensionTypeSpec,
  BiomeSpec,
  StructureSetSpec,
  ValidationIssue,
} from '@mc-creator/shared';
import { validateDatapack } from '@mc-creator/shared';

type DatapackTab =
  | 'functions'
  | 'loot'
  | 'advancements'
  | 'recipes'
  | 'tags'
  | 'enchantments'
  | 'effects'
  | 'damage'
  | 'structures'
  | 'particles'
  | 'trims'
  | 'instruments'
  | 'structure_sets'
  | 'worldgen'
  | 'validation';

/** 校验类型到 tab 的映射 */
const validationTypeToTab: Record<string, DatapackTab> = {
  recipe: 'recipes',
  function: 'functions',
  tag: 'tags',
  advancement: 'advancements',
  enchantment: 'enchantments',
  effect: 'effects',
  damageType: 'damage',
  structure: 'structures',
  particle: 'particles',
  trim: 'trims',
  instrument: 'instruments',
  dimensionType: 'worldgen',
  biome: 'worldgen',
  dimension: 'worldgen',
  pack: 'recipes',
};

const TABS: { key: DatapackTab; label: string }[] = [
  { key: 'recipes', label: '配方' },
  { key: 'functions', label: '函数' },
  { key: 'loot', label: '战利品' },
  { key: 'advancements', label: '进度' },
  { key: 'tags', label: '标签' },
  { key: 'enchantments', label: '附魔' },
  { key: 'effects', label: '效果' },
  { key: 'damage', label: '损伤' },
  { key: 'structures', label: '结构' },
  { key: 'structure_sets', label: '结构集' },
  { key: 'particles', label: '粒子' },
  { key: 'trims', label: '纹饰' },
  { key: 'instruments', label: '乐器' },
  { key: 'worldgen', label: '世界' },
  { key: 'validation', label: '校验' },
];

/** Datapack 预览面板：15 分类 tab + 表格 + 搜索 + 校验 */
export function DatapackPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [activeTab, setActiveTab] = useState<DatapackTab>('recipes');
  const [query, setQuery] = useState('');

  // 实时校验（必须在所有 hooks 之后才能 early return）
  const dp = spec as unknown as DatapackSpec;
  const validationResult = useMemo(
    () =>
      spec
        ? validateDatapack(dp)
        : {
            valid: true,
            issues: [] as ValidationIssue[],
            summary: { errors: 0, warnings: 0, infos: 0 },
          },
    [spec, dp],
  );
  const issuesByTab = useMemo(() => {
    const map = new Map<DatapackTab, ValidationIssue[]>();
    for (const issue of validationResult.issues) {
      const tab = validationTypeToTab[issue.type] ?? 'validation';
      const list = map.get(tab) ?? [];
      list.push(issue);
      map.set(tab, list);
    }
    return map;
  }, [validationResult]);

  // ===== Tab 配置（预计算 count + error/warning；hooks 必须在 early return 之前）=====
  const tabs = useMemo<TabItem<DatapackTab>[]>(() => {
    if (!spec) return TABS.map((t) => ({ key: t.key, label: t.label }));
    const dp = spec as unknown as DatapackSpec;
    const lootCount = dp.lootTables.length + dp.predicates.length;
    const tagCount = dp.tags.length + dp.itemTags.length + dp.blockTags.length;
    const trimCount = dp.trimPatterns.length + dp.trimMaterials.length;
    const issueCount = validationResult.issues.length;
    return TABS.map((t) => {
      const tabIssues = issuesByTab.get(t.key);
      const tabErrors = tabIssues?.filter((i) => i.level === 'error').length ?? 0;
      const tabWarnings = tabIssues?.filter((i) => i.level === 'warning').length ?? 0;
      return {
        key: t.key,
        label: t.label,
        count: countByTab(dp, lootCount, tagCount, trimCount, issueCount, t.key),
        error: tabErrors > 0 ? tabErrors : undefined,
        warning: tabWarnings > 0 && tabErrors === 0 ? tabWarnings : undefined,
      };
    });
  }, [spec, issuesByTab, validationResult.issues.length]);

  const handleTabSelect = useCallback((tab: DatapackTab) => {
    setActiveTab(tab);
    setQuery('');
  }, []);

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成数据包 Spec"
        hint="在右侧 AgentPanel 描述你想要的数据包，生成 Spec 后即可预览"
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={dp.packName || dp.packId}
        meta={[
          { label: 'packFormat', value: String(dp.packFormat) },
          { label: '描述', value: dp.description || '—' },
          ...(validationResult.summary.errors > 0
            ? [{ label: '❌ 错误', value: String(validationResult.summary.errors) }]
            : []),
          ...(validationResult.summary.warnings > 0
            ? [{ label: '⚠️ 警告', value: String(validationResult.summary.warnings) }]
            : []),
        ]}
        subtitle={`数据包 ID: ${dp.packId}`}
      />

      {/* Tab 栏 - 两行排列 */}
      <IconTabBar tabs={tabs} activeTab={activeTab} onSelect={handleTabSelect} />

      <FilterBar
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={`搜索${tabs.find((t) => t.key === activeTab)?.label ?? ''}…`}
      />

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'recipes' && <RecipesTab items={dp.recipes} query={query} />}
        {activeTab === 'functions' && <FunctionsTab items={dp.functions} query={query} />}
        {activeTab === 'loot' && (
          <LootTab lootTables={dp.lootTables} predicates={dp.predicates} query={query} />
        )}
        {activeTab === 'advancements' && <AdvancementsTab items={dp.advancements} query={query} />}
        {activeTab === 'tags' && (
          <TagsTab tags={dp.tags} itemTags={dp.itemTags} blockTags={dp.blockTags} query={query} />
        )}
        {activeTab === 'enchantments' && <EnchantmentsTab items={dp.enchantments} query={query} />}
        {activeTab === 'effects' && <EffectsTab items={dp.effects} query={query} />}
        {activeTab === 'damage' && <DamageTab items={dp.damageTypes} query={query} />}
        {activeTab === 'structures' && <StructuresTab items={dp.structures} query={query} />}
        {activeTab === 'structure_sets' && (
          <StructureSetsTab items={dp.structureSets} query={query} />
        )}
        {activeTab === 'particles' && <ParticlesTab items={dp.particles} query={query} />}
        {activeTab === 'trims' && (
          <TrimsTab patterns={dp.trimPatterns} materials={dp.trimMaterials} query={query} />
        )}
        {activeTab === 'instruments' && <InstrumentsTab items={dp.instruments} query={query} />}
        {activeTab === 'worldgen' && (
          <WorldgenTab
            dimensions={dp.dimensions}
            dimensionTypes={dp.dimensionTypes}
            biomes={dp.biomes}
            query={query}
          />
        )}
        {activeTab === 'validation' && (
          <ValidationTab issues={validationResult.issues} query={query} />
        )}
      </div>

      <div className="border-t border-mc-border px-4 py-1 text-[10px] text-mc-mute">
        配方 {dp.recipes.length} · 函数 {dp.functions.length} · 附魔 {dp.enchantments.length} · 效果{' '}
        {dp.effects.length}· 结构 {dp.structures.length} · 维度 {dp.dimensions.length} · 生物群系{' '}
        {dp.biomes.length}
      </div>
    </div>
  );
}

function countByTab(
  dp: DatapackSpec,
  lootCount: number,
  tagCount: number,
  trimCount: number,
  issueCount: number,
  tab: DatapackTab,
): number {
  switch (tab) {
    case 'recipes':
      return dp.recipes.length;
    case 'functions':
      return dp.functions.length;
    case 'loot':
      return lootCount;
    case 'advancements':
      return dp.advancements.length;
    case 'tags':
      return tagCount;
    case 'enchantments':
      return dp.enchantments.length;
    case 'effects':
      return dp.effects.length;
    case 'damage':
      return dp.damageTypes.length;
    case 'structures':
      return dp.structures.length;
    case 'structure_sets':
      return dp.structureSets.length;
    case 'particles':
      return dp.particles.length;
    case 'trims':
      return trimCount;
    case 'instruments':
      return dp.instruments.length;
    case 'worldgen':
      return dp.dimensions.length + dp.dimensionTypes.length + dp.biomes.length;
    case 'validation':
      return issueCount;
    default:
      return 0;
  }
}

// ===== 原有 Tab 组件（函数/战利品/进度/配方/标签）=====

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
    blasting: '高炉',
    smoking: '烟熏',
    campfire_cooking: '营火',
    stonecutting: '切石',
    smithing_transform: '锻造',
    smithing_trim: '纹饰锻造',
    brewing: '酿造',
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
    { key: 'source', header: '来源', width: '15%', sortValue: (r) => r.source },
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

// ===== 新内容类型 Tab =====

function EnchantmentsTab({ items, query }: { items: DatapackEnchantmentSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(
      (e) => e.id.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    );
  }, [items, query]);

  const columns: Column<DatapackEnchantmentSpec>[] = [
    { key: 'id', header: '附魔 ID', width: '25%', sortValue: (r) => r.id },
    { key: 'description', header: '描述', width: '20%', sortValue: (r) => r.description },
    {
      key: 'maxLevel',
      header: '最大等级',
      width: '10%',
      sortValue: (r) => r.maxLevel,
      render: (r) => String(r.maxLevel),
    },
    {
      key: 'weight',
      header: '权重',
      width: '10%',
      sortValue: (r) => r.weight,
      render: (r) => String(r.weight),
    },
    {
      key: 'anvilCost',
      header: '铁砧消耗',
      width: '10%',
      sortValue: (r) => r.anvilCost,
      render: (r) => String(r.anvilCost),
    },
    { key: 'supportedItems', header: '适用物品', width: '15%', render: (r) => r.supportedItems },
    {
      key: 'flags',
      header: '标记',
      width: '10%',
      render: (r) =>
        [r.isCurse ? '诅咒' : '', r.isTreasure ? '宝藏' : ''].filter(Boolean).join(' ') || '—',
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无自定义附魔" />
  );
}

function EffectsTab({ items, query }: { items: StatusEffectSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((e) => e.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<StatusEffectSpec>[] = [
    { key: 'id', header: '效果 ID', width: '30%', sortValue: (r) => r.id },
    { key: 'description', header: '描述', width: '30%', sortValue: (r) => r.description },
    {
      key: 'color',
      header: '颜色',
      width: '15%',
      render: (r) => `#${r.color.toString(16).padStart(6, '0')}`,
    },
    { key: 'instant', header: '即时', width: '10%', render: (r) => (r.instant ? '是' : '否') },
    {
      key: 'beneficial',
      header: '有益',
      width: '15%',
      render: (r) => (r.beneficial ? '是' : '否'),
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无自定义效果" />
  );
}

function DamageTab({ items, query }: { items: DamageTypeSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((d) => d.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<DamageTypeSpec>[] = [
    { key: 'id', header: '损伤类型 ID', width: '30%', sortValue: (r) => r.id },
    { key: 'messageType', header: '消息类型', width: '25%', sortValue: (r) => r.messageType },
    { key: 'scaling', header: '缩放', width: '25%', sortValue: (r) => r.scaling },
    { key: 'exhaustion', header: '疲劳', width: '20%', render: (r) => r.exhaustion.toFixed(1) },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => r.id}
      emptyHint="暂无自定义损伤类型"
    />
  );
}

function StructuresTab({ items, query }: { items: StructureSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((s) => s.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<StructureSpec>[] = [
    { key: 'id', header: '结构 ID', width: '25%', sortValue: (r) => r.id },
    { key: 'placementType', header: '放置', width: '15%', sortValue: (r) => r.placementType },
    { key: 'templatePool', header: '模板池', width: '25%', render: (r) => r.templatePool },
    {
      key: 'size',
      header: '尺寸',
      width: '10%',
      sortValue: (r) => r.size,
      render: (r) => String(r.size),
    },
    { key: 'biomes', header: '生物群系', width: '15%', render: (r) => r.biomes },
    { key: 'step', header: '适应', width: '10%', sortValue: (r) => r.step },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无自定义结构" />
  );
}

function StructureSetsTab({ items, query }: { items: StructureSetSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((s) => s.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<StructureSetSpec>[] = [
    { key: 'id', header: '结构集 ID', width: '25%', sortValue: (r) => r.id },
    {
      key: 'structures',
      header: '结构数',
      width: '15%',
      sortValue: (r) => r.structures.length,
      render: (r) => String(r.structures.length),
    },
    {
      key: 'placementType',
      header: '放置类型',
      width: '20%',
      render: (r) => r.placement.type.replace('minecraft:', ''),
    },
    {
      key: 'spacing',
      header: '间距',
      width: '10%',
      sortValue: (r) => r.placement.spacing,
      render: (r) => String(r.placement.spacing),
    },
    {
      key: 'separation',
      header: '分离',
      width: '10%',
      sortValue: (r) => r.placement.separation,
      render: (r) => String(r.placement.separation),
    },
    {
      key: 'frequency',
      header: '频率',
      width: '10%',
      render: (r) => (r.placement.frequency !== undefined ? r.placement.frequency.toFixed(2) : '—'),
    },
    {
      key: 'salt',
      header: '盐值',
      width: '10%',
      sortValue: (r) => r.placement.salt,
      render: (r) => String(r.placement.salt),
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无结构集" />
  );
}

function ParticlesTab({ items, query }: { items: ParticleSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((p) => p.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<ParticleSpec>[] = [
    { key: 'id', header: '粒子 ID', width: '40%', sortValue: (r) => r.id },
    { key: 'description', header: '描述', width: '40%', sortValue: (r) => r.description },
    {
      key: 'override',
      header: '覆盖原版',
      width: '20%',
      render: (r) => (r.override ? '是' : '否'),
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无自定义粒子" />
  );
}

function TrimsTab({
  patterns,
  materials,
  query,
}: {
  patterns: TrimPatternSpec[];
  materials: TrimMaterialSpec[];
  query: string;
}) {
  type TrimRow = { kind: 'pattern' | 'material'; id: string; ref: string; extra: string };
  const rows: TrimRow[] = useMemo(
    () => [
      ...patterns.map((t): TrimRow => ({
        kind: 'pattern',
        id: t.id,
        ref: t.templateItem,
        extra: t.decal ? '贴花' : '—',
      })),
      ...materials.map((t): TrimRow => ({
        kind: 'material',
        id: t.id,
        ref: t.materialItem,
        extra: t.color,
      })),
    ],
    [patterns, materials],
  );

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.id.toLowerCase().includes(q) || r.ref.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<TrimRow>[] = [
    {
      key: 'kind',
      header: '类型',
      width: '15%',
      sortValue: (r) => r.kind,
      render: (r) => (r.kind === 'pattern' ? '纹饰' : '材质'),
    },
    { key: 'id', header: 'ID', width: '25%', sortValue: (r) => r.id },
    { key: 'ref', header: '物品', width: '35%', sortValue: (r) => r.ref },
    { key: 'extra', header: '额外', width: '25%', render: (r) => r.extra },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => `${r.kind}:${r.id}`}
      emptyHint="暂无盔甲纹饰/材质"
    />
  );
}

function InstrumentsTab({ items, query }: { items: InstrumentSpec[]; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter((i) => i.id.toLowerCase().includes(q));
  }, [items, query]);

  const columns: Column<InstrumentSpec>[] = [
    { key: 'id', header: '乐器 ID', width: '25%', sortValue: (r) => r.id },
    { key: 'soundEvent', header: '音效事件', width: '30%', sortValue: (r) => r.soundEvent },
    {
      key: 'useDuration',
      header: '持续时间',
      width: '15%',
      sortValue: (r) => r.useDuration,
      render: (r) => `${r.useDuration} tick`,
    },
    {
      key: 'range',
      header: '范围',
      width: '15%',
      sortValue: (r) => r.range,
      render: (r) => `${r.range} 格`,
    },
    { key: 'description', header: '描述', width: '15%', render: (r) => r.description || '—' },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无自定义乐器" />
  );
}

function WorldgenTab({
  dimensions,
  dimensionTypes,
  biomes,
  query,
}: {
  dimensions: DimensionSpec[];
  dimensionTypes: DimensionTypeSpec[];
  biomes: BiomeSpec[];
  query: string;
}) {
  type WgRow = { kind: string; id: string; detail: string };
  const rows: WgRow[] = useMemo(
    () => [
      ...dimensionTypes.map((d): WgRow => ({
        kind: '维度类型',
        id: d.id,
        detail: `高度 ${d.minY}~${d.minY + d.height} | ${d.effects}`,
      })),
      ...biomes.map((b): WgRow => ({
        kind: '生物群系',
        id: b.id,
        detail: `${b.precipitation} | T=${b.temperature} | 降水=${b.downfall}`,
      })),
      ...dimensions.map((d): WgRow => ({
        kind: '维度',
        id: d.id,
        detail: `${d.generatorType} | ${d.dimensionType}`,
      })),
    ],
    [dimensions, dimensionTypes, biomes],
  );

  const filtered = useMemo(() => {
    if (!query) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.id.toLowerCase().includes(q) || r.kind.toLowerCase().includes(q));
  }, [rows, query]);

  const columns: Column<WgRow>[] = [
    { key: 'kind', header: '类型', width: '15%', sortValue: (r) => r.kind },
    { key: 'id', header: 'ID', width: '30%', sortValue: (r) => r.id },
    { key: 'detail', header: '详情', width: '55%', render: (r) => r.detail },
  ];

  return (
    <DataTable
      columns={columns}
      data={filtered}
      rowKey={(r) => `${r.kind}:${r.id}`}
      emptyHint="暂无世界生成定义"
    />
  );
}

/** 校验 Tab：展示所有校验问题（错误/警告/信息），按级别排序 */
function ValidationTab({ issues, query }: { issues: ValidationIssue[]; query: string }) {
  const filtered = useMemo(() => {
    let result = [...issues].sort((a, b) => {
      const levelOrder = { error: 0, warning: 1, info: 2 };
      return levelOrder[a.level] - levelOrder[b.level];
    });
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (i) =>
          i.type.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q) ||
          i.field.toLowerCase().includes(q) ||
          i.message.toLowerCase().includes(q),
      );
    }
    return result;
  }, [issues, query]);

  const levelIcon: Record<string, string> = { error: '❌', warning: '⚠️', info: 'ℹ️' };
  const levelColor: Record<string, string> = {
    error: 'text-red-400',
    warning: 'text-yellow-400',
    info: 'text-blue-400',
  };

  const columns: Column<ValidationIssue>[] = [
    {
      key: 'level',
      header: '级别',
      width: '8%',
      sortValue: (r) => r.level,
      render: (r) => levelIcon[r.level],
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => <span className={levelColor[r.level]}>{r.type}</span>,
    },
    { key: 'id', header: 'ID', width: '15%', sortValue: (r) => r.id },
    {
      key: 'field',
      header: '字段',
      width: '15%',
      sortValue: (r) => r.field,
      render: (r) => <code className="text-mc-accent text-[10px]">{r.field}</code>,
    },
    {
      key: 'message',
      header: '问题描述',
      width: '50%',
      sortValue: (r) => r.message,
      render: (r) => <span className={levelColor[r.level]}>{r.message}</span>,
    },
  ];

  return (
    <div className="flex flex-col">
      {issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-mc-dim">
          <span className="text-2xl mb-2">✅</span>
          <span className="text-sm">校验通过，未发现问题</span>
        </div>
      ) : (
        <>
          <div className="px-3 py-1 text-[10px] text-mc-mute border-b border-mc-border">
            {issues.filter((i) => i.level === 'error').length > 0 && (
              <span className="text-red-400 mr-3">
                ❌ 错误 {issues.filter((i) => i.level === 'error').length}
              </span>
            )}
            {issues.filter((i) => i.level === 'warning').length > 0 && (
              <span className="text-yellow-400 mr-3">
                ⚠️ 警告 {issues.filter((i) => i.level === 'warning').length}
              </span>
            )}
            {issues.filter((i) => i.level === 'info').length > 0 && (
              <span className="text-blue-400">
                ℹ️ 信息 {issues.filter((i) => i.level === 'info').length}
              </span>
            )}
          </div>
          <DataTable
            columns={columns}
            data={filtered}
            rowKey={(r) => `${r.level}:${r.type}:${r.id}:${r.field}`}
            emptyHint="无匹配校验问题"
          />
        </>
      )}
    </div>
  );
}
