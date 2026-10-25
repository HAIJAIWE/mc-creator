/**
 * 启动器实例详情的「世界」tab（L9）。
 *
 * 列表来自 `game/<实例名>/saves/` 下每个存档的 `level.dat` 解析结果
 * （主进程 `listWorlds`）。目录名往往没有信息量（「新世界」「111」），
 * 所以这里显示的是**真实世界名**，见 docs/launcher-window-architecture.md §5 L9。
 *
 * 损坏的 level.dat 仍然会列出（`readable: false`）：存档还在，只是元数据读不出来 ——
 * 静默跳过会让用户以为存档丢了。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Globe2, RefreshCw } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client.js';
import type { WorldInfo } from '../../../../shared/ipc/launcher.js';

interface WorldTabProps {
  /**
   * 实例 id —— 世界在 `<gameDir>/saves/`，而 gameDir 的键是**实例名**
   * 不是 MC 版本号（多实例之后两者不再相等）。
   */
  instanceId: string;
}

/** 字节数 → 人类可读 */
function fmtSize(bytes: number | undefined): string {
  if (bytes === undefined) return '';
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

/** 最后游玩时间的 UI 投影（与面板里的 lastPlayedLabel 同口径） */
function playedLabel(ts: number | undefined): string {
  if (!ts) return '时间未知';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return '今天玩过';
  if (days === 1) return '昨天玩过';
  if (days < 30) return `${days} 天前玩过`;
  return `${Math.floor(days / 30)} 个月前玩过`;
}

export function WorldTab({ instanceId }: WorldTabProps) {
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!instanceId) return;
    setLoading(true);
    try {
      const res = await ipcClient.launcherListWorlds({ instance: instanceId });
      if (res.error) {
        setError(res.error);
        setWorlds([]);
      } else {
        setWorlds(res.worlds ?? []);
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
      setWorlds([]);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-mc-mute">saves/ 下共 {worlds.length} 个世界</span>
        <button
          onClick={() => void load()}
          disabled={loading || !instanceId}
          className="ml-auto flex items-center gap-1 rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
          title="刷新世界列表"
        >
          <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-start gap-1.5 rounded-mc border border-mc-redstone/40 bg-mc-redstone/10 px-2 py-1 text-[11px] text-mc-redstone"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!error && worlds.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center text-mc-mute">
          <Globe2 className="h-5 w-5" />
          <span>
            {loading
              ? '读取中…'
              : '该实例还没有任何存档。启动一次游戏并新建世界后，这里会列出存档与元数据。'}
          </span>
        </div>
      ) : (
        <ul className="space-y-1">
          {worlds.map((w) => (
            <li key={w.dirName} className="rounded-mc bg-mc-surface px-2 py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <Globe2 className="h-3 w-3 flex-shrink-0 text-mc-teal" />
                <span className="min-w-0 flex-1 truncate text-mc-text" title={w.levelName}>
                  {w.levelName}
                </span>
                {w.sizeBytes !== undefined && (
                  <span className="flex-shrink-0 tabular-nums text-[10px] text-mc-mute">
                    {fmtSize(w.sizeBytes)}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[10px] text-mc-mute">
                {w.gameMode && <span>{w.gameMode}</span>}
                {w.mcVersion && <span>MC {w.mcVersion}</span>}
                <span>{playedLabel(w.lastPlayed)}</span>
                {w.levelName !== w.dirName && (
                  <span className="truncate" title={`saves/${w.dirName}`}>
                    目录 {w.dirName}
                  </span>
                )}
              </div>
              {!w.readable && (
                <div className="mt-0.5 flex items-center gap-1 pl-5 text-[10px] text-mc-gold">
                  <AlertTriangle className="h-2.5 w-2.5 flex-shrink-0" />
                  level.dat 不可读，元数据缺失（存档本身仍在）
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
