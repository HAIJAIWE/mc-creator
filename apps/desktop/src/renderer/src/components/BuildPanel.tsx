import { useRef, useState } from 'react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import type { BuildStreamChunkT, LocateMcRes } from '../../../shared/ipc-channels.js';

/** 从日志中提取 jar 路径（匹配 build/libs/*.jar） */
function extractJarPath(log: string): string | null {
  const match = log.match(/build\/libs\/[^\s"']*\.jar/);
  return match ? match[0] : null;
}

/** 逐行渲染日志：错误红色、警告黄色、其他默认 */
function renderLog(log: string) {
  return log.split('\n').map((line, i) => {
    const isError = /error:|ERROR|FAILED/i.test(line);
    const isWarn = /warning:|WARN/i.test(line);
    const color = isError ? 'text-mc-redstone' : isWarn ? 'text-mc-gold' : 'text-mc-text';
    return (
      <div key={i} className={color}>
        {line || ' '}
      </div>
    );
  });
}

export function BuildPanel() {
  const {
    files, buildLog, buildSuccess, jarPath, loading, fixLog,
    setBuildResult, setLoading, setError, error, setFixLog,
  } = useModStore();

  // P20：流式构建状态
  const [streamLog, setStreamLog] = useState('');
  const [streamBuilding, setStreamBuilding] = useState(false);
  const [streamSuccess, setStreamSuccess] = useState<boolean | null>(null);
  const [streamJarPath, setStreamJarPath] = useState<string | null>(null);
  const [buildCount, setBuildCount] = useState(0);
  const streamLogRef = useRef('');

  // 部署与运行（离线账号，无需微软 OAuth）
  const [jarAbs, setJarAbs] = useState<string | null>(null);
  const [mcInfo, setMcInfo] = useState<LocateMcRes | null>(null);
  const [mcDirOverride, setMcDirOverride] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState<string | null>(null);
  const [deployErr, setDeployErr] = useState<string | null>(null);
  const [launchMsg, setLaunchMsg] = useState<string | null>(null);

  const toAbs = (root: string, p: string | null): string | null =>
    !p ? null : p.includes(':') || p.startsWith('/') ? p : `${root}/${p}`;

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    try {
      // P22-4：先把内存中的 files 写入临时目录，再用该路径构建（避免硬编码 /tmp/mc-mod）
      const { projectPath } = await ipcClient.prepareBuildDir(files);
      const res = await ipcClient.buildWithFix(projectPath) as any;
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
      setJarAbs(toAbs(projectPath, res.jarPath));
      setFixLog(res.fixLog ?? []);
      setBuildCount((c) => c + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const buildStream = async () => {
    setStreamBuilding(true);
    setStreamSuccess(null);
    setStreamJarPath(null);
    streamLogRef.current = '';
    setStreamLog('');
    setError(null);
    setBuildCount((c) => c + 1);

    let projectPath = '';

    const onChunk = (chunk: BuildStreamChunkT) => {
      streamLogRef.current += chunk.text;
      setStreamLog(streamLogRef.current);
      if (chunk.done) {
        setStreamBuilding(false);
        const code = chunk.exitCode ?? -1;
        const ok = code === 0;
        setStreamSuccess(ok);
        if (ok) {
          const sjp = extractJarPath(streamLogRef.current);
          setStreamJarPath(sjp);
          setJarAbs(toAbs(projectPath, sjp));
        }
      }
    };

    try {
      // P22-4：先把内存中的 files 写入临时目录，再启动流式构建
      const prepared = await ipcClient.prepareBuildDir(files);
      projectPath = prepared.projectPath;
      // P22-3：await Promise 以捕获 invoke 失败
      await ipcClient.buildStream(projectPath, onChunk);
    } catch (e) {
      setStreamBuilding(false);
      setStreamSuccess(false);
      setError((e as Error).message);
    }
  };

  const clearStreamLog = () => {
    setStreamLog('');
    streamLogRef.current = '';
    setStreamSuccess(null);
    setStreamJarPath(null);
    setJarAbs(null);
    setMcInfo(null);
    setMcDirOverride(null);
    setDeployMsg(null);
    setDeployErr(null);
    setLaunchMsg(null);
  };

  const detectMc = async () => {
    setDeploying(true); setDeployErr(null); setDeployMsg(null);
    try {
      const res = await ipcClient.locateMc();
      setMcInfo(res);
      if (!res.found) setDeployErr(res.error ?? '未检测到 .minecraft');
    } finally { setDeploying(false); }
  };
  const chooseMcDir = async () => {
    const res = await ipcClient.chooseMcDir();
    if (res.path) {
      setMcDirOverride(res.path);
      setMcInfo({ found: true, mcDir: res.path, modsDir: `${res.path}/mods`, launcherExe: null, error: null });
      setDeployErr(null);
    }
  };
  const installMod = async () => {
    if (!jarAbs) return;
    setDeploying(true); setDeployErr(null); setDeployMsg(null);
    try {
      const res = await ipcClient.installMod(jarAbs, mcDirOverride ?? mcInfo?.mcDir ?? undefined);
      if (res.ok) setDeployMsg(`已安装到 ${res.modsDir}`);
      else setDeployErr(res.error ?? '安装失败');
    } catch (e) { setDeployErr((e as Error).message); } finally { setDeploying(false); }
  };
  const launchMc = async () => {
    setDeploying(true); setLaunchMsg(null); setDeployErr(null);
    try {
      const res = await ipcClient.launchMc(mcDirOverride ?? mcInfo?.mcDir ?? undefined);
      if (res.ok) setLaunchMsg('已拉起官方启动器，用离线档案进游戏即可');
      else setDeployErr(res.error ?? '启动失败');
    } catch (e) { setDeployErr((e as Error).message); } finally { setDeploying(false); }
  };

  return (
    <div className="border-t border-mc-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          onClick={build}
          disabled={loading || files.length === 0}
          className="mc-btn-primary"
        >
          {loading ? '构建中…' : '编译 .jar'}
        </button>
        <button
          onClick={buildStream}
          disabled={streamBuilding || files.length === 0}
          className="mc-btn-primary"
        >
          {streamBuilding ? '流式编译中…' : '流式编译'}
        </button>
        {(streamLog || buildLog) && (
          <button
            onClick={clearStreamLog}
            className="mc-btn-ghost"
          >
            清空日志
          </button>
        )}
        {/* 构建历史 */}
        <span className="text-xs text-mc-text-dim">构建次数：{buildCount}</span>
        {fixLog.length > 0 && (
          <span className="text-xs text-mc-text-dim">修复次数：{fixLog.length}</span>
        )}
      </div>

      {/* 一次性构建结果提示 */}
      {buildSuccess === true && <span className="text-sm text-mc-accent">编译成功！</span>}
      {buildSuccess === false && <span className="text-sm text-mc-redstone">编译失败</span>}
      {jarPath && <span className="text-xs text-mc-text-dim">产物：{jarPath}</span>}

      {/* 流式构建结果提示 */}
      {streamSuccess === true && (
        <div className="mb-2 text-sm text-mc-accent">
          构建成功！
          {streamJarPath && <span className="ml-2 text-xs text-mc-text-dim">产物：{streamJarPath}</span>}
        </div>
      )}
      {streamSuccess === false && (
        <div className="mb-2 text-sm text-mc-redstone">构建失败，请查看日志中标记为红色的错误行</div>
      )}

      {/* 部署与运行（离线账号，无需微软登录） */}
      {jarAbs && (
        <div className="mb-3 mt-2 space-y-2 border-t border-mc-border pt-2">
          <div className="text-xs font-semibold text-mc-text-dim">部署与运行（离线账号，无需微软登录）</div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={detectMc} disabled={deploying} className="mc-btn-ghost">
              {mcInfo ? '重新检测 Minecraft' : '检测 Minecraft'}
            </button>
            {mcInfo && !mcInfo.found && (
              <button onClick={chooseMcDir} disabled={deploying} className="mc-btn-ghost">手动选择 .minecraft</button>
            )}
            <button
              onClick={installMod}
              disabled={deploying || (!mcInfo?.found && !mcDirOverride)}
              className="mc-btn-primary"
            >
              安装到 mods
            </button>
            <button onClick={launchMc} disabled={deploying} className="mc-btn-primary">
              启动游戏（离线）
            </button>
          </div>
          {mcInfo?.found && (
            <div className="text-xs text-mc-text-dim">
              .minecraft：{mcDirOverride ?? mcInfo.mcDir} ｜ mods：{mcInfo.modsDir ?? '—'}
              {mcInfo.launcherExe ? ' ｜ 启动器已找到' : ' ｜ 未找到官方启动器'}
            </div>
          )}
          {deployMsg && <div className="text-xs text-mc-gold">{deployMsg}</div>}
          {launchMsg && <div className="text-xs text-mc-gold">{launchMsg}</div>}
          {deployErr && <div className="text-xs text-mc-redstone">{deployErr}</div>}
        </div>
      )}

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {fixLog.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-xs font-semibold text-mc-text-dim">修复过程</div>
          {fixLog.map((log, i) => (
            <div key={i} className="text-xs text-mc-text-dim">• {log}</div>
          ))}
        </div>
      )}
      {streamLog ? (
        <div className="mc-card max-h-40 overflow-auto p-2 text-xs font-mono">
          {renderLog(streamLog)}
        </div>
      ) : (
        buildLog && (
          <pre className="mc-card max-h-40 overflow-auto p-2 text-xs font-mono text-mc-text">{buildLog}</pre>
        )
      )}
    </div>
  );
}
