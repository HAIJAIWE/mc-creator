import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';
import { ErrorBanner } from './ErrorBanner.js';

export function ChatPanel() {
  const {
    description, setDescription, loader, mcVersion,
    spec, setSpec, setFiles, setLoading, setError, loading, error,
  } = useModStore();

  const generateSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateSpec(description);
      setSpec(res.spec);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateFiles = async () => {
    if (!spec) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateFiles({ loader, mcVersion, spec });
      setFiles(res.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-800 p-4">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述你想要的 mod（如：做一个添加红宝石工具的 mod）"
        className="h-24 rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100"
        disabled={loading}
      />
      <div className="flex gap-2">
        <button
          onClick={generateSpec}
          disabled={loading || !description}
          className="flex items-center gap-2 rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          生成 Spec
        </button>
        <button
          onClick={generateFiles}
          disabled={loading || !spec}
          className="flex items-center gap-2 rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          生成代码
        </button>
      </div>
      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {spec && (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="mb-1 text-xs text-zinc-400">ModSpec（审阅后点「生成代码」）</div>
          <pre className="max-h-48 overflow-auto text-xs text-zinc-300">
            {JSON.stringify(spec, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
