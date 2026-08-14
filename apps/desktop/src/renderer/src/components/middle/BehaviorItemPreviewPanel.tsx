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
  Shield,
  Sword,
  Pickaxe,
} from 'lucide-react';
import type { BehaviorItemSpec, BpItemEntrySpec } from '@mc-creator/shared';
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

type ItemTab = 'items' | 'lang' | 'metadata' | 'export';

const TABS: { key: ItemTab; label: string; icon: typeof Boxes }[] = [
  { key: 'items', label: '物品', icon: Boxes },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<ItemTab>(['metadata', 'export']);

const CATEGORY_LABEL: Record<string, string> = {
  equipment: '装备',
  tools: '工具',
  weapons: '武器',
  items: '物品',
};

const CATEGORY_COLOR: Record<string, string> = {
  equipment: 'bg-cyan-500/20 text-cyan-400',
  tools: 'bg-emerald-500/20 text-emerald-400',
  weapons: 'bg-red-500/20 text-red-400',
  items: 'bg-mc-surface-3 text-mc-dim',
};

const ITEM_CONFLICT_GROUPS: ConflictGroup<BehaviorItemSpec>[] = [
  {
    key: 'duplicateItemIds',
    label: '物品 ID 重复',
    detect: (s) => findDuplicates(s.items, (i) => i.id),
  },
];

const ITEM_EXPORT: ExportHandler<BehaviorItemSpec> = {
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
              heading: '物品列表',
              lines: s.items.map(
                (i) =>
                  `- \`${i.id}\` — ${i.name} (${CATEGORY_LABEL[i.category] ?? i.category})` +
                  (i.armor ? ` — 盔甲 ${i.armor.protection}` : '') +
                  (i.tool ? ` — 挖掘 ${i.tool.level}` : '') +
                  (i.attackDamage > 0 ? ` — 攻击 ${i.attackDamage}` : ''),
              ),
            },
          ],
        ),
    },
    items: {
      data: (s) => s.items,
      toCsv: (s) =>
        [
          'ID,Name,Category,MaxStack,Durability,Attack,Armor,Enchantable',
          ...s.items.map((i) =>
            [
              `"${i.id}"`,
              `"${i.name}"`,
              i.category,
              i.maxStackSize,
              i.durability,
              i.attackDamage,
              i.armor?.protection ?? '',
              i.enchantable,
            ].join(','),
          ),
        ].join('\n'),
      toMd: (s) =>
        toMdTable(
          `# ${s.packName || s.packId} - 物品列表`,
          `共 ${s.items.length} 个物品`,
          ['ID', '名称', '分类', '耐久', '攻击', '盔甲', '附魔'],
          s.items.map((i) => [
            `\`${i.id}\``,
            i.name,
            CATEGORY_LABEL[i.category] ?? i.category,
            i.durability ? String(i.durability) : '—',
            i.attackDamage ? String(i.attackDamage) : '—',
            i.armor ? String(i.armor.protection) : '—',
            String(i.enchantable),
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

/** 行为包自定义物品预览面板：4 Tab + 统计卡片 + 搜索 + 批量管理 + 导出 + ID 重复检测 */
export function BehaviorItemPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<ItemTab>('items');
  const [query, setQuery] = useState('');
  const selection = useBatchSelection<string>();

  const bp = spec as unknown as BehaviorItemSpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!bp) {
      return {
        total: 0,
        armor: 0,
        tools: 0,
        weapons: 0,
        langCount: 0,
        langEntries: 0,
      };
    }
    const { entries: langEntries, languages: langCount } = countLangEntries(bp.lang);
    return {
      total: bp.items.length,
      armor: bp.items.filter((i) => i.armor).length,
      tools: bp.items.filter((i) => i.tool).length,
      weapons: bp.items.filter((i) => i.attackDamage > 0 && !i.tool && !i.armor).length,
      langCount,
      langEntries,
    };
  }, [bp]);

  // ===== ID 重复检测 =====
  const { conflicts, totalConflicts, conflictList } = useConflictDetection(
    bp,
    ITEM_CONFLICT_GROUPS,
  );

  // ===== 物品筛选 =====
  const filteredItems = useMemo(() => {
    if (!bp) return [];
    if (!query) return bp.items;
    const q = query.toLowerCase();
    return bp.items.filter(
      (i) => i.id.toLowerCase().includes(q) || i.name.toLowerCase().includes(q),
    );
  }, [bp, query]);

  // ===== 语言条目展开为行 =====
  const langRows = useMemo<LangRow[]>(() => {
    if (!bp?.lang) return [];
    const rows: LangRow[] = [];
    for (const [langCode, dict] of Object.entries(bp.lang)) {
      for (const [key, value] of Object.entries(dict)) {
        rows.push({ lang: langCode, key, value });
      }
    }
    return rows;
  }, [bp]);

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
    if (!bp) return [];
    return [
      { label: 'Pack ID', value: bp.packId },
      { label: 'Pack Name', value: bp.packName },
      { label: '描述', value: bp.description || '—' },
      { label: 'packFormat', value: String(bp.packFormat) },
      { label: '引擎版本', value: bp.mcVersion.join('.') },
      {
        label: '物品 ID 列表',
        value: bp.items.map((i) => i.id).join(', ') || '—',
      },
    ];
  }, [bp]);

  // ===== 批量选择操作 =====
  const removeItems = useCallback(
    (ids: string[]) => {
      if (!bp) return;
      const idSet = new Set(ids);
      const updated = {
        ...bp,
        items: bp.items.filter((i) => !idSet.has(i.id)),
      };
      setSpec(updated as unknown as typeof spec);
      selection.clear();
    },
    [bp, setSpec, selection],
  );

  // ===== Tab 配置 =====
  const tabs = useTabCounts(
    TABS,
    bp,
    (spec, tab) => countByTab(spec, tab, stats.langEntries),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((tab: ItemTab) => {
    setActiveTab(tab);
    setQuery('');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (format: ExportFormat, scope: 'all' | 'items' | 'lang') => {
      if (!bp) return;
      const out = buildExport(bp, ITEM_EXPORT, format, scope);
      if (!out) return;
      downloadBlob(out.content, out.filename, 'text/plain');
    },
    [bp],
  );

  if (!spec || !bp) {
    return <EmptySpecState label="行为包物品" describe="基岩版自定义物品" />;
  }

  // ===== 物品列定义 =====
  const itemColumns: Column<BpItemEntrySpec>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (i) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(i.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selection.isSelected(i.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    {
      key: 'id',
      header: '物品 ID',
      width: '14%',
      sortValue: (i) => i.id,
      render: (i) => <span className="font-mono text-[11px] text-mc-text">{i.id}</span>,
    },
    {
      key: 'name',
      header: '名称',
      width: '13%',
      sortValue: (i) => i.name,
      render: (i) => <span className="text-[11px] text-mc-text">{i.name}</span>,
    },
    {
      key: 'category',
      header: '分类',
      width: '9%',
      sortValue: (i) => i.category,
      render: (i) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${CATEGORY_COLOR[i.category] ?? 'bg-mc-surface-3 text-mc-dim'}`}
        >
          {CATEGORY_LABEL[i.category] ?? i.category}
        </span>
      ),
    },
    {
      key: 'stats',
      header: '数值',
      width: '26%',
      render: (i) => {
        const parts: string[] = [];
        if (i.attackDamage > 0) parts.push(`攻击 ${i.attackDamage}`);
        if (i.attackSpeed > 0) parts.push(`攻速 ${i.attackSpeed}`);
        if (i.armor) parts.push(`盔甲 ${i.armor.protection}（${i.armor.slot}）`);
        if (i.tool) parts.push(`挖掘${i.tool.level} 效率${i.tool.efficiency}`);
        if (i.durability > 0) parts.push(`耐久 ${i.durability}`);
        return parts.length > 0 ? (
          <span className="text-[10px] text-mc-dim">{parts.join(' · ')}</span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
        );
      },
    },
    {
      key: 'enchantable',
      header: '附魔',
      width: '8%',
      sortValue: (i) => i.enchantable,
      render: (i) =>
        i.enchantable > 0 ? (
          <span className="rounded-mc bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
            {i.enchantable}
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
        ),
    },
    {
      key: 'custom',
      header: '自定义组件',
      width: '12%',
      render: (i) =>
        i.customComponents.length > 0 ? (
          <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
            ×{i.customComponents.length}
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (i) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeItems([i.id]);
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
        icon="tool-case"
        title={bp.packName || bp.packId}
        meta={[
          { label: 'packFormat', value: String(bp.packFormat) },
          { label: '引擎', value: bp.mcVersion.join('.') },
          { label: '描述', value: bp.description || '—' },
        ]}
        subtitle={`基岩版自定义物品包 ID: ${bp.packId}`}
      />

      {/* 统计卡片行 */}
      <StatCardGrid>
        <StatCard label="物品" value={stats.total} icon={<Boxes className="h-3 w-3" />} />
        <StatCard label="盔甲" value={stats.armor} icon={<Shield className="h-3 w-3" />} />
        <StatCard label="工具" value={stats.tools} icon={<Pickaxe className="h-3 w-3" />} />
        <StatCard label="武器" value={stats.weapons} icon={<Sword className="h-3 w-3" />} />
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

      {/* 物品批量操作栏 */}
      {activeTab === 'items' && (
        <BatchSelectToolbar
          selectedCount={selection.size}
          onBatchRemove={() => removeItems(Array.from(selection.selected))}
          onClearSelection={selection.clear}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'items' && (
          <DataTable
            columns={itemColumns}
            data={filteredItems}
            rowKey={(i) => i.id}
            emptyHint="暂无物品"
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
            title="导出行为包物品数据"
            description="将当前物品包的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'items', label: '物品列表', count: bp.items.length },
              { scope: 'lang', label: '语言条目', count: stats.langEntries },
            ]}
            onExport={exportData}
            statsTitle="物品包统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="物品总数" value={stats.total} />
                <StatCard label="盔甲" value={stats.armor} />
                <StatCard label="工具" value={stats.tools} />
                <StatCard label="武器" value={stats.weapons} />
                <StatCard label="语言种类" value={stats.langCount} />
                <StatCard label="翻译条目" value={stats.langEntries} />
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'items' && (
          <>
            物品 {bp.items.length} · 显示 {filteredItems.length} · 盔甲 {stats.armor} · 工具{' '}
            {stats.tools} · 武器 {stats.weapons}
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

function countByTab(s: BehaviorItemSpec, tab: ItemTab, langEntries: number): number {
  if (tab === 'items') return s.items.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

function tabLabel(tab: ItemTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
