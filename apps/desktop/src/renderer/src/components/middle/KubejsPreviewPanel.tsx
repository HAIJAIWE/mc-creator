import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import {
  DataTable,
  PanelHeader,
  EmptyState,
  StatCard,
  StatCardGrid,
  MetadataView,
  ConflictAlert,
  ExportView,
  FilterBar,
  IconTabBar,
  BatchSelectToolbar,
  findDuplicates,
  downloadBlob,
} from './shared/index.js';
import type { Column, TabItem } from './shared/index.js';
import type {
  KubejsSpec,
  KubejsRecipeSpec,
  KubejsTagSpec,
  KubejsEventSpec,
  KubejsTooltipSpec,
  KubejsRegistrySpec,
} from '@mc-creator/shared';
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  FileText,
  Boxes,
  Tag,
  Flag,
  Languages,
  BookOpen,
  Database,
} from 'lucide-react';

type KubejsTab =
  'recipes' | 'tags' | 'events' | 'tooltips' | 'registry' | 'lang' | 'metadata' | 'export';

type RecipeTypeFilter = 'all' | 'shaped' | 'shapeless' | 'smelting' | 'stonecutting' | 'custom';
type TagTypeFilter = 'all' | 'item' | 'block' | 'entity_type' | 'fluid' | 'function';
type RegistryTypeFilter = 'all' | 'item' | 'block' | 'sound' | 'fluid';

const TABS: { key: KubejsTab; label: string; icon: typeof Boxes }[] = [
  { key: 'recipes', label: '配方', icon: Boxes },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'events', label: '事件', icon: Flag },
  { key: 'tooltips', label: '工具提示', icon: BookOpen },
  { key: 'registry', label: '注册表', icon: Database },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const RECIPE_TYPE_LABEL: Record<string, string> = {
  shaped: '有序合成',
  shapeless: '无序合成',
  smelting: '熔炼',
  stonecutting: '切石',
  custom: '自定义',
};

const RECIPE_TYPE_COLOR: Record<string, string> = {
  shaped: 'bg-blue-500/20 text-blue-400',
  shapeless: 'bg-green-500/20 text-green-400',
  smelting: 'bg-orange-500/20 text-orange-400',
  stonecutting: 'bg-yellow-500/20 text-yellow-400',
  custom: 'bg-purple-500/20 text-purple-400',
};

const TAG_TYPE_LABEL: Record<string, string> = {
  item: '物品',
  block: '方块',
  entity_type: '实体',
  fluid: '流体',
  function: '函数',
};

const TAG_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  entity_type: 'bg-orange-500/20 text-orange-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
  function: 'bg-pink-500/20 text-pink-400',
};

const REGISTRY_TYPE_LABEL: Record<string, string> = {
  item: '物品',
  block: '方块',
  sound: '音效',
  fluid: '流体',
};

const REGISTRY_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  sound: 'bg-purple-500/20 text-purple-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
};

interface LangRow {
  lang: string;
  key: string;
  value: string;
}

/** KubeJS 预览面板：8 Tab + 统计卡片 + 高级筛选 + 批量管理 + 导出 + ID 重复检测 */
export function KubejsPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<KubejsTab>('recipes');
  const [query, setQuery] = useState('');
  const [recipeTypeFilter, setRecipeTypeFilter] = useState<RecipeTypeFilter>('all');
  const [tagTypeFilter, setTagTypeFilter] = useState<TagTypeFilter>('all');
  const [registryTypeFilter, setRegistryTypeFilter] = useState<RegistryTypeFilter>('all');
  const [selectedRecipeIds, setSelectedRecipeIds] = useState<Set<string>>(new Set());

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
    const langEntries = Object.values(kj.lang ?? {}).reduce(
      (sum, dict) => sum + Object.keys(dict).length,
      0,
    );
    return {
      recipes: kj.recipes.length,
      tags: kj.tags.length,
      events: kj.events.length,
      tooltips: kj.tooltips.length,
      registry: kj.registry.length,
      langCount: Object.keys(kj.lang ?? {}).length,
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
  const conflicts = useMemo(() => {
    if (!kj)
      return {
        duplicateRecipeIds: [],
        duplicateTagIds: [],
        duplicateEventIds: [],
        duplicateTooltipIds: [],
        duplicateRegistryIds: [],
      };
    return {
      duplicateRecipeIds: findDuplicates(kj.recipes, (r) => r.id),
      duplicateTagIds: findDuplicates(kj.tags, (t) => t.id),
      duplicateEventIds: findDuplicates(kj.events, (e) => e.id),
      duplicateTooltipIds: findDuplicates(kj.tooltips, (t) => t.itemId),
      duplicateRegistryIds: findDuplicates(kj.registry, (r) => r.id),
    };
  }, [kj]);

  const totalConflicts =
    conflicts.duplicateRecipeIds.length +
    conflicts.duplicateTagIds.length +
    conflicts.duplicateEventIds.length +
    conflicts.duplicateTooltipIds.length +
    conflicts.duplicateRegistryIds.length;

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
  const toggleRecipeSelect = useCallback((id: string) => {
    setSelectedRecipeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const removeRecipes = useCallback(
    (ids: string[]) => {
      if (!kj) return;
      const idSet = new Set(ids);
      const updated = {
        ...kj,
        recipes: kj.recipes.filter((r) => !idSet.has(r.id)),
      };
      setSpec(updated as unknown as typeof spec);
      setSelectedRecipeIds(new Set());
    },
    [kj, setSpec],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useMemo<TabItem<KubejsTab>[]>(() => {
    return TABS.map((t) => ({
      key: t.key,
      label: t.label,
      icon: t.icon,
      hideCount: t.key === 'metadata' || t.key === 'export',
      count:
        kj && t.key !== 'metadata' && t.key !== 'export'
          ? countByTab(kj, t.key, stats.langEntries)
          : undefined,
    }));
  }, [kj, stats.langEntries]);

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
      format: 'json' | 'csv' | 'markdown',
      scope: 'all' | 'recipes' | 'tags' | 'events' | 'tooltips' | 'registry' | 'lang',
    ) => {
      if (!kj) return;
      let data: unknown;
      let filename = '';
      let content = '';

      if (scope === 'all') {
        data = kj;
      } else if (scope === 'recipes') {
        data = kj.recipes;
      } else if (scope === 'tags') {
        data = kj.tags;
      } else if (scope === 'events') {
        data = kj.events;
      } else if (scope === 'tooltips') {
        data = kj.tooltips;
      } else if (scope === 'registry') {
        data = kj.registry;
      } else {
        data = kj.lang;
      }

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `${kj.packId}-${scope}.json`;
      } else if (format === 'csv') {
        if (scope === 'recipes') {
          const rows = ['ID,Type,Result,Count'];
          for (const r of kj.recipes) {
            rows.push(`"${r.id}","${r.type}","${r.result}",${r.count}`);
          }
          content = rows.join('\n');
        } else if (scope === 'tags') {
          const rows = ['ID,Type,Values,Replace'];
          for (const t of kj.tags) {
            rows.push(`"${t.id}","${t.type}","${t.values.join(';')}",${t.replace ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'events') {
          const rows = ['ID,Type,Target'];
          for (const e of kj.events) {
            rows.push(`"${e.id}","${e.type}","${e.target}"`);
          }
          content = rows.join('\n');
        } else if (scope === 'tooltips') {
          const rows = ['ItemID,Lines,Advanced'];
          for (const t of kj.tooltips) {
            rows.push(`"${t.itemId}",${t.lines.length},${t.advanced ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'registry') {
          const rows = ['ID,Type,Items,Blocks'];
          for (const r of kj.registry) {
            rows.push(`"${r.id}","${r.type}",${r.items.length},${r.blocks.length}`);
          }
          content = rows.join('\n');
        } else if (scope === 'lang') {
          const rows = ['Lang,Key,Value'];
          for (const [langCode, dict] of Object.entries(kj.lang ?? {})) {
            for (const [k, v] of Object.entries(dict)) {
              rows.push(`"${langCode}","${k}","${v.replace(/"/g, '""')}"`);
            }
          }
          content = rows.join('\n');
        } else {
          content = JSON.stringify(data, null, 2);
        }
        filename = `${kj.packId}-${scope}.csv`;
      } else {
        // markdown
        const lines: string[] = [];
        if (scope === 'all') {
          lines.push(`# ${kj.packName || kj.packId}`, '');
          lines.push(`- **Pack ID**: ${kj.packId}`);
          lines.push(`- **Format**: ${kj.packFormat}`);
          lines.push(`- **MC 版本**: ${kj.mcVersion}`);
          lines.push(`- **描述**: ${kj.description || '—'}`);
          lines.push('');
          lines.push('## 配方列表', '');
          for (const r of kj.recipes) {
            lines.push(
              `- \`${r.id}\` — ${RECIPE_TYPE_LABEL[r.type] ?? r.type} → ${r.result} x${r.count}`,
            );
          }
          lines.push('');
          lines.push('## 标签列表', '');
          for (const t of kj.tags) {
            lines.push(
              `- \`${t.id}\` — ${TAG_TYPE_LABEL[t.type] ?? t.type} (${t.values.length} 条目)`,
            );
          }
          lines.push('');
          lines.push('## 事件列表', '');
          for (const e of kj.events) {
            lines.push(`- \`${e.id}\` — ${e.type} (${e.target || '—'})`);
          }
          lines.push('');
          lines.push('## 注册表', '');
          for (const r of kj.registry) {
            lines.push(
              `- \`${r.id}\` — ${REGISTRY_TYPE_LABEL[r.type] ?? r.type} (${r.items.length + r.blocks.length} 条目)`,
            );
          }
          lines.push('');
          lines.push('## 工具提示', '');
          for (const t of kj.tooltips) {
            lines.push(`- \`${t.itemId}\` — ${t.lines.length} 行${t.advanced ? ' (高级)' : ''}`);
          }
        } else if (scope === 'recipes') {
          lines.push(`# ${kj.packName || kj.packId} - 配方列表`, '');
          lines.push(`共 ${kj.recipes.length} 个配方`, '');
          lines.push('| ID | 类型 | 产物 | 数量 |', '|---|---|---|---|');
          for (const r of kj.recipes) {
            lines.push(
              `| \`${r.id}\` | ${RECIPE_TYPE_LABEL[r.type] ?? r.type} | ${r.result} | ${r.count} |`,
            );
          }
        } else if (scope === 'tags') {
          lines.push(`# ${kj.packName || kj.packId} - 标签列表`, '');
          lines.push(`共 ${kj.tags.length} 个标签`, '');
          lines.push('| ID | 类型 | 条目数 | 替换 |', '|---|---|---|---|');
          for (const t of kj.tags) {
            lines.push(
              `| \`${t.id}\` | ${TAG_TYPE_LABEL[t.type] ?? t.type} | ${t.values.length} | ${t.replace ? '是' : '否'} |`,
            );
          }
        } else if (scope === 'events') {
          lines.push(`# ${kj.packName || kj.packId} - 事件列表`, '');
          lines.push(`共 ${kj.events.length} 个事件`, '');
          lines.push('| ID | 类型 | 目标 |', '|---|---|---|');
          for (const e of kj.events) {
            lines.push(`| \`${e.id}\` | ${e.type} | ${e.target || '—'} |`);
          }
        } else if (scope === 'tooltips') {
          lines.push(`# ${kj.packName || kj.packId} - 工具提示`, '');
          lines.push(`共 ${kj.tooltips.length} 个工具提示`, '');
          lines.push('| 物品 ID | 行数 | 高级 |', '|---|---|---|');
          for (const t of kj.tooltips) {
            lines.push(`| \`${t.itemId}\` | ${t.lines.length} | ${t.advanced ? '是' : '否'} |`);
          }
        } else if (scope === 'registry') {
          lines.push(`# ${kj.packName || kj.packId} - 注册表`, '');
          lines.push(`共 ${kj.registry.length} 个注册表条目`, '');
          lines.push('| ID | 类型 | 物品数 | 方块数 |', '|---|---|---|---|');
          for (const r of kj.registry) {
            lines.push(
              `| \`${r.id}\` | ${REGISTRY_TYPE_LABEL[r.type] ?? r.type} | ${r.items.length} | ${r.blocks.length} |`,
            );
          }
        } else if (scope === 'lang') {
          lines.push(`# ${kj.packName || kj.packId} - 语言条目`, '');
          lines.push(`共 ${stats.langEntries} 条翻译，覆盖 ${stats.langCount} 种语言`, '');
          lines.push('| 语言 | 键 | 值 |', '|---|---|---|');
          for (const [langCode, dict] of Object.entries(kj.lang ?? {})) {
            for (const [k, v] of Object.entries(dict)) {
              lines.push(`| ${langCode} | \`${k}\` | ${v} |`);
            }
          }
        }
        content = lines.join('\n');
        filename = `${kj.packId}-${scope}.md`;
      }

      downloadBlob(content, filename, 'text/plain');
    },
    [kj, stats.langEntries, stats.langCount],
  );

  if (!spec || !kj) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成 KubeJS Spec"
        hint="在右侧 AgentPanel 描述你想要的 KubeJS 脚本，生成 Spec 后即可预览"
      />
    );
  }

  // ===== 配方列定义 =====
  const recipeColumns: Column<KubejsRecipeSpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleRecipeSelect(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selectedRecipeIds.has(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'id',
      header: 'ID',
      width: '18%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${RECIPE_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {RECIPE_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    { key: 'result', header: '产物', width: '28%', sortValue: (r) => r.result },
    {
      key: 'count',
      header: '数量',
      width: '8%',
      sortValue: (r) => r.count,
      render: (r) => String(r.count),
    },
    {
      key: 'pattern',
      header: '形状/材料',
      width: '22%',
      render: (r) =>
        r.pattern
          ? `${r.pattern.length} 行`
          : r.ingredients
            ? `${r.ingredients.length} 材料`
            : r.customCode
              ? '自定义代码'
              : '—',
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeRecipes([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];

  // ===== 标签列定义 =====
  const tagColumns: Column<KubejsTagSpec>[] = [
    {
      key: 'id',
      header: '标签 ID',
      width: '28%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${TAG_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {TAG_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    {
      key: 'values',
      header: '条目数',
      width: '12%',
      sortValue: (r) => r.values.length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {r.values.length}
        </span>
      ),
    },
    {
      key: 'replace',
      header: '替换模式',
      width: '14%',
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
      width: '34%',
      render: (r) => (r.values.length > 0 ? r.values.slice(0, 3).join(', ') : '—'),
    },
  ];

  // ===== 事件列定义 =====
  const eventColumns: Column<KubejsEventSpec>[] = [
    {
      key: 'id',
      header: '事件 ID',
      width: '18%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '事件类型',
      width: '22%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span className="rounded-mc bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
          {r.type}
        </span>
      ),
    },
    {
      key: 'target',
      header: '目标',
      width: '20%',
      sortValue: (r) => r.target,
      render: (r) => r.target || '—',
    },
    {
      key: 'handler',
      header: 'handler 预览',
      width: '40%',
      render: (r) => {
        const firstLine = r.handler.split('\n')[0] ?? '';
        return (
          <span className="font-mono text-[10px] text-mc-dim">
            {firstLine.length > 50 ? firstLine.slice(0, 50) + '…' : firstLine || '—'}
          </span>
        );
      },
    },
  ];

  // ===== 工具提示列定义 =====
  const tooltipColumns: Column<KubejsTooltipSpec>[] = [
    {
      key: 'itemId',
      header: '物品 ID',
      width: '32%',
      sortValue: (r) => r.itemId,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.itemId}</span>,
    },
    {
      key: 'lines',
      header: '行数',
      width: '10%',
      sortValue: (r) => r.lines.length,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          {r.lines.length}
        </span>
      ),
    },
    {
      key: 'advanced',
      header: '高级',
      width: '10%',
      render: (r) =>
        r.advanced ? (
          <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
            高级
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">普通</span>
        ),
    },
    {
      key: 'preview',
      header: '首行预览',
      width: '48%',
      render: (r) => (
        <span className="text-[11px] text-mc-dim">{r.lines[0]?.slice(0, 50) ?? '—'}</span>
      ),
    },
  ];

  // ===== 注册表列定义 =====
  const registryColumns: Column<KubejsRegistrySpec>[] = [
    {
      key: 'id',
      header: '注册表 ID',
      width: '22%',
      sortValue: (r) => r.id,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.id}</span>,
    },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${REGISTRY_TYPE_COLOR[r.type] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {REGISTRY_TYPE_LABEL[r.type] ?? r.type}
        </span>
      ),
    },
    {
      key: 'items',
      header: '物品数',
      width: '12%',
      sortValue: (r) => r.items.length,
      render: (r) => (
        <span className="rounded-mc bg-blue-500/20 px-1.5 py-0.5 text-[10px] text-blue-400">
          {r.items.length}
        </span>
      ),
    },
    {
      key: 'blocks',
      header: '方块数',
      width: '12%',
      sortValue: (r) => r.blocks.length,
      render: (r) => (
        <span className="rounded-mc bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
          {r.blocks.length}
        </span>
      ),
    },
    {
      key: 'customCode',
      header: '自定义代码',
      width: '12%',
      render: (r) => (r.customCode ? '是' : '—'),
    },
    {
      key: 'preview',
      header: '前 2 个条目',
      width: '30%',
      render: (r) => {
        const all = r.type === 'block' && r.blocks.length > 0 ? r.blocks : r.items;
        return all.length > 0 ? all.slice(0, 2).join(', ') : '—';
      },
    },
  ];

  // ===== 语言列定义 =====
  const langColumns: Column<LangRow>[] = [
    {
      key: 'lang',
      header: '语言',
      width: '12%',
      sortValue: (r) => r.lang,
      render: (r) => (
        <span className="rounded-mc bg-cyan-500/20 px-1.5 py-0.5 text-[10px] text-cyan-400">
          {r.lang}
        </span>
      ),
    },
    {
      key: 'key',
      header: '键',
      width: '38%',
      sortValue: (r) => r.key,
      render: (r) => <span className="font-mono text-[11px] text-mc-text">{r.key}</span>,
    },
    {
      key: 'value',
      header: '值',
      width: '50%',
      render: (r) => <span className="text-[11px] text-mc-dim">{r.value}</span>,
    },
  ];

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
      <ConflictAlert
        totalConflicts={totalConflicts}
        conflicts={[
          { label: '配方 ID 重复', count: conflicts.duplicateRecipeIds.length },
          { label: '标签 ID 重复', count: conflicts.duplicateTagIds.length },
          { label: '事件 ID 重复', count: conflicts.duplicateEventIds.length },
          { label: '工具提示 ID 重复', count: conflicts.duplicateTooltipIds.length },
          { label: '注册表 ID 重复', count: conflicts.duplicateRegistryIds.length },
        ]}
      />

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
          selectedCount={selectedRecipeIds.size}
          onBatchRemove={() => removeRecipes(Array.from(selectedRecipeIds))}
          onClearSelection={() => setSelectedRecipeIds(new Set())}
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

function countByTab(kj: KubejsSpec, tab: KubejsTab, langEntries: number): number {
  if (tab === 'recipes') return kj.recipes.length;
  if (tab === 'tags') return kj.tags.length;
  if (tab === 'events') return kj.events.length;
  if (tab === 'tooltips') return kj.tooltips.length;
  if (tab === 'registry') return kj.registry.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

function countTagType(kj: KubejsSpec, type: string): number {
  return kj.tags.filter((t) => t.type === type).length;
}

function countRegistryType(kj: KubejsSpec, type: string): number {
  return kj.registry.filter((r) => r.type === type).length;
}

function tabLabel(tab: KubejsTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
