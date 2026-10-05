import { useEffect, useState } from 'react';
import { History, Trash2, RotateCcw, Save } from 'lucide-react';
import {
  loadHistory,
  commitVersion,
  deleteVersion,
  clearHistory,
  type SkinVersion,
  type HistoryScope,
} from './skin-history';

interface SkinHistoryPanelProps {
  playerName: string;
  getCurrentDataUrl: () => string | null;
  onRestore: (dataUrl: string) => void;
  /** v2.0：skin 与 cape 共用面板，存储相互隔离 */
  scope?: HistoryScope;
  title?: string;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const h = `${d.getHours()}`.padStart(2, '0');
  const min = `${d.getMinutes()}`.padStart(2, '0');
  return `${m}-${day} ${h}:${min}`;
}

export function SkinHistoryPanel({
  playerName,
  getCurrentDataUrl,
  onRestore,
  scope = 'skin',
  title = '版本历史',
}: SkinHistoryPanelProps) {
  const [versions, setVersions] = useState<SkinVersion[]>(() => loadHistory(playerName, scope));
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setVersions(loadHistory(playerName, scope));
    setMessage('');
  }, [playerName, scope]);

  const handleCommit = () => {
    const url = getCurrentDataUrl();
    if (!url) return;
    const item = commitVersion(playerName, url, message, scope);
    setVersions((prev) => [item, ...prev].slice(0, 20));
    setMessage('');
  };

  const handleRestore = (v: SkinVersion) => {
    onRestore(v.dataUrl);
  };

  const handleDelete = (id: string) => {
    setVersions(deleteVersion(playerName, id, scope));
  };

  const handleClear = () => {
    clearHistory(playerName, scope);
    setVersions([]);
  };

  return (
    <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="mb-2 flex w-full items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-mc-dim"
      >
        <History className="h-3 w-3" /> {title} ({versions.length}/20)
      </button>
      {open && (
        <>
          <div className="mb-2 flex items-center gap-1.5">
            <input
              type="text"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCommit();
              }}
              placeholder="版本说明（回车提交）…"
              className="min-w-0 flex-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text placeholder:text-mc-mute"
            />
            <button
              onClick={handleCommit}
              className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-text hover:border-mc-accent"
              title="提交当前纹理为新版本"
            >
              <Save className="h-3 w-3" /> 提交
            </button>
          </div>
          {versions.length === 0 ? (
            <div className="py-2 text-center text-[11px] text-mc-mute">
              暂无版本。画完关键阶段点「提交」，随时可回滚。
            </div>
          ) : (
            <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
              {versions.map((v, i) => (
                <div
                  key={v.id}
                  className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1.5"
                >
                  <img
                    src={v.dataUrl}
                    alt={v.message}
                    className="h-8 w-8 shrink-0 rounded-sm border border-mc-border"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] text-mc-text" title={v.message}>
                      {i === 0 ? '● ' : ''}
                      {v.message}
                    </div>
                    <div className="text-[10px] text-mc-mute">{formatTime(v.createdAt)}</div>
                  </div>
                  <button
                    onClick={() => handleRestore(v)}
                    className="rounded-mc border border-mc-border bg-mc-surface-2 p-1 text-mc-dim hover:text-mc-text"
                    title="恢复到此版本（编辑器将重载纹理）"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => handleDelete(v.id)}
                    className="rounded-mc border border-mc-border bg-mc-surface-2 p-1 text-mc-dim hover:text-red-400"
                    title="删除此版本"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {versions.length > 0 && (
            <button
              onClick={handleClear}
              className="mt-2 w-full rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-1 text-[11px] text-mc-dim hover:text-red-400"
            >
              清空全部版本
            </button>
          )}
        </>
      )}
    </div>
  );
}
