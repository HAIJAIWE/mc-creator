import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type { ModpackSpec, ModEntry, OverrideFileSpec } from '@mc-creator/shared';
import {
  Download,
  Copy,
  Trash2,
  ChevronDown,
  ChevronRight,
  FileText,
  CheckSquare,
  Square,
  GripVertical,
} from 'lucide-react';

type FormatFilter = 'all' | 'modrinth' | 'curseforge';
type SortBy = 'name' | 'size' | 'source' | 'default';
type SubView = 'mods' | 'overrides' | 'server-overrides' | 'export';

/**
 * Modpack 预览面板：mod 列表 + 搜索 + 来源筛选 + 排序 + 批量管理 + 覆盖文件预览 + 导出
 */
export function ModpackPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('default');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState<SubView>('mods');
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());

  const pack = spec as unknown as ModpackSpec | null;

  // useMemo 必须在 early return 之前
  const filtered = useMemo(() => {
    if (!pack) return [];
    let result = pack.mods;
    if (formatFilter !== 'all') {
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
    // 排序
    const sorted = [...result];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'size':
        sorted.sort((a, b) => (b.fileSize ?? 0) - (a.fileSize ?? 0));
        break;
      case 'source':
        sorted.sort((a, b) => {
          const aCF = /^\d+$/.test(a.projectId) ? 1 : 0;
          const bCF = /^\d+$/.test(b.projectId) ? 1 : 0;
          return aCF - bCF;
        });
        break;
    }
    return sorted;
  }, [pack, query, formatFilter, sortBy]);

  // 总下载大小
  const totalSize = useMemo(() => {
    if (!pack) return 0;
    return pack.mods.reduce((sum, m) => sum + (m.fileSize ?? 0), 0);
  }, [pack]);

  // 来源统计
  const sourceStats = useMemo(() => {
    if (!pack) return { modrinth: 0, curseforge: 0 };
    let modrinth = 0,
      curseforge = 0;
    for (const m of pack.mods) {
      if (/^\d+$/.test(m.projectId)) curseforge++;
      else modrinth++;
    }
    return { modrinth, curseforge };
  }, [pack]);

  // ===== 批量操作（hooks 必须在 early return 之前）=====
  const toggleSelect = useCallback((key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(filtered.map((m) => `${m.projectId}:${m.versionId}`)));
  }, [filtered]);

  const deselectAll = useCallback(() => setSelectedIds(new Set()), []);

  const removeMods = useCallback(
    (keys: string[]) => {
      if (!pack) return;
      const keySet = new Set(keys);
      const updated = {
        ...pack,
        mods: pack.mods.filter((m) => !keySet.has(`${m.projectId}:${m.versionId}`)),
      };
      setSpec(updated as unknown as typeof spec);
      setSelectedIds(new Set());
    },
    [pack, setSpec],
  );

  // ===== 覆盖文件操作 =====
  const toggleOverride = useCallback((path: string) => {
    setExpandedOverrides((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const removeOverride = useCallback(
    (path: string, isServer: boolean) => {
      if (!pack) return;
      const key = isServer ? 'serverOverrides' : 'overrides';
      const updated = {
        ...pack,
        [key]: (pack[key] as OverrideFileSpec[]).filter((o) => o.path !== path),
      };
      setSpec(updated as unknown as typeof spec);
    },
    [pack, setSpec],
  );

  // ===== 导出 mod 列表 =====
  const exportModList = useCallback(
    (format: 'json' | 'csv' | 'markdown') => {
      if (!pack) return;
      let content = '';
      let filename = '';
      if (format === 'json') {
        content = JSON.stringify(pack.mods, null, 2);
        filename = `${pack.packId}-mods.json`;
      } else if (format === 'csv') {
        const rows = ['Name,ProjectID,VersionID,FileName,FileSize,Source'];
        for (const m of pack.mods) {
          const source = /^\d+$/.test(m.projectId) ? 'CurseForge' : 'Modrinth';
          rows.push(
            `"${m.name}","${m.projectId}","${m.versionId}","${m.fileName}",${m.fileSize ?? 0},${source}`,
          );
        }
        content = rows.join('\n');
        filename = `${pack.packId}-mods.csv`;
      } else {
        const lines = [`# ${pack.packName} - Mod 列表`, '', `共 ${pack.mods.length} 个 mod`, ''];
        for (const m of pack.mods) {
          const source = /^\d+$/.test(m.projectId) ? 'CurseForge' : 'Modrinth';
          lines.push(
            `- **${m.name}** (${source}) — ${m.fileName} (${formatBytes(m.fileSize ?? 0)})`,
          );
        }
        content = lines.join('\n');
        filename = `${pack.packId}-mods.md`;
      }
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    [pack],
  );

  if (!spec || !pack) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成整合包 Spec"
        hint="在右侧 AgentPanel 描述你想要的整合包，生成 Spec 后即可预览"
      />
    );
  }

  const columns: Column<ModEntry>[] = [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => {
        const key = `${r.projectId}:${r.versionId}`;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSelect(key);
            }}
            className="text-mc-mute hover:text-mc-accent"
          >
            {selectedIds.has(key) ? (
              <CheckSquare className="h-3 w-3" />
            ) : (
              <Square className="h-3 w-3" />
            )}
          </button>
        );
      },
    },
    {
      key: 'drag',
      header: '',
      width: '3%',
      render: () => <GripVertical className="h-3 w-3 cursor-grab text-mc-mute" />,
    },
    { key: 'name', header: 'Mod 名称', width: '22%', sortValue: (r) => r.name },
    { key: 'fileName', header: '文件名', width: '28%', sortValue: (r) => r.fileName },
    { key: 'versionId', header: '版本', width: '18%', sortValue: (r) => r.versionId },
    {
      key: 'fileSize',
      header: '大小',
      width: '10%',
      sortValue: (r) => r.fileSize ?? 0,
      render: (r) => (r.fileSize ? formatBytes(r.fileSize) : '—'),
    },
    {
      key: 'source',
      header: '来源',
      width: '8%',
      render: (r) => {
        const isCF = /^\d+$/.test(r.projectId);
        return (
          <span
            className={`rounded-mc px-1 py-0.5 text-[9px] ${
              isCF ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'
            }`}
          >
            {isCF ? 'CF' : 'MR'}
          </span>
        );
      },
    },
    {
      key: 'actions',
      header: '',
      width: '7%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            removeMods([`${r.projectId}:${r.versionId}`]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
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
          { label: '总大小', value: formatBytes(totalSize) },
        ]}
        subtitle={pack.description || `作者: ${pack.author || '—'}`}
      />

      {/* 子视图切换 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-mc-border bg-mc-surface px-2 py-1">
        {[
          { key: 'mods' as SubView, label: 'Mod 列表', count: pack.mods.length },
          { key: 'overrides' as SubView, label: '覆盖文件', count: pack.overrides.length },
          {
            key: 'server-overrides' as SubView,
            label: '服务器覆盖',
            count: pack.serverOverrides.length,
          },
          { key: 'export' as SubView, label: '导出' },
        ].map((v) => (
          <button
            key={v.key}
            onClick={() => setActiveView(v.key)}
            className={`rounded-mc px-2 py-0.5 text-[11px] font-medium transition-colors ${
              activeView === v.key
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {v.label}
            {v.count !== undefined && <span className="ml-0.5 text-mc-mute">({v.count})</span>}
          </button>
        ))}
      </div>

      {/* ===== Mod 列表视图 ===== */}
      {activeView === 'mods' && (
        <>
          {/* 搜索 + 筛选 + 排序 */}
          <div className="flex flex-wrap items-center gap-2 border-b border-mc-border px-3 py-2">
            <div className="flex-1 min-w-[180px]">
              <SearchInput value={query} onChange={setQuery} placeholder="搜索 mod…" />
            </div>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="all">全部来源 ({pack.mods.length})</option>
              <option value="modrinth">Modrinth ({sourceStats.modrinth})</option>
              <option value="curseforge">CurseForge ({sourceStats.curseforge})</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="mc-select !py-1 !text-xs"
            >
              <option value="default">默认顺序</option>
              <option value="name">按名称</option>
              <option value="size">按大小</option>
              <option value="source">按来源</option>
            </select>
          </div>

          {/* 批量操作栏 */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2 border-b border-mc-border bg-mc-accent/10 px-3 py-1.5">
              <span className="text-[11px] text-mc-text">已选 {selectedIds.size} 项</span>
              <button
                onClick={() => removeMods(Array.from(selectedIds))}
                className="flex items-center gap-1 rounded-mc bg-red-500/20 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-500/30"
              >
                <Trash2 className="h-3 w-3" /> 批量移除
              </button>
              <button
                onClick={deselectAll}
                className="ml-auto text-[10px] text-mc-dim hover:text-mc-text"
              >
                取消选择
              </button>
            </div>
          )}

          {/* 表格 */}
          <div className="flex-1 overflow-y-auto">
            <DataTable
              columns={columns}
              data={filtered}
              rowKey={(r) => `${r.projectId}:${r.versionId}`}
              emptyHint="暂无 mod"
            />
          </div>

          {/* 选择操作 */}
          {filtered.length > 0 && (
            <div className="border-t border-mc-border px-3 py-1 text-[10px]">
              <button onClick={selectAll} className="text-mc-dim hover:text-mc-text">
                全选
              </button>
              <span className="mx-2 text-mc-mute">·</span>
              <button onClick={deselectAll} className="text-mc-dim hover:text-mc-text">
                取消全选
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
            mod 数: {pack.mods.length} · 显示: {filtered.length} · 覆盖文件: {pack.overrides.length}{' '}
            · 服务器覆盖: {pack.serverOverrides.length}
          </div>
        </>
      )}

      {/* ===== 覆盖文件视图（客户端 + 服务器）===== */}
      {(activeView === 'overrides' || activeView === 'server-overrides') && (
        <OverridesView
          overrides={activeView === 'server-overrides' ? pack.serverOverrides : pack.overrides}
          expanded={expandedOverrides}
          onToggle={toggleOverride}
          onRemove={(path) => removeOverride(path, activeView === 'server-overrides')}
          isServer={activeView === 'server-overrides'}
        />
      )}

      {/* ===== 导出视图 ===== */}
      {activeView === 'export' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <h3 className="mb-2 text-sm font-medium text-mc-text">导出 Mod 列表</h3>
            <p className="mb-3 text-xs text-mc-mute">
              将当前整合包的 mod 列表导出为不同格式，方便分享或文档归档
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => exportModList('json')}
                className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-xs text-mc-text hover:border-mc-accent"
              >
                <Download className="h-3 w-3" /> 导出 JSON
              </button>
              <button
                onClick={() => exportModList('csv')}
                className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-xs text-mc-text hover:border-mc-accent"
              >
                <Download className="h-3 w-3" /> 导出 CSV
              </button>
              <button
                onClick={() => exportModList('markdown')}
                className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-xs text-mc-text hover:border-mc-accent"
              >
                <Download className="h-3 w-3" /> 导出 Markdown
              </button>
            </div>
          </div>

          <div className="border-t border-mc-border pt-4">
            <h3 className="mb-2 text-sm font-medium text-mc-text">整合包统计</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <StatCard label="Mod 总数" value={String(pack.mods.length)} />
              <StatCard label="总下载大小" value={formatBytes(totalSize)} />
              <StatCard label="Modrinth 来源" value={String(sourceStats.modrinth)} />
              <StatCard label="CurseForge 来源" value={String(sourceStats.curseforge)} />
              <StatCard label="客户端覆盖" value={String(pack.overrides.length)} />
              <StatCard label="服务器覆盖" value={String(pack.serverOverrides.length)} />
            </div>
          </div>

          {pack.credits && (
            <div className="border-t border-mc-border pt-4">
              <h3 className="mb-2 text-sm font-medium text-mc-text">致谢</h3>
              <p className="text-xs text-mc-dim whitespace-pre-wrap">{pack.credits}</p>
            </div>
          )}

          {pack.launchMessage && (
            <div className="border-t border-mc-border pt-4">
              <h3 className="mb-2 text-sm font-medium text-mc-text">启动消息</h3>
              <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3 text-xs text-mc-dim">
                {pack.launchMessage}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ===== 覆盖文件视图子组件 =====

function OverridesView({
  overrides,
  expanded,
  onToggle,
  onRemove,
  isServer,
}: {
  overrides: OverrideFileSpec[];
  expanded: Set<string>;
  onToggle: (path: string) => void;
  onRemove: (path: string) => void;
  isServer: boolean;
}) {
  if (overrides.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center text-xs text-mc-mute">
          <FileText className="mx-auto mb-2 h-8 w-8 opacity-50" />
          暂无{isServer ? '服务器' : '客户端'}覆盖文件
          <div className="mt-1 text-[10px]">
            覆盖文件用于覆盖默认配置（如 options.txt、config/*.cfg 等）
          </div>
        </div>
      </div>
    );
  }

  const totalSize = overrides.reduce((sum, o) => sum + o.content.length, 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="border-b border-mc-border px-3 py-1.5 text-[10px] text-mc-mute">
        共 {overrides.length} 个文件 · 总大小 {formatBytes(totalSize)}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {overrides.map((o) => {
          const isExpanded = expanded.has(o.path);
          return (
            <div key={o.path} className="rounded-mc border border-mc-border bg-mc-surface-2">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  onClick={() => onToggle(o.path)}
                  className="text-mc-mute hover:text-mc-text"
                >
                  {isExpanded ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
                <FileText className="h-3 w-3 text-mc-accent" />
                <span className="flex-1 truncate font-mono text-[11px] text-mc-text">{o.path}</span>
                <span className="text-[9px] text-mc-mute">{formatBytes(o.content.length)}</span>
                <button
                  onClick={() => navigator.clipboard?.writeText(o.content)}
                  className="text-mc-mute hover:text-mc-text"
                  title="复制内容"
                >
                  <Copy className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onRemove(o.path)}
                  className="text-mc-mute hover:text-red-400"
                  title="移除"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              {isExpanded && (
                <pre className="border-t border-mc-border bg-mc-surface p-2 max-h-48 overflow-auto text-[10px] text-mc-text whitespace-pre-wrap">
                  {o.content}
                </pre>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ===== 统计卡片子组件 =====

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
      <div className="text-[10px] text-mc-mute">{label}</div>
      <div className="mt-1 font-display text-lg font-bold text-mc-text">{value}</div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
