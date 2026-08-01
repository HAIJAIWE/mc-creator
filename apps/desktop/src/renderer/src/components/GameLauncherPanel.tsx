import { useState, useEffect } from 'react';
import {
  Download,
  Play,
  Square,
  RefreshCw,
  Gamepad2,
  Loader2,
  Puzzle,
  Trash2,
  User,
  Wrench,
} from 'lucide-react';
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

  // 加载器 / Mod / 皮肤
  const [installingLoader, setInstallingLoader] = useState(false);
  const [mods, setMods] = useState<string[]>([]);
  const [skinInstalling, setSkinInstalling] = useState(false);
  const [skinApiUrl, setSkinApiUrl] = useState('https://littleskin.cn/api/yggdrasil');

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

  // 版本切换时刷新 Mod 列表
  useEffect(() => {
    if (selected) refreshMods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

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

  const refreshMods = async () => {
    if (!selected) return;
    const res = await ipcClient.launcherListMods(selected);
    setMods(res.mods ?? []);
  };

  const handleInstallLoader = async (loader: 'fabric' | 'neoforge') => {
    if (!selected) return;
    setInstallingLoader(true);
    setError(null);
    try {
      const res = await ipcClient.launcherInstallLoader({ version: selected, loader });
      if (!res.ok) {
        setError(res.error ?? '加载器安装失败');
      } else {
        setDownloadStatus(`${loader === 'fabric' ? 'Fabric' : 'NeoForge'} 加载器安装完成`);
        await refreshMods();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setInstallingLoader(false);
    }
  };

  const handleInstallSkin = async () => {
    if (!selected) return;
    setSkinInstalling(true);
    setError(null);
    try {
      const res = await ipcClient.launcherInstallSkin({ version: selected, skinApiUrl });
      if (!res.ok) {
        setError(res.error ?? '皮肤支持安装失败');
      } else {
        setDownloadStatus('离线皮肤支持已安装（CustomSkinLoader）');
        await refreshMods();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSkinInstalling(false);
    }
  };

  const handleRemoveMod = async (name: string) => {
    if (!selected) return;
    await ipcClient.launcherRemoveMod({ version: selected, name });
    await refreshMods();
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

        {/* 加载器安装 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-mc-text">
            <Wrench className="h-3 w-3" /> 加载器安装（Mod 支持）
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => handleInstallLoader('fabric')}
              disabled={!selected || installingLoader}
              className="mc-btn-primary flex-1"
            >
              {installingLoader && <Loader2 className="h-3 w-3 animate-spin" />} 安装 Fabric
            </button>
            <button
              onClick={() => handleInstallLoader('neoforge')}
              disabled={!selected || installingLoader}
              className="mc-btn-primary flex-1"
            >
              {installingLoader && <Loader2 className="h-3 w-3 animate-spin" />} 安装 NeoForge
            </button>
          </div>
          <p className="mt-1 text-[10px] text-mc-mute">
            安装后版本目录出现 fabric-loader-&lt;版本&gt;，用于启动 Mod。
          </p>
        </div>

        {/* Mod 管理 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <div className="mb-2 flex items-center gap-1.5">
            <Puzzle className="h-3 w-3" />
            <span className="text-xs font-medium text-mc-text">已装 Mod</span>
            <button
              onClick={refreshMods}
              className="ml-auto flex items-center gap-1 rounded-mc bg-mc-surface-3 px-1.5 py-0.5 text-[10px] text-mc-dim hover:text-mc-text"
              title="刷新 Mod 列表"
            >
              <RefreshCw className="h-2.5 w-2.5" /> 刷新
            </button>
          </div>
          {mods.length === 0 ? (
            <div className="py-3 text-center text-[11px] text-mc-mute">
              暂无 Mod（可先在「包管理」搜索 Modrinth，复制文件 URL 后在此安装）
            </div>
          ) : (
            <ul className="space-y-1">
              {mods.map((m) => (
                <li
                  key={m}
                  className="flex items-center gap-2 rounded-mc bg-mc-surface px-2 py-1 text-[11px]"
                >
                  <Puzzle className="h-3 w-3 flex-shrink-0 text-mc-mute" />
                  <span className="min-w-0 flex-1 truncate text-mc-text">{m}</span>
                  <button
                    onClick={() => handleRemoveMod(m)}
                    className="text-mc-mute hover:text-mc-redstone"
                    title="删除 Mod"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 离线皮肤 */}
        <div className="rounded-mc border border-mc-border bg-mc-surface-2 p-3">
          <span className="mb-2 flex items-center gap-1.5 text-xs font-medium text-mc-text">
            <User className="h-3 w-3" /> 离线皮肤
          </span>
          <div className="flex items-center gap-2">
            <select
              value={skinApiUrl}
              onChange={(e) => setSkinApiUrl(e.target.value)}
              className="mc-select flex-1"
              aria-label="皮肤站"
            >
              <option value="https://littleskin.cn/api/yggdrasil">LittleSkin（国内主流）</option>
              <option value="https://skin.mualliance.ltd/api/yggdrasil">MUA 皮肤站</option>
              <option value="https://littleskin.cn/api/yggdrasil">自定义（下方输入）</option>
            </select>
            <input
              value={skinApiUrl}
              onChange={(e) => setSkinApiUrl(e.target.value)}
              placeholder="Yggdrasil API URL"
              className="mc-input flex-1"
            />
          </div>
          <button
            onClick={handleInstallSkin}
            disabled={!selected || skinInstalling}
            className="mc-btn-primary mt-2 w-full"
          >
            {skinInstalling ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <User className="h-3 w-3" />
            )}
            {skinInstalling ? '安装中…' : '安装离线皮肤支持'}
          </button>
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
