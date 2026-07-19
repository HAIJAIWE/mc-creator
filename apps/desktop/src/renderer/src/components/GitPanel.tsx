import { useEffect, useState, useCallback } from 'react';
import { GitBranch, Plus, RefreshCw, ChevronDown, ChevronRight, FileCode } from 'lucide-react';
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

interface Branch {
  name: string;
  current: boolean;
}

export function GitPanel() {
  const [repoPath, setRepoPath] = useState<string>(() => localStorage.getItem(REPO_KEY) ?? '');
  const [status, setStatus] = useState<GitStatusRes | null>(null);
  const [log, setLog] = useState<GitLogRes | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [showBranches, setShowBranches] = useState(false);
  const [diffPath, setDiffPath] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState('');
  const [newBranchName, setNewBranchName] = useState('');

  const refresh = useCallback(async (path: string) => {
    if (!path) {
      setStatus(null);
      setLog(null);
      setBranches([]);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const [s, l, b] = await Promise.all([
        ipcClient.gitStatus(path),
        ipcClient.gitLog(path, 20),
        ipcClient.gitBranchList(path),
      ]);
      if (!s.ok) {
        setError(s.error || '读取仓库状态失败');
        setStatus(null);
      } else {
        setStatus(s);
      }
      setLog(l.ok ? l : null);
      setBranches(b.ok ? b.branches : []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

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
      const res =
        kind === 'pull' ? await ipcClient.gitPull(repoPath) : await ipcClient.gitPush(repoPath);
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

  const doBranchCreate = async (name: string) => {
    if (!repoPath || busy || !name.trim()) return;
    // Git 分支名校验：不允许空格开头和特殊字符
    if (!/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/.test(name.trim())) {
      setError('分支名只能包含字母、数字、/、-、_、.，且不能以特殊字符开头');
      return;
    }
    setBusy(true);
    try {
      const res = await ipcClient.gitBranchCreate(repoPath, name.trim());
      if (!res.ok) setError(res.error || '创建分支失败');
      else {
        setNewBranchName('');
        await refresh(repoPath);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doBranchSwitch = async (name: string) => {
    if (!repoPath || busy) return;
    setBusy(true);
    try {
      const res = await ipcClient.gitBranchSwitch(repoPath, name);
      if (!res.ok) setError(res.error || '切换分支失败');
      else await refresh(repoPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doAdd = async (paths: string[]) => {
    if (!repoPath || busy) return;
    setBusy(true);
    try {
      const res = await ipcClient.gitAdd(repoPath, paths);
      if (!res.ok) setError(res.error || '暂存失败');
      else await refresh(repoPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async (paths: string[]) => {
    if (!repoPath || busy) return;
    setBusy(true);
    try {
      const res = await ipcClient.gitReset(repoPath, paths);
      if (!res.ok) setError(res.error || '取消暂存失败');
      else await refresh(repoPath);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDiff = async (path: string) => {
    if (!repoPath || busy) return;
    if (diffPath === path) {
      setDiffPath(null);
      setDiffContent('');
      return;
    }
    setDiffPath(path);
    try {
      const res = await ipcClient.gitDiff(repoPath, path);
      setDiffContent(res.ok ? res.diff : res.error || '无法获取差异');
    } catch (e) {
      setDiffContent((e as Error).message);
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
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {error && (
        <div className="mx-3 mt-2 rounded-mc bg-mc-surface-2 px-3 py-2 text-xs text-mc-redstone">
          {error}
        </div>
      )}
      {syncMsg && !error && (
        <div className="mx-3 mt-2 rounded-mc bg-mc-surface-2 px-3 py-2 text-xs text-mc-accent">
          {syncMsg}
        </div>
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
          {/* 分支管理（折叠面板） */}
          <div className="border-b border-mc-border">
            <button
              onClick={() => setShowBranches((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-xs text-mc-dim hover:bg-mc-surface-2"
            >
              {showBranches ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <GitBranch className="h-3 w-3 text-mc-accent" />
              <span className="flex-1 text-left">{status?.branch ?? '—'}</span>
              {status?.upstream && (
                <span className="text-mc-mute">
                  ↑{status.ahead} ↓{status.behind}
                </span>
              )}
            </button>
            {showBranches && (
              <div className="border-t border-mc-border px-3 py-2">
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-xs text-mc-mute">分支</span>
                </div>
                {/* 新建分支内联输入 */}
                <div className="flex items-center gap-1 mb-2">
                  <input
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="新分支名称"
                    className="flex-1 rounded-mc bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newBranchName.trim()) doBranchCreate(newBranchName);
                    }}
                  />
                  <button
                    onClick={() => newBranchName.trim() && doBranchCreate(newBranchName)}
                    className="mc-btn-ghost !px-1.5 !py-0.5"
                    disabled={!newBranchName.trim() || busy}
                    title="新建分支"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>
                <div className="max-h-32 overflow-y-auto">
                  {branches.map((b) => (
                    <button
                      key={b.name}
                      onClick={() => !b.current && doBranchSwitch(b.name)}
                      disabled={b.current || busy}
                      className={`flex w-full items-center gap-2 rounded-mc px-2 py-1 text-left text-xs transition-colors ${
                        b.current
                          ? 'bg-mc-surface-2 text-mc-accent font-medium'
                          : 'text-mc-dim hover:bg-mc-surface-2 hover:text-mc-text'
                      }`}
                    >
                      <GitBranch
                        className={`h-3 w-3 ${b.current ? 'text-mc-accent' : 'text-mc-mute'}`}
                      />
                      <span className="truncate">{b.name}</span>
                      {b.current && <span className="ml-auto text-[10px] text-mc-mute">当前</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 状态概要 */}
          <div className="flex items-center gap-2 px-3 py-2 text-xs">
            <span className={status?.clean ? 'text-mc-text' : 'text-mc-gold'}>
              {status?.clean ? '工作区干净' : `${status?.files.length ?? 0} 项改动`}
            </span>
            {busy && <span className="text-mc-mute">处理中…</span>}
          </div>

          {/* 改动列表（带暂存/取消暂存/查看 diff 操作） */}
          <div className="px-3">
            {status && status.files.length > 0 ? (
              <ul className="divide-y divide-mc-border">
                {status.files.map((f, i) => (
                  <li key={i} className="flex items-center gap-1 py-1 text-xs">
                    <span className={`w-20 flex-shrink-0 ${statusColor(f.x, f.y)}`}>
                      {statusText(f.x, f.y)}
                    </span>
                    <span className="flex-1 truncate font-mono text-mc-text" title={f.path}>
                      {f.path}
                    </span>
                    {/* 操作按钮 */}
                    {f.x === '?' && f.y === '?' && (
                      <button
                        onClick={() => doAdd([f.path])}
                        className="text-mc-accent hover:underline"
                        title="暂存 (git add)"
                      >
                        +暂存
                      </button>
                    )}
                    {f.x !== ' ' && f.x !== '?' && (
                      <button
                        onClick={() => doReset([f.path])}
                        className="text-mc-mute hover:underline"
                        title="取消暂存 (git reset)"
                      >
                        -取消
                      </button>
                    )}
                    {f.y === 'M' && f.x === ' ' && (
                      <button
                        onClick={() => doAdd([f.path])}
                        className="text-mc-accent hover:underline"
                        title="暂存 (git add)"
                      >
                        +暂存
                      </button>
                    )}
                    <button
                      onClick={() => doDiff(f.path)}
                      className="text-mc-mute hover:text-mc-text"
                      title="查看差异"
                    >
                      <FileCode className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="py-2 text-xs text-mc-mute">无未提交改动</div>
            )}
          </div>

          {/* Diff 展示区域 */}
          {diffPath && (
            <div className="border-t border-mc-border mx-3 mt-2">
              <div className="flex items-center gap-2 px-2 py-1">
                <FileCode className="h-3 w-3 text-mc-accent" />
                <span className="text-xs font-medium text-mc-dim">差异：{diffPath}</span>
                <button
                  onClick={() => {
                    setDiffPath(null);
                    setDiffContent('');
                  }}
                  className="ml-auto text-xs text-mc-mute hover:text-mc-text"
                >
                  关闭
                </button>
              </div>
              <pre className="max-h-48 overflow-auto bg-mc-bg rounded-mc p-2 font-mono text-[11px] leading-3 text-mc-text">
                {diffContent}
              </pre>
            </div>
          )}

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
              <button
                className="mc-btn-primary"
                onClick={doCommit}
                disabled={busy || !message.trim()}
              >
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
