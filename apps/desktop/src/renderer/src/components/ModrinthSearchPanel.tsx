import { useState } from 'react';
import type { ModEntry } from '@mc-creator/shared';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';

interface Props {
  /** 选中 mod 后回调（mod 结构匹配 ModpackSpec.mods 的 ModEntry） */
  onPick: (mod: ModEntry) => void;
  onClose: () => void;
  /** 当前 loader/mcVersion，用于搜索过滤 */
  loader?: string;
  mcVersion?: string;
}

/** 搜索结果条目（与 ModrinthSearchResponse.hits 一致） */
interface SearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
}

/** 版本条目（与 ModrinthVersionsResponse.versions 一致） */
interface VersionInfo {
  id: string;
  project_id: string;
  version_number: string;
  name: string;
  files: Array<{ url: string; filename: string; primary: boolean; size: number }>;
}

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
 * Modrinth 搜索面板（模态框）。
 *
 * - 搜索框 + 搜索按钮
 * - 结果列表：icon + title + description + downloads + categories
 * - 点击结果 → 获取版本列表 → 选中版本后回调 onPick(ModEntry)
 * - 深色主题：bg-zinc-900 / border-zinc-700 / text-zinc-100，字体最小 text-xs(12px)
 * - loading / error / empty 状态完整覆盖
 */
export function ModrinthSearchPanel({ onPick, onClose, loader, mcVersion }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 选中项目后加载版本
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const [versions, setVersions] = useState<VersionInfo[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedHit(null);
    setVersions([]);
    try {
      const res = await ipcClient.modrinthSearch({ query: q, loader, mcVersion });
      setHits(res.hits);
    } catch (e) {
      setError((e as Error).message);
      setHits([]);
    } finally {
      setLoading(false);
    }
  };

  const loadVersions = async (hit: SearchHit) => {
    setSelectedHit(hit);
    setVersions([]);
    setVersionsError(null);
    setVersionsLoading(true);
    try {
      const res = await ipcClient.modrinthVersions({ projectId: hit.project_id, loader, mcVersion });
      setVersions(res.versions);
    } catch (e) {
      setVersionsError((e as Error).message);
    } finally {
      setVersionsLoading(false);
    }
  };

  const pickVersion = (hit: SearchHit, ver: VersionInfo) => {
    // 优先选 primary 文件，否则取第一个
    const file = ver.files.find((f) => f.primary) ?? ver.files[0];
    if (!file) return;
    const entry: ModEntry = {
      name: hit.title,
      projectId: hit.project_id,
      versionId: ver.id,
      fileName: file.filename,
      fileSize: file.size,
      downloadUrl: file.url,
    };
    onPick(entry);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[640px] max-w-[92vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 p-4 text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">
            🔍 搜索 Modrinth
            {(loader || mcVersion) && (
              <span className="ml-2 text-xs font-normal text-zinc-400">
                （{loader ?? '任意 loader'} / {mcVersion ?? '任意版本'}）
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 搜索框 */}
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch();
            }}
            placeholder="输入 mod 名称（如 Sodium）"
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 p-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            disabled={loading}
          />
          <button
            onClick={doSearch}
            disabled={loading || !query.trim()}
            className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {loading && (
              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            搜索
          </button>
        </div>

        {/* 错误提示 */}
        {error && <div className="mb-3"><ErrorBanner message={error} onClose={() => setError(null)} /></div>}

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto">
          {/* 版本选择视图 */}
          {selectedHit ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <button
                  onClick={() => {
                    setSelectedHit(null);
                    setVersions([]);
                    setVersionsError(null);
                  }}
                  className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-600"
                >
                  ← 返回结果列表
                </button>
                <span className="text-xs text-zinc-400">选择版本：{selectedHit.title}</span>
              </div>
              {versionsError && (
                <div className="mb-2"><ErrorBanner message={versionsError} onClose={() => setVersionsError(null)} /></div>
              )}
              {versionsLoading ? (
                <div className="py-8 text-center text-xs text-zinc-500">加载版本中…</div>
              ) : versions.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  没有匹配的版本{loader || mcVersion ? `（${loader ?? ''} ${mcVersion ?? ''}）` : ''}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {versions.map((v) => {
                    const file = v.files.find((f) => f.primary) ?? v.files[0];
                    return (
                      <li key={v.id}>
                        <button
                          onClick={() => pickVersion(selectedHit, v)}
                          className="w-full rounded border border-zinc-700 bg-zinc-800/60 p-2.5 text-left transition hover:border-blue-500 hover:bg-zinc-800"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-zinc-100">{v.name}</span>
                            <span className="text-xs text-zinc-400">{v.version_number}</span>
                          </div>
                          {file && (
                            <div className="mt-1 text-xs text-zinc-500">
                              {file.filename} · {formatSize(file.size)}
                              {file.primary && <span className="ml-1 text-blue-400">主文件</span>}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            /* 搜索结果列表 */
            <>
              {loading ? (
                <div className="py-8 text-center text-xs text-zinc-500">搜索中…</div>
              ) : hits.length === 0 ? (
                hasSearched ? (
                  <div className="py-8 text-center text-xs text-zinc-500">
                    没有找到匹配的 mod
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-zinc-500">
                    输入关键词开始搜索 Modrinth 上的 mod
                  </div>
                )
              ) : (
                <ul className="space-y-1.5">
                  {hits.map((hit) => (
                    <li key={hit.project_id}>
                      <button
                        onClick={() => loadVersions(hit)}
                        className="flex w-full items-start gap-3 rounded border border-zinc-700 bg-zinc-800/60 p-2.5 text-left transition hover:border-blue-500 hover:bg-zinc-800"
                      >
                        {hit.icon_url ? (
                          <img
                            src={hit.icon_url}
                            alt=""
                            className="h-10 w-10 flex-shrink-0 rounded"
                          />
                        ) : (
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded bg-zinc-700 text-xs text-zinc-400">
                            无图
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-medium text-zinc-100">{hit.title}</span>
                            <span className="flex-shrink-0 text-xs text-zinc-400">
                              ↓ {formatDownloads(hit.downloads)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{hit.description}</p>
                          {hit.categories.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {hit.categories.slice(0, 5).map((c) => (
                                <span
                                  key={c}
                                  className="rounded bg-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300"
                                >
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

        <div className="mt-3 text-right text-xs text-zinc-500">
          {selectedHit ? '选择版本后将添加到整合包' : '点击结果选择版本'}
        </div>
      </div>
    </div>
  );
}
