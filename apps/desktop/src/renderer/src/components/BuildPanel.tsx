import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

export function BuildPanel() {
  const { files, buildLog, buildSuccess, jarPath, loading, setBuildResult, setLoading, setError, error } = useModStore();

  const build = async () => {
    setLoading(true);
    setError(null);
    try {
      // P3 阶段用临时目录，P4 接真实文件系统写入
      const res = await ipcClient.build('/tmp/mc-mod');
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
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
          编译 .jar
        </button>
        {buildSuccess === true && <span className="text-sm text-green-400">编译成功！</span>}
        {buildSuccess === false && <span className="text-sm text-red-400">编译失败</span>}
        {jarPath && <span className="text-xs text-zinc-400">产物：{jarPath}</span>}
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {buildLog && (
        <pre className="max-h-40 overflow-auto rounded bg-black p-2 text-xs text-zinc-300">{buildLog}</pre>
      )}
    </div>
  );
}
