import { useState, useMemo } from 'react';
import { useModStore } from '../store/mod-store.js';
import { McIcon } from '../assets/mc-ui/McIcon';

function iconFor(path: string): { scope: 'pixel'; name: string } {
  if (path.endsWith('.json')) return { scope: 'pixel', name: 'file-text' };
  if (path.endsWith('.java')) return { scope: 'pixel', name: 'terminal' };
  if (path.endsWith('.png')) return { scope: 'pixel', name: 'image' };
  return { scope: 'pixel', name: 'file' };
}

/** 搜索：在当前 Mod 已生成的文件里按路径检索，点击即在主区打开。 */
export function SearchPanel() {
  const files = useModStore((s) => s.files);
  const selectedFile = useModStore((s) => s.selectedFile);
  const selectFile = useModStore((s) => s.selectFile);
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return files;
    return files.filter((f) => f.path.toLowerCase().includes(q));
  }, [files, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-mc-border p-2">
        <div className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5">
          <McIcon scope="pixel" name="search" size={16} className="flex-shrink-0 text-mc-mute" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索文件（按路径）"
            className="flex-1 bg-transparent text-sm text-mc-text outline-none placeholder:text-mc-mute"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="text-mc-mute hover:text-mc-text"
              aria-label="清除"
            >
              <McIcon scope="pixel" name="close" size={14} />
            </button>
          )}
        </div>
        <div className="mt-1 px-1 text-xs text-mc-mute">
          {results.length} / {files.length} 个文件
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {results.length === 0 ? (
          <div className="py-8 text-center text-xs text-mc-mute">
            {files.length === 0 ? '还没有生成文件' : '没有匹配的文件'}
          </div>
        ) : (
          results.map((f) => {
            const ic = iconFor(f.path);
            const active = f.path === selectedFile;
            return (
              <button
                key={f.path}
                onClick={() => selectFile(f.path)}
                className={`flex w-full items-center gap-2 rounded-mc px-2 py-1.5 text-left text-xs transition-colors ${
                  active ? 'bg-mc-surface-2 text-mc-text' : 'text-mc-dim hover:bg-mc-surface-2/60'
                }`}
              >
                <McIcon
                  scope={ic.scope}
                  name={ic.name}
                  size={14}
                  className="flex-shrink-0 text-mc-mute"
                />
                <span className="truncate">{f.path}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
