import { useState, useMemo, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { useModStore } from '../../store/mod-store.js';
import { DataTable, PanelHeader, SearchInput, EmptyState } from './shared/index.js';
import type { Column } from './shared/index.js';
import { McIcon } from '../../assets/mc-ui/McIcon';
import type {
  ResourcePackSpec as ResourcePackSpecType,
  TextureOverrideEntry,
  SoundEntry,
  ModelEntry,
} from '@mc-creator/shared';

type Tab = 'textures' | 'sounds' | 'models' | 'lang';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'textures', label: '材质', icon: 'box' },
  { id: 'sounds', label: '音效', icon: 'star' },
  { id: 'models', label: '模型', icon: 'box' },
  { id: 'lang', label: '语言', icon: 'star' },
];

/** ResourcePack 预览面板：4 tab — 材质画廊/音效列表/模型表格/语言 key-value 表格 */
export function ResourcePackPreviewPanel() {
  const { spec, files } = useModStore((s) => ({ spec: s.spec, files: s.files }), shallow);
  const [tab, setTab] = useState<Tab>('textures');

  const fileMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of files) m.set(f.path, f.content);
    return m;
  }, [files]);

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成资源包 Spec"
        hint="在右侧 AgentPanel 描述你想要的资源包，生成 Spec 后即可预览"
      />
    );
  }

  const pack = spec as unknown as ResourcePackSpecType;

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

      {/* Tab 切换栏 */}
      <div
        role="tablist"
        aria-label="资源包分类"
        className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
              tab === t.id
                ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
                : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            <McIcon scope="pixel" name={t.icon} size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'textures' && <TexturesTab pack={pack} fileMap={fileMap} />}
        {tab === 'sounds' && <SoundsTab pack={pack} fileMap={fileMap} />}
        {tab === 'models' && <ModelsTab pack={pack} />}
        {tab === 'lang' && <LangTab pack={pack} />}
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        材质: {pack.textureOverrides.length} · 音效: {pack.sounds.length} · 模型:{' '}
        {pack.models.length} · 字体: {pack.fonts.length}
      </div>
    </div>
  );
}

// ===== Textures tab =====

function TexturesTab({
  pack,
  fileMap,
}: {
  pack: ResourcePackSpecType;
  fileMap: Map<string, string>;
}) {
  const dataUrl = (entry: TextureOverrideEntry): string | null => {
    const content = fileMap.get(`assets/minecraft/textures/${entry.path}.png`);
    if (!content) return null;
    return `data:image/png;base64,${content}`;
  };

  if (pack.textureOverrides.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无材质覆盖</div>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 md:grid-cols-4">
      {pack.textureOverrides.map((entry, idx) => {
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
}: {
  pack: ResourcePackSpecType;
  fileMap: Map<string, string>;
}) {
  if (pack.sounds.length === 0) {
    return <div className="px-3 py-6 text-center text-xs text-mc-mute">暂无音效</div>;
  }

  return (
    <div className="flex flex-col gap-1 p-3">
      {pack.sounds.map((entry, idx) => (
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

  // audioUrl 变化时重置 UI 状态
  useEffect(() => {
    setPlaying(false);
    setDuration('—');
  }, [audioUrl]);

  // 组件卸载时停止播放
  useEffect(() => {
    return () => {
      audio?.pause();
    };
  }, [audio]);

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

function ModelsTab({ pack }: { pack: ResourcePackSpecType }) {
  const columns: Column<ModelEntry>[] = [
    { key: 'path', header: '路径', width: '40%', sortValue: (r) => r.path },
    { key: 'textureName', header: '贴图名', width: '20%', sortValue: (r) => r.textureName },
    {
      key: 'autoCubeAll',
      header: '自动 cube_all',
      width: '15%',
      render: (r) => (r.autoCubeAll ? '是' : '否'),
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
        data={pack.models}
        rowKey={(r) => r.path}
        emptyHint="暂无模型覆盖"
      />
    </div>
  );
}

// ===== Lang tab =====

interface LangRow {
  key: string;
  en: string;
  zh: string;
}

function LangTab({ pack }: { pack: ResourcePackSpecType }) {
  const [query, setQuery] = useState('');

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
      <SearchInput value={query} onChange={setQuery} placeholder="搜索语言键或翻译…" />
      <DataTable columns={columns} data={rows} rowKey={(r) => r.key} emptyHint="暂无语言条目" />
    </div>
  );
}
