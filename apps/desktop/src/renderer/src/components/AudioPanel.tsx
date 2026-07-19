import { useState, useCallback, useMemo } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import {
  Upload,
  Play,
  Pause,
  Trash2,
  Plus,
  Volume2,
  Subtitles,
  Clock,
  Tag,
  ChevronDown,
  ChevronRight,
  Edit3,
} from 'lucide-react';

/** MC 音效事件分类 */
const MC_SOUND_CATEGORIES = [
  { key: 'master', label: '主控 (master)', color: 'text-yellow-400' },
  { key: 'music', label: '音乐 (music)', color: 'text-purple-400' },
  { key: 'record', label: '唱片 (record)', color: 'text-green-400' },
  { key: 'weather', label: '天气 (weather)', color: 'text-blue-400' },
  { key: 'block', label: '方块 (block)', color: 'text-orange-400' },
  { key: 'hostile', label: '敌对 (hostile)', color: 'text-red-400' },
  { key: 'neutral', label: '中立 (neutral)', color: 'text-cyan-400' },
  { key: 'player', label: '玩家 (player)', color: 'text-emerald-400' },
  { key: 'ambient', label: '环境 (ambient)', color: 'text-slate-400' },
  { key: 'voice', label: '语音 (voice)', color: 'text-pink-400' },
] as const;

type McSoundCategory = (typeof MC_SOUND_CATEGORIES)[number]['key'];

/** 从事件 ID 推断分类 */
function inferCategory(id: string): McSoundCategory {
  const prefix = id.split('.')[0];
  const categoryMap: Record<string, McSoundCategory> = {
    block: 'block',
    entity: 'hostile',
    ambient: 'ambient',
    music: 'music',
    weather: 'weather',
    record: 'record',
    voice: 'voice',
    player: 'player',
  };
  return categoryMap[prefix] ?? 'master';
}

/** 音效事件条目 */
interface SoundEvent {
  id: string;
  /** 音效文件路径列表（相对于 assets/<namespace>/sounds/） */
  sounds: string[];
  /** 是否替换原版 */
  replace: boolean;
  /** 音量 0-2 */
  volume: number;
  /** 音调 0-2 */
  pitch: number;
  /** 是否流式播放（BGM 用） */
  stream: boolean;
  /** 分类 */
  category: McSoundCategory;
  /** 字幕映射（无障碍访问用） */
  subtitle: string;
  /** .ogg 文件时长（秒） */
  duration: number | null;
}

/**
 * 音效/音频管理面板：管理 sounds.json 事件 + 导入/播放 .ogg 文件。
 */
export function AudioPanel() {
  const [namespace, setNamespace] = useState('minecraft');
  const [events, setEvents] = useState<SoundEvent[]>([
    {
      id: 'block.stone.break',
      sounds: [
        'block/stone/break1',
        'block/stone/break2',
        'block/stone/break3',
        'block/stone/break4',
      ],
      replace: false,
      volume: 1,
      pitch: 1,
      stream: false,
      category: 'block',
      subtitle: '',
      duration: null,
    },
    {
      id: 'block.stone.place',
      sounds: [
        'block/stone/place1',
        'block/stone/place2',
        'block/stone/place3',
        'block/stone/place4',
      ],
      replace: false,
      volume: 1,
      pitch: 1,
      stream: false,
      category: 'block',
      subtitle: '',
      duration: null,
    },
  ]);
  const [importing, setImporting] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [filterCategory, setFilterCategory] = useState<McSoundCategory | 'all'>('all');
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);

  const handleImport = useCallback(async () => {
    setImporting(true);
    try {
      const res = await ipcClient.importResourceFiles({
        title: '导入音效文件',
        extensions: ['ogg'],
        multiSelect: true,
      });
      if (!res.ok || res.files.length === 0) return;
      // 为每个导入的文件创建音效事件
      const newEvents: SoundEvent[] = res.files.map((f) => {
        const id = `${namespace}:${f.fileName.replace('.ogg', '')}`;
        return {
          id,
          sounds: [f.fileName.replace('.ogg', '')],
          replace: false,
          volume: 1,
          pitch: 1,
          stream: false,
          category: inferCategory(id),
          subtitle: '',
          duration: null,
        };
      });
      setEvents((prev) => [...prev, ...newEvents]);
    } catch {
      // 导入失败不阻塞
    } finally {
      setImporting(false);
    }
  }, [namespace]);

  const addEvent = useCallback(() => {
    const id = prompt('输入音效事件 ID', `${namespace}:custom.sound`);
    if (!id) return;
    setEvents((prev) => [
      ...prev,
      {
        id,
        sounds: [],
        replace: false,
        volume: 1,
        pitch: 1,
        stream: false,
        category: inferCategory(id),
        subtitle: '',
        duration: null,
      },
    ]);
  }, [namespace]);

  const deleteEvent = useCallback((index: number) => {
    setEvents((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateEvent = useCallback((index: number, patch: Partial<SoundEvent>) => {
    setEvents((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }, []);

  // 分类过滤后的事件
  const filteredEvents = useMemo(() => {
    if (filterCategory === 'all') return events.map((ev, i) => ({ ev, i }));
    return events.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.category === filterCategory);
  }, [events, filterCategory]);

  // 按 MC 音效分类统计
  const categoryStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const cat of MC_SOUND_CATEGORIES) stats[cat.key] = 0;
    for (const ev of events) stats[ev.category] = (stats[ev.category] ?? 0) + 1;
    return stats;
  }, [events]);

  // 生成 sounds.json
  const soundsJson = (() => {
    const obj: Record<string, unknown> = {};
    for (const ev of events) {
      const entry: Record<string, unknown> = {
        sounds: ev.sounds,
        replace: ev.replace,
      };
      if (ev.volume !== 1) entry.volume = ev.volume;
      if (ev.pitch !== 1) entry.pitch = ev.pitch;
      if (ev.stream) entry.stream = true;
      if (ev.subtitle) entry.subtitle = ev.subtitle;
      obj[ev.id] = entry;
    }
    return JSON.stringify(obj, null, 2);
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mc-surface">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="star" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">音效管理</span>
        <input
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          className="ml-2 w-24 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
          placeholder="namespace"
        />
        <span className="ml-auto text-[10px] text-mc-mute">{events.length} 个事件</span>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1">
        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text disabled:opacity-50"
        >
          <Upload className="h-3 w-3" />
          {importing ? '导入中…' : '导入 .ogg'}
        </button>
        <button
          onClick={addEvent}
          className="flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] text-mc-dim transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
        >
          <Plus className="h-3 w-3" />
          新增事件
        </button>
        {/* 分类筛选 */}
        <button
          onClick={() => setShowCategoryFilter(!showCategoryFilter)}
          className={`flex items-center gap-1 rounded-mc px-2 py-0.5 text-[11px] transition-colors hover:bg-mc-surface-2 hover:text-mc-text ${filterCategory !== 'all' ? 'text-mc-accent' : 'text-mc-dim'}`}
        >
          <Tag className="h-3 w-3" />
          {filterCategory === 'all'
            ? '全部分类'
            : (MC_SOUND_CATEGORIES.find((c) => c.key === filterCategory)?.label ?? filterCategory)}
          {showCategoryFilter ? (
            <ChevronDown className="h-2.5 w-2.5" />
          ) : (
            <ChevronRight className="h-2.5 w-2.5" />
          )}
        </button>
      </div>

      {/* 分类筛选下拉 */}
      {showCategoryFilter && (
        <div className="border-b border-mc-border bg-mc-surface-2/50 px-3 py-1.5">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                setFilterCategory('all');
                setShowCategoryFilter(false);
              }}
              className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${filterCategory === 'all' ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text'}`}
            >
              全部 ({events.length})
            </button>
            {MC_SOUND_CATEGORIES.map((cat) => (
              <button
                key={cat.key}
                onClick={() => {
                  setFilterCategory(cat.key);
                  setShowCategoryFilter(false);
                }}
                className={`rounded-mc px-2 py-0.5 text-[10px] transition-colors ${filterCategory === cat.key ? 'bg-mc-accent/20 text-mc-accent-bright' : 'text-mc-mute hover:bg-mc-surface-2 hover:text-mc-text'}`}
              >
                <span className={cat.color}>{cat.label}</span> ({categoryStats[cat.key] ?? 0})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 音效事件列表 */}
      <div className="flex-1 overflow-y-auto p-2">
        {events.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Volume2 className="h-8 w-8 text-mc-mute" />
            <div className="text-xs text-mc-mute">暂无音效事件</div>
          </div>
        ) : filteredEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-8">
            <Tag className="h-6 w-6 text-mc-mute" />
            <div className="text-xs text-mc-mute">当前分类下无事件</div>
          </div>
        ) : (
          filteredEvents.map(({ ev, i }) => {
            const catInfo = MC_SOUND_CATEGORIES.find((c) => c.key === ev.category);
            const isEditing = editingIndex === i;
            return (
              <div
                key={`${ev.id}-${i}`}
                className="group mb-2 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2"
              >
                {/* 事件头行 */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPlayingId(playingId === ev.id ? null : ev.id)}
                    className="flex h-5 w-5 items-center justify-center rounded-mc border border-mc-border bg-mc-surface-2 text-mc-accent hover:bg-mc-surface-3"
                  >
                    {playingId === ev.id ? (
                      <Pause className="h-2.5 w-2.5" />
                    ) : (
                      <Play className="h-2.5 w-2.5" />
                    )}
                  </button>
                  <span className="flex-1 font-mono text-[11px] text-mc-text">{ev.id}</span>
                  {/* 分类标签 */}
                  <span className={`text-[9px] ${catInfo?.color ?? 'text-mc-mute'}`}>
                    {catInfo?.key ?? ev.category}
                  </span>
                  <span className="text-[9px] text-mc-mute">{ev.sounds.length} 文件</span>
                  {/* 时长显示 */}
                  {ev.duration != null && (
                    <span
                      className="flex items-center gap-0.5 text-[9px] text-mc-mute"
                      title="时长"
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {ev.duration.toFixed(1)}s
                    </span>
                  )}
                  <label className="flex items-center gap-0.5 text-[9px] text-mc-mute">
                    <input
                      type="checkbox"
                      checked={ev.replace}
                      onChange={() => updateEvent(i, { replace: !ev.replace })}
                      className="h-2.5 w-2.5 accent-mc-accent"
                    />
                    替换
                  </label>
                  <label className="flex items-center gap-0.5 text-[9px] text-mc-mute">
                    <input
                      type="checkbox"
                      checked={ev.stream}
                      onChange={() => updateEvent(i, { stream: !ev.stream })}
                      className="h-2.5 w-2.5 accent-mc-accent"
                    />
                    流式
                  </label>
                  {/* 结构化编辑按钮 */}
                  <button
                    onClick={() => setEditingIndex(isEditing ? null : i)}
                    className={`text-mc-mute opacity-0 transition-opacity hover:text-mc-accent group-hover:opacity-100 ${isEditing ? '!opacity-100 text-mc-accent' : ''}`}
                    title="结构化编辑"
                  >
                    <Edit3 className="h-2.5 w-2.5" />
                  </button>
                  <button
                    onClick={() => deleteEvent(i)}
                    className="text-mc-mute opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                  </button>
                </div>

                {/* 音量/音调滑条 */}
                <div className="mt-1 flex items-center gap-2">
                  <label className="text-[9px] text-mc-mute">音量</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={ev.volume}
                    onChange={(e) => updateEvent(i, { volume: parseFloat(e.target.value) })}
                    className="h-1 w-16 accent-mc-accent"
                  />
                  <span className="w-5 text-[9px] text-mc-dim">{ev.volume.toFixed(1)}</span>
                  <label className="text-[9px] text-mc-mute">音调</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={ev.pitch}
                    onChange={(e) => updateEvent(i, { pitch: parseFloat(e.target.value) })}
                    className="h-1 w-16 accent-mc-accent"
                  />
                  <span className="w-5 text-[9px] text-mc-dim">{ev.pitch.toFixed(1)}</span>
                </div>

                {/* 字幕指示器（简要） */}
                {ev.subtitle && !isEditing && (
                  <div className="mt-1 flex items-center gap-1 text-[9px] text-mc-dim">
                    <Subtitles className="h-2.5 w-2.5" />
                    <span className="truncate">{ev.subtitle}</span>
                  </div>
                )}

                {/* 结构化编辑面板 */}
                {isEditing && (
                  <div className="mt-2 space-y-2 rounded-mc border border-mc-border bg-mc-surface/60 p-2">
                    {/* 事件 ID */}
                    <div className="flex items-center gap-2">
                      <label className="w-14 shrink-0 text-[10px] text-mc-mute">事件 ID</label>
                      <input
                        value={ev.id}
                        onChange={(e) => updateEvent(i, { id: e.target.value })}
                        className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
                      />
                    </div>
                    {/* 分类选择 */}
                    <div className="flex items-center gap-2">
                      <label className="w-14 shrink-0 text-[10px] text-mc-mute">分类</label>
                      <select
                        value={ev.category}
                        onChange={(e) =>
                          updateEvent(i, { category: e.target.value as McSoundCategory })
                        }
                        className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 text-[10px] text-mc-text outline-none"
                      >
                        {MC_SOUND_CATEGORIES.map((cat) => (
                          <option key={cat.key} value={cat.key}>
                            {cat.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* 音量/音调数值输入 */}
                    <div className="flex items-center gap-2">
                      <label className="w-14 shrink-0 text-[10px] text-mc-mute">音量</label>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={ev.volume}
                        onChange={(e) =>
                          updateEvent(i, {
                            volume: Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)),
                          })
                        }
                        className="w-16 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
                      />
                      <label className="w-10 shrink-0 text-[10px] text-mc-mute">音调</label>
                      <input
                        type="number"
                        min="0"
                        max="2"
                        step="0.1"
                        value={ev.pitch}
                        onChange={(e) =>
                          updateEvent(i, {
                            pitch: Math.min(2, Math.max(0, parseFloat(e.target.value) || 0)),
                          })
                        }
                        className="w-16 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
                      />
                    </div>
                    {/* 字幕映射 */}
                    <div className="flex items-center gap-2">
                      <label className="flex w-14 shrink-0 items-center gap-1 text-[10px] text-mc-mute">
                        <Subtitles className="h-2.5 w-2.5" />
                        字幕
                      </label>
                      <input
                        value={ev.subtitle}
                        onChange={(e) => updateEvent(i, { subtitle: e.target.value })}
                        className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 text-[10px] text-mc-text outline-none"
                        placeholder="无障碍字幕文本，如：石块破裂"
                      />
                    </div>
                    {/* 时长设置 */}
                    <div className="flex items-center gap-2">
                      <label className="flex w-14 shrink-0 items-center gap-1 text-[10px] text-mc-mute">
                        <Clock className="h-2.5 w-2.5" />
                        时长
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={ev.duration ?? ''}
                        onChange={(e) =>
                          updateEvent(i, {
                            duration: e.target.value ? parseFloat(e.target.value) : null,
                          })
                        }
                        className="w-20 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
                        placeholder="秒"
                      />
                      <span className="text-[9px] text-mc-mute">.ogg 文件时长（秒）</span>
                    </div>
                    {/* 音效文件列表编辑 */}
                    <div>
                      <label className="mb-1 block text-[10px] text-mc-mute">音效文件路径</label>
                      <div className="space-y-1">
                        {ev.sounds.map((s, si) => (
                          <div key={si} className="flex items-center gap-1">
                            <input
                              value={s}
                              onChange={(e) => {
                                const newSounds = [...ev.sounds];
                                newSounds[si] = e.target.value;
                                updateEvent(i, { sounds: newSounds });
                              }}
                              className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-mc-text outline-none"
                            />
                            <button
                              onClick={() => {
                                const newSounds = ev.sounds.filter((_, j) => j !== si);
                                updateEvent(i, { sounds: newSounds });
                              }}
                              className="text-mc-mute hover:text-red-400"
                            >
                              <Trash2 className="h-2.5 w-2.5" />
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            const path = prompt(
                              '输入音效文件路径（不含 .ogg）',
                              `${ev.id.split(':').pop() ?? 'sound'}_new`,
                            );
                            if (path) updateEvent(i, { sounds: [...ev.sounds, path] });
                          }}
                          className="flex items-center gap-1 text-[10px] text-mc-dim hover:text-mc-text"
                        >
                          <Plus className="h-2.5 w-2.5" />
                          添加文件
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* sounds.json 预览 */}
      <details className="border-t border-mc-border">
        <summary className="cursor-pointer px-3 py-1 text-[11px] text-mc-mute hover:text-mc-dim">
          查看 sounds.json
        </summary>
        <pre className="max-h-40 overflow-auto bg-mc-bg p-2 font-mono text-[10px] text-mc-text">
          {soundsJson}
        </pre>
      </details>
    </div>
  );
}
