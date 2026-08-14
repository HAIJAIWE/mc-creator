import { useCallback, useMemo, useState } from 'react';
import { shallow } from 'zustand/shallow';
import {
  Download,
  Trash2,
  CheckSquare,
  Square,
  FileText,
  Languages,
  Ghost,
  Heart,
  Swords,
  Target,
  Boxes,
} from 'lucide-react';
import type { BehaviorEntitySpec, BpCustomEntitySpec } from '@mc-creator/shared';
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

type EntityTab = 'entities' | 'lang' | 'metadata' | 'export';

const TABS: { key: EntityTab; label: string; icon: typeof Ghost }[] = [
  { key: 'entities', label: '实体', icon: Ghost },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<EntityTab>(['metadata', 'export']);

const GOAL_LABEL: Record<string, string> = {
  melee: '近战',
  ranged: '远程',
  idle_wander: '游荡',
  look_at_player: '注视',
  flee_sun: '避日',
  swim: '游泳',
  follow_owner: '跟随',
  panic: '恐慌',
};

const ENTITY_CONFLICT_GROUPS: ConflictGroup<BehaviorEntitySpec>[] = [
  {
    key: 'duplicateEntityIds',
    label: '实体 ID 重复',
    detect: (s) => findDuplicates(s.entities, (e) => e.id),
  },
];

const ENTITY_EXPORT: ExportHandler<BehaviorEntitySpec> = {
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
              heading: '实体列表',
              lines: s.entities.map(
                (e) =>
                  `- \`${e.id}\` — ${e.name} (生命 ${e.health} / 攻击 ${e.attackDamage || '—'} / 速度 ${e.movementSpeed})` +
                  (e.goals.length > 0
                    ? ` — AI: ${e.goals.map((g) => GOAL_LABEL[g.type] ?? g.type).join(', ')}`
                    : '') +
                  (e.drops.length > 0 ? ` — 掉落 ${e.drops.length} 项` : ''),
              ),
            },
          ],
        ),
    },
    entities: {
      data: (s) => s.entities,
      toCsv: (s) =>
        [
          'ID,Name,Health,Attack,Speed,Hostile,Geometry,Drops,Goals',
          ...s.entities.map((e) =>
            [
              `"${e.id}"`,
              `"${e.name}"`,
              e.health,
              e.attackDamage,
              e.movementSpeed,
              e.hostile,
              e.geometry,
              e.drops.length,
              e.goals.map((g) => g.type).join('|'),
            ].join(','),
          ),
        ].join('\n'),
      toMd: (s) =>
        toMdTable(
          `# ${s.packName || s.packId} - 实体列表`,
          `共 ${s.entities.length} 个实体`,
          ['ID', '名称', '生命', '攻击', '速度', '敌对', 'AI 行为', '掉落'],
          s.entities.map((e) => [
            `\`${e.id}\``,
            e.name,
            String(e.health),
            e.attackDamage ? String(e.attackDamage) : '—',
            String(e.movementSpeed),
            e.hostile ? '是' : '否',
            e.goals.map((g) => GOAL_LABEL[g.type] ?? g.type).join(', ') || '—',
            e.drops.length ? String(e.drops.length) : '—',
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

/** 行为包自定义实体（怪物 AI）预览面板：4 Tab + 统计卡片 + 搜索 + 批量管理 + 导出 + ID 重复检测 */
export function BehaviorEntityPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [activeTab, setActiveTab] = useState<EntityTab>('entities');
  const [query, setQuery] = useState('');
  const selection = useBatchSelection<string>();

  const be = spec as unknown as BehaviorEntitySpec | null;

  // ===== 统计计算（hooks 必须在 early return 之前）=====
  const stats = useMemo(() => {
    if (!be) {
      return {
        total: 0,
        hostile: 0,
        ranged: 0,
        totalDrops: 0,
        langCount: 0,
        langEntries: 0,
      };
    }
    const { entries: langEntries, languages: langCount } = countLangEntries(be.lang);
    return {
      total: be.entities.length,
      hostile: be.entities.filter((e) => e.hostile).length,
      ranged: be.entities.filter((e) => e.goals.some((g) => g.type === 'ranged')).length,
      totalDrops: be.entities.reduce((n, e) => n + e.drops.length, 0),
      langCount,
      langEntries,
    };
  }, [be]);

  // ===== ID 重复检测 =====
  const { conflicts, totalConflicts, conflictList } = useConflictDetection(
    be,
    ENTITY_CONFLICT_GROUPS,
  );

  // ===== 实体筛选 =====
  const filteredEntities = useMemo(() => {
    if (!be) return [];
    if (!query) return be.entities;
    const q = query.toLowerCase();
    return be.entities.filter(
      (e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q),
    );
  }, [be, query]);

  // ===== 语言条目展开为行 =====
  const langRows = useMemo<LangRow[]>(() => {
    if (!be?.lang) return [];
    const rows: LangRow[] = [];
    for (const [langCode, dict] of Object.entries(be.lang)) {
      for (const [key, value] of Object.entries(dict)) {
        rows.push({ lang: langCode, key, value });
      }
    }
    return rows;
  }, [be]);

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
    if (!be) return [];
    return [
      { label: 'Pack ID', value: be.packId },
      { label: 'Pack Name', value: be.packName },
      { label: '描述', value: be.description || '—' },
      { label: 'packFormat', value: String(be.packFormat) },
      { label: '引擎版本', value: be.mcVersion.join('.') },
      {
        label: '实体 ID 列表',
        value: be.entities.map((e) => e.id).join(', ') || '—',
      },
    ];
  }, [be]);

  // ===== 批量选择操作 =====
  const removeEntities = useCallback(
    (ids: string[]) => {
      if (!be) return;
      const idSet = new Set(ids);
      const updated = {
        ...be,
        entities: be.entities.filter((e) => !idSet.has(e.id)),
      };
      setSpec(updated as unknown as typeof spec);
      selection.clear();
    },
    [be, setSpec, selection],
  );

  // ===== Tab 配置 =====
  const tabs = useTabCounts(
    TABS,
    be,
    (spec, tab) => countByTab(spec, tab, stats.langEntries),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((tab: EntityTab) => {
    setActiveTab(tab);
    setQuery('');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (format: ExportFormat, scope: 'all' | 'entities' | 'lang') => {
      if (!be) return;
      const out = buildExport(be, ENTITY_EXPORT, format, scope);
      if (!out) return;
      downloadBlob(out.content, out.filename, 'text/plain');
    },
    [be],
  );

  if (!spec || !be) {
    return <EmptySpecState label="行为包实体" describe="基岩版自定义怪物 AI" />;
  }

  // ===== 实体列定义 =====
  const entityColumns: Column<BpCustomEntitySpec>[] = [
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
      header: '实体 ID',
      width: '14%',
      sortValue: (e) => e.id,
      render: (e) => <span className="font-mono text-[11px] text-mc-text">{e.id}</span>,
    },
    {
      key: 'name',
      header: '名称',
      width: '11%',
      sortValue: (e) => e.name,
      render: (e) => <span className="text-[11px] text-mc-text">{e.name}</span>,
    },
    {
      key: 'hostile',
      header: '类型',
      width: '8%',
      sortValue: (e) => (e.hostile ? 1 : 0),
      render: (e) =>
        e.hostile ? (
          <span className="rounded-mc bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
            敌对
          </span>
        ) : (
          <span className="rounded-mc bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400">
            被动
          </span>
        ),
    },
    {
      key: 'stats',
      header: '数值',
      width: '24%',
      render: (e) => {
        const parts: string[] = [];
        parts.push(`生命 ${e.health}`);
        if (e.attackDamage > 0) parts.push(`攻击 ${e.attackDamage}`);
        parts.push(`速度 ${e.movementSpeed}`);
        if (e.scale !== 1) parts.push(`体型 ×${e.scale}`);
        if (e.fireImmune) parts.push('免疫火');
        if (e.knockbackResistance > 0) parts.push(`抗击退 ${e.knockbackResistance}`);
        return <span className="text-[10px] text-mc-dim">{parts.join(' · ')}</span>;
      },
    },
    {
      key: 'goals',
      header: 'AI 行为',
      width: '20%',
      render: (e) =>
        e.goals.length > 0 ? (
          <span className="text-[10px] text-mc-dim">
            {e.goals
              .slice(0, 3)
              .map((g) => GOAL_LABEL[g.type] ?? g.type)
              .join(', ')}
            {e.goals.length > 3 ? ` +${e.goals.length - 3}` : ''}
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
        ),
    },
    {
      key: 'drops',
      header: '掉落',
      width: '7%',
      sortValue: (e) => e.drops.length,
      render: (e) =>
        e.drops.length > 0 ? (
          <span className="rounded-mc bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-400">
            ×{e.drops.length}
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
        ),
    },
    {
      key: 'custom',
      header: '自定义',
      width: '8%',
      render: (e) =>
        e.customComponents.length > 0 || Object.keys(e.customEvents).length > 0 ? (
          <span className="rounded-mc bg-purple-500/20 px-1.5 py-0.5 text-[10px] text-purple-400">
            {e.customComponents.length + Object.keys(e.customEvents).length} 项
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">—</span>
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
            removeEntities([e.id]);
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
        icon="bug"
        title={be.packName || be.packId}
        meta={[
          { label: 'packFormat', value: String(be.packFormat) },
          { label: '引擎', value: be.mcVersion.join('.') },
          { label: '描述', value: be.description || '—' },
        ]}
        subtitle={`基岩版自定义实体包 ID: ${be.packId}`}
      />

      {/* 统计卡片行 */}
      <StatCardGrid>
        <StatCard label="实体" value={stats.total} icon={<Ghost className="h-3 w-3" />} />
        <StatCard label="敌对" value={stats.hostile} icon={<Swords className="h-3 w-3" />} />
        <StatCard label="远程射手" value={stats.ranged} icon={<Target className="h-3 w-3" />} />
        <StatCard label="掉落项" value={stats.totalDrops} icon={<Boxes className="h-3 w-3" />} />
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

      {/* 实体批量操作栏 */}
      {activeTab === 'entities' && (
        <BatchSelectToolbar
          selectedCount={selection.size}
          onBatchRemove={() => removeEntities(Array.from(selection.selected))}
          onClearSelection={selection.clear}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'entities' && (
          <DataTable
            columns={entityColumns}
            data={filteredEntities}
            rowKey={(e) => e.id}
            emptyHint="暂无实体"
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
            title="导出行为包实体数据"
            description="将当前实体包的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'entities', label: '实体列表', count: be.entities.length },
              { scope: 'lang', label: '语言条目', count: stats.langEntries },
            ]}
            onExport={exportData}
            statsTitle="实体包统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="实体总数" value={stats.total} />
                <StatCard label="敌对" value={stats.hostile} />
                <StatCard label="远程射手" value={stats.ranged} />
                <StatCard label="掉落项" value={stats.totalDrops} />
                <StatCard label="语言种类" value={stats.langCount} />
                <StatCard label="翻译条目" value={stats.langEntries} />
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {activeTab === 'entities' && (
          <>
            实体 {be.entities.length} · 显示 {filteredEntities.length} · 敌对 {stats.hostile} · 远程{' '}
            {stats.ranged} · 掉落 {stats.totalDrops}
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

function countByTab(s: BehaviorEntitySpec, tab: EntityTab, langEntries: number): number {
  if (tab === 'entities') return s.entities.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

function tabLabel(tab: EntityTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
