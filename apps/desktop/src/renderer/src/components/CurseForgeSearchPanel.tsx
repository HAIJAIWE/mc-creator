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
 * - 搜索框 + 搜索按钮
 * - 结果列表：logo + name + summary + downloadCount + categories
 * - 点击结果 → 获取文件列表 → 选中文件后回调 onPick(ModEntry)
 * - 深色主题：bg-zinc-900 / border-zinc-700 / text-zinc-100，字体最小 text-xs(12px)
 * - loading / error / empty 状态完整覆盖
 */
export function CurseForgeSearchPanel({ onPick, onClose, loader, mcVersion }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // 选中项目后加载文件列表
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const doSearch = async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setHasSearched(true);
    setSelectedHit(null);
    setFiles([]);
    try {
      const res = await ipcClient.curseforgeSearch({ query: q, loader, mcVersion });
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
            🔍 搜索 CurseForge
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
            placeholder="输入 mod 名称（如 JEI）"
            className="flex-1 rounded border border-zinc-700 bg-zinc-800 p-2 text-sm text-zinc-100 placeholder:text-zinc-500"
            disabled={loading}
          />
          <button
            onClick={doSearch}
            disabled={loading || !query.trim()}
            className="flex items-center gap-1.5 rounded bg-orange-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
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
                  className="rounded bg-zinc-700 px-2 py-0.5 text-xs text-zinc-200 hover:bg-zinc-600"
                >
                  ← 返回结果列表
                </button>
                <span className="text-xs text-zinc-400">选择文件：{selectedHit.name}</span>
              </div>
              {filesError && (
                <div className="mb-2"><ErrorBanner message={filesError} onClose={() => setFilesError(null)} /></div>
              )}
              {filesLoading ? (
                <div className="py-8 text-center text-xs text-zinc-500">加载文件列表中…</div>
              ) : files.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-500">
                  没有匹配的文件{loader || mcVersion ? `（${loader ?? ''} ${mcVersion ?? ''}）` : ''}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {files.map((f) => (
                    <li key={f.id}>
                      <button
                        onClick={() => pickFile(selectedHit, f)}
                        className="w-full rounded border border-zinc-700 bg-zinc-800/60 p-2.5 text-left transition hover:border-orange-500 hover:bg-zinc-800"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-zinc-100">{f.displayName}</span>
                          <span className="text-xs text-zinc-400">{formatSize(f.fileLength)}</span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500">
                          {f.fileName}
                          {f.modLoaderNames.length > 0 && (
                            <span className="ml-1 text-orange-400">[{f.modLoaderNames.join(', ')}]</span>
                          )}
                        </div>
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
                <div className="py-8 text-center text-xs text-zinc-500">搜索中…</div>
              ) : hits.length === 0 ? (
                hasSearched ? (
                  <div className="py-8 text-center text-xs text-zinc-500">
                    没有找到匹配的 mod
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-zinc-500">
                    输入关键词开始搜索 CurseForge 上的 mod
                  </div>
                )
              ) : (
                <ul className="space-y-1.5">
                  {hits.map((hit) => (
                    <li key={hit.id}>
                      <button
                        onClick={() => loadFiles(hit)}
                        className="flex w-full items-start gap-3 rounded border border-zinc-700 bg-zinc-800/60 p-2.5 text-left transition hover:border-orange-500 hover:bg-zinc-800"
                      >
                        {hit.logoUrl ? (
                          <img
                            src={hit.logoUrl}
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
                            <span className="truncate text-sm font-medium text-zinc-100">{hit.name}</span>
                            <span className="flex-shrink-0 text-xs text-zinc-400">
                              ↓ {formatDownloads(hit.downloadCount)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-zinc-400">{hit.summary}</p>
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
          {selectedHit ? '选择文件后将添加到整合包' : '点击结果选择文件'}
        </div>
      </div>
    </div>
  );
}
