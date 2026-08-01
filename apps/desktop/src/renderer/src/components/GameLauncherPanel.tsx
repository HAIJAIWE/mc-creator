import { useState, useEffect } from 'react';
import { Download, Play, Square, RefreshCw, Gamepad2, Loader2 } from 'lucide-react';
import { ipcClient } from '../lib/ipc-client.js';

interface VersionEntry {
  id: string;
  type: string;
  releaseTime: string;
}

/**
 * 游戏启动器面板：
 * 选择 MC 版本 → 下载客户端 jar + 资源 + 库 → 离线启动游戏。
 * 数据目录: userData/mc-launcher/
 */
export function GameLauncherPanel() {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [selected, setSelected] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [username, setUsername] = useState('Steve');
  const [memory, setMemory] = useState('2G');
  const [launching, setLaunching] = useState(false);
  const [runningPid, setRunningPid] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadVersions = async () => {
    setLoadingVersions(true);
    setError(null);
    try {
      const res = await ipcClient.launcherListVersions();
      if (res.error) {
        setError(res.error);
      } else {
        setVersions(res.versions);
        if (!selected && res.versions.length > 0) {
          setSelected(res.versions[0].id);
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingVersions(false);
    }
  };

  useEffect(() => {
    loadVersions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDownload = async () => {
    if (!selected) return;
    setDownloading(true);
    setDownloadStatus('正在解析版本…');
    setError(null);
    try {
      const res = await ipcClient.launcherDownload({ version: selected });
      if (!res.ok) {
        setError(res.error ?? '下载失败');
      } else {
        setDownloadStatus('下载完成');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const handleLaunch = async () => {
    if (!selected) return;
    setLaunching(true);
    setError(null);
    try {
      const res = await ipcClient.launcherLaunch({
        version: selected,
        username,
        memory,
      });
      if (res.error) {
        setError(res.error);
      } else if (res.pid > 0) {
        setRunningPid(res.pid);
        setDownloadStatus(`游戏已启动（PID ${res.pid}）`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-mc-surface">
      <div className="mc-section-title flex items-center gap-2 border-b border-mc-border">
        <Gamepad2 className="h-4 w-4" /> 游戏启动器
        <span className="ml-auto text-[10px] text-mc-mute">离线模式 · userData/mc-launcher</span>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {/* 版本选择 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-mc-text">选择版本</span>
            <button
              onClick={loadVersions}
              disabled={loadingVersions}
              className="flex items-center gap-1 rounded-mc bg-mc-surface-3 px-2 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
              title="刷新版本清单"
            >
              <RefreshCw className={`h-3 w-3 ${loadingVersions ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="mc-select w-full"
            aria-label="MC 版本"
          >
            {versions.length === 0 && <option value="">（加载中…）</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}
              </option>
            ))}
          </select>
          {versions.length > 0 && (
            <div className="mt-1 text-[10px] text-mc-mute">
              共 {versions.length} 个正式版 · 最新 {versions[0]?.id}
            </div>
          )}
        </div>

        {/* 启动配置 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <span className="mb-2 block text-xs font-medium text-mc-text">启动配置</span>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="w-16 text-[11px] text-mc-dim">用户名</label>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mc-input flex-1"
                placeholder="离线用户名"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="w-16 text-[11px] text-mc-dim">内存</label>
              <input
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                className="mc-input flex-1"
                placeholder="如 2G / 4G"
              />
            </div>
          </div>
        </div>

        {/* 状态与错误 */}
        {downloadStatus && (
          <div className="rounded-mc border border-mc-accent/30 bg-mc-accent/10 px-3 py-2 text-[11px] text-mc-accent">
            {downloadStatus}
          </div>
        )}
        {error && (
          <div className="rounded-mc border border-mc-redstone/30 bg-mc-redstone/10 px-3 py-2 text-[11px] text-mc-redstone">
            {error}
          </div>
        )}

        {/* 操作 */}
        <div className="flex gap-2">
          <button
            onClick={handleDownload}
            disabled={!selected || downloading}
            className="mc-btn-primary flex-1"
          >
            {downloading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3" />
            )}
            {downloading ? '下载中…' : '下载客户端'}
          </button>
          <button
            onClick={handleLaunch}
            disabled={!selected || launching || runningPid !== null}
            className="mc-btn-primary flex-1"
          >
            {launching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : runningPid !== null ? (
              <Square className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {runningPid !== null ? `运行中 (${runningPid})` : launching ? '启动中…' : '启动游戏'}
          </button>
        </div>

        {/* 说明 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2/60 p-3 text-[11px] leading-relaxed text-mc-mute">
          <div className="mb-1 text-xs font-medium text-mc-text">使用说明</div>
          <ul className="list-inside list-disc space-y-0.5">
            <li>下载：获取 Mojang 官方客户端 jar、资源文件与运行库</li>
            <li>启动：离线模式（无需正版账号），UUID 随机生成</li>
            <li>首次启动较慢：需下载约 200MB 资源与库文件</li>
            <li>游戏存档目录：userData/mc-launcher/game/&lt;版本&gt;/</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
