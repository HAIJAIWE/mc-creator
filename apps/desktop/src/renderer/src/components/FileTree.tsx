import { useModStore } from '../store/mod-store.js';

export function FileTree() {
  const { files, selectedFile, selectFile } = useModStore();

  if (files.length === 0) {
    return <div className="p-4 text-sm text-zinc-500">暂无生成文件</div>;
  }

  return (
    <div className="p-2">
      <div className="mb-2 text-xs font-semibold text-zinc-400">生成文件</div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.path}>
            <button
              onClick={() => selectFile(f.path)}
              className={`w-full truncate rounded px-2 py-1 text-left text-xs ${
                selectedFile === f.path ? 'bg-zinc-700 text-white' : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {f.path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
