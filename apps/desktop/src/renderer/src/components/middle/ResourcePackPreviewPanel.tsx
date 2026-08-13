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
  findDuplicates,
  downloadBlob,
  useTabCounts,
} from './shared/index.js';
import type { Column, TabItem } from './shared/index.js';
import { McIcon } from '../../assets/mc-ui/McIcon';
import type {
  ResourcePackSpec as ResourcePackSpecType,
  TextureOverrideEntry,
  SoundEntry,
  ModelEntry,
  FontEntry,
} from '@mc-creator/shared';
import { Download, FileText, Image, Music, Box, Type, Languages } from 'lucide-react';

type Tab = 'textures' | 'sounds' | 'models' | 'fonts' | 'lang' | 'metadata' | 'export';

const TABS: { key: Tab; label: string; icon: typeof Image }[] = [
  { key: 'textures', label: '材质', icon: Image },
  { key: 'sounds', label: '音效', icon: Music },
  { key: 'models', label: '模型', icon: Box },
  { key: 'fonts', label: '字体', icon: Type },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

const HIDE_COUNT_TABS = new Set<Tab>(['metadata', 'export']);

interface LangRow {
  key: string;
  en: string;
  zh: string;
}

/** ResourcePack 预览面板：7 tab — 材质画廊/音效/模型/字体/语言/元数据/导出 */
export function ResourcePackPreviewPanel() {
  const { spec, files } = useModStore((s) => ({ spec: s.spec, files: s.files }), shallow);
  const [tab, setTab] = useState<Tab>('textures');
  const [query, setQuery] = useState('');

  const pack = spec as unknown as ResourcePackSpecType | null;

  // ===== fileMap 必须在 early return 之前 =====
  const fileMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of files) m.set(f.path, f.content);
    return m;
  }, [files]);

  // ===== 统计计算 =====
  const stats = useMemo(() => {
    if (!pack) {
      return {
        textures: 0,
        sounds: 0,
        models: 0,
        fonts: 0,
        langEnUs: 0,
        langZhCn: 0,
        streamSounds: 0,
        cubeAllModels: 0,
        gradientTextures: 0,
        checkerTextures: 0,
      };
    }
    return {
      textures: pack.textureOverrides.length,
      sounds: pack.sounds.length,
      models: pack.models.length,
      fonts: pack.fonts.length,
      langEnUs: Object.keys(pack.langEnUs).length,
      langZhCn: Object.keys(pack.langZhCn).length,
      streamSounds: pack.sounds.filter((s) => s.stream).length,
      cubeAllModels: pack.models.filter((m) => m.autoCubeAll).length,
      gradientTextures: pack.textureOverrides.filter((t) => t.gradientTo).length,
      checkerTextures: pack.textureOverrides.filter((t) => t.checkerboard).length,
    };
  }, [pack]);

  // ===== ID 重复检测 =====
  const conflicts = useMemo(() => {
    if (!pack)
      return {
        duplicateSoundIds: [],
        duplicateFontIds: [],
        duplicateTexturePaths: [],
        duplicateModelPaths: [],
      };
    return {
      duplicateSoundIds: findDuplicates(pack.sounds, (s) => s.id),
      duplicateFontIds: findDuplicates(pack.fonts, (f) => f.id),
      duplicateTexturePaths: findDuplicates(pack.textureOverrides, (t) => t.path),
      duplicateModelPaths: findDuplicates(pack.models, (m) => m.path),
    };
  }, [pack]);

  const totalConflicts =
    conflicts.duplicateSoundIds.length +
    conflicts.duplicateFontIds.length +
    conflicts.duplicateTexturePaths.length +
    conflicts.duplicateModelPaths.length;

  // ===== 元数据行（供 MetadataView 使用）=====
  const metadataRows = useMemo(
    () => [
      { label: 'Pack Name', value: pack?.packName ?? '' },
      { label: '描述', value: pack?.packDescription || '—' },
      { label: 'packFormat', value: String(pack?.packFormat ?? '') },
      { label: 'Namespace', value: pack?.namespace ?? '' },
      { label: 'MC 版本', value: '1.21.x' },
    ],
    [pack],
  );

  // ===== Tab 配置（预计算 count）=====
  const tabs = useTabCounts(
    TABS,
    pack,
    (spec, tab) => countByTab(spec, tab, stats),
    HIDE_COUNT_TABS,
  );

  const handleTabSelect = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    setQuery('');
  }, []);

  // ===== 导出函数 =====
  const exportData = useCallback(
    (
      format: 'json' | 'csv' | 'markdown',
      scope: 'all' | 'textures' | 'sounds' | 'models' | 'fonts' | 'lang',
    ) => {
      if (!pack) return;
      let data: unknown;
      let filename = '';
      let content = '';

      if (scope === 'all') {
        data = pack;
      } else if (scope === 'textures') {
        data = pack.textureOverrides;
      } else if (scope === 'sounds') {
        data = pack.sounds;
      } else if (scope === 'models') {
        data = pack.models;
      } else if (scope === 'fonts') {
        data = pack.fonts;
      } else {
        data = { en_us: pack.langEnUs, zh_cn: pack.langZhCn };
      }

      if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = `${pack.namespace}-${scope}.json`;
      } else if (format === 'csv') {
        if (scope === 'textures') {
          const rows = ['Path,Color,Width,Height,Gradient,Checkerboard'];
          for (const t of pack.textureOverrides) {
            rows.push(
              `"${t.path}","${t.color}",${t.width},${t.height},${t.gradientTo ? 'Yes' : 'No'},${t.checkerboard ? 'Yes' : 'No'}`,
            );
          }
          content = rows.join('\n');
        } else if (scope === 'sounds') {
          const rows = ['ID,Event,Volume,Pitch,Stream'];
          for (const s of pack.sounds) {
            rows.push(`"${s.id}","${s.event}",${s.volume},${s.pitch},${s.stream ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'models') {
          const rows = ['Path,TextureName,AutoCubeAll'];
          for (const m of pack.models) {
            rows.push(`"${m.path}","${m.textureName}",${m.autoCubeAll ? 'Yes' : 'No'}`);
          }
          content = rows.join('\n');
        } else if (scope === 'fonts') {
          const rows = ['ID,Char,Texture,Width,Height,Advance,Ascent'];
          for (const f of pack.fonts) {
            rows.push(
              `"${f.id}","${f.char}","${f.texture}",${f.width},${f.height},${f.advance},${f.ascent}`,
            );
          }
          content = rows.join('\n');
        } else if (scope === 'lang') {
          const rows = ['Key,en_us,zh_cn'];
          const allKeys = new Set([...Object.keys(pack.langEnUs), ...Object.keys(pack.langZhCn)]);
          for (const k of allKeys) {
            rows.push(`"${k}","${pack.langEnUs[k] ?? ''}","${pack.langZhCn[k] ?? ''}"`);
          }
          content = rows.join('\n');
        } else {
          content = JSON.stringify(data, null, 2);
        }
        filename = `${pack.namespace}-${scope}.csv`;
      } else {
        // markdown
        const lines: string[] = [];
        if (scope === 'all') {
          lines.push(`# ${pack.packName}`, '');
          lines.push(`- **Namespace**: ${pack.namespace}`);
          lines.push(`- **Format**: ${pack.packFormat}`);
          lines.push(`- **描述**: ${pack.packDescription || '—'}`);
          lines.push('');
          lines.push('## 材质覆盖', '');
          for (const t of pack.textureOverrides) {
            lines.push(`- \`${t.path}\` — ${t.width}×${t.height} (${t.color})`);
          }
          lines.push('');
          lines.push('## 音效', '');
          for (const s of pack.sounds) {
            lines.push(
              `- \`${s.id}\` — 音量 ${s.volume} · 音调 ${s.pitch}${s.stream ? ' · 流式' : ''}`,
            );
          }
          lines.push('');
          lines.push('## 模型', '');
          for (const m of pack.models) {
            lines.push(`- \`${m.path}\` — ${m.autoCubeAll ? '自动 cube_all' : '自定义 JSON'}`);
          }
          lines.push('');
          lines.push('## 字体', '');
          for (const f of pack.fonts) {
            lines.push(`- \`${f.id}\` — 字符 "${f.char}" → ${f.texture}`);
          }
          lines.push('');
          lines.push('## 语言 (en_us)', '');
          for (const [k, v] of Object.entries(pack.langEnUs)) {
            lines.push(`- \`${k}\` = ${v}`);
          }
        } else if (scope === 'textures') {
          lines.push(`# ${pack.packName} - 材质覆盖`, '');
          lines.push(`共 ${pack.textureOverrides.length} 个材质`, '');
          lines.push('| 路径 | 颜色 | 尺寸 |', '|---|---|---|');
          for (const t of pack.textureOverrides) {
            lines.push(`| \`${t.path}\` | ${t.color} | ${t.width}×${t.height} |`);
          }
        } else if (scope === 'sounds') {
          lines.push(`# ${pack.packName} - 音效`, '');
          lines.push(`共 ${pack.sounds.length} 个音效`, '');
          lines.push('| ID | 事件 | 音量 | 音调 |', '|---|---|---|---|');
          for (const s of pack.sounds) {
            lines.push(`| \`${s.id}\` | ${s.event || '—'} | ${s.volume} | ${s.pitch} |`);
          }
        } else if (scope === 'models') {
          lines.push(`# ${pack.packName} - 模型`, '');
          lines.push(`共 ${pack.models.length} 个模型`, '');
          lines.push('| 路径 | 贴图名 | 类型 |', '|---|---|---|');
          for (const m of pack.models) {
            lines.push(
              `| \`${m.path}\` | ${m.textureName || '—'} | ${m.autoCubeAll ? 'cube_all' : '自定义'} |`,
            );
          }
        } else if (scope === 'fonts') {
          lines.push(`# ${pack.packName} - 字体`, '');
          lines.push(`共 ${pack.fonts.length} 个字体条目`, '');
          lines.push('| ID | 字符 | 贴图 | 尺寸 |', '|---|---|---|---|');
          for (const f of pack.fonts) {
            lines.push(
              `| \`${f.id}\` | "${f.char}" | ${f.texture || '—'} | ${f.width}×${f.height} |`,
            );
          }
        } else if (scope === 'lang') {
          lines.push(`# ${pack.packName} - 语言条目`, '');
          lines.push(`en_us: ${stats.langEnUs} 条 · zh_cn: ${stats.langZhCn} 条`, '');
          lines.push('| 键 | en_us | zh_cn |', '|---|---|---|');
          const allKeys = new Set([...Object.keys(pack.langEnUs), ...Object.keys(pack.langZhCn)]);
          for (const k of allKeys) {
            lines.push(`| \`${k}\` | ${pack.langEnUs[k] ?? '—'} | ${pack.langZhCn[k] ?? '—'} |`);
          }
        }
        content = lines.join('\n');
        filename = `${pack.namespace}-${scope}.md`;
      }

      downloadBlob(content, filename);
    },
    [pack, stats.langEnUs, stats.langZhCn],
  );

  if (!spec || !pack) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成资源包 Spec"
        hint="在右侧 AgentPanel 描述你想要的资源包，生成 Spec 后即可预览"
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      <PanelHeader
        icon="box"
        title={pack.packName}
        meta={[
          { label: 'Format', value: String(pack.packFormat) },
          { label: 'Namespace', value: pack.namespace },
          { label: 'MC', value: '1.21.x' },
        ]}
        subtitle={pack.packDescription}
      />

      {/* 统计卡片行 */}
      <StatCardGrid>
        <StatCard
          label="材质"
          value={stats.textures}
          sub={`${stats.gradientTextures} 渐变 · ${stats.checkerTextures} 棋盘`}
          icon={<Image className="h-3 w-3" />}
        />
        <StatCard
          label="音效"
          value={stats.sounds}
          sub={`${stats.streamSounds} 流式`}
          icon={<Music className="h-3 w-3" />}
        />
        <StatCard
          label="模型"
          value={stats.models}
          sub={`${stats.cubeAllModels} cube_all`}
          icon={<Box className="h-3 w-3" />}
        />
        <StatCard label="字体" value={stats.fonts} icon={<Type className="h-3 w-3" />} />
        <StatCard label="en_us" value={stats.langEnUs} icon={<Languages className="h-3 w-3" />} />
        <StatCard label="zh_cn" value={stats.langZhCn} icon={<Languages className="h-3 w-3" />} />
        <StatCard
          label="总条目"
          value={
            stats.textures +
            stats.sounds +
            stats.models +
            stats.fonts +
            stats.langEnUs +
            stats.langZhCn
          }
          icon={<FileText className="h-3 w-3" />}
        />
      </StatCardGrid>

      {/* 冲突检测告警 */}
      <ConflictAlert
        totalConflicts={totalConflicts}
        conflicts={[
          { label: '材质路径重复', count: conflicts.duplicateTexturePaths.length },
          { label: '音效 ID 重复', count: conflicts.duplicateSoundIds.length },
          { label: '模型路径重复', count: conflicts.duplicateModelPaths.length },
          { label: '字体 ID 重复', count: conflicts.duplicateFontIds.length },
        ]}
      />

      {/* Tab 切换 */}
      <IconTabBar tabs={tabs} activeTab={tab} onSelect={handleTabSelect} />

      {/* 搜索栏（除元数据/导出外） */}
      {tab !== 'metadata' && tab !== 'export' && (
        <FilterBar
          query={query}
          onQueryChange={setQuery}
          searchPlaceholder={`搜索${tabLabel(tab)}…`}
        />
      )}

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'textures' && <TexturesTab pack={pack} fileMap={fileMap} query={query} />}
        {tab === 'sounds' && <SoundsTab pack={pack} fileMap={fileMap} query={query} />}
        {tab === 'models' && <ModelsTab pack={pack} query={query} />}
        {tab === 'fonts' && <FontsTab pack={pack} query={query} />}
        {tab === 'lang' && <LangTab pack={pack} query={query} />}
        {tab === 'metadata' && <MetadataView rows={metadataRows} />}
        {tab === 'export' && (
          <ExportView
            title="导出资源包数据"
            description="将当前资源包的 Spec 数据导出为不同格式，方便分享、文档归档或迁移"
            sections={[
              { scope: 'all', label: '完整 Spec' },
              { scope: 'textures', label: '材质覆盖', count: pack.textureOverrides.length },
              { scope: 'sounds', label: '音效', count: pack.sounds.length },
              { scope: 'models', label: '模型', count: pack.models.length },
              { scope: 'fonts', label: '字体', count: pack.fonts.length },
              {
                scope: 'lang',
                label: '语言',
                count: stats.langEnUs + stats.langZhCn,
              },
            ]}
            onExport={exportData}
            statsTitle="资源包统计"
            stats={
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                <StatCard label="材质总数" value={stats.textures} />
                <StatCard
                  label="音效总数"
                  value={stats.sounds}
                  sub={`${stats.streamSounds} 流式`}
                />
                <StatCard
                  label="模型总数"
                  value={stats.models}
                  sub={`${stats.cubeAllModels} cube_all`}
                />
                <StatCard label="字体总数" value={stats.fonts} />
                <StatCard label="en_us 条目" value={stats.langEnUs} />
                <StatCard label="zh_cn 条目" value={stats.langZhCn} />
                <StatCard label="渐变材质" value={stats.gradientTextures} />
                <StatCard label="棋盘材质" value={stats.checkerTextures} />
              </div>
            }
          />
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        材质: {pack.textureOverrides.length} · 音效: {pack.sounds.length} · 模型:{' '}
        {pack.models.length} · 字体: {pack.fonts.length} · en_us: {stats.langEnUs} · zh_cn:{' '}
        {stats.langZhCn}
      </div>
    </div>
  );
}

function countByTab(
  pack: ResourcePackSpecType,
  tab: Tab,
  stats: { langEnUs: number; langZhCn: number },
): number {
  if (tab === 'textures') return pack.textureOverrides.length;
  if (tab === 'sounds') return pack.sounds.length;
  if (tab === 'models') return pack.models.length;
  if (tab === 'fonts') return pack.fonts.length;
  if (tab === 'lang') return stats.langEnUs + stats.langZhCn;
  return 0;
}

function tabLabel(tab: Tab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}

// ===== Textures tab =====

function TexturesTab({
  pack,
  fileMap,
  query,
}: {
  pack: ResourcePackSpecType;
  fileMap: Map<string, string>;
  query: string;
}) {
  const filtered = useMemo(() => {
    if (!query) return pack.textureOverrides;
    const q = query.toLowerCase();
    return pack.textureOverrides.filter((t) => t.path.toLowerCase().includes(q));
  }, [pack.textureOverrides, query]);

  const dataUrl = (entry: TextureOverrideEntry): string | null => {
    const content = fileMap.get(`assets/minecraft/textures/${entry.path}.png`);
    if (!content) return null;
    return `data:image/png;base64,${content}`;
  };

  if (filtered.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无材质覆盖</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4">
      {filtered.map((entry, idx) => {
        const url = dataUrl(entry);
        return (
          <div
            key={`${entry.path}-${idx}`}
            className="rounded-mc border border-mc-border bg-mc-surface-2/40 p-2"
          >
            <div className="mb-1 flex aspect-square items-center justify-center overflow-hidden rounded-mc bg-mc-bg">
              {url ? (
                <img
                  src={url}
                  alt={entry.path}
                  className="h-full w-full object-contain"
                  style={{ imageRendering: 'pixelated' }}
                />
              ) : (
                <div
                  className="flex h-full w-full items-center justify-center"
                  style={{ backgroundColor: entry.color }}
                >
                  <span className="text-xs text-mc-mute">生成中</span>
                </div>
              )}
            </div>
            <div className="truncate text-xs text-mc-dim" title={entry.path}>
              {entry.path}
            </div>
            <div className="text-xs text-mc-mute">
              {entry.width}×{entry.height}
              {entry.gradientTo ? ' · 渐变' : ''}
              {entry.checkerboard ? ' · 棋盘' : ''}
            </div>
            <div className="mt-0.5 flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-mc border border-mc-border"
                style={{ backgroundColor: entry.color }}
                title={entry.color}
              />
              <span className="text-[9px] text-mc-mute">{entry.color}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ===== Sounds tab =====

function SoundsTab({
  pack,
  fileMap,
  query,
}: {
  pack: ResourcePackSpecType;
  fileMap: Map<string, string>;
  query: string;
}) {
  const filtered = useMemo(() => {
    if (!query) return pack.sounds;
    const q = query.toLowerCase();
    return pack.sounds.filter(
      (s) => s.id.toLowerCase().includes(q) || s.event.toLowerCase().includes(q),
    );
  }, [pack.sounds, query]);

  if (filtered.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无音效</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {filtered.map((entry, idx) => (
        <SoundRow key={`${entry.id}-${idx}`} entry={entry} pack={pack} fileMap={fileMap} />
      ))}
    </div>
  );
}

function SoundRow({
  entry,
  pack,
  fileMap,
}: {
  entry: SoundEntry;
  pack: ResourcePackSpecType;
  fileMap: Map<string, string>;
}) {
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  const [duration, setDuration] = useState<string>('—');
  const [playing, setPlaying] = useState(false);

  const audioUrl = useMemo(() => {
    const content = fileMap.get(`assets/${pack.namespace}/sounds/${entry.id}.ogg`);
    if (!content) return null;
    return `data:audio/ogg;base64,${content}`;
  }, [fileMap, pack.namespace, entry.id]);

  const togglePlay = () => {
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const onLoadedMetadata = () => {
    if (audio && !Number.isNaN(audio.duration)) {
      setDuration(`${audio.duration.toFixed(1)}s`);
    }
  };

  const onEnded = () => setPlaying(false);

  return (
    <div className="flex items-center gap-3 rounded-mc border border-mc-border bg-mc-surface-2/40 px-3 py-2">
      <button
        onClick={togglePlay}
        disabled={!audioUrl}
        className="flex h-7 w-7 items-center justify-center rounded-mc border border-mc-border bg-mc-surface-2 text-mc-accent transition-colors hover:bg-mc-surface-3 disabled:cursor-not-allowed disabled:opacity-40"
        title={audioUrl ? (playing ? '暂停' : '播放') : '无音频数据'}
      >
        <McIcon scope="pixel" name={playing ? 'star' : 'box'} size={12} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="truncate text-xs font-medium text-mc-text" title={entry.id}>
          {entry.id}
        </div>
        <div className="truncate text-xs text-mc-mute" title={entry.event}>
          {entry.event || '(无事件名)'} · 音量 {entry.volume} · 音调 {entry.pitch}
          {entry.stream ? ' · 流式' : ''}
        </div>
      </div>
      <div className="text-xs text-mc-dim">{duration}</div>
      {audioUrl && (
        <audio
          ref={setAudio}
          src={audioUrl}
          onLoadedMetadata={onLoadedMetadata}
          onEnded={onEnded}
          preload="metadata"
        />
      )}
    </div>
  );
}

// ===== Models tab =====

function ModelsTab({ pack, query }: { pack: ResourcePackSpecType; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return pack.models;
    const q = query.toLowerCase();
    return pack.models.filter(
      (m) => m.path.toLowerCase().includes(q) || m.textureName.toLowerCase().includes(q),
    );
  }, [pack.models, query]);

  const columns: Column<ModelEntry>[] = [
    { key: 'path', header: '路径', width: '40%', sortValue: (r) => r.path },
    { key: 'textureName', header: '贴图名', width: '20%', sortValue: (r) => r.textureName },
    {
      key: 'autoCubeAll',
      header: '自动 cube_all',
      width: '15%',
      sortValue: (r) => (r.autoCubeAll ? 1 : 0),
      render: (r) =>
        r.autoCubeAll ? (
          <span className="rounded-mc bg-green-500/20 px-1.5 py-0.5 text-[10px] text-green-400">
            是
          </span>
        ) : (
          <span className="text-[10px] text-mc-mute">否</span>
        ),
    },
    {
      key: 'jsonPreview',
      header: 'JSON 摘要',
      width: '25%',
      render: (r) => (r.json ? `${r.json.slice(0, 40)}${r.json.length > 40 ? '…' : ''}` : '—'),
    },
  ];

  return (
    <div className="p-2">
      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(r) => r.path}
        emptyHint="暂无模型覆盖"
      />
    </div>
  );
}

// ===== Fonts tab（新增）=====

function FontsTab({ pack, query }: { pack: ResourcePackSpecType; query: string }) {
  const filtered = useMemo(() => {
    if (!query) return pack.fonts;
    const q = query.toLowerCase();
    return pack.fonts.filter(
      (f) => f.id.toLowerCase().includes(q) || f.char.toLowerCase().includes(q),
    );
  }, [pack.fonts, query]);

  const columns: Column<FontEntry>[] = [
    {
      key: 'char',
      header: '字符',
      width: '10%',
      sortValue: (r) => r.char,
      render: (r) => (
        <span className="rounded-mc bg-mc-surface-3 px-2 py-0.5 font-mono text-sm text-mc-text">
          {r.char}
        </span>
      ),
    },
    { key: 'id', header: 'ID', width: '20%', sortValue: (r) => r.id },
    { key: 'texture', header: '贴图路径', width: '30%', sortValue: (r) => r.texture },
    {
      key: 'size',
      header: '尺寸',
      width: '12%',
      sortValue: (r) => r.width * r.height,
      render: (r) => `${r.width}×${r.height}`,
    },
    {
      key: 'position',
      header: '位置 (x,y)',
      width: '12%',
      sortValue: (r) => r.x + r.y,
      render: (r) => `(${r.x},${r.y})`,
    },
    {
      key: 'advance',
      header: 'advance/ascent',
      width: '16%',
      sortValue: (r) => r.advance,
      render: (r) => `${r.advance}/${r.ascent}`,
    },
  ];

  return (
    <DataTable columns={columns} data={filtered} rowKey={(r) => r.id} emptyHint="暂无字体条目" />
  );
}

// ===== Lang tab =====

function LangTab({ pack, query }: { pack: ResourcePackSpecType; query: string }) {
  const rows = useMemo<LangRow[]>(() => {
    const keys = new Set([...Object.keys(pack.langEnUs), ...Object.keys(pack.langZhCn)]);
    let result = Array.from(keys).map((key) => ({
      key,
      en: pack.langEnUs[key] ?? '',
      zh: pack.langZhCn[key] ?? '',
    }));
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.en.toLowerCase().includes(q) ||
          r.zh.toLowerCase().includes(q),
      );
    }
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }, [pack.langEnUs, pack.langZhCn, query]);

  const columns: Column<LangRow>[] = [
    { key: 'key', header: '键', width: '35%', sortValue: (r) => r.key },
    { key: 'en', header: 'en_us', width: '32%', sortValue: (r) => r.en },
    { key: 'zh', header: 'zh_cn', width: '33%', sortValue: (r) => r.zh },
  ];

  return (
    <div className="flex flex-col gap-2 p-2">
      <DataTable columns={columns} data={rows} rowKey={(r) => r.key} emptyHint="暂无语言条目" />
    </div>
  );
}
