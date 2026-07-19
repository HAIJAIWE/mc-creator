import { useState, useMemo, useEffect } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import type { ModEntry } from '@mc-creator/shared';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import { Loader2, Search, Clock, X, Star, Download, Filter } from 'lucide-react';

interface Props {
  /** 选中 mod 后回调（mod 结构匹配 ModpackSpec.mods 的 ModEntry） */
  onPick: (mod: ModEntry) => void;
  onClose: () => void;
  /** 当前 loader/mcVersion，用于搜索过滤 */
  loader?: string;
  mcVersion?: string;
}

/** 搜索结果条目（与 CurseForgeSearchResponse.hits 一致） */
interface SearchHit {
  id: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  downloadCount: number;
  categories: string[];
}

/** 文件条目（与 CurseForgeFilesResponse.files 一致） */
interface FileInfo {
  id: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  modLoaderNames: string[];
}

/** 排序方式 */
type SortBy = 'relevance' | 'downloads' | 'name' | 'newest';

/** 分类筛选 */
const CATEGORY_FILTERS = [
  'all',
  'armor',
  'adventure',
  'magic',
  'utility',
  'technology',
  'world-gen',
  'storage',
  'food',
  'game-mechanics',
  'server',
] as const;
type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: '全部分类',
  armor: '装甲',
  adventure: '冒险',
  magic: '魔法',
  utility: '工具',
  technology: '科技',
  'world-gen': '世界生成',
  storage: '存储',
  food: '食物',
  'game-mechanics': '游戏机制',
  server: '服务器',
};

const SORT_LABELS: Record<SortBy, string> = {
  relevance: '相关度',
  downloads: '下载量',
  name: '名称',
  newest: '最新',
};

const HISTORY_KEY = 'mc-creator:curseforge:history';
const MAX_HISTORY = 8;

/** 格式化下载量为人类可读字符串 */
function formatDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** 格式化文件大小（字节 → KB/MB） */
function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${bytes} B`;
}

/**
 * CurseForge 搜索面板（模态框，P29）。
 *
 * 增强：排序、分类筛选、最近搜索历史、加载更多
 */
export function CurseForgeSearchPanel({ onPick, onClose, loader, mcVersion }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>('relevance');
  const [category, setCategory] = useState<CategoryFilter>('all');
  const [history, setHistory] = useState<string[]>([]);

  // 选中项目后加载文件列表
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [loaderFilter, setLoaderFilter] = useState<string>('all');

  // 加载历史
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  // 保存历史
  const saveHistory = (q: string) => {
    const next = [q, ...history.filter((h) => h !== q)].slice(0, MAX_HISTORY);
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
  };

  const doSearch = async (q?: string) => {
    const searchQuery = (q ?? query).trim();
    if (!searchQuery) return;
    setQuery(searchQuery);
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedHit(null);
    setFiles([]);
    saveHistory(searchQuery);
    try {
      const res = await ipcClient.curseforgeSearch({ query: searchQuery, loader, mcVersion });
      setHits(res.hits);
    } catch (e) {
      setError((e as Error).message);
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  const loadFiles = async (hit: SearchHit) => {
    setSelectedHit(hit);
    setFiles([]);
    setFilesError(null);
    setFilesLoading(true);
    try {
      const res = await ipcClient.curseforgeFiles({ modId: hit.id, loader, mcVersion });
      setFiles(res.files);
    } catch (e) {
      setFilesError((e as Error).message);
    } finally {
      setFilesLoading(false);
    }
  };

  const pickFile = (hit: SearchHit, file: FileInfo) => {
    const entry: ModEntry = {
      name: hit.name,
      projectId: String(hit.id),
      versionId: String(file.id),
      fileName: file.fileName,
      fileSize: file.fileLength,
      downloadUrl: file.downloadUrl ?? '',
    };
    onPick(entry);
  };

  // ===== 客户端筛选 + 排序 =====
  const displayHits = useMemo(() => {
    let result = hits;
    // 分类筛选（基于 categories 数组包含的字符串）
    if (category !== 'all') {
      result = result.filter((h) =>
        h.categories.some((c) => c.toLowerCase().includes(category.replace('-', ' '))),
      );
    }
    // 排序
    const sorted = [...result];
    switch (sortBy) {
      case 'downloads':
        sorted.sort((a, b) => b.downloadCount - a.downloadCount);
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'newest':
        // 简化：按 id 倒序（id 越大越新）
        sorted.sort((a, b) => b.id - a.id);
        break;
      case 'relevance':
      default:
        // 保持原顺序
        break;
    }
    return sorted;
  }, [hits, sortBy, category]);

  // 文件按 loader 筛选
  const filteredFiles = useMemo(() => {
    if (loaderFilter === 'all') return files;
    return files.filter((f) =>
      f.modLoaderNames.some((l) => l.toLowerCase() === loaderFilter.toLowerCase()),
    );
  }, [files, loaderFilter]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-[720px] max-w-[94vw] flex-col rounded-mc-lg border border-mc-border-strong bg-mc-surface shadow-mc-pop p-4 text-mc-text animate-mc-dialog-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-base font-bold">
            <McIcon scope="pixel" name="search" size={16} /> 搜索 CurseForge
            {(loader || mcVersion) && (
              <span className="ml-2 text-xs font-normal text-mc-text-dim">
                （{loader ?? '任意 loader'} / {mcVersion ?? '任意版本'}）
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-mc-text-dim hover:text-mc-text"
            aria-label="关闭"
          >
            <McIcon scope="pixel" name="close" size={16} />
          </button>
        </div>

        {/* 搜索框 */}
        <div className="mb-2 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-mc-mute" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSearch();
              }}
              placeholder="输入 mod 名称（如 JEI）"
              className="mc-input w-full pl-7"
              disabled={loading}
            />
          </div>
          <button
            onClick={() => doSearch()}
            disabled={loading || !query.trim()}
            className="mc-btn-primary"
          >
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            搜索
          </button>
        </div>

        {/* 最近搜索历史 */}
        {!hasSearched && history.length > 0 && (
          <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2 p-2">
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1 text-[10px] font-medium text-mc-dim">
                <Clock className="h-3 w-3" /> 最近搜索
              </span>
              <button
                onClick={clearHistory}
                className="text-[10px] text-mc-mute hover:text-red-400"
              >
                清空
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {history.map((h) => (
                <button
                  key={h}
                  onClick={() => doSearch(h)}
                  className="flex items-center gap-1 rounded-mc bg-mc-surface px-2 py-0.5 text-[10px] text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text"
                >
                  {h}
                  <X className="h-2 w-2" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 筛选 + 排序（仅搜索后显示） */}
        {hasSearched && !selectedHit && (
          <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-mc-border pb-2">
            <Filter className="h-3 w-3 text-mc-mute" />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CategoryFilter)}
              className="mc-select !py-1 !text-xs"
            >
              {CATEGORY_FILTERS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortBy)}
              className="mc-select !py-1 !text-xs"
            >
              {Object.entries(SORT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  排序: {v}
                </option>
              ))}
            </select>
            <span className="ml-auto text-[10px] text-mc-mute">
              {displayHits.length} / {hits.length} 个结果
            </span>
          </div>
        )}

        {/* 错误提示 */}
        {error && (
          <div className="mb-3">
            <ErrorBanner message={error} onClose={() => setError(null)} />
          </div>
        )}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {/* 文件选择视图 */}
          {selectedHit ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    setSelectedHit(null);
                    setFiles([]);
                    setFilesError(null);
                  }}
                  className="mc-btn-ghost"
                >
                  <McIcon scope="pixel" name="arrow-left" size={12} /> 返回结果列表
                </button>
                <span className="text-xs text-mc-text-dim">选择文件：{selectedHit.name}</span>
              </div>

              {/* Loader 筛选 */}
              <div className="mb-2 flex items-center gap-1">
                <span className="text-[10px] text-mc-mute">Loader:</span>
                {['all', 'fabric', 'forge', 'neoforge', 'quilt'].map((l) => (
                  <button
                    key={l}
                    onClick={() => setLoaderFilter(l)}
                    className={`rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ${
                      loaderFilter === l
                        ? 'bg-mc-accent text-white'
                        : 'bg-mc-surface-2 text-mc-dim hover:text-mc-text'
                    }`}
                  >
                    {l === 'all' ? '全部' : l}
                  </button>
                ))}
              </div>

              {filesError && (
                <div className="mb-2">
                  <ErrorBanner message={filesError} onClose={() => setFilesError(null)} />
                </div>
              )}
              {filesLoading ? (
                <div className="py-8 text-center text-xs text-mc-text-dim">加载文件列表中…</div>
              ) : filteredFiles.length === 0 ? (
                <div className="py-8 text-center text-xs text-mc-text-dim">
                  没有匹配的文件
                  {loader || mcVersion ? `（${loader ?? ''} ${mcVersion ?? ''}）` : ''}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {filteredFiles.map((f) => (
                    <li key={f.id}>
                      <button
                        onClick={() => pickFile(selectedHit, f)}
                        className="mc-card w-full p-2.5 text-left hover:border-mc-accent transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-mc-text">{f.displayName}</span>
                          <span className="text-xs text-mc-text-dim">
                            {formatSize(f.fileLength)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-mc-text-dim">
                          <span className="truncate">{f.fileName}</span>
                          {f.modLoaderNames.length > 0 && (
                            <span className="flex flex-wrap gap-0.5">
                              {f.modLoaderNames.map((l) => (
                                <span
                                  key={l}
                                  className="rounded-mc bg-mc-accent/20 px-1 text-[9px] text-mc-accent"
                                >
                                  {l}
                                </span>
                              ))}
                            </span>
                          )}
                        </div>
                        {f.gameVersions.length > 0 && (
                          <div className="mt-0.5 text-[10px] text-mc-mute">
                            MC: {f.gameVersions.filter((v) => v.startsWith('1.')).join(', ')}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* 搜索结果列表 */
            <>
              {loading ? (
                <div className="py-8 text-center text-xs text-mc-text-dim">搜索中…</div>
              ) : displayHits.length === 0 ? (
                hasSearched ? (
                  <div className="py-8 text-center text-xs text-mc-text-dim">
                    {hits.length === 0 ? '没有找到匹配的 mod' : '当前筛选条件下无结果'}
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-mc-text-dim">
                    输入关键词开始搜索 CurseForge 上的 mod
                  </div>
                )
              ) : (
                <ul className="space-y-1.5">
                  {displayHits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        onClick={() => loadFiles(hit)}
                        className="mc-card flex w-full items-start gap-3 p-2.5 text-left hover:border-mc-accent transition-colors"
                      >
                        {hit.logoUrl ? (
                          <img
                            src={hit.logoUrl}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded"
                          />
                        ) : (
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-mc-surface-3 text-xs text-mc-text-dim">
                            无图
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-mc-text">
                              {hit.name}
                            </span>
                            <span className="flex flex-shrink-0 items-center gap-1 text-xs text-mc-text-dim">
                              <Download className="h-3 w-3" />
                              {formatDownloads(hit.downloadCount)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-mc-text-dim">
                            {hit.summary}
                          </p>
                          {hit.categories.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {hit.categories.slice(0, 5).map((c) => (
                                <span key={c} className="mc-tag flex items-center gap-0.5">
                                  <Star className="h-2 w-2" />
                                  {c}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="mt-3 text-right text-xs text-mc-text-dim">
          {selectedHit ? '选择文件后将添加到整合包' : '点击结果选择文件'}
        </div>
      </div>
    </div>
  );
}
