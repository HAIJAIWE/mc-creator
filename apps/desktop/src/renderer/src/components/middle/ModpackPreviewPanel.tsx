import { useState, useMemo, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { useProjectStore } from '../../store/project-store.js';
import { ipcClient } from '../../lib/ipc-client.js';
import type { ModConflictT } from '../../../../shared/ipc-channels.js';
import {
  DataTable,
  PanelHeader,
  FilterBar,
  EmptySpecState,
  StatCard,
  IconTabBar,
  BatchSelectToolbar,
  downloadBlob,
  formatBytes,
  useBatchSelection,
  useTabCounts,
} from './shared/index.js';
import type { Column, BaseTab } from './shared/index.js';
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
  RefreshCw,
  AlertTriangle,
  Package,
  Loader2,
} from 'lucide-react';

type FormatFilter = 'all' | 'modrinth' | 'curseforge';
type SortBy = 'name' | 'size' | 'source' | 'default';
type SubView = 'mods' | 'deps' | 'conflicts' | 'overrides' | 'server-overrides' | 'export';

const MODPACK_TABS: BaseTab<SubView>[] = [
  { key: 'mods', label: 'Mod 列表' },
  { key: 'deps', label: '依赖树' },
  { key: 'conflicts', label: '冲突' },
  { key: 'overrides', label: '覆盖文件' },
  { key: 'server-overrides', label: '服务器覆盖' },
  { key: 'export', label: '导出' },
];

const HIDE_COUNT_TABS = new Set<SubView>(['deps', 'conflicts', 'export']);

const CONFLICT_KIND_LABEL: Record<ModConflictT['kind'], string> = {
  'duplicate-version': '多版本',
  'loader-mismatch': 'Loader 不匹配',
  'mc-out-of-range': 'MC 越界',
  'missing-dependency': '缺失依赖',
  'breaks-conflict': '不兼容',
};

/**
 * Modpack 预览面板：mod 列表 + 搜索 + 来源筛选 + 排序 + 批量管理 + 覆盖文件预览 + 导出
 */
export function ModpackPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [sortBy, setSortBy] = useState<SortBy>('default');
  const selection = useBatchSelection<string>();
  const [activeView, setActiveView] = useState<SubView>('mods');
  const [expandedOverrides, setExpandedOverrides] = useState<Set<string>>(new Set());
  // === 依赖解析 / 冲突 / 导出状态 ===
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [depGraph, setDepGraph] = useState<{
    nodes: { projectId: string; name: string; versionId: string; versionNumber?: string | undefined; source: string }[];
    edges: { from: string; to: string; kind: string; versionConstraint?: string | undefined }[];
  } | null>(null);
  const [conflicts, setConflicts] = useState<ModConflictT[]>([]);
  const [resolving, setResolving] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ loaded: number; total: number; percentage: number; currentFile: string } | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

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
  const removeMods = useCallback(
    (keys: string[]) => {
      if (!pack) return;
      const keySet = new Set(keys);
      const updated = {
        ...pack,
        mods: pack.mods.filter((m) => !keySet.has(`${m.projectId}:${m.versionId}`)),
      };
      setSpec(updated as unknown as typeof spec);
      selection.clear();
    },
    [pack, setSpec, selection],
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

  // ===== 依赖解析：拉取版本元数据并锁定 fileId/versionNumber + 依赖图 =====
  const handleResolve = useCallback(async () => {
    if (!pack || resolving) return;
    setResolving(true);
    setResolveMsg(null);
    try {
      const res = await ipcClient.modpackResolve({
        mods: pack.mods.map((m) => ({ projectId: m.projectId, name: m.name })),
        mcVersion: pack.mcVersion,
        loader: pack.loader,
      });
      setDepGraph(res.graph);
      setConflicts(res.conflicts);
      setFromCache(res.fromCache);
      if (res.resolved.length > 0) {
        // 用锁定后的条目回写 spec（保留用户手工添加但未解析的条目）
        const resolvedById = new Map(res.resolved.map((r) => [r.projectId, r]));
        const merged = pack.mods.map((m) => resolvedById.get(m.projectId) ?? m);
        setSpec({ ...pack, mods: merged } as unknown as typeof spec);
      }
      const parts = [
        `锁定 ${res.resolved.length}/${pack.mods.length} 个 mod`,
        `冲突 ${res.conflicts.length} 项`,
      ];
      if (res.unresolved.length > 0) parts.push(`未解析 ${res.unresolved.length} 个`);
      if (res.fromCache) parts.push('（离线缓存）');
      setResolveMsg(parts.join(' · '));
    } catch (e) {
      setResolveMsg(`解析失败：${(e as Error).message}`);
    } finally {
      setResolving(false);
    }
  }, [pack, resolving, setSpec, spec]);

  // ===== 本地冲突检测（无网络） =====
  const handleCheckConflicts = useCallback(async () => {
    if (!pack) return;
    setResolveMsg(null);
    try {
      const res = await ipcClient.modpackCheckConflicts({
        mods: pack.mods,
        mcVersion: pack.mcVersion,
        loader: pack.loader,
      });
      setConflicts(res.conflicts);
      setResolveMsg(res.conflicts.length === 0 ? '未发现冲突' : `发现 ${res.conflicts.length} 项冲突`);
    } catch (e) {
      setResolveMsg(`检测失败：${(e as Error).message}`);
    }
  }, [pack]);

  // ===== 一键修复：升级 / 降级 / 移除 / 补装 =====
  const handleApplyFix = useCallback(
    (conflict: ModConflictT) => {
      if (!pack) return;
      const s = conflict.suggestion;
      if (s.action === 'remove') {
        const target = s.targetProjectId ?? conflict.projectIds[0];
        if (!target) return;
        setSpec(
          { ...pack, mods: pack.mods.filter((m) => m.projectId !== target) } as unknown as typeof spec,
        );
        setConflicts((prev) => prev.filter((c) => c !== conflict));
        return;
      }
      if (s.action === 'add-missing') {
        const target = s.targetProjectId;
        if (!target) return;
        if (pack.mods.some((m) => m.projectId === target)) return;
        const placeholder: ModEntry = {
          name: target,
          projectId: target,
          versionId: s.targetVersionId ?? 'latest',
          fileName: `${target}.jar`,
        };
        setSpec({ ...pack, mods: [...pack.mods, placeholder] } as unknown as typeof spec);
        setResolveMsg(`已补装占位 ${target}，请点击「解析依赖」锁定真实版本`);
        return;
      }
      // upgrade / downgrade / switch-loader-version：就地更新 versionId，下次解析时锁定完整元数据
      const targetPid = conflict.projectIds[0];
      if (!targetPid || !s.targetVersionId) return;
      setSpec(
        {
          ...pack,
          mods: pack.mods.map((m) =>
            m.projectId === targetPid ? { ...m, versionId: s.targetVersionId as string } : m,
          ),
        } as unknown as typeof spec,
      );
      setResolveMsg(`已将 ${targetPid} 切换到版本 ${s.targetVersionId}，建议重新解析以锁定元数据`);
      setConflicts((prev) => prev.filter((c) => c !== conflict));
    },
    [pack, setSpec, spec],
  );

  // ===== 导出 .mrpack（含进度条；大文件走流式通道） =====
  const handleExportMrpack = useCallback(async () => {
    if (!pack || exporting) return;
    setExporting(true);
    setExportProgress({ loaded: 0, total: 1, percentage: 0, currentFile: '' });
    setExportMsg(null);
    try {
      const res = await ipcClient.modpackExportMrpack(
        {
          spec: pack as unknown as Record<string, unknown>,
          ...(projectId ? { projectId } : {}),
          defaultName: `${pack.packId}-${pack.packVersion}.mrpack`,
        },
        (p) => setExportProgress(p),
      );
      if (res.ok && res.savedPath) {
        setExportProgress({ loaded: res.totalBytes, total: res.totalBytes, percentage: 100, currentFile: '' });
        setExportMsg(
          `已导出 ${res.fileCount} 个文件（${formatBytes(res.totalBytes)}${res.usedStream ? '，流式写入' : ''}）到：${res.savedPath}`,
        );
      } else if (res.canceled) {
        setExportMsg('已取消导出');
        setExportProgress(null);
      }
      if (res.warnings.length > 0) {
        setExportMsg((prev) => `${prev ?? ''}\n告警：${res.warnings.join('；')}`);
      }
    } catch (e) {
      setExportMsg(`导出失败：${(e as Error).message}`);
      setExportProgress(null);
    } finally {
      setExporting(false);
    }
  }, [pack, exporting, projectId]);

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
      downloadBlob(content, filename);
    },
    [pack],
  );

  // ===== Tab 配置（预计算 count；hooks 必须在 early return 之前）=====
  const tabs = useTabCounts(
    MODPACK_TABS,
    pack,
    (spec, key) => {
      if (key === 'mods') return spec.mods.length;
      if (key === 'deps') return depGraph?.nodes.length ?? 0;
      if (key === 'conflicts') return conflicts.length;
      if (key === 'overrides') return spec.overrides.length;
      return spec.serverOverrides.length;
    },
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((view: SubView) => {
    setActiveView(view);
    // 注意：Modpack 切换 view 时不重置 query/filter（保持现有行为）
  }, []);

  if (!spec || !pack) {
    return <EmptySpecState label="整合包" describe="整合包" />;
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
              selection.toggle(key);
            }}
            className="text-mc-mute hover:text-mc-accent"
          >
            {selection.isSelected(key) ? (
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
      <IconTabBar tabs={tabs} activeTab={activeView} onSelect={handleTabSelect} />

      {/* ===== Mod 列表视图 ===== */}
      {activeView === 'mods' && (
        <>
          {/* 搜索 + 筛选 + 排序 */}
          <FilterBar query={query} onQueryChange={setQuery} searchPlaceholder="搜索 mod…">
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
          </FilterBar>

          {/* 批量操作栏 */}
          <BatchSelectToolbar
            selectedCount={selection.size}
            onBatchRemove={() => removeMods(Array.from(selection.selected))}
            onClearSelection={selection.clear}
          />

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
              <button
                onClick={() =>
                  selection.setAll(filtered.map((m) => `${m.projectId}:${m.versionId}`))
                }
                className="text-mc-dim hover:text-mc-text"
              >
                全选
              </button>
              <span className="mx-2 text-mc-mute">·</span>
              <button onClick={selection.clear} className="text-mc-dim hover:text-mc-text">
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

      {/* ===== 依赖树视图 ===== */}
      {activeView === 'deps' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button
              onClick={handleResolve}
              disabled={resolving || pack.mods.length === 0}
              className="mc-btn-primary !py-1 !text-xs"
            >
              {resolving && <Loader2 className="h-3 w-3 animate-spin" />}
              <RefreshCw className="h-3 w-3" />
              {resolving ? '解析中…' : '解析依赖'}
            </button>
            {fromCache && (
              <span className="text-[10px] text-mc-gold">离线缓存数据</span>
            )}
            {resolveMsg && <span className="text-[10px] text-mc-mute">{resolveMsg}</span>}
          </div>
          {!depGraph ? (
            <div className="flex flex-1 items-center justify-center py-8 text-center text-xs text-mc-mute">
              <div>
                <Package className="mx-auto mb-2 h-8 w-8 opacity-50" />
                尚未解析依赖
                <div className="mt-1 text-[10px]">
                  点击「解析依赖」从 Modrinth/CurseForge 拉取版本元数据并锁定 fileId
                </div>
              </div>
            </div>
          ) : depGraph.nodes.length === 0 ? (
            <div className="py-8 text-center text-xs text-mc-mute">依赖图为空</div>
          ) : (
            depGraph.nodes.map((n) => {
              const out = depGraph.edges.filter((e) => e.from === n.projectId);
              const incoming = depGraph.edges.filter((e) => e.to === n.projectId);
              return (
                <div key={n.projectId} className="rounded-mc border border-mc-border bg-mc-surface-2 p-2">
                  <div className="flex items-center gap-2">
                    <Package className="h-3 w-3 text-mc-accent" />
                    <span className="text-xs font-medium text-mc-text">{n.name}</span>
                    <span className="font-mono text-[10px] text-mc-mute">
                      {n.versionNumber ?? n.versionId}
                    </span>
                    <span className="ml-auto rounded-mc bg-mc-surface px-1 text-[9px] text-mc-mute">
                      {n.source}
                    </span>
                  </div>
                  {out.length > 0 && (
                    <div className="mt-1 space-y-0.5 pl-5 text-[10px] text-mc-dim">
                      {out.map((e, i) => (
                        <div key={i}>
                          <span className={e.kind === 'requires' ? 'text-mc-accent' : e.kind === 'breaks' ? 'text-red-400' : 'text-mc-mute'}>
                            {e.kind === 'requires' ? '需要' : e.kind === 'optional' ? '可选' : e.kind === 'breaks' ? '冲突' : '内嵌'}
                          </span>
                          {' → '}
                          <span className="font-mono">{e.to}</span>
                          {e.versionConstraint && <span className="text-mc-mute"> @{e.versionConstraint.slice(0, 8)}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                  {incoming.length > 0 && (
                    <div className="mt-0.5 pl-5 text-[10px] text-mc-mute">
                      被 {incoming.length} 个 mod 依赖
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===== 冲突列表视图（一键修复） ===== */}
      {activeView === 'conflicts' && (
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={handleCheckConflicts} className="mc-btn-ghost !py-1 !text-xs">
              <AlertTriangle className="h-3 w-3" /> 本地检测
            </button>
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="mc-btn-ghost !py-1 !text-xs"
            >
              <RefreshCw className="h-3 w-3" /> 联网解析并检测
            </button>
            {resolveMsg && <span className="text-[10px] text-mc-mute">{resolveMsg}</span>}
          </div>
          {conflicts.length === 0 ? (
            <div className="py-8 text-center text-xs text-mc-mute">
              {pack.mods.length === 0 ? '暂无 mod' : '未发现冲突'}
            </div>
          ) : (
            conflicts.map((c, i) => (
              <div key={i} className="rounded-mc border border-red-500/30 bg-mc-surface-2 p-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-mc bg-red-500/20 px-1 py-0.5 text-[9px] text-red-400">
                    {CONFLICT_KIND_LABEL[c.kind]}
                  </span>
                  <span className="font-mono text-[10px] text-mc-mute">{c.projectIds.join(', ')}</span>
                </div>
                <p className="mt-1 text-xs text-mc-text">{c.message}</p>
                <p className="mt-0.5 text-[10px] text-mc-dim">建议：{c.suggestion.reason}</p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    onClick={() => handleApplyFix(c)}
                    className="rounded-mc border border-mc-accent bg-mc-accent/10 px-2 py-0.5 text-[10px] text-mc-accent hover:bg-mc-accent/20"
                  >
                    {c.suggestion.action === 'remove'
                      ? '移除'
                      : c.suggestion.action === 'add-missing'
                        ? `补装 ${c.suggestion.targetProjectId ?? ''}`
                        : c.suggestion.action === 'upgrade'
                          ? `升级${c.suggestedVersionNumber ? `到 ${c.suggestedVersionNumber}` : ''}`
                          : c.suggestion.action === 'downgrade'
                            ? `降级${c.suggestedVersionNumber ? `到 ${c.suggestedVersionNumber}` : ''}`
                            : `切换版本${c.suggestedVersionNumber ? `到 ${c.suggestedVersionNumber}` : ''}`}
                  </button>
                  {c.suggestion.action !== 'remove' && (
                    <button
                      onClick={() => {
                        const target = c.projectIds[0];
                        if (!target) return;
                        setSpec(
                          { ...pack, mods: pack.mods.filter((m) => m.projectId !== target) } as unknown as typeof spec,
                        );
                        setConflicts((prev) => prev.filter((x) => x !== c));
                      }}
                      className="rounded-mc border border-mc-border px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
                    >
                      直接移除
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
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
            <h3 className="mb-2 text-sm font-medium text-mc-text">导出 .mrpack（Modrinth 格式）</h3>
            <p className="mb-3 text-xs text-mc-mute">
              modrinth.index.json + overrides/ 打包为 .mrpack；大文件走 file:project:writeStream 流式通道
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleResolve}
                disabled={resolving || pack.mods.length === 0}
                className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-1.5 text-xs text-mc-text hover:border-mc-accent"
              >
                {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {resolving ? '解析中…' : '先解析依赖'}
              </button>
              <button
                onClick={handleExportMrpack}
                disabled={exporting || pack.mods.length === 0}
                className="flex items-center gap-1 rounded-mc border border-mc-accent bg-mc-accent/10 px-3 py-1.5 text-xs text-mc-accent hover:bg-mc-accent/20"
              >
                {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                {exporting ? '导出中…' : '导出 .mrpack'}
              </button>
            </div>
            {resolveMsg && <p className="mt-2 text-[10px] text-mc-mute">{resolveMsg}</p>}
            {exportProgress && (
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-mc bg-mc-surface-2">
                  <div
                    className="h-full bg-mc-accent transition-all"
                    style={{ width: `${exportProgress.percentage}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-mc-mute">
                  {exportProgress.percentage}% · {formatBytes(exportProgress.loaded)} / {formatBytes(exportProgress.total)}
                  {exportProgress.currentFile ? ` · ${exportProgress.currentFile}` : ''}
                </p>
              </div>
            )}
            {exportMsg && (
              <p className="mt-2 text-[10px] text-mc-dim whitespace-pre-wrap">{exportMsg}</p>
            )}
          </div>

          <div className="border-t border-mc-border pt-4">
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
              <StatCard variant="wide" label="Mod 总数" value={String(pack.mods.length)} />
              <StatCard variant="wide" label="总下载大小" value={formatBytes(totalSize)} />
              <StatCard variant="wide" label="Modrinth 来源" value={String(sourceStats.modrinth)} />
              <StatCard
                variant="wide"
                label="CurseForge 来源"
                value={String(sourceStats.curseforge)}
              />
              <StatCard variant="wide" label="客户端覆盖" value={String(pack.overrides.length)} />
              <StatCard
                variant="wide"
                label="服务器覆盖"
                value={String(pack.serverOverrides.length)}
              />
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
