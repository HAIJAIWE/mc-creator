import { useState, useEffect, useCallback } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import { useModStore } from '../store/mod-store.js';
import type { Loader } from '@mc-creator/shared';
import {
  Play,
  FolderOpen,
  Search,
  Download,
  Loader2,
  CheckCircle2,
  XCircle,
  Settings2,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

type McStatus = 'idle' | 'locating' | 'found' | 'not_found' | 'launching' | 'running' | 'error';

/** MC 常用版本列表 */
const MC_VERSIONS = [
  { version: '1.21.4', label: '1.21.4 (最新)', stable: true },
  { version: '1.21.1', label: '1.21.1', stable: true },
  { version: '1.20.6', label: '1.20.6', stable: true },
  { version: '1.20.4', label: '1.20.4', stable: true },
  { version: '1.20.1', label: '1.20.1 (LTS)', stable: true },
  { version: '1.19.4', label: '1.19.4', stable: true },
] as const;

/** Mod 加载器版本信息 */
const LOADER_VERSIONS: Record<string, { loader: string; version: string }> = {
  fabric: { loader: 'Fabric Loader', version: '0.16.14' },
  neoforge: { loader: 'NeoForge', version: '21.4.0-beta' },
  forge: { loader: 'Forge', version: '52.0.20' },
  quilt: { loader: 'Quilt Loader', version: '0.27.0' },
};

/** 快速启动配置预设 */
const LAUNCH_PROFILES = [
  {
    key: 'vanilla',
    label: 'Vanilla',
    icon: '⛏️',
    loader: null as string | null,
    color: 'text-green-400',
  },
  { key: 'fabric', label: 'Fabric', icon: '🧵', loader: 'fabric', color: 'text-purple-400' },
  { key: 'neoforge', label: 'NeoForge', icon: '🔥', loader: 'neoforge', color: 'text-orange-400' },
] as const;

/**
 * MC 启动器面板：定位 MC 安装 → 安装 Mod → 启动测试。
 * 离线模式，支持官方启动器 / PCL2 / HMCL。
 */
export function McLauncherPanel() {
  const [status, setStatus] = useState<McStatus>('idle');
  const [mcDir, setMcDir] = useState<string | null>(null);
  const [modsDir, setModsDir] = useState<string | null>(null);
  const [launcher, setLauncher] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installMsg, setInstallMsg] = useState<string | null>(null);

  // 新增：MC 版本选择
  const [selectedVersion, setSelectedVersion] = useState('1.21.4');
  const [showVersionDropdown, setShowVersionDropdown] = useState(false);

  // 新增：JVM 启动参数
  const [jvmArgs, setJvmArgs] = useState('-Xmx2G -Xms1G');
  const [showJvmEditor, setShowJvmEditor] = useState(false);

  // 新增：快速配置选择
  const [activeProfile, setActiveProfile] = useState<string | null>(null);

  const jarPath = useModStore((s) => {
    // 找到第一个 .jar 文件
    const jar = s.files.find((f) => f.path.endsWith('.jar'));
    return jar ? jar.path : null;
  });

  const loader = useModStore((s) => s.loader);
  const setLoader = useModStore((s) => s.setLoader);

  const locateMc = useCallback(async () => {
    setStatus('locating');
    setErrorMsg(null);
    try {
      const res = await ipcClient.locateMc();
      if (res.found && res.mcDir) {
        setMcDir(res.mcDir);
        setModsDir(res.modsDir);
        setLauncher(res.launcher);
        setStatus('found');
      } else {
        setStatus('not_found');
        setErrorMsg(res.error ?? '未找到 Minecraft 安装');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  }, []);

  // 自动定位 MC（首次挂载时）
  const [located, setLocated] = useState(false);
  useEffect(() => {
    if (!located) {
      locateMc();
      setLocated(true);
    }
  }, [locateMc, located]);

  const chooseDir = useCallback(async () => {
    const res = await ipcClient.chooseMcDir();
    if (res.path) {
      setMcDir(res.path);
      setModsDir(res.path + '/mods');
      setStatus('found');
      setErrorMsg(null);
    }
  }, []);

  const installMod = useCallback(async () => {
    if (!jarPath) return;
    setInstalling(true);
    setInstallMsg(null);
    try {
      const res = await ipcClient.installMod(jarPath, mcDir ?? undefined);
      if (res.ok) {
        setModsDir(res.modsDir);
        setInstallMsg(`已安装到 ${res.modsDir ?? 'mods 目录'}`);
      } else {
        setInstallMsg(res.error ?? '安装失败');
      }
    } catch (err) {
      setInstallMsg((err as Error).message);
    } finally {
      setInstalling(false);
    }
  }, [jarPath, mcDir]);

  const launchMc = useCallback(async () => {
    setStatus('launching');
    setErrorMsg(null);
    try {
      const res = await ipcClient.launchMc(mcDir ?? undefined);
      if (res.ok) {
        setStatus('running');
      } else {
        setStatus('error');
        setErrorMsg(res.error ?? '启动失败');
      }
    } catch (err) {
      setStatus('error');
      setErrorMsg((err as Error).message);
    }
  }, [mcDir]);

  const statusIcon = (() => {
    switch (status) {
      case 'locating':
        return <Loader2 className="h-4 w-4 animate-spin text-mc-accent" />;
      case 'found':
        return <CheckCircle2 className="h-4 w-4 text-green-400" />;
      case 'running':
        return <Play className="h-4 w-4 text-green-400" />;
      case 'not_found':
        return <XCircle className="h-4 w-4 text-yellow-400" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-red-400" />;
      default:
        return <Search className="h-4 w-4 text-mc-mute" />;
    }
  })();

  const statusText = (() => {
    switch (status) {
      case 'idle':
        return '准备就绪';
      case 'locating':
        return '正在定位 Minecraft…';
      case 'found':
        return `已找到 (${launcher ?? '未知启动器'})`;
      case 'running':
        return 'Minecraft 运行中';
      case 'not_found':
        return '未找到 Minecraft';
      case 'launching':
        return '正在启动…';
      case 'error':
        return '出错';
    }
  })();

  return (
    <div className="flex h-full flex-col overflow-hidden bg-mc-surface">
      {/* 面板标题 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="star" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">MC 启动器</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* 状态卡片 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-3">
          <div className="mb-2 flex items-center gap-2">
            {statusIcon}
            <span className="text-xs font-medium text-mc-text">{statusText}</span>
          </div>
          {mcDir && (
            <div className="mb-1 text-[11px] text-mc-dim" title={mcDir}>
              📁 {mcDir.length > 50 ? `…${mcDir.slice(-47)}` : mcDir}
            </div>
          )}
          {modsDir && (
            <div className="mb-1 text-[11px] text-mc-mute" title={modsDir}>
              📦 mods: {modsDir.length > 50 ? `…${modsDir.slice(-47)}` : modsDir}
            </div>
          )}
          {errorMsg && <div className="mb-1 text-[11px] text-red-400">{errorMsg}</div>}
        </div>

        {/* MC 版本选择器 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">Minecraft 版本</div>
          <div className="relative">
            <button
              onClick={() => setShowVersionDropdown(!showVersionDropdown)}
              className="flex w-full items-center justify-between rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1.5 text-xs text-mc-text transition-colors hover:bg-mc-surface-3"
            >
              <span className="font-mono">{selectedVersion}</span>
              {showVersionDropdown ? (
                <ChevronUp className="h-3 w-3 text-mc-mute" />
              ) : (
                <ChevronDown className="h-3 w-3 text-mc-mute" />
              )}
            </button>
            {showVersionDropdown && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-mc border border-mc-border bg-mc-surface py-1 shadow-lg">
                {MC_VERSIONS.map((v) => (
                  <button
                    key={v.version}
                    onClick={() => {
                      setSelectedVersion(v.version);
                      setShowVersionDropdown(false);
                    }}
                    className={`flex w-full items-center gap-2 px-2.5 py-1 text-xs transition-colors hover:bg-mc-surface-2 ${selectedVersion === v.version ? 'text-mc-accent-bright bg-mc-accent/10' : 'text-mc-text'}`}
                  >
                    <span className="font-mono">{v.version}</span>
                    {v.version === '1.21.4' && (
                      <span className="text-[9px] text-green-400">最新</span>
                    )}
                    {v.version === '1.20.1' && (
                      <span className="text-[9px] text-blue-400">LTS</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Mod Loader 版本显示 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 text-[11px] font-medium text-mc-dim">Mod 加载器</div>
          <div className="space-y-1">
            {Object.entries(LOADER_VERSIONS).map(([key, info]) => (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                <span
                  className={`w-3 h-3 rounded-full inline-block ${key === 'fabric' ? 'bg-purple-500' : key === 'neoforge' ? 'bg-orange-500' : key === 'forge' ? 'bg-blue-500' : 'bg-cyan-500'}`}
                />
                <span className="text-mc-text">{info.loader}</span>
                <span className="font-mono text-mc-mute">{info.version}</span>
                {loader === key && <span className="text-[9px] text-mc-accent">← 当前</span>}
              </div>
            ))}
          </div>
        </div>

        {/* 快速启动配置 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-mc-dim">
            <Zap className="h-3 w-3" />
            快速启动配置
          </div>
          <div className="flex gap-2">
            {LAUNCH_PROFILES.map((profile) => (
              <button
                key={profile.key}
                onClick={() => {
                  setActiveProfile(profile.key);
                  if (profile.loader) {
                    setLoader(profile.loader as Loader);
                  }
                }}
                className={`flex flex-1 flex-col items-center gap-1 rounded-mc border px-2 py-1.5 text-[11px] transition-colors ${
                  activeProfile === profile.key
                    ? 'border-mc-accent bg-mc-accent/10 text-mc-accent-bright'
                    : 'border-mc-border bg-mc-surface-2 text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                }`}
              >
                <span className="text-base">{profile.icon}</span>
                <span>{profile.label}</span>
                {profile.loader && (
                  <span className="text-[9px] text-mc-mute">
                    {LOADER_VERSIONS[profile.loader]?.version ?? ''}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* JVM 启动参数编辑器 */}
        <div className="mb-3 rounded-mc border border-mc-border bg-mc-surface-2/40 p-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowJvmEditor(!showJvmEditor)}
              className="flex items-center gap-1 text-[11px] font-medium text-mc-dim hover:text-mc-text"
            >
              <Settings2 className="h-3 w-3" />
              JVM 启动参数
              {showJvmEditor ? (
                <ChevronUp className="h-2.5 w-2.5" />
              ) : (
                <ChevronDown className="h-2.5 w-2.5" />
              )}
            </button>
            <span className="font-mono text-[10px] text-mc-mute">{jvmArgs}</span>
          </div>
          {showJvmEditor && (
            <div className="mt-2 space-y-2">
              <input
                value={jvmArgs}
                onChange={(e) => setJvmArgs(e.target.value)}
                className="w-full rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 font-mono text-[11px] text-mc-text outline-none"
                placeholder="-Xmx2G -Xms1G"
              />
              <div className="flex flex-wrap gap-1.5">
                {/* 常用 JVM 参数快捷按钮 */}
                {[
                  { label: '-Xmx1G', value: '-Xmx1G' },
                  { label: '-Xmx2G', value: '-Xmx2G' },
                  { label: '-Xmx4G', value: '-Xmx4G' },
                  { label: '-Xmx8G', value: '-Xmx8G' },
                  { label: '-Xms1G', value: '-Xms1G' },
                ].map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      // 替换或追加对应参数
                      const prefix = preset.label.split('=')[0].split('G')[0] + 'G';
                      const existing = jvmArgs
                        .split(' ')
                        .find((a) => a.startsWith(prefix.charAt(0) === '-' ? prefix : ''));
                      if (existing) {
                        setJvmArgs(jvmArgs.replace(existing, preset.value));
                      } else {
                        setJvmArgs(`${jvmArgs} ${preset.value}`.trim());
                      }
                    }}
                    className={`rounded-mc px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                      jvmArgs.includes(preset.value)
                        ? 'bg-mc-accent/20 text-mc-accent-bright'
                        : 'bg-mc-surface-2 text-mc-mute hover:text-mc-text'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="text-[9px] text-mc-mute">
                提示：-Xmx 设置最大堆内存，-Xms 设置初始堆内存。例：-Xmx4G -Xms2G
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮组 */}
        <div className="flex flex-col gap-2">
          {/* 定位 MC */}
          <button
            onClick={locateMc}
            disabled={status === 'locating'}
            className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-2 text-xs text-mc-text transition-colors hover:bg-mc-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Search className="h-3.5 w-3.5" />
            自动定位 Minecraft
          </button>

          {/* 手动选择目录 */}
          <button
            onClick={chooseDir}
            className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-2 text-xs text-mc-text transition-colors hover:bg-mc-surface-3"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            手动选择 .minecraft 目录
          </button>

          {/* 安装 Mod */}
          {jarPath && (
            <button
              onClick={installMod}
              disabled={installing || !mcDir}
              className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-3 py-2 text-xs text-mc-text transition-colors hover:bg-mc-surface-3 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              安装 Mod 到 mods 目录
            </button>
          )}
          {installMsg && <div className="text-[11px] text-mc-dim">{installMsg}</div>}

          {/* 启动 MC */}
          <button
            onClick={launchMc}
            disabled={status === 'launching' || !mcDir}
            className="flex items-center gap-2 rounded-mc bg-mc-accent px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-mc-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === 'launching' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            启动 Minecraft {selectedVersion}
          </button>

          {status === 'running' && (
            <div className="rounded-mc border border-green-800 bg-green-900/20 px-3 py-2 text-xs text-green-300">
              ✅ Minecraft 已启动！可在游戏中测试 Mod 效果。
            </div>
          )}
        </div>

        {/* 使用说明 */}
        <div className="mt-4 rounded-mc border border-mc-border bg-mc-surface-2/20 p-3">
          <div className="mb-1 text-[11px] font-medium text-mc-dim">使用说明</div>
          <ul className="list-inside list-disc space-y-1 text-[10px] text-mc-mute">
            <li>自动定位支持官方启动器 / PCL2 / HMCL</li>
            <li>离线模式，无需微软 OAuth 登录</li>
            <li>安装 Mod 会将构建产物复制到 mods 目录</li>
            <li>启动后可在游戏中实时测试 Mod 效果</li>
            <li>选择快速配置可一键设置 Vanilla / Fabric / NeoForge</li>
            <li>调整 JVM 参数以控制内存分配（建议至少 2G）</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
