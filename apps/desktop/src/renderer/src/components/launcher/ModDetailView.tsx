/**
 * 在线内容详情页（对齐 PCL 点击搜索结果后弹出的那个窗口）。
 *
 * 信息层次刻意照 PCL 排：
 *   1. 头部：图标 / 名称 + 中文分类 / 摘要 / loader+版本范围+下载量+时间+来源
 *   2. 动作行：转到源站、转到 MC 百科、复制名称
 *   3. 版本 tab：全部 + 各个 MC 版本（PCL 那一排 26.3 / 26.2 / 1.21 …）
 *   4. loader 分组：NeoForge 26.3 / Fabric 26.3 / … 每个可展开出文件行
 *
 * 浏览 + 下载；整合包按版本给「安装」（整包铺进一个新实例），其余分类只给
 * 单文件下载 —— 后者的归属（装进哪个实例 / 世界）属于实例内容管理，不在这里。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { compareMcVersionsDesc } from '../../lib/mc-version-compare.js';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  Package,
  RefreshCw,
} from 'lucide-react';

import { ipcClient } from '../../lib/ipc-client.js';
import { ErrorBanner } from '../ErrorBanner';
import {
  categoryLabel,
  sourceLoaderLabel,
  formatDownloads,
  formatAgo,
  versionRange,
} from './detail-shared.js';
import type { ContentType, ModEntry, ModProjectDetail } from '../../../../shared/ipc/launcher.js';
import { PLAY_LOADER_FILTERS } from '../../../../shared/play-loaders.js';

const MC_WIKI_BASE = 'https://zh.minecraft.wiki/w/';

export function ModDetailView({
  entry,
  contentType,
  onBack,
  onDownloadFile,
  onInstallModpack,
  installingId,
  downloadingId,
}: {
  entry: ModEntry;
  contentType: ContentType;
  onBack: () => void;
  /** 下载某个具体版本的文件；`expected` 是清单给的 sha1 / size（主进程据此校验）。 */
  onDownloadFile: (
    url: string,
    filename: string,
    expected?: { sha1?: string; size?: number },
  ) => void;
  /** 整合包「安装到实例」；只对 modpack 分类有意义，其他分类不传。 */
  onInstallModpack?: (versionId: string, versionLabel: string) => void;
  /** 正在安装的整合包版本 id；null = 没在装。 */
  installingId?: string | null;
  downloadingId: string | null;
}): JSX.Element {
  const [detail, setDetail] = useState<ModProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bodyOpen, setBodyOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 版本 tab：'' 表示「全部」。 */
  const [versionTab, setVersionTab] = useState('');
  /** 展开了哪些 loader 分组（key = `${loader}|${版本号}`）。 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.launcherGetModDetail({
        modId: entry.id,
        contentType,
      });
      if (res.error) setError(res.error);
      else setDetail(res.detail ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [entry.id, contentType]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * 版本 tab 候选：把项目所有版本的 gameVersions 摊平去重，按版本号**降序**排。
   *
   * 降序要按 major/minor/patch 数值比，不能按字符串 —— 否则 "1.9" 会排在
   * "1.10" 后面（字符串比较 9 > 1）。`-rc-1` / `-snapshot-4` 也不能直接
   * `Number()`：`Number('2-rc-1')` 是 NaN，排序会把 RC 版本当成相等。
   * 统一交给 `compareMcVersionsDesc`，下载页的版本候选也用同一个。
   */
  const versionTabs = useMemo(() => {
    if (!detail) return [];
    const seen = new Set<string>();
    for (const v of detail.versions) {
      for (const gv of v.gameVersions) seen.add(gv);
    }
    return [...seen].sort(compareMcVersionsDesc);
  }, [detail]);

  /** 当前 tab 过滤后的版本列表（新版本在前）。 */
  const visibleVersions = useMemo(() => {
    if (!detail) return [];
    const list =
      versionTab === ''
        ? detail.versions
        : detail.versions.filter((v) => v.gameVersions.includes(versionTab));
    return [...list].sort((a, b) => (b.datePublished ?? 0) - (a.datePublished ?? 0));
  }, [detail, versionTab]);

  /**
   * 按 loader 分组 —— PCL 的「NeoForge 26.3 / Fabric 26.3」就是这么来的。
   *
   * 一个版本可能同时支持多个 loader，PCL 的选择是**每个 loader 各自出一组**，
   * 组名带该 loader 下最新支持的版本号。这里对齐这个行为。
   *
   * 只保留 NeoForge / Fabric（清单取 `shared/play-loaders.ts`，与搜索页筛选器
   * 是**同一份**）；源站里 Forge / Quilt 等分组不展示 —— 否则筛选器选了
   * NeoForge、详情页却列出一堆 Forge 组。
   */
  const SUPPORTED = useMemo(() => new Set<string>(PLAY_LOADER_FILTERS), []);
  const groups = useMemo(() => {
    const byLoader = new Map<string, typeof visibleVersions>();
    for (const v of visibleVersions) {
      for (const l of v.loaders) {
        if (!SUPPORTED.has(l.toLowerCase())) continue;
        const arr = byLoader.get(l) ?? [];
        arr.push(v);
        byLoader.set(l, arr);
      }
    }
    // loader 没填的版本归到「其他」，不能因为字段缺失就整个版本不显示
    const noLoader = visibleVersions.filter(
      (v) => v.loaders.length === 0 || !v.loaders.some((l) => SUPPORTED.has(l.toLowerCase())),
    );
    if (noLoader.length > 0) byLoader.set('__none__', noLoader);
    return [...byLoader.entries()].map(([loader, versions]) => ({
      loader,
      label:
        loader === '__none__'
          ? '其他'
          : `${sourceLoaderLabel(loader)} ${versions[0]?.versionNumber ?? ''}`.trim(),
      /** 该组支持的 MC 版本里最高的那个，PCL 组名后缀就是它 */
      topVersion: versionRange(versions.flatMap((v) => v.gameVersions)),
      versions,
    }));
  }, [visibleVersions, SUPPORTED]);

  /**
   * 顶栏（返回 + 标题 + 刷新）。
   *
   * 加载中 / 出错 / 没数据这三条分支**都要**用它 —— 少了返回键用户就死在
   * 详情页里了：搜索结果在整块替换掉的那棵树里，回不去只能重新搜一遍。
   * 出错时尤其致命，因为出错的往往正是网络最差的时候。
   */
  const topBar = (
    <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
      <button
        onClick={onBack}
        className="mc-btn-ghost"
        aria-label="返回搜索结果"
        title="返回搜索结果"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
      </button>
      <span className="truncate text-xs font-medium text-mc-text">
        {detail?.name ?? entry.name}
      </span>
      {!loading && (
        <button
          onClick={() => void load()}
          className="mc-btn-ghost ml-auto"
          aria-label="刷新详情"
          title="刷新详情"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col" aria-label="内容详情">
        {topBar}
        <div className="flex flex-1 items-center justify-center text-xs text-mc-text-dim">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          加载详情…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col" aria-label="内容详情">
        {topBar}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
          <ErrorBanner message={error} onClose={() => setError(null)} />
          <button onClick={() => void load()} className="mc-btn-ghost">
            <RefreshCw className="mr-1 h-3 w-3" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex h-full flex-col" aria-label="内容详情">
        {topBar}
        <div className="flex flex-1 items-center justify-center text-xs text-mc-text-dim">
          没有拿到详情数据
        </div>
      </div>
    );
  }

  const vr = versionRange(detail.gameVersions);
  const ago = formatAgo(detail.updatedAt);
  /**
   * 只展示 NeoForge / Fabric。
   *
   * 搜索页的加载器筛选器只给这两项（当下双主力），但**源站数据里还有
   * Forge / Quilt / LiteLoader**。详情页不跟着过滤的话，用户在筛选器里
   * 选了 NeoForge，进详情却看到一堆 Forge 分组，等于筛选没生效。
   *
   * 所以清单直接取 `shared/play-loaders.ts` 那一份（这里、搜索页下拉、
   * CurseForge 面板的文件筛选都用它）—— 同一件事写三遍就会各漂各的。
   *
   * ⚠️ 比较时统一转小写：源站给的是小写 loader 键。但**只做小写归一**，
   * 不做「family 归并」——`legacy-fabric` 不等于 `fabric`，会被这条过滤掉
   * （要不要把 legacy-fabric 也算 Fabric 是产品决定，见会话记录）。
   *
   * 另外**必须去重**：CurseForge 那边这两份数据是「所有文件摊平」来的，
   * 不去重的话头部会渲染成 `NeoForge / Fabric / NeoForge / Fabric / …`
   * 几百遍（实测 JEI 的详情页就是这样一堵墙）。渲染层再兜一次底：不管上游
   * 从哪来，展示用的列表都不该有重复项。
   */
  const loaders = [
    ...new Set(
      detail.loaders
        .filter((l) => (PLAY_LOADER_FILTERS as readonly string[]).includes(l.toLowerCase()))
        .map(sourceLoaderLabel),
    ),
  ];
  const tags = detail.categories.slice(0, 1);

  return (
    <div className="flex h-full flex-col overflow-hidden" aria-label="内容详情">
      {/* 顶栏复用上面那个 —— 三条分支都得有返回键 */}
      {topBar}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 头部信息 */}
        <section className="flex gap-3">
          {detail.iconUrl ? (
            <img
              src={detail.iconUrl}
              alt=""
              className="h-16 w-16 shrink-0 rounded-mc object-cover"
            />
          ) : (
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-mc bg-mc-surface">
              <Package className="h-7 w-7 text-mc-text-dim" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm font-medium text-mc-text">{detail.name}</h2>
              {tags.map((t) => (
                <span
                  key={t}
                  className="mc-tag text-[9px] bg-mc-accent/15 text-mc-accent"
                  title={t}
                >
                  {categoryLabel(t)}
                </span>
              ))}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-mc-text-dim">{detail.summary}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-mc-text-dim">
              {loaders.length > 0 && <span>{loaders.join(' / ')}</span>}
              {vr && <span className="text-mc-text">{vr}</span>}
              {detail.downloads !== undefined && <span>↓ {formatDownloads(detail.downloads)}</span>}
              {ago && <span>↑ {ago}</span>}
              <span className={detail.source === 'modrinth' ? 'text-mc-green' : 'text-mc-orange'}>
                <Globe className="mr-0.5 inline h-2.5 w-2.5" />
                {detail.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
              </span>
            </div>
          </div>
        </section>

        {/* 动作行 */}
        <section className="flex flex-wrap gap-2">
          {detail.sourceUrl && (
            <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="mc-btn-ghost">
              <ExternalLink className="mr-1 h-3 w-3" />
              转到 {detail.source === 'modrinth' ? 'Modrinth' : 'CurseForge'}
            </a>
          )}
          {detail.wikiUrl ? (
            <a href={detail.wikiUrl} target="_blank" rel="noreferrer" className="mc-btn-ghost">
              <BookOpen className="mr-1 h-3 w-3" />
              Wiki
            </a>
          ) : (
            <a
              href={`${MC_WIKI_BASE}${encodeURIComponent(detail.name)}`}
              target="_blank"
              rel="noreferrer"
              className="mc-btn-ghost"
              title="源站没给百科链接，按名字去 MC 百科搜"
            >
              <BookOpen className="mr-1 h-3 w-3" />
              转到 MC 百科
            </a>
          )}
          <button
            onClick={() => {
              void navigator.clipboard.writeText(detail.name);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            }}
            className="mc-btn-ghost"
          >
            <Copy className="mr-1 h-3 w-3" />
            {copied ? '已复制' : '复制名称'}
          </button>
        </section>

        {/* 长描述：默认收起，点开才渲染 —— markdown 长文展开会把首屏顶掉 */}
        {detail.body && (
          <section className="mc-card">
            <button
              onClick={() => setBodyOpen((s) => !s)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
              aria-expanded={bodyOpen}
            >
              {bodyOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span className="text-xs font-medium">详细介绍</span>
            </button>
            {bodyOpen && (
              <div className="border-t border-mc-border px-3 py-2">
                <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed text-mc-text-dim">
                  {detail.body.replace(/<[^>]+>/g, '')}
                </pre>
              </div>
            )}
          </section>
        )}

        {/* 版本 tab */}
        {versionTabs.length > 0 && (
          <section className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setVersionTab('')}
              className={`rounded-mc px-2 py-1 text-[10px] ${
                versionTab === ''
                  ? 'bg-mc-accent/15 text-mc-accent'
                  : 'text-mc-text-dim hover:bg-mc-hover'
              }`}
            >
              全部
            </button>
            {versionTabs.map((v) => (
              <button
                key={v}
                onClick={() => setVersionTab(v)}
                className={`rounded-mc px-2 py-1 text-[10px] ${
                  versionTab === v
                    ? 'bg-mc-accent/15 text-mc-accent'
                    : 'text-mc-text-dim hover:bg-mc-hover'
                }`}
              >
                {v}
              </button>
            ))}
          </section>
        )}

        {/* loader 分组 */}
        {groups.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-4 text-[11px] text-mc-text-dim">
            <AlertTriangle className="h-3 w-3" />
            这个版本筛选下没有可下载的文件
          </div>
        ) : (
          <section className="space-y-2">
            {groups.map((g) => {
              const key = `${g.loader}`;
              const expanded = openGroups[key] ?? false;
              return (
                <div className="mc-card" key={key}>
                  <button
                    onClick={() => setOpenGroups((s) => ({ ...s, [key]: !expanded }))}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="h-3 w-3" />
                    ) : (
                      <ChevronRight className="h-3 w-3" />
                    )}
                    <span className="text-xs font-medium">{g.label}</span>
                    <span className="ml-auto text-[10px] text-mc-text-dim">
                      {g.versions.length} 个版本
                    </span>
                  </button>
                  {expanded && (
                    <ul className="border-t border-mc-border">
                      {g.versions.map((v) => (
                        <li
                          key={v.id}
                          className="flex items-center gap-2 border-b border-mc-border px-3 py-2 last:border-b-0"
                        >
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                            {v.versionNumber}
                          </span>
                          <span className="shrink-0 text-[10px] text-mc-text-dim">
                            {versionRange(v.gameVersions)}
                          </span>
                          {v.datePublished && (
                            <span className="shrink-0 text-[10px] text-mc-text-dim">
                              {formatAgo(v.datePublished)}
                            </span>
                          )}
                          {v.files.map((f) => {
                            const dlKey = `${v.id}|${f.filename}`;
                            return (
                              <button
                                key={dlKey}
                                onClick={() =>
                                  onDownloadFile(f.url, f.filename, {
                                    ...(f.sha1 === undefined ? {} : { sha1: f.sha1 }),
                                    ...(f.size === undefined ? {} : { size: f.size }),
                                  })
                                }
                                disabled={downloadingId !== null}
                                className="mc-btn-ghost shrink-0"
                                aria-label={`下载 ${f.filename}`}
                                title={`${f.filename}${f.size ? ` · ${(f.size / 1048576).toFixed(2)} MB` : ''}`}
                              >
                                {downloadingId === dlKey ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Download className="h-3.5 w-3.5" />
                                )}
                              </button>
                            );
                          })}
                          {/*
                            整合包按版本给「安装」而不是「下载」。

                            整合包不是单个文件 —— 它是一份清单（实测 Fabulously Optimized
                            55 个条目），装它要新建实例、装加载器、把整份清单铺进去。
                            只把 `.mrpack` 丢进 mods/ 目录，游戏什么都不会多出来。
                            这里给的是**整包安装**，标出来以免和旁边的单文件下载混淆。
                          */}
                          {onInstallModpack && (
                            <button
                              onClick={() =>
                                onInstallModpack(
                                  v.id,
                                  `${v.versionNumber} · MC ${versionRange(v.gameVersions)}`,
                                )
                              }
                              disabled={installingId !== undefined && installingId !== null}
                              className="mc-btn shrink-0"
                              aria-label={`安装整合包版本 ${v.versionNumber}`}
                              title={`安装这个版本：新建实例、装加载器、铺完整份清单`}
                            >
                              {installingId === v.id ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Package className="mr-1 h-3 w-3" />
                              )}
                              安装
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
