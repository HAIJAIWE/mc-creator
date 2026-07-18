import { useRef, useState } from 'react';
import { shallow } from 'zustand/shallow';
import { Wrench, X, Loader2 } from 'lucide-react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import { extractJarPath, renderLog } from '../lib/build-utils.js';
import type { BuildStreamChunkT, LocateMcRes } from '../../../shared/ipc-channels.js';

/** 启动器种类 → 中文标签 */
const LAUNCHER_LABEL: Record<string, string> = {
  official: '官方启动器',
  pcl2: 'PCL2',
  hmcl: 'HMCL',
};

export function BuildPanel() {
  // P3 性能：shallow 选择器仅订阅所需字段，避免 description/spec/files 变化时重渲染
  const {
    files,
    buildLog,
    buildSuccess,
    jarPath,
    loading,
    fixLog,
    setBuildResult,
    setLoading,
    setError,
    error,
    setFixLog,
  } = useModStore(
    (s) => ({
      files: s.files,
      buildLog: s.buildLog,
      buildSuccess: s.buildSuccess,
      jarPath: s.jarPath,
      loading: s.loading,
      fixLog: s.fixLog,
      setBuildResult: s.setBuildResult,
      setLoading: s.setLoading,
      setError: s.setError,
      error: s.error,
      setFixLog: s.setFixLog,
    }),
    shallow,
  );

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

  // AI 修复建议状态
  const [showFixSuggest, setShowFixSuggest] = useState(false);
  const [fixSuggestion, setFixSuggestion] = useState('');
  const [isFixSuggesting, setIsFixSuggesting] = useState(false);
  const fixSuggestionRef = useRef('');

  const toAbs = (root: string, p: string | null): string | null =>
    !p ? null : p.includes(':') || p.startsWith('/') ? p : `${root}/${p}`;

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    setShowFixSuggest(false);
    setFixSuggestion('');
    try {
      // P22-4：先把内存中的 files 写入临时目录，再用该路径构建（避免硬编码 /tmp/mc-mod）
      const { projectPath } = await ipcClient.prepareBuildDir(files);
      const res = await ipcClient.buildWithFix(projectPath);
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

  const handleFixSuggest = () => {
    const log = streamLog || buildLog;
    if (!log) return;
    setShowFixSuggest(true);
    setFixSuggestion('');
    fixSuggestionRef.current = '';
    setIsFixSuggesting(true);

    // 只取前 5 个主要文件，内容截断到 2000 字符
    const filesPreview = files.slice(0, 5).map((f) => ({
      path: f.path,
      content: f.content.slice(0, 2000),
    }));

    ipcClient.fixSuggest(log, filesPreview, (delta: string, done: boolean) => {
      fixSuggestionRef.current += delta;
      setFixSuggestion(fixSuggestionRef.current);
      if (done) {
        setIsFixSuggesting(false);
      }
    });
  };

  const closeFixSuggest = () => {
    setShowFixSuggest(false);
    setFixSuggestion('');
    fixSuggestionRef.current = '';
    setIsFixSuggesting(false);
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
    closeFixSuggest();
  };

  const detectMc = async () => {
    setDeploying(true);
    setDeployErr(null);
    setDeployMsg(null);
    try {
      const res = await ipcClient.locateMc();
      setMcInfo(res);
      if (!res.found) setDeployErr(res.error ?? '未检测到 .minecraft');
    } finally {
      setDeploying(false);
    }
  };
  const chooseMcDir = async () => {
    const res = await ipcClient.chooseMcDir();
    if (res.path) {
      setMcDirOverride(res.path);
      setMcInfo({
        found: true,
        mcDir: res.path,
        modsDir: `${res.path}/mods`,
        launcherExe: null,
        launcher: null,
        error: null,
      });
      setDeployErr(null);
    }
  };
  const installMod = async () => {
    if (!jarAbs) return;
    setDeploying(true);
    setDeployErr(null);
    setDeployMsg(null);
    try {
      const res = await ipcClient.installMod(jarAbs, mcDirOverride ?? mcInfo?.mcDir ?? undefined);
      if (res.ok) setDeployMsg(`已安装到 ${res.modsDir}`);
      else setDeployErr(res.error ?? '安装失败');
    } catch (e) {
      setDeployErr((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };
  const launchMc = async () => {
    setDeploying(true);
    setLaunchMsg(null);
    setDeployErr(null);
    try {
      const res = await ipcClient.launchMc(mcDirOverride ?? mcInfo?.mcDir ?? undefined);
      if (res.ok)
        setLaunchMsg(
          `已拉起${res.launcher ? (LAUNCHER_LABEL[res.launcher] ?? '启动器') : '启动器'}，用离线档案进游戏即可`,
        );
      else setDeployErr(res.error ?? '启动失败');
    } catch (e) {
      setDeployErr((e as Error).message);
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div className="border-t border-mc-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={build} disabled={loading || files.length === 0} className="mc-btn-primary">
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
          <button onClick={clearStreamLog} className="mc-btn-ghost">
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
      {buildSuccess === false && (
        <span className="text-sm text-mc-redstone">
          编译失败
          {!showFixSuggest && (
            <button
              onClick={handleFixSuggest}
              disabled={isFixSuggesting}
              className="ml-2 inline-flex items-center gap-1 text-xs text-mc-gold hover:underline"
            >
              <Wrench className="h-3 w-3" />
              AI 诊断修复
            </button>
          )}
        </span>
      )}
      {jarPath && <span className="text-xs text-mc-text-dim">产物：{jarPath}</span>}

      {/* 流式构建结果提示 */}
      {streamSuccess === true && (
        <div className="mb-2 text-sm text-mc-accent">
          构建成功！
          {streamJarPath && (
            <span className="ml-2 text-xs text-mc-text-dim">产物：{streamJarPath}</span>
          )}
        </div>
      )}
      {streamSuccess === false && (
        <div className="mb-2 text-sm text-mc-redstone">
          构建失败，请查看日志中标记为红色的错误行
          {!showFixSuggest && (
            <button
              onClick={handleFixSuggest}
              disabled={isFixSuggesting}
              className="ml-2 inline-flex items-center gap-1 text-xs text-mc-gold hover:underline"
            >
              <Wrench className="h-3 w-3" />
              AI 诊断修复
            </button>
          )}
        </div>
      )}

      {/* AI 修复建议面板 */}
      {showFixSuggest && (
        <div className="mc-card mb-2 mt-2 overflow-hidden border border-mc-gold/30">
          <div className="flex items-center justify-between border-b border-mc-border bg-mc-gold/10 px-3 py-1.5">
            <span className="text-xs font-semibold text-mc-gold">AI 修复建议</span>
            <button onClick={closeFixSuggest} className="text-mc-text-dim hover:text-mc-text">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-60 overflow-auto p-3 text-xs whitespace-pre-wrap text-mc-text">
            {isFixSuggesting && !fixSuggestion && (
              <span className="inline-flex items-center gap-1 text-mc-text-dim">
                <Loader2 className="h-3 w-3 animate-spin" />
                AI 正在分析错误日志…
              </span>
            )}
            {fixSuggestion}
          </div>
          <div className="flex items-center gap-2 border-t border-mc-border px-3 py-1.5">
            <button
              onClick={() => {
                closeFixSuggest();
                build();
              }}
              disabled={loading}
              className="mc-btn-primary text-xs"
            >
              重新构建
            </button>
            {isFixSuggesting && (
              <span className="inline-flex items-center gap-1 text-xs text-mc-text-dim">
                <Loader2 className="h-3 w-3 animate-spin" />
                分析中…
              </span>
            )}
          </div>
        </div>
      )}

      {/* 部署与运行（离线账号，无需微软登录） */}
      {jarAbs && (
        <div className="mb-3 mt-2 space-y-2 border-t border-mc-border pt-2">
          <div className="text-xs font-semibold text-mc-text-dim">
            部署与运行（离线账号，无需微软登录）
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={detectMc} disabled={deploying} className="mc-btn-ghost">
              {mcInfo ? '重新检测 Minecraft' : '检测 Minecraft'}
            </button>
            {mcInfo && !mcInfo.found && (
              <button onClick={chooseMcDir} disabled={deploying} className="mc-btn-ghost">
                手动选择 .minecraft
              </button>
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
              {mcInfo.launcher
                ? ` ｜ 启动器：${LAUNCHER_LABEL[mcInfo.launcher] ?? '已找到'}`
                : ' ｜ 未找到启动器（可手动选择 .minecraft 后用你自己的启动器）'}
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
            <div key={i} className="text-xs text-mc-text-dim">
              • {log}
            </div>
          ))}
        </div>
      )}
      {streamLog ? (
        <div className="mc-card max-h-40 overflow-auto p-2 text-xs font-mono">
          {renderLog(streamLog)}
        </div>
      ) : (
        buildLog && (
          <pre className="mc-card max-h-40 overflow-auto p-2 text-xs font-mono text-mc-text">
            {buildLog}
          </pre>
        )
      )}
    </div>
  );
}
