import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import {
  DataTable,
  PanelHeader,
  ConflictAlert,
  ExportView,
  FilterBar,
  EmptyState,
  StatCard,
  StatCardGrid,
  MetadataView,
  IconTabBar,
  BatchSelectToolbar,
  findDuplicates,
  downloadBlob,
  useBatchSelection,
  useTabCounts,
  useConflictDetection,
} from './shared/index.js';
import type { Column, TabItem, ConflictGroup } from './shared/index.js';
import type {
  ModSpec,
  ItemSpec,
  BlockSpec,
  ModDependencySpec,
  ModLootTableSpec,
  ModAdvancementSpec,
} from '@mc-creator/shared';
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  FileText,
  Boxes,
  Package,
  Trophy,
  Tag,
  FunctionSquare,
  Layers,
} from 'lucide-react';

type ModTab =
  | 'items'
  | 'blocks'
  | 'dependencies'
  | 'loot'
  | 'advancements'
  | 'tags'
  | 'functions'
  | 'metadata'
  | 'export';

type ItemRarityFilter = 'all' | 'common' | 'uncommon' | 'rare' | 'epic';
type ItemCategoryFilter =
  | 'all'
  | 'sword'
  | 'pickaxe'
  | 'axe'
  | 'shovel'
  | 'hoe'
  | 'helmet'
  | 'chestplate'
  | 'leggings'
  | 'boots'
  | 'food'
  | 'potion'
  | 'bow'
  | 'crossbow'
  | 'trident'
  | 'misc';
type BlockMaterialFilter =
  | 'all'
  | 'wood'
  | 'stone'
  | 'metal'
  | 'rock'
  | 'cloth'
  | 'plant'
  | 'sand'
  | 'glass'
  | 'ice'
  | 'water'
  | 'lava';

const TABS: { key: ModTab; label: string; icon: typeof Boxes }[] = [
  { key: 'items', label: '物品', icon: Boxes },
  { key: 'blocks', label: '方块', icon: Layers },
  { key: 'dependencies', label: '依赖', icon: Package },
  { key: 'loot', label: '战利品', icon: FileText },
  { key: 'advancements', label: '进度', icon: Trophy },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'functions', label: '函数', icon: FunctionSquare },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<ModTab>(['metadata', 'export']);

const MOD_CONFLICT_GROUPS: ConflictGroup<ModSpec>[] = [
  {
    key: 'duplicateItemIds',
    label: '物品 ID 重复',
    detect: (m) => findDuplicates(m.items, (i) => i.id),
  },
  {
    key: 'duplicateBlockIds',
    label: '方块 ID 重复',
    detect: (m) => findDuplicates(m.blocks, (b) => b.id),
  },
  {
    key: 'duplicateDeps',
    label: '依赖重复',
    detect: (m) => findDuplicates(m.dependencies, (d) => d.modId),
  },
];

const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  uncommon: '少见',
  rare: '稀有',
  epic: '史诗',
};

const RARITY_COLOR: Record<string, string> = {
  common: 'bg-mc-surface-3 text-mc-dim',
  uncommon: 'bg-yellow-500/20 text-yellow-400',
  rare: 'bg-blue-500/20 text-blue-400',
  epic: 'bg-purple-500/20 text-purple-400',
};

const ITEM_CATEGORY_LABEL: Record<string, string> = {
  sword: '剑',
  pickaxe: '镐',
  axe: '斧',
  shovel: '铲',
  hoe: '锄',
  helmet: '头盔',
  chestplate: '胸甲',
  leggings: '护腿',
  boots: '靴子',
  food: '食物',
  potion: '药水',
  bow: '弓',
  crossbow: '弩',
  trident: '三叉戟',
  misc: '杂项',
};

const BLOCK_TYPE_LABEL: Record<string, string> = {
  full_block: '完整方块',
  slab: '半砖',
  stairs: '楼梯',
  fence: '栅栏',
  fence_gate: '栅栏门',
  wall: '墙',
  door: '门',
  trapdoor: '活板门',
  button: '按钮',
  pressure_plate: '压力板',
  lever: '拉杆',
  sign: '告示牌',
  bed: '床',
  chest: '箱子',
  piston: '活塞',
  torch: '火把',
  custom: '自定义',
};

const LOOT_TYPE_LABEL: Record<string, string> = {
  block: '方块掉落',
  entity: '实体掉落',
  chest: '宝箱',
  generic: '通用',
  empty: '空',
};

const ADVANCEMENT_FRAME_LABEL: Record<string, string> = {
  task: '任务',
  challenge: '挑战',
  goal: '目标',
};

/** Mod 预览面板：9 分类 tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + 冲突检测 */
export function ModPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
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
  const { conflicts, totalConflicts, conflictList } = useConflictDetection(
    mod,
    MOD_CONFLICT_GROUPS,
  );

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
    [mod, setSpec],
  );

  const removeBlocks = useCallback(
    (ids: string[]) => {
      if (!mod) return;
      const idSet = new Set(ids);
      const updated = { ...mod, blocks: mod.blocks.filter((b) => !idSet.has(b.id)) };
      setSpec(updated as unknown as typeof spec);
      blockSelection.clear();
    },
    [mod, setSpec],
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
    (format: 'json' | 'csv' | 'markdown', scope: 'all' | 'items' | 'blocks' | 'deps') => {
      if (!mod) return;
      let data: unknown;
      let filename = '';
      let content = '';

      if (scope === 'all') {
        data = mod;
      } else if (scope === 'items') {
        data = mod.items;
      } else if (scope === 'blocks') {
        data = mod.blocks;
      } else {
        data = mod.dependencies;
      }

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `${mod.modId}-${scope}.json`;
      } else if (format === 'csv') {
        if (scope === 'items') {
          const rows = ['ID,Name,Rarity,MaxStackSize,MaxDamage,FuelTick,Category,CreativeTab,Food'];
          for (const i of mod.items) {
            rows.push(
              `"${i.id}","${i.name}","${i.rarity}",${i.maxStackSize},${i.maxDamage},${i.fuelTick},"${i.itemCategory}","${i.creativeTab}",${i.food ? 'Yes' : 'No'}`,
            );
          }
          content = rows.join('\n');
        } else if (scope === 'blocks') {
          const rows = ['ID,Name,Material,Hardness,Resistance,LightLevel,BlockType,Transparent'];
          for (const b of mod.blocks) {
            rows.push(
              `"${b.id}","${b.name}","${b.material}",${b.hardness},${b.resistance},${b.lightLevel},"${b.blockType}",${b.transparent ? 'Yes' : 'No'}`,
            );
          }
          content = rows.join('\n');
        } else if (scope === 'deps') {
          const rows = ['ModID,Version,Mandatory'];
          for (const d of mod.dependencies) {
            rows.push(`"${d.modId}","${d.version}",${d.mandatory ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else {
          // all - 不适合 CSV，fallback 到 JSON
          content = JSON.stringify(data, null, 2);
        }
        filename = `${mod.modId}-${scope}.csv`;
      } else {
        // markdown
        const lines: string[] = [];
        if (scope === 'all') {
          lines.push(`# ${mod.name || mod.modId}`, '');
          lines.push(`- **Mod ID**: ${mod.modId}`);
          lines.push(`- **版本**: ${mod.version}`);
          lines.push(`- **License**: ${mod.license}`);
          lines.push(`- **作者**: ${mod.authors.join(', ') || '—'}`);
          lines.push(`- **描述**: ${mod.description || '—'}`);
          lines.push('');
          lines.push('## 物品列表', '');
          for (const i of mod.items) {
            lines.push(
              `- **${i.name}** (\`${i.id}\`) — 稀有度 ${RARITY_LABEL[i.rarity]} · 堆叠 ${i.maxStackSize}`,
            );
          }
          lines.push('');
          lines.push('## 方块列表', '');
          for (const b of mod.blocks) {
            lines.push(`- **${b.name}** (\`${b.id}\`) — 材质 ${b.material} · 硬度 ${b.hardness}`);
          }
          lines.push('');
          lines.push('## 依赖', '');
          for (const d of mod.dependencies) {
            lines.push(`- \`${d.modId}\` ${d.version} ${d.mandatory ? '(必需)' : '(可选)'}`);
          }
        } else if (scope === 'items') {
          lines.push(`# ${mod.name || mod.modId} - 物品列表`, '');
          lines.push(`共 ${mod.items.length} 个物品`, '');
          lines.push('| ID | 名称 | 稀有度 | 堆叠 |', '|---|---|---|---|');
          for (const i of mod.items) {
            lines.push(
              `| \`${i.id}\` | ${i.name} | ${RARITY_LABEL[i.rarity]} | ${i.maxStackSize} |`,
            );
          }
        } else if (scope === 'blocks') {
          lines.push(`# ${mod.name || mod.modId} - 方块列表`, '');
          lines.push(`共 ${mod.blocks.length} 个方块`, '');
          lines.push('| ID | 名称 | 材质 | 硬度 |', '|---|---|---|---|');
          for (const b of mod.blocks) {
            lines.push(`| \`${b.id}\` | ${b.name} | ${b.material} | ${b.hardness} |`);
          }
        } else if (scope === 'deps') {
          lines.push(`# ${mod.name || mod.modId} - 依赖列表`, '');
          lines.push(`共 ${mod.dependencies.length} 个依赖`, '');
          lines.push('| Mod ID | 版本 | 必需 |', '|---|---|---|');
          for (const d of mod.dependencies) {
            lines.push(`| \`${d.modId}\` | ${d.version} | ${d.mandatory ? '是' : '否'} |`);
          }
        }
        content = lines.join('\n');
        filename = `${mod.modId}-${scope}.md`;
      }

      downloadBlob(content, filename);
    },
    [mod],
  );

  if (!spec || !mod) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成 Mod Spec"
        hint="在右侧 AgentPanel 描述你想要的 mod，生成 Spec 后即可预览"
        action={{
          label: '打开命令面板',
          onClick: () => window.dispatchEvent(new Event('mc:open-command-palette')),
        }}
      />
    );
  }

  // ===== 物品列表列定义 =====
  const itemColumns: Column<ItemSpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            itemSelection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {itemSelection.isSelected(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    { key: 'id', header: 'ID', width: '14%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '16%', sortValue: (r) => r.name },
    {
      key: 'rarity',
      header: '稀有度',
      width: '10%',
      sortValue: (r) => r.rarity,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${RARITY_COLOR[r.rarity] ?? RARITY_COLOR.common}`}
        >
          {RARITY_LABEL[r.rarity] ?? r.rarity}
        </span>
      ),
    },
    {
      key: 'itemCategory',
      header: '类别',
      width: '10%',
      sortValue: (r) => r.itemCategory,
      render: (r) => ITEM_CATEGORY_LABEL[r.itemCategory] ?? r.itemCategory,
    },
    {
      key: 'maxStackSize',
      header: '堆叠',
      width: '8%',
      sortValue: (r) => r.maxStackSize,
    },
    {
      key: 'maxDamage',
      header: '耐久',
      width: '8%',
      sortValue: (r) => r.maxDamage,
      render: (r) => (r.maxDamage > 0 ? String(r.maxDamage) : '—'),
    },
    {
      key: 'fuelTick',
      header: '燃料',
      width: '8%',
      sortValue: (r) => r.fuelTick,
      render: (r) => (r.fuelTick > 0 ? `${r.fuelTick}t` : '—'),
    },
    {
      key: 'food',
      header: '食物',
      width: '12%',
      render: (r) => (r.food ? `饥饿 ${r.food.hunger}/饱和 ${r.food.saturation}` : '—'),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeItems([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];

  // ===== 方块列表列定义 =====
  const blockColumns: Column<BlockSpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            blockSelection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {blockSelection.isSelected(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    { key: 'id', header: 'ID', width: '14%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '14%', sortValue: (r) => r.name },
    {
      key: 'material',
      header: '材质',
      width: '10%',
      sortValue: (r) => r.material,
    },
    {
      key: 'blockType',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.blockType,
      render: (r) => BLOCK_TYPE_LABEL[r.blockType] ?? r.blockType,
    },
    { key: 'hardness', header: '硬度', width: '8%', sortValue: (r) => r.hardness },
    {
      key: 'lightLevel',
      header: '发光',
      width: '8%',
      sortValue: (r) => r.lightLevel,
      render: (r) => (r.lightLevel > 0 ? String(r.lightLevel) : '—'),
    },
    {
      key: 'resistance',
      header: '抗性',
      width: '8%',
      sortValue: (r) => r.resistance,
    },
    {
      key: 'transparent',
      header: '透明',
      width: '8%',
      render: (r) => (r.transparent ? '是' : '否'),
    },
    {
      key: 'dropSelf',
      header: '掉落',
      width: '10%',
      render: (r) => (r.dropSelf ? '自身' : r.dropItem || '无'),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBlocks([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];

  const depColumns: Column<ModDependencySpec>[] = [
    { key: 'modId', header: 'Mod ID', width: '40%', sortValue: (r) => r.modId },
    { key: 'version', header: '版本', width: '30%', sortValue: (r) => r.version },
    {
      key: 'mandatory',
      header: '必需',
      width: '30%',
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${
            r.mandatory ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {r.mandatory ? '必需' : '可选'}
        </span>
      ),
    },
  ];

  const lootColumns: Column<ModLootTableSpec>[] = [
    { key: 'id', header: 'ID', width: '30%', sortValue: (r) => r.id },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => LOOT_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      key: 'pools',
      header: '池数',
      width: '10%',
      sortValue: (r) => r.pools.length,
      render: (r) => String(r.pools.length),
    },
    {
      key: 'entries',
      header: '总条目',
      width: '12%',
      sortValue: (r) => r.pools.reduce((sum, p) => sum + p.entries.length, 0),
      render: (r) => String(r.pools.reduce((sum, p) => sum + p.entries.length, 0)),
    },
    {
      key: 'preview',
      header: '前 2 个物品',
      width: '36%',
      render: (r) => {
        const items = r.pools.flatMap((p) => p.entries.map((e) => e.item)).slice(0, 2);
        return items.length > 0 ? items.join(', ') : '—';
      },
    },
  ];

  const advancementColumns: Column<ModAdvancementSpec>[] = [
    { key: 'id', header: 'ID', width: '25%', sortValue: (r) => r.id },
    {
      key: 'title',
      header: '标题',
      width: '20%',
      render: (r) => r.display?.title ?? '—',
    },
    {
      key: 'frame',
      header: '框架',
      width: '10%',
      render: (r) =>
        r.display?.frame ? (ADVANCEMENT_FRAME_LABEL[r.display.frame] ?? r.display.frame) : '—',
    },
    {
      key: 'parent',
      header: '父进度',
      width: '20%',
      render: (r) => r.parent ?? '—',
    },
    {
      key: 'criteria',
      header: '条件数',
      width: '10%',
      sortValue: (r) => r.criteria.length,
      render: (r) => String(r.criteria.length),
    },
    {
      key: 'icon',
      header: '图标',
      width: '15%',
      render: (r) => r.display?.icon ?? '—',
    },
  ];

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

function countByTab(mod: ModSpec, tab: ModTab): number {
  if (tab === 'items') return mod.items.length;
  if (tab === 'blocks') return mod.blocks.length;
  if (tab === 'dependencies') return mod.dependencies.length;
  if (tab === 'loot') return mod.lootTables.length;
  if (tab === 'advancements') return mod.advancements.length;
  if (tab === 'tags') return mod.tags.length;
  if (tab === 'functions') return mod.functions.length;
  return 0;
}

function tabLabel(tab: ModTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== 标签 Tab =====
function TagsTab({ tags, query }: { tags: ModSpec['tags']; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return tags;
    const q = query.toLowerCase();
    return tags.filter(
      (t) => t.id.toLowerCase().includes(q) || t.values.some((v) => v.toLowerCase().includes(q)),
    );
  }, [tags, query]);

  const columns: Column<(typeof tags)[number]>[] = [
    { key: 'id', header: '标签 ID', width: '30%', sortValue: (r) => r.id },
    {
      key: 'values',
      header: '条目数',
      width: '10%',
      sortValue: (r) => r.values.length,
      render: (r) => String(r.values.length),
    },
    {
      key: 'replace',
      header: '替换模式',
      width: '12%',
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
      width: '48%',
      render: (r) => (r.values.length > 0 ? r.values.slice(0, 3).join(', ') : '—'),
    },
  ];

  return <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无标签" />;
}

// ===== 函数 Tab =====
function FunctionsTab({ functions, query }: { functions: ModSpec['functions']; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return functions;
    const q = query.toLowerCase();
    return functions.filter(
      (f) => f.id.toLowerCase().includes(q) || f.commands.some((c) => c.toLowerCase().includes(q)),
    );
  }, [functions, query]);

  if (filtered.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无函数</div>;
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      {filtered.map((f) => (
        <div key={f.id} className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1 flex items-center gap-2">
            <FunctionSquare className="h-3 w-3 text-mc-accent" />
            <span className="font-mono text-xs font-medium text-mc-text">{f.id}</span>
            <span className="text-[10px] text-mc-mute">· {f.commands.length} 行命令</span>
          </div>
          <pre className="max-h-32 overflow-auto rounded-mc bg-mc-bg p-2 text-[10px] text-mc-dim whitespace-pre-wrap">
            {f.commands.join('\n')}
          </pre>
        </div>
      ))}
    </div>
  );
}
