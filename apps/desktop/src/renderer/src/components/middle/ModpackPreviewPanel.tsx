import { useState, useMemo } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import type { ModpackSpec, ModEntry } from '@mc-creator/shared';

type FormatFilter = 'all' | 'modrinth' | 'curseforge';

/** Modpack 预览面板：mod 列表 + 搜索 + 来源筛选 */
export function ModpackPreviewPanel() {
  const spec = useModStore((s) => s.spec, shallow);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');

  if (!spec) {
    return <EmptyState icon="box" title="尚未生成整合包 Spec" hint="在右侧 AgentPanel 描述你想要的整合包，生成 Spec 后即可预览" />;
  }

  const pack = spec as unknown as ModpackSpec;

  const filtered = useMemo(() => {
    let result = pack.mods;
    if (formatFilter !== 'all') {
      // 简单启发式：projectId 是数字则视为 CurseForge，否则 Modrinth（不精确但够用）
      result = result.filter((m) => {
        const isNumeric = /^\d+$/.test(m.projectId);
        return formatFilter === 'curseforge' ? isNumeric : !isNumeric;
      });
    }
    if (query) {
      const q = query.toLowerCase();
      result = result.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.fileName.toLowerCase().includes(q) ||
        m.projectId.toLowerCase().includes(q)
      );
    }
    return result;
  }, [pack.mods, query, formatFilter]);

  const columns: Column<ModEntry>[] = [
    { key: 'name', header: 'Mod 名称', width: '25%', sortValue: (r) => r.name },
    { key: 'fileName', header: '文件名', width: '30%', sortValue: (r) => r.fileName },
    { key: 'versionId', header: '版本', width: '20%', sortValue: (r) => r.versionId },
    { key: 'fileSize', header: '大小', width: '15%', sortValue: (r) => r.fileSize ?? 0, render: (r) => r.fileSize ? formatBytes(r.fileSize) : '—' },
    { key: 'source', header: '来源', width: '10%', render: (r) => /^\d+$/.test(r.projectId) ? 'CurseForge' : 'Modrinth' },
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
        ]}
        subtitle={pack.description || `作者: ${pack.author || '—'}`}
      />

      {/* 搜索 + 筛选 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <div className="flex-1">
          <SearchInput value={query} onChange={setQuery} placeholder="搜索 mod…" />
        </div>
        <select
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value as FormatFilter)}
          className="mc-select !py-1 !text-xs"
        >
          <option value="all">全部来源</option>
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </select>
      </div>

      {/* 表格 */}
      <div className="flex-1 overflow-y-auto">
        <DataTable columns={columns} data={filtered} rowKey={(r) => `${r.projectId}:${r.versionId}`} emptyHint="暂无 mod" />
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        mod 数: {pack.mods.length} · 显示: {filtered.length} · 覆盖文件: {pack.overrides.length} · 服务器覆盖: {pack.serverOverrides.length}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
