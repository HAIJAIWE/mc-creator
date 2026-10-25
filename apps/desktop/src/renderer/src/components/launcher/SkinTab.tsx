/**
 * 启动器实例详情的「皮肤」tab（§5.9）。
 *
 * ## 这个 tab 做什么
 *
 * 三件事，对应三种来源：
 *
 * | 来源 | 入口 |
 * |---|---|
 * | 本地 PNG | 「从文件导入」选一个 .png |
 * | 正版账号 | 用已登录微软账号的皮肤 URL（`mc-account-service` 解析出来的） |
 * | MineSkin 公共库 | 翻页浏览（**没有名字/作者**，靠 3D 预览挑） |
 *
 * 「应用」= 把库里的 PNG 复制到
 * `<gameDir>/CustomSkinLoader/LocalSkin/skins/<玩家名>.png`。
 * CustomSkinLoader（已装的 mod）读那个目录并显示 —— **不需要动启动参数**。
 *
 * ## 玩家名要用户填
 *
 * 因为本地皮肤的键是**玩家名**，而它跟实例的 `username`  поле不一定一致
 * （用户可能换个名字登录同一个实例）。默认填实例的 username，可改。
 *
 * 主键校验在主进程（`localSkinFileName`），渲染层这一层只是即时反馈 ——
 * IPC 请求可以直接构造，不能当安全边界。
 *
 * ## 预览
 *
 * 2D 直接贴 PNG；3D 用 skinview3d（`mc/ui` 那套渲染在低代码生成器里用过）。
 * 这里只读不写：皮肤库是「挑选」而不是「绘制」，绘制在 lowcode 的皮肤编辑器。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FolderOpen, RefreshCw, Sparkles, Trash2, Upload } from 'lucide-react';
import type { ModelType } from 'skinview3d';

import { ipcClient } from '../../lib/ipc-client.js';
import { SKIN_LEGACY_HEIGHT } from '../../lib/skin-layout.js';
import { importSkinFromUrl } from '../../lib/skin-url-import.js';
import type { SkinEntryT, MineSkinEntryT } from '../../../../shared/ipc/launcher.js';
import { ErrorBanner } from '../ErrorBanner';
import { Skin3DPreview } from './skin-3d-preview.js';

interface SkinTabProps {
  /** 实例 id —— 皮肤落到它的 gameDir。 */
  instanceId: string;
  /** 默认玩家名（实例的 username）。 */
  playerName: string;
}

/**
 * 来源标签。用 `SkinEntryT['source']` 而不是 `string` 做键 ——
 * 新增来源时这里会编译报错，不会悄悄掉到 `?? e.source` 显示个英文枚举值。
 */
const SOURCE_LABEL: Record<SkinEntryT['source'], string> = {
  file: '本地文件',
  url: 'URL 导入',
  mineskin: 'MineSkin',
};

/**
 * 读库里 PNG 的 data URL。
 *
 * 用 data URL 而不是 `file://`：skinview3d 的 `loadSkin` 接受任何 URL，
 * 而 `file://` 在 Electron 渲染进程的 CSP 下会被拦 —— 本项目
 * `renderer/index.html` 的 `img-src` 没放开 file:。
 */
function useSkinDataUrl(entry: SkinEntryT | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!entry) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await ipcClient.launcherSkinReadPng({ id: entry.id });
        if (!cancelled) setUrl(res.dataUrl ?? null);
      } catch {
        if (!cancelled) setUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);
  return url;
}

export function SkinTab({ instanceId, playerName }: SkinTabProps): JSX.Element {
  const [entries, setEntries] = useState<SkinEntryT[]>([]);
  /**
   * 库**是否成功读到过**。
   *
   * 为什么需要这个布尔：`entries.length === 0` 有两种完全不同的含义 ——
   * 「读到了，确实一张都没有」和「压根没读到」。不区分的话，读失败时
   * `entries` 停在初值 `[]`，于是页面同时显示红条**和**
   * 「库里还没有皮肤」，等于一边承认出错一边说「其实没有」。
   * 用户看到的是后者，就会去反复导入。
   */
  const [entriesLoaded, setEntriesLoaded] = useState(false);
  const [applied, setApplied] = useState<
    Array<{ playerName: string; path: string; sizeBytes: number }>
  >([]);
  /** 同上：「还没应用过」vs「已应用列表读不到」。 */
  const [appliedLoaded, setAppliedLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [targetPlayer, setTargetPlayer] = useState(playerName);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** MineSkin 翻页状态。 */
  const [browse, setBrowse] = useState<MineSkinEntryT[]>([]);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  /** 库 vs 公共库 两个视图。 */
  const [view, setView] = useState<'library' | 'browse'>('library');

  const selected = useMemo(
    () => entries.find((e) => e.id === selectedId) ?? null,
    [entries, selectedId],
  );
  // legacy（64×32）只有 Steve 模型：那个格式里 slim 不存在，所以下拉框要禁用。
  const selectedIsLegacy = selected !== null && selected.height === SKIN_LEGACY_HEIGHT;
  const skinUrl = useSkinDataUrl(selected);

  const refresh = useCallback(async () => {
    try {
      const res = await ipcClient.launcherSkinList();
      // ⚠️ IPC 的失败是**返回值里的 error 字段**，不是 throw。漏查它的话，
      // 「库索引读不了」会被画成「库里还没有皮肤」—— 用户以为是自己没导入，
      // 实际是启动器读不到盘。
      if (res.error) {
        setEntriesLoaded(false);
        setError(res.error);
        return;
      }
      setEntries(res.entries ?? []);
      setEntriesLoaded(true);
    } catch (e) {
      setEntriesLoaded(false);
      setError((e as Error).message);
    }
  }, []);

  const refreshApplied = useCallback(async () => {
    try {
      const res = await ipcClient.launcherSkinListApplied({ instance: instanceId });
      // 同上：读失败不能画成「还没有皮肤」。用户会以为刚应用的那张丢了，
      // 然后反复点应用。
      if (res.error) {
        setAppliedLoaded(false);
        setError(res.error);
        return;
      }
      setApplied(res.applied ?? []);
      setAppliedLoaded(true);
    } catch (e) {
      setAppliedLoaded(false);
      setError((e as Error).message);
    }
  }, [instanceId]);

  useEffect(() => {
    void refresh();
    void refreshApplied();
  }, [refresh, refreshApplied]);

  /** 翻一页公共库。 */
  const loadBrowse = useCallback(async (page: number) => {
    setBrowseLoading(true);
    setError(null);
    try {
      const res = await ipcClient.launcherSkinMineskinPage({ page });
      // 同样别把失败画成「公共库没有内容」—— 那会把网络问题说成内容问题。
      if (res.error) {
        setError(res.error);
        setBrowse([]);
        return;
      }
      setBrowse(res.entries ?? []);
      setBrowsePage(res.page);
      setBrowseHasMore(res.hasMore);
    } catch (e) {
      setError((e as Error).message);
      setBrowse([]);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'browse') void loadBrowse(1);
  }, [view, loadBrowse]);

  /**
   * 从本地文件导入。
   *
   * 一次支持多选 —— 换皮肤时常常是一堆图一起换，逐个弹框太烦。
   * 每张单独 add：一张坏图不该让其余的也失败。
   */
  const importFromFile = async (): Promise<void> => {
    setError(null);
    try {
      const r = await ipcClient.launcherPickFiles({
        title: '选择皮肤 PNG（可多选）',
        filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        properties: ['openFile', 'multiSelections'],
      });
      if (r.error) {
        setError(r.error);
        return;
      }
      if (r.paths.length === 0) return;
      const added: SkinEntryT[] = [];
      const failures: string[] = [];
      for (const path of r.paths) {
        const res = await ipcClient.launcherSkinAddLocal({ path });
        if (res.error || !res.entry) failures.push(res.error ?? '未知错误');
        else added.push(res.entry);
      }
      setNotice(
        failures.length === 0
          ? `已导入 ${added.length} 张`
          : `已导入 ${added.length} 张，${failures.length} 张失败：${failures[0]}`,
      );
      await refresh();
      // 选中第一张新导入的（用返回的 entry，不从刷新后的列表里反查 ——
      // origin 未必等于用户选的那个路径）。
      if (added[0]) setSelectedId(added[0].id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  /**
   * 从 URL 导入。
   *
   * 为什么收 URL 而不是走「账户列表」：账户通道（`mcAccount:list`）在
   * preload 里没有接线（那是既有的独立缺口）。URL 方案对「我已经从
   * 官网/profile 拿到了 texture 链接」的用户更直接，且不依赖整条
   * 账户管线。Mojang 的 texture 直链长这样：
   * `https://textures.minecraft.net/texture/<sha1>`。
   *
   * ⚠️ 链接先过 `importSkinFromUrl`（规范化 + 转 PNG），别直接发 IPC：
   * 用户手头最多的是 MC百科 的链接，而它站上图是 WebP、且常带 `@宽x高`
   * 缩放后缀 —— 不经这一步，每一条都会报「不是有效的皮肤 PNG」。
   */
  const importFromUrl = async (): Promise<void> => {
    setError(null);
    const raw = window.prompt(
      '输入皮肤图片的 URL（直接图链；例如 https://i.mcmod.cn/…/xxx.png，' +
        '或 https://textures.minecraft.net/texture/…）',
    );
    if (!raw) return;
    const r = await importSkinFromUrl(raw, {
      addByUrl: (req) => ipcClient.launcherSkinAddUrl(req),
    });
    if (!r.ok) {
      setError(r.error ?? '导入失败');
      return;
    }
    setNotice('已从链接导入');
    await refresh();
    if (r.entryId) setSelectedId(r.entryId);
  };

  const importFromMineskin = async (e: MineSkinEntryT): Promise<void> => {
    setError(null);
    try {
      const res = await ipcClient.launcherSkinAddMineskin({ mineskinId: e.id });
      if (res.error) {
        setError(res.error);
        return;
      }
      setNotice(`已导入「${res.entry?.name ?? ''}」`);
      await refresh();
      if (res.entry) {
        setSelectedId(res.entry.id);
        setView('library');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const apply = async (skinId: string): Promise<void> => {
    setError(null);
    try {
      const res = await ipcClient.launcherSkinApply({
        skinId,
        instance: instanceId,
        playerName: targetPlayer,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      // note 说的是第二条路（覆盖默认皮肤贴图的资源包）的结果 —— 它**不是**
      // 「应用失败」：CSL 那条路已经落盘了。所以两句话都要说，别合并成一句
      // 让人以为「装了 CustomSkinLoader 才行」。
      setNotice(
        [
          `已应用到玩家「${targetPlayer}」（CustomSkinLoader 的 LocalSkin）`,
          ...(res.note ? [res.note] : []),
        ].join('；'),
      );
      await refreshApplied();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const unapply = async (name: string): Promise<void> => {
    setError(null);
    try {
      const res = await ipcClient.launcherSkinUnapply({ instance: instanceId, playerName: name });
      if (res.error) {
        setError(res.error);
        return;
      }
      setNotice([`已取消玩家「${name}」的皮肤`, ...(res.note ? [res.note] : [])].join('；'));
      await refreshApplied();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: string): Promise<void> => {
    setError(null);
    try {
      const res = await ipcClient.launcherSkinRemove({ id });
      if (res.error) {
        setError(res.error);
        return;
      }
      if (selectedId === id) setSelectedId(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // 玩家名不合法时禁用「应用」—— 主进程会再拦一次，这里是即时反馈
  const playerNameOk =
    targetPlayer.trim().length > 0 && !/[/\\]/.test(targetPlayer) && !targetPlayer.includes('..');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 视图切换 + 导入入口 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <div className="flex gap-0.5">
          <button
            onClick={() => setView('library')}
            className={`px-2 py-1 text-[11px] ${view === 'library' ? 'text-mc-teal border-b-2 border-mc-teal' : 'text-mc-dim hover:text-mc-text'}`}
          >
            我的皮肤（{entries.length}）
          </button>
          <button
            onClick={() => setView('browse')}
            className={`px-2 py-1 text-[11px] ${view === 'browse' ? 'text-mc-teal border-b-2 border-mc-teal' : 'text-mc-dim hover:text-mc-text'}`}
          >
            公共库
          </button>
        </div>
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => void importFromFile()}
            className="mc-btn-ghost"
            title="从本地 PNG 导入"
          >
            <Upload className="mr-1 h-3 w-3" />
            文件
          </button>
          <button onClick={() => void importFromUrl()} className="mc-btn-ghost" title="从 URL 导入">
            <Upload className="mr-1 h-3 w-3" />
            URL
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}
      {notice && (
        <div className="border-b border-mc-border px-3 py-1 text-[11px] text-mc-teal">{notice}</div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* 左：列表 */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-mc-border">
          {view === 'library' ? (
            entries.length === 0 ? (
              <div className="px-3 py-4 text-[11px] text-mc-dim">
                {entriesLoaded
                  ? '库里还没有皮肤。用上面的「文件 / URL」导入，或去「公共库」挑一个。'
                  : // 还没成功读到过 —— 别撒谎说「没有」，上面已经有错误条了
                    '正在读取皮肤库…'}
              </div>
            ) : (
              <ul>
                {entries.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedId(e.id)}
                      className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] ${
                        selectedId === e.id
                          ? 'bg-mc-surface-2 text-mc-teal'
                          : 'hover:bg-mc-surface-1'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{e.name}</span>
                      <span className="shrink-0 text-[10px] text-mc-dim">
                        {SOURCE_LABEL[e.source] ?? e.source}
                      </span>
                      {e.model === 'slim' && (
                        <span className="shrink-0 text-[10px] text-mc-dim">Slim</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : browse.length === 0 ? (
            <div className="px-3 py-4 text-[11px] text-mc-dim">
              {browseLoading ? '加载中…' : '公共库没有内容（或网络不通）。'}
            </div>
          ) : (
            <ul>
              {browse.map((e) => (
                <li key={e.id} className="flex items-center gap-1 px-2 py-1">
                  <span className="min-w-0 flex-1 truncate text-[11px]">#{e.id}</span>
                  <button
                    onClick={() => void importFromMineskin(e)}
                    className="mc-btn-ghost shrink-0"
                    title={`导入 MineSkin #${e.id}`}
                  >
                    <Upload className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 右：预览 + 操作 */}
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {view === 'browse' ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void loadBrowse(Math.max(1, browsePage - 1))}
                disabled={browseLoading || browsePage <= 1}
                className="mc-btn-ghost"
              >
                上一页
              </button>
              <span className="text-[11px] text-mc-dim">第 {browsePage} 页</span>
              <button
                onClick={() => void loadBrowse(browsePage + 1)}
                disabled={browseLoading || !browseHasMore}
                className="mc-btn-ghost"
              >
                下一页
              </button>
              <span className="ml-auto text-[10px] text-mc-dim">
                公共库只有编号，没有名字 —— 导入后可在「我的皮肤」里改名。
              </span>
            </div>
          ) : selected ? (
            <>
              <div className="flex items-start gap-3">
                {skinUrl && (
                  <img
                    src={skinUrl}
                    alt={`${selected.name} 皮肤`}
                    className="h-32 w-32 shrink-0 rounded border border-mc-border"
                    style={{ imageRendering: 'pixelated' as const }}
                  />
                )}
                <Skin3DPreview
                  url={skinUrl}
                  width={200}
                  height={260}
                  model={selected.model as ModelType}
                />
                <div className="min-w-0 flex-1 text-[11px]">
                  <div className="truncate text-sm">{selected.name}</div>
                  <div className="mt-1 text-mc-dim">
                    {SOURCE_LABEL[selected.source] ?? selected.source} · {selected.width}×
                    {selected.height} · {selected.model === 'slim' ? 'Slim' : 'Classic'}
                  </div>
                  {selected.origin && (
                    <div className="mt-1 truncate text-[10px] text-mc-dim" title={selected.origin}>
                      来源：{selected.origin}
                    </div>
                  )}
                </div>
              </div>

              {/* 模型切换（PNG 判不出来，只影响展示与实际渲染） */}
              <div className="mt-3 flex items-center gap-2 text-[11px]">
                <span className="text-mc-dim">模型</span>
                <select
                  value={selected.model}
                  disabled={selectedIsLegacy}
                  onChange={(e) => {
                    const id = selected.id;
                    const model = e.target.value as 'classic' | 'slim';
                    void ipcClient
                      .launcherSkinUpdate({ id, model })
                      .then(async (res) => {
                        // ⚠️ 顺序要紧：refresh() 会重置 error 状态，先报错
                        // 再刷新等于自己把错误擦掉。必须刷新**之后**再报。
                        await refresh();
                        // 失败要说话：下拉框已经变了，不报错等于骗用户
                        // 「改好了」（刷新后它还会弹回去，更让人困惑）。
                        if (res.error) setError(res.error);
                      })
                      .catch((err: Error) => setError(err.message));
                  }}
                  className="mc-select"
                  aria-label="皮肤模型"
                >
                  <option value="classic">Classic（Steve，4px 手臂）</option>
                  <option value="slim">Slim（Alex，3px 手臂）</option>
                </select>
                {selectedIsLegacy && (
                  <span className="text-mc-dim">
                    64×32 旧格式只有 Steve 模型，游戏会把右肢镜像到左边
                  </span>
                )}
              </div>

              {/* 应用 */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px]">
                  <span className="text-mc-dim">玩家名</span>
                  <input
                    value={targetPlayer}
                    onChange={(e) => setTargetPlayer(e.target.value)}
                    className="mc-input w-32"
                    aria-label="玩家名"
                  />
                </label>
                <button
                  onClick={() => void apply(selected.id)}
                  disabled={!playerNameOk}
                  className="mc-btn"
                  title={
                    playerNameOk ? '复制到 LocalSkin/skins/<玩家名>.png' : '玩家名不能含 / \\ 或 ..'
                  }
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  应用
                </button>
                <button
                  onClick={() => void remove(selected.id)}
                  className="mc-btn-ghost"
                  title="从皮肤库删除（已应用的副本不受影响）"
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  删除
                </button>
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] text-mc-dim">
              左边选一张皮肤预览
            </div>
          )}

          {/* 已应用列表 */}
          <div className="mt-auto border-t border-mc-border pt-2">
            <div className="mb-1 flex items-center gap-2 text-[11px] text-mc-dim">
              <FolderOpen className="h-3 w-3" />
              已应用到本实例的皮肤
              <button
                onClick={() => void refreshApplied()}
                className="mc-btn-ghost ml-auto"
                aria-label="刷新已应用列表"
              >
                <RefreshCw className="h-3 w-3" />
              </button>
            </div>
            {applied.length === 0 ? (
              <div className="text-[11px] text-mc-dim">
                {appliedLoaded
                  ? '还没有。应用后会写 CustomSkinLoader 的 LocalSkin，并生成一个覆盖默认皮肤的资源包（没装 mod 也能显示）。'
                  : // 读不到 ≠ 没有：说「还没有」会让用户以为刚装的皮肤丢了
                    '正在读取…'}
              </div>
            ) : (
              <ul className="space-y-0.5">
                {applied.map((a) => (
                  <li key={a.playerName} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-0 flex-1 truncate">{a.playerName}</span>
                    <span className="shrink-0 text-[10px] text-mc-dim">
                      {(a.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                    <button
                      onClick={() => void unapply(a.playerName)}
                      className="mc-btn-ghost shrink-0"
                      aria-label={`取消 ${a.playerName}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
