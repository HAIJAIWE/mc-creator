import { useRef, useState } from 'react';
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';
import type { BuildStreamChunkT } from '../../../shared/ipc-channels.js';

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

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    try {
      // P22-4：先把内存中的 files 写入临时目录，再用该路径构建（避免硬编码 /tmp/mc-mod）
      const { projectPath } = await ipcClient.prepareBuildDir(files);
      const res = await ipcClient.buildWithFix(projectPath) as any;
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
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

    const onChunk = (chunk: BuildStreamChunkT) => {
      streamLogRef.current += chunk.text;
      setStreamLog(streamLogRef.current);
      if (chunk.done) {
        setStreamBuilding(false);
        const code = chunk.exitCode ?? -1;
        const ok = code === 0;
        setStreamSuccess(ok);
        if (ok) {
          setStreamJarPath(extractJarPath(streamLogRef.current));
        }
      }
    };

    try {
      // P22-4：先把内存中的 files 写入临时目录，再启动流式构建
      const { projectPath } = await ipcClient.prepareBuildDir(files);
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
