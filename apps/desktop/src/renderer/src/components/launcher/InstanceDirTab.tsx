/**
 * 启动器实例详情的「实例目录」tab（L8）。
 *
 * 列表是 `game/<实例名>/` 下的条目，与工作台左栏的「项目文件树」**刻意不同**：
 *  - 视觉：项目树是树形缩进 + 文件图标；这里是扁平的「当前目录内容」+ 面包屑；
 *  - 归属：项目树属项目（生成产物），这里属实例（可运行环境）。
 * 命名用「实例目录」而非「文件」正是为了避免与项目文件树在用户心智里撞车
 * （docs/launcher-window-architecture.md §4.3.2）。
 *
 * 越界防护在主进程（`resolveInside` + `assertVersionId`），渲染层不做安全判断，
 * 只把主进程返回的 error 如实显示 —— 静默吞掉会让「路径被拒」看起来像「目录为空」。
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, File, Folder, FolderOpen, RefreshCw } from 'lucide-react';
import { ipcClient } from '../../lib/ipc-client.js';
import type { InstanceFileInfo } from '../../../../shared/ipc/launcher.js';

interface InstanceDirTabProps {
  /**
   * 实例 id（对应 `game/<实例名>/`）。
   *
   * ⚠️ 是**实例名**不是 MC 版本号 —— 多实例之后两者不再相等。
   */
  instanceId: string;
  /** 实例名，仅用于面包屑旁的标题，避免与项目文件树混淆 */
  instanceName?: string;
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

/** 相对路径拆成面包屑段：`''` → []，`'saves/world1'` → ['saves','world1'] */
function segments(relPath: string): string[] {
  return relPath ? relPath.split('/').filter(Boolean) : [];
}

export function InstanceDirTab({ instanceId, instanceName }: InstanceDirTabProps) {
  /** 导航状态带上它所属的实例 id，用于切实例时自动失效。 */
  const [nav, setNav] = useState<{ v: string; path: string }>({ v: instanceId, path: '' });
  const [entries, setEntries] = useState<InstanceFileInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const res = await ipcClient.launcherListInstanceFiles({ instance: instanceId, path });
        if (res.error) {
          setError(res.error);
          setEntries([]);
        } else {
          setEntries(res.files ?? []);
          setError(null);
        }
      } catch (e) {
        setError((e as Error).message);
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [instanceId],
  );

  /**
   * 当前目录**派生**自 `versionId`，而不是另开一个 effect 去重置。
   *
   * 若用 `useEffect(() => setCwd(''), [versionId])`，切实例时会先以
   * 「新实例 + 旧实例的路径」发一次请求（多半路径不存在，闪现错误条），
   * 重置引发的第二次渲染才发正确的第二次请求。派生写法让首次渲染就拿到正确的 cwd。
   */
  const cwd = nav.v === instanceId ? nav.path : '';
  const setCwd = useCallback((path: string) => setNav({ v: instanceId, path }), [instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    void load(cwd);
  }, [load, cwd, instanceId]);

  const crumbs = segments(cwd);

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* 面包屑：每一段都可点回溯 */}
      <nav aria-label="实例目录路径" className="flex flex-wrap items-center gap-0.5 text-[11px]">
        <button
          onClick={() => setCwd('')}
          className={crumbs.length === 0 ? 'text-mc-teal' : 'text-mc-dim hover:text-mc-text'}
          aria-current={crumbs.length === 0 ? 'page' : undefined}
        >
          <span className="inline-flex items-center gap-1">
            <FolderOpen className="h-3 w-3" />
            {instanceName ? `${instanceName} 的实例目录` : '实例目录'}
          </span>
        </button>
        {crumbs.map((seg, i) => {
          const isLast = i === crumbs.length - 1;
          const target = segments(cwd)
            .slice(0, i + 1)
            .join('/');
          return (
            <span key={`${seg}-${i}`} className="flex items-center gap-0.5">
              <ChevronRight className="h-3 w-3 text-mc-mute" aria-hidden />
              <button
                onClick={() => setCwd(target)}
                className={isLast ? 'text-mc-teal' : 'text-mc-dim hover:text-mc-text'}
                aria-current={isLast ? 'page' : undefined}
              >
                {seg}
              </button>
            </span>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <span className="text-[10px] text-mc-mute">
          game/{instanceId || '—'}/{cwd}
        </span>
        <button
          onClick={() => void load(cwd)}
          disabled={loading || !instanceId}
          className="ml-auto flex items-center gap-1 rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
          title="刷新目录"
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

      {!error && entries.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-mc-mute">
          {loading ? '读取中…' : '该目录为空'}
        </div>
      ) : (
        <ul className="space-y-0.5" role="list">
          {entries.map((e) => (
            <li key={e.path}>
              <button
                onClick={() => {
                  if (e.isDirectory) setCwd(e.path);
                }}
                disabled={!e.isDirectory}
                className="flex w-full items-center gap-2 rounded-mc px-2 py-1 text-left text-[11px] enabled:hover:bg-mc-surface-3"
                title={e.path}
              >
                {e.isDirectory ? (
                  <Folder className="h-3 w-3 flex-shrink-0 text-mc-teal" />
                ) : (
                  <File className="h-3 w-3 flex-shrink-0 text-mc-mute" />
                )}
                <span
                  className={`min-w-0 flex-1 truncate ${e.isDirectory ? 'text-mc-text' : 'text-mc-dim'}`}
                >
                  {e.name}
                </span>
                {e.isSymlink && <span className="mc-tag">链接</span>}
                {!e.isDirectory && e.size !== undefined && (
                  <span className="flex-shrink-0 tabular-nums text-[10px] text-mc-mute">
                    {fmtSize(e.size)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
