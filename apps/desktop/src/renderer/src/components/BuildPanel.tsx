import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';

export function BuildPanel() {
  const {
    files, buildLog, buildSuccess, jarPath, loading, fixLog,
    setBuildResult, setLoading, setError, error, setFixLog,
  } = useModStore();

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    try {
      const res = await ipcClient.buildWithFix('/tmp/mc-mod') as any;
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
      setFixLog(res.fixLog ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-zinc-800 p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={build}
          disabled={loading || files.length === 0}
          className="rounded bg-orange-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading ? '构建中…' : '编译 .jar'}
        </button>
        {buildSuccess === true && <span className="text-sm text-green-400">编译成功！</span>}
        {buildSuccess === false && <span className="text-sm text-red-400">编译失败</span>}
        {jarPath && <span className="text-xs text-zinc-400">产物：{jarPath}</span>}
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {fixLog.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-xs font-semibold text-zinc-400">修复过程</div>
          {fixLog.map((log, i) => (
            <div key={i} className="text-xs text-zinc-500">• {log}</div>
          ))}
        </div>
      )}
      {buildLog && (
        <pre className="max-h-40 overflow-auto rounded bg-black p-2 text-xs text-zinc-300">{buildLog}</pre>
      )}
    </div>
  );
}
