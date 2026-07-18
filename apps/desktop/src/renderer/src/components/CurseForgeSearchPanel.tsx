import { useState } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import type { ModEntry } from '@mc-creator/shared';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import { Loader2 } from 'lucide-react';

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
 * - 深色主题：bg-mc-surface / border-mc-border-strong / text-mc-text，字体最小 text-xs(12px)
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
        className="flex max-h-[85vh] w-[640px] max-w-[92vw] flex-col rounded-mc-lg border border-mc-border-strong bg-mc-surface shadow-mc-pop p-4 text-mc-text animate-mc-dialog-in"
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
        <div className="mb-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doSearch();
            }}
            placeholder="输入 mod 名称（如 JEI）"
            className="mc-input flex-1"
            disabled={loading}
          />
          <button onClick={doSearch} disabled={loading || !query.trim()} className="mc-btn-primary">
            {loading && <Loader2 className="h-3 w-3 animate-spin" />}
            搜索
          </button>
        </div>

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
              {filesError && (
                <div className="mb-2">
                  <ErrorBanner message={filesError} onClose={() => setFilesError(null)} />
                </div>
              )}
              {filesLoading ? (
                <div className="py-8 text-center text-xs text-mc-text-dim">加载文件列表中…</div>
              ) : files.length === 0 ? (
                <div className="py-8 text-center text-xs text-mc-text-dim">
                  没有匹配的文件
                  {loader || mcVersion ? `（${loader ?? ''} ${mcVersion ?? ''}）` : ''}
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {files.map((f) => (
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
                        <div className="mt-1 text-xs text-mc-text-dim">
                          {f.fileName}
                          {f.modLoaderNames.length > 0 && (
                            <span className="ml-1 text-mc-accent">
                              [{f.modLoaderNames.join(', ')}]
                            </span>
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
                <div className="py-8 text-center text-xs text-mc-text-dim">搜索中…</div>
              ) : hits.length === 0 ? (
                hasSearched ? (
                  <div className="py-8 text-center text-xs text-mc-text-dim">
                    没有找到匹配的 mod
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-mc-text-dim">
                    输入关键词开始搜索 CurseForge 上的 mod
                  </div>
                )
              ) : (
                <ul className="space-y-1.5">
                  {hits.map((hit) => (
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
                            <span className="flex-shrink-0 text-xs text-mc-text-dim">
                              <McIcon scope="pixel" name="download" size={12} />{' '}
                              {formatDownloads(hit.downloadCount)}
                            </span>
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs text-mc-text-dim">
                            {hit.summary}
                          </p>
                          {hit.categories.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {hit.categories.slice(0, 5).map((c) => (
                                <span key={c} className="mc-tag">
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
