/**
 * 启动器实例详情的「内容」tab（L6）。
 *
 * 归属：实例 = `game/<实例名>/` 下 mods 目录。
 * 与左侧「项目文件树」（项目产物）和 packages 面板（远端 Modrinth）都不同 ——
 * 这里只列**当前实例已装**的 Mod，见 docs/launcher-window-architecture.md §4.3.2。
 *
 * 搜索框只过滤已装内容（不是第二套 Modrinth 搜索面，§4.3.3）。
 */
import { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, Package, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client.js';
import type { ModInfo } from '../../../../shared/ipc/launcher.js';

interface ContentTabProps {
  /**
   * 实例 id（决定 mods 目录在哪）。
   *
   * ⚠️ 是**实例名**不是 MC 版本号 —— 多实例之后两者不再相等，
   * 传版本号会去读 `game/<版本号>/mods/`，那是另一个（或不存在的）实例。
   */
  instanceId: string;
}

/** 字节数 → 人类可读（与 VS Code 文件树一致：B / KB / MB / GB） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export function ContentTab({ instanceId }: ContentTabProps) {
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);

  const refresh = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      const res = await ipcClient.launcherListMods({ instance: instanceId });
      setMods(res.mods ?? []);
      setError(res.error ?? null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * 启用/禁用：乐观更新 + 失败回滚。
   * 必须同时看 `ok` —— 契约允许 `{ ok: false, error: null }`，
   * 只看 error 会让失败的乐观更新静默保留（UI 说禁用，磁盘上没改）。
   */
  const toggle = async (name: string, enabled: boolean) => {
    const prev = mods;
    setMods((cur) => cur.map((m) => (m.name === name ? { ...m, enabled } : m)));
    setError(null);
    try {
      const res = await ipcClient.launcherToggleMod({ instance: instanceId, name, enabled });
      if (!res.ok || res.error) {
        setMods(prev);
        setError(res.error || `切换 ${name} 失败`);
      }
    } catch (e) {
      setMods(prev);
      setError((e as Error).message);
    }
  };

  const remove = async (name: string) => {
    const prev = mods;
    setMods((cur) => cur.filter((m) => m.name !== name));
    setError(null);
    try {
      const res = await ipcClient.launcherRemoveMod({ instance: instanceId, name });
      // 同 toggle：只看 error 会漏掉 `{ok:false, error:null}`，
      // 那样 Mod 会从 UI 消失但磁盘上还在 —— 用户以为删掉了。
      if (!res.ok || res.error) {
        setMods(prev);
        setError(res.error || `删除 ${name} 失败`);
      }
    } catch (e) {
      setMods(prev);
      setError((e as Error).message);
    }
  };

  const install = async () => {
    const url = installUrl.trim();
    if (!url) return;
    setInstalling(true);
    setError(null);
    try {
      // 从 URL 推断文件名；拿不到就用时间戳兜底（主进程会补 .jar）
      const guessed = url.split('/').pop()?.split('?')[0] || `mod-${Date.now()}.jar`;
      const res = await ipcClient.launcherInstallMod({ instance: instanceId, name: guessed, url });
      // 同上：`{ok:false, error:null}` 时若当成成功，会清空输入框 + 刷新列表，
      // 用户连 URL 都没了，而安装根本没发生。
      if (!res.ok || res.error) setError(res.error || '安装失败');
      else {
        setInstallUrl('');
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  // 只过滤已装 —— 不是第二套 Modrinth 搜索面（§4.3.3）
  const filtered = query.trim()
    ? mods.filter((m) => m.name.toLowerCase().includes(query.trim().toLowerCase()))
    : mods;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-mc-mute" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索已装内容…"
            aria-label="搜索已装 Mod"
            className="mc-input w-full pl-7"
          />
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="mc-btn-ghost flex items-center gap-1"
          title="刷新已装 Mod"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-mc border border-mc-redstone/40 bg-mc-redstone/10 px-2 py-1 text-[11px] text-mc-redstone"
        >
          {error}
        </div>
      )}

      <div className="flex items-center gap-1.5">
        <input
          value={installUrl}
          onChange={(e) => setInstallUrl(e.target.value)}
          placeholder="粘贴 Mod 文件直链后回车安装"
          aria-label="Mod 文件直链"
          className="mc-input flex-1"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void install();
          }}
        />
        <button
          onClick={() => void install()}
          disabled={installing || !installUrl.trim()}
          className="mc-btn-primary flex items-center gap-1"
          title="从直链安装 Mod"
        >
          <Upload className="h-3 w-3" />
          安装
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-mc-mute">
          {mods.length === 0
            ? '该实例还没有安装任何 Mod。可在上方粘贴 Modrinth 文件直链安装，或到「包管理」搜索后安装到本实例。'
            : `没有匹配「${query}」的 Mod`}
        </div>
      ) : (
        <ul className="space-y-1">
          {filtered.map((m) => (
            <li
              key={m.name}
              className="flex items-center gap-2 rounded-mc bg-mc-surface px-2 py-1 text-[11px]"
            >
              <Package className="h-3 w-3 flex-shrink-0 text-mc-mute" />
              <span
                className={`min-w-0 flex-1 truncate ${m.enabled ? 'text-mc-text' : 'text-mc-mute line-through'}`}
                title={m.name}
              >
                {m.name}
              </span>
              {m.size !== undefined && (
                <span className="flex-shrink-0 tabular-nums text-[10px] text-mc-mute">
                  {formatBytes(m.size)}
                </span>
              )}
              <button
                onClick={() => void toggle(m.name, !m.enabled)}
                className={m.enabled ? 'text-mc-mute hover:text-mc-text' : 'text-mc-teal'}
                title={m.enabled ? '禁用' : '启用'}
                aria-label={m.enabled ? `禁用 ${m.name}` : `启用 ${m.name}`}
              >
                {m.enabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                onClick={() => void remove(m.name)}
                className="text-mc-mute hover:text-mc-redstone"
                title="删除"
                aria-label={`删除 ${m.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
