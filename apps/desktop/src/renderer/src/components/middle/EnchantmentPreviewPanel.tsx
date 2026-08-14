import { useCallback, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  FileText,
  Boxes,
  Languages,
  Star,
  Sparkles,
} from 'lucide-react';
import type { DataEnchantmentSpec, DataEnchantmentEntrySpec } from '@mc-creator/shared';
import { useModStore } from '../../store/mod-store.js';
import {
  Column,
  PanelHeader,
  EmptySpecState,
  StatCard,
  StatCardGrid,
  MetadataView,
  findDuplicates,
  downloadBlob,
  countLangEntries,
  ConflictAlert,
  ExportView,
  type ExportFormat,
  FilterBar,
  IconTabBar,
  useBatchSelection,
  useTabCounts,
  useConflictDetection,
  BatchSelectToolbar,
  buildExport,
  toMdTable,
  toMdOverview,
  type ExportHandler,
  type ConflictGroup,
  DataTable,
} from './shared/index.js';

type EnchantmentTab = 'enchantments' | 'lang' | 'metadata' | 'export';

const TABS: { key: EnchantmentTab; label: string; icon: typeof Star }[] = [
  { key: 'enchantments', label: '附魔', icon: Star },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<EnchantmentTab>(['metadata', 'export']);

/** 效果类型 → 显示标签 */
const EFFECT_LABEL: Record<string, string> = {
  damage_bonus: '伤害加成',
  mob_experience: '经验加成',
  loot_bonus: '战利品加成',
  knockback: '击退',
  burning_time: '火焰附加',
  healing: '吸取生命',
  attribute: '属性加成',
};

const ENCHANT_CONFLICT_GROUPS: ConflictGroup<DataEnchantmentSpec>[] = [
  {
    key: 'duplicateEnchantmentIds',
    label: '附魔 ID 重复',
    detect: (s) => findDuplicates(s.enchantments, (e) => e.id),
  },
];

const ENCHANT_EXPORT: ExportHandler<DataEnchantmentSpec> = {
  prefix: (s) => s.packId,
  scopes: {
    all: {
      data: (s) => s,
      toMd: (s) =>
        toMdOverview(
          `# ${s.packName || s.packId}`,
          [
            `- **Pack ID**: ${s.packId}`,
            `- **Format**: ${s.packFormat}`,
            `- **描述**: ${s.description || '—'}`,
          ],
          [
            {
              heading: '附魔列表',
              lines: s.enchantments.map(
                (e) =>
                  `- \`${e.id}\` — ${e.name} (Lv.${e.maxLevel}) — ${e.supportedItems.join(', ') || '#minecraft:enchantable/sharp_weapon'}`,
              ),
            },
          ],
        ),
    },
    enchantments: {
      data: (s) => s.enchantments,
      toCsv: (s) =>
        [
          'ID,Name,MaxLevel,Weight,Slots,SupportedItems,Effects',
          ...s.enchantments.map((e) =>
            [
              `"${e.id}"`,
              `"${e.name}"`,
              e.maxLevel,
              e.weight,
              `"${e.slots.join(';')}"`,
              `"${e.supportedItems.join(';')}"`,
              e.effects.length + e.customEffects.length,
            ].join(','),
          ),
        ].join('\n'),
      toMd: (s) =>
        toMdTable(
          `# ${s.packName || s.packId} - 附魔列表`,
          `共 ${s.enchantments.length} 个附魔`,
          ['ID', '名称', '最大等级', '权重', '物品', '效果数'],
          s.enchantments.map((e) => [
            `\`${e.id}\``,
            e.name,
            String(e.maxLevel),
            String(e.weight),
            e.supportedItems.join(', ') || '默认',
            String(e.effects.length + e.customEffects.length),
          ]),
        ),
    },
    lang: {
      data: (s) => s.lang,
      toCsv: (s) =>
        [
          'Lang,Key,Value',
          ...Object.entries(s.lang).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => `"${langCode}","${k}","${v}"`),
          ),
        ].join('\n'),
      toMd: (s) =>
        toMdTable(
          `# ${s.packName || s.packId} - 语言条目`,
          `共 ${Object.values(s.lang).reduce((n, d) => n + Object.keys(d).length, 0)} 条`,
          ['语言', '键', '值'],
          Object.entries(s.lang).flatMap(([langCode, dict]) =>
            Object.entries(dict).map(([k, v]) => [langCode, `\`${k}\``, v]),
          ),
        ),
    },
  },
};

interface LangRow {
  lang: string;
  key: string;
  value: string;
}

/** 附魔预览面板：4 Tab + 统计卡片 + 搜索 + 批量管理 + 导出 + ID 重复检测 */
export function EnchantmentPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<EnchantmentTab>('enchantments');
  const [query, setQuery] = useState('');
  const selection = useBatchSelection<string>();

  const ench = spec as unknown as DataEnchantmentSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!ench) {
      return {
        total: 0,
        effects: 0,
        customEffects: 0,
        exclusive: 0,
        langCount: 0,
        langEntries: 0,
      };
    }
    const { entries: langEntries, languages: langCount } = countLangEntries(ench.lang);
    return {
      total: ench.enchantments.length,
      effects: ench.enchantments.reduce((n, e) => n + e.effects.length, 0),
      customEffects: ench.enchantments.reduce((n, e) => n + e.customEffects.length, 0),
      exclusive: ench.enchantments.filter((e) => e.exclusiveSet).length,
      langCount,
      langEntries,
    };
  }, [ench]);

  // ===== 效果类型分布 =====
  const effectTypeStats = useMemo(() => {
    const dist: Record<string, number> = {};
    for (const e of ench?.enchantments ?? []) {
      for (const fx of e.effects) {
        dist[fx.type] = (dist[fx.type] ?? 0) + 1;
      }
    }
    return dist;
  }, [ench]);

  // ===== ID 重复检测 =====
  const { conflicts, totalConflicts, conflictList } = useConflictDetection(
    ench,
    ENCHANT_CONFLICT_GROUPS,
  );

  // ===== 附魔筛选 =====
  const filteredEnchantments = useMemo(() => {
    if (!ench) return [];
    if (!query) return ench.enchantments;
    const q = query.toLowerCase();
    return ench.enchantments.filter(
      (e) =>
        e.id.toLowerCase().includes(q) ||
        e.name.toLowerCase().includes(q) ||
        e.supportedItems.some((i) => i.toLowerCase().includes(q)),
    );
  }, [ench, query]);

  // ===== 语言条目展开为行 =====
  const langRows = useMemo<LangRow[]>(() => {
    if (!ench?.lang) return [];
    const rows: LangRow[] = [];
    for (const [langCode, dict] of Object.entries(ench.lang)) {
      for (const [key, value] of Object.entries(dict)) {
        rows.push({ lang: langCode, key, value });
      }
    }
    return rows;
  }, [ench]);

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

  // ===== 元数据行 =====
  const metadataRows = useMemo(() => {
    if (!ench) return [];
    return [
      { label: 'Pack ID', value: ench.packId },
      { label: 'Pack Name', value: ench.packName },
      { label: '描述', value: ench.description || '—' },
      { label: 'packFormat', value: String(ench.packFormat) },
      {
        label: '语言列表',
        value: Object.keys(ench.lang ?? {}).join(', ') || '—',
      },
      {
        label: '附魔 ID 列表',
        value: ench.enchantments.map((e) => e.id).join(', ') || '—',
      },
    ];
  }, [ench]);

  // ===== 批量选择操作 =====
  const removeEnchantments = useCallback(
    (ids: string[]) => {
      if (!ench) return;
      const idSet = new Set(ids);
      const updated = {
        ...ench,
        enchantments: ench.enchantments.filter((e) => !idSet.has(e.id)),
      };
      setSpec(updated as unknown as typeof spec);
      selection.clear();
    },
    [ench, setSpec, selection],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(
    TABS,
    ench,
    (spec, tab) => countByTab(spec, tab, stats.langEntries),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((tab: EnchantmentTab) => {
    setActiveTab(tab);
    setQuery('');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (format: ExportFormat, scope: 'all' | 'enchantments' | 'lang') => {
      if (!ench) return;
      const out = buildExport(ench, ENCHANT_EXPORT, format, scope);
      if (!out) return;
      downloadBlob(out.content, out.filename, 'text/plain');
    },
    [ench],
  );

  if (!spec || !ench) {
    return <EmptySpecState label="附魔" describe="1.21+ 数据驱动附魔包" />;
  }

  // ===== 附魔列定义 =====
  const enchantColumns: Column<DataEnchantmentEntrySpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (e) => (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            selection.toggle(e.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selection.isSelected(e.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'id',
      header: '附魔 ID',
      width: '16%',
      sortValue: (e) => e.id,
      render: (e) => <span className="font-mono text-[11px] text-mc-text">{e.id}</span>,
    },
    {
      key: 'name',
      header: '名称',
      width: '14%',
      sortValue: (e) => e.name,
      render: (e) => <span className="text-[11px] text-mc-text">{e.name}</span>,
    },
    {
      key: 'maxLevel',
      header: '等级',
      width: '7%',
      sortValue: (e) => e.maxLevel,
      render: (e) => (
        <span className="rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim">
          Lv.{e.maxLevel}
        </span>
      ),
    },
    {
      key: 'slots',
      header: '栏位',
      width: '10%',
      sortValue: (e) => e.slots.join(','),
      render: (e) => e.slots.join(', ') || 'any',
    },
    {
      key: 'supportedItems',
      header: '适用物品',
      width: '20%',
      sortValue: (e) => e.supportedItems.join(','),
      render: (e) =>
        e.supportedItems.length > 0 ? (
          <span className="font-mono text-[10px] text-mc-dim">
            {e.supportedItems.slice(0, 2).join(', ')}
            {e.supportedItems.length > 2 ? ` +${e.supportedItems.length - 2}` : ''}
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">默认</span>
        ),
    },
    {
      key: 'weight',
      header: '权重',
      width: '7%',
      sortValue: (e) => e.weight,
      render: (e) => String(e.weight),
    },
    {
      key: 'effects',
      header: '效果',
      width: '18%',
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          {e.effects.map((fx) => (
            <span
              key={fx.type}
              className="rounded-mc bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400"
              title={`${fx.amount} / 级`}
            >
              {EFFECT_LABEL[fx.type] ?? fx.type}
            </span>
          ))}
          {e.customEffects.length > 0 && (
            <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
              自定义 ×{e.customEffects.length}
            </span>
          )}
          {e.effects.length === 0 && e.customEffects.length === 0 && (
            <span className="text-[10px] text-mc-mute">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (e) => (
        <button
          onClick={(ev) => {
            ev.stopPropagation();
            removeEnchantments([e.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
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
        icon="star"
        title={ench.packName || ench.packId}
        meta={[
          { label: 'packFormat', value: String(ench.packFormat) },
          { label: '描述', value: ench.description || '—' },
        ]}
        subtitle={`数据驱动附魔包 ID: ${ench.packId}（1.21+）`}
      />

      {/* 统计卡片行 */}
      <StatCardGrid>
        <StatCard label="附魔" value={stats.total} icon={<Star className="h-3 w-3" />} />
        <StatCard
          label="语义化效果"
          value={stats.effects}
          icon={<Sparkles className="h-3 w-3" />}
        />
        <StatCard
          label="自定义效果"
          value={stats.customEffects}
          icon={<Boxes className="h-3 w-3" />}
        />
        <StatCard label="互斥附魔" value={stats.exclusive} icon={<Boxes className="h-3 w-3" />} />
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

      {/* 搜索栏 */}
      {activeTab !== 'metadata' && activeTab !== 'export' && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={`搜索${tabLabel(activeTab)}…`}
        />
      )}

      {/* 附魔批量操作栏 */}
      {activeTab === 'enchantments' && (
        <BatchSelectToolbar
          selectedCount={selection.size}
          onBatchRemove={() => removeEnchantments(Array.from(selection.selected))}
          onClearSelection={selection.clear}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'enchantments' && (
          <DataTable
            columns={enchantColumns}
            data={filteredEnchantments}
            rowKey={(e) => e.id}
            emptyHint="暂无附魔"
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
        {activeTab === 'metadata' && <MetadataView rows={metadataRows} />}
        {activeTab === 'export' && (
          <ExportView
            title="导出附魔数据"
            description="将当前附魔包的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'enchantments', label: '附魔列表', count: ench.enchantments.length },
              { scope: 'lang', label: '语言条目', count: stats.langEntries },
            ]}
            onExport={exportData}
            statsTitle="附魔包统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="附魔总数" value={stats.total} />
                <StatCard label="语义化效果" value={stats.effects} />
                <StatCard label="自定义效果" value={stats.customEffects} />
                <StatCard label="互斥附魔" value={stats.exclusive} />
                <StatCard label="语言种类" value={stats.langCount} />
                <StatCard label="翻译条目" value={stats.langEntries} />
                {Object.entries(effectTypeStats).map(([type, count]) => (
                  <StatCard key={type} label={EFFECT_LABEL[type] ?? type} value={count} />
                ))}
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'enchantments' && (
          <>
            附魔 {ench.enchantments.length} · 显示 {filteredEnchantments.length} · 效果{' '}
            {stats.effects} · 自定义 {stats.customEffects}
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

function countByTab(s: DataEnchantmentSpec, tab: EnchantmentTab, langEntries: number): number {
  if (tab === 'enchantments') return s.enchantments.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

function tabLabel(tab: EnchantmentTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
