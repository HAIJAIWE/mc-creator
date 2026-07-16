import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import type { GitStatusRes, GitLogRes } from '../../../shared/ipc-channels.js';

const REPO_KEY = 'mc-creator:git-repo';

/** git status 两字母状态码 → 中文短标签 */
function statusText(x: string, y: string): string {
  if (x === '?' && y === '?') return '未跟踪';
  if (x === 'A') return '新增·已暂存';
  if (x === 'M') return '修改·已暂存';
  if (y === 'M') return '修改';
  if (x === 'D' || y === 'D') return '删除';
  if (x === 'R') return '重命名';
  if (x === 'C') return '复制';
  if (x === 'U' || y === 'U') return '冲突';
  if (x === 'T' || y === 'T') return '类型变更';
  return (x + y).replace(/\s/g, '') || '改动';
}

function statusColor(x: string, y: string): string {
  if (x === 'U' || y === 'U') return 'text-mc-redstone';
  if (x === '?' && y === '?') return 'text-mc-mute';
  if (x !== ' ' && x !== '?') return 'text-mc-gold';
  if (y === 'M' || y === 'D' || y === 'T') return 'text-mc-gold';
  return 'text-mc-text';
}

export function GitPanel() {
  const [repoPath, setRepoPath] = useState<string>(() => localStorage.getItem(REPO_KEY) ?? '');
  const [status, setStatus] = useState<GitStatusRes | null>(null);
  const [log, setLog] = useState<GitLogRes | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const refresh = async (path: string) => {
    if (!path) {
      setStatus(null);
      setLog(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([ipcClient.gitStatus(path), ipcClient.gitLog(path, 20)]);
      if (!s.ok) {
        setError(s.error || '读取仓库状态失败');
        setStatus(null);
      } else {
        setStatus(s);
      }
      setLog(l.ok ? l : null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 挂载时若已记住仓库路径则自动刷新
  useEffect(() => {
    if (repoPath) refresh(repoPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseRepo = async () => {
    setError(null);
    setSyncMsg(null);
    try {
      const res = await ipcClient.gitChooseRepo();
      if (res.path) {
        setRepoPath(res.path);
        localStorage.setItem(REPO_KEY, res.path);
        await refresh(res.path);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doCommit = async () => {
    if (!repoPath || !message.trim() || busy) return;
    setBusy(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = await ipcClient.gitCommit(repoPath, message.trim(), true);
      if (!res.ok) setError(res.error || '提交失败');
      else {
        setSyncMsg(`已提交 ${res.hash?.slice(0, 8) ?? ''}`.trim());
        setMessage('');
        await refresh(repoPath);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doSync = async (kind: 'pull' | 'push') => {
    if (!repoPath || busy) return;
    setBusy(true);
    setError(null);
    setSyncMsg(null);
    try {
      const res = kind === 'pull' ? await ipcClient.gitPull(repoPath) : await ipcClient.gitPush(repoPath);
      if (!res.ok) setError(res.error || (kind === 'pull' ? '拉取失败' : '推送失败'));
      else {
        setSyncMsg(res.stdout.trim() || (kind === 'pull' ? '已拉取最新' : '已推送'));
        await refresh(repoPath);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="mc-section-title border-b border-mc-border flex items-center gap-2">
        <GitBranch className="h-4 w-4" /> 源代码管理
      </div>

      {/* 仓库路径 + 选择 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="folder" size={14} className="text-mc-mute flex-shrink-0" />
        <span className="flex-1 truncate text-xs text-mc-dim" title={repoPath}>
          {repoPath || '未选择仓库'}
        </span>
        <button className="mc-btn-ghost" onClick={chooseRepo} disabled={busy}>
          <McIcon scope="pixel" name="search" size={14} /> 选择仓库
        </button>
        {repoPath && (
          <button className="mc-btn-ghost" onClick={() => refresh(repoPath)} disabled={busy}>
            <McIcon scope="pixel" name="reload" size={14} /> 刷新
          </button>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded-mc bg-mc-surface-2 px-3 py-2 text-xs text-mc-redstone">{error}</div>
      )}
      {syncMsg && !error && (
        <div className="mx-3 mt-2 rounded-mc bg-mc-surface-2 px-3 py-2 text-xs text-mc-green">{syncMsg}</div>
      )}

      {!repoPath ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-mc-dim">
          <div className="flex h-14 w-14 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
            <GitBranch className="h-7 w-7 text-mc-mute" />
          </div>
          选择一个 git 仓库目录以查看状态、提交与同步
        </div>
      ) : (
        <div className="flex flex-1 flex-col overflow-auto">
          {/* 状态概要 */}
          <div className="flex items-center gap-2 px-3 py-2 text-xs">
            <span className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-mc-text">{status?.branch ?? '—'}</span>
            {status?.upstream && <span className="text-mc-mute">↑{status.ahead} ↓{status.behind}</span>}
            <span className={status?.clean ? 'text-mc-text' : 'text-mc-gold'}>
              {status?.clean ? '工作区干净' : `${status?.files.length ?? 0} 项改动`}
            </span>
            {busy && <span className="text-mc-mute">处理中…</span>}
          </div>

          {/* 改动列表 */}
          <div className="px-3">
            {status && status.files.length > 0 ? (
              <ul className="divide-y divide-mc-border">
                {status.files.map((f, i) => (
                  <li key={i} className="flex items-center gap-2 py-1 text-xs">
                    <span className={`w-20 flex-shrink-0 ${statusColor(f.x, f.y)}`}>{statusText(f.x, f.y)}</span>
                    <span className="flex-1 truncate font-mono text-mc-text" title={f.path}>
                      {f.path}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-2 text-xs text-mc-mute">无未提交改动</div>
            )}
          </div>

          {/* 提交框 */}
          <div className="mt-2 border-t border-mc-border px-3 py-2">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="提交说明…"
              rows={2}
              className="w-full resize-none rounded-mc bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none"
            />
            <div className="mt-2 flex gap-2">
              <button className="mc-btn-primary" onClick={doCommit} disabled={busy || !message.trim()}>
                <McIcon scope="pixel" name="check" size={14} /> 提交
              </button>
              <button className="mc-btn-ghost" onClick={() => doSync('pull')} disabled={busy}>
                <McIcon scope="pixel" name="reload" size={14} /> 拉取
              </button>
              <button className="mc-btn-ghost" onClick={() => doSync('push')} disabled={busy}>
                <McIcon scope="pixel" name="upload" size={14} /> 推送
              </button>
            </div>
          </div>

          {/* 最近提交 */}
          <div className="mt-2 border-t border-mc-border px-3 py-2">
            <div className="mb-1 text-xs text-mc-mute">最近提交</div>
            {log && log.commits.length > 0 ? (
              <ul className="space-y-1">
                {log.commits.map((c) => (
                  <li key={c.hash} className="flex items-baseline gap-2 text-xs">
                    <span className="font-mono text-mc-gold">{c.shortHash}</span>
                    <span className="flex-1 truncate text-mc-text" title={c.message}>
                      {c.message}
                    </span>
                    <span className="text-mc-mute">
                      {c.author} · {c.date}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-mc-mute">暂无提交记录</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
