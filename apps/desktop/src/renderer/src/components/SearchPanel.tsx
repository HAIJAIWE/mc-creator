import { useState, useMemo } from 'react';
import { useModStore } from '../store/mod-store.js';
import { McIcon } from '../assets/mc-ui/McIcon';

function iconFor(path: string): { scope: 'pixel'; name: string } {
  if (path.endsWith('.json')) return { scope: 'pixel', name: 'file-text' };
  if (path.endsWith('.java')) return { scope: 'pixel', name: 'terminal' };
  if (path.endsWith('.png')) return { scope: 'pixel', name: 'image' };
  return { scope: 'pixel', name: 'file' };
}

/** 搜索：在当前 Mod 已生成的文件里检索（支持路径 + 内容搜索），点击即在主区打开。 */
export function SearchPanel() {
  const files = useModStore((s) => s.files);
  const selectedFile = useModStore((s) => s.selectedFile);
  const selectFile = useModStore((s) => s.selectFile);
  const [query, setQuery] = useState('');
  const [searchContent, setSearchContent] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return files;

    // 路径搜索
    const pathFilter = (path: string) => {
      const target = caseSensitive ? path : path.toLowerCase();
      const keyword = caseSensitive ? q : q.toLowerCase();
      return target.includes(keyword);
    };

    if (!searchContent) {
      return files.filter((f) => pathFilter(f.path));
    }

    // 内容搜索
    let regex: RegExp | null = null;
    if (useRegex) {
      try {
        regex = new RegExp(q, caseSensitive ? 'g' : 'gi');
      } catch {
        // 非法正则，回退为纯文本
        regex = null;
      }
    }

    return files.filter((f) => {
      if (f.path.endsWith('.png')) return pathFilter(f.path);
      if (pathFilter(f.path)) return true;

      if (regex) {
        return regex.test(f.content);
      }

      const content = caseSensitive ? f.content : f.content.toLowerCase();
      const keyword = caseSensitive ? q : q.toLowerCase();

      if (wholeWord) {
        const wordRegex = new RegExp(
          `\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
          caseSensitive ? '' : 'i',
        );
        return wordRegex.test(f.content);
      }

      return content.includes(keyword);
    });
  }, [files, query, searchContent, caseSensitive, useRegex, wholeWord]);

  /** 生成搜索选项的 toggle 按钮样式 */
  const toggleClass = (on: boolean) =>
    `rounded-mc px-1.5 py-0.5 text-[10px] transition-colors ${
      on
        ? 'bg-mc-accent/20 text-mc-accent-bright'
        : 'text-mc-mute hover:bg-mc-surface-2 hover:text-mc-dim'
    }`;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-mc-border p-2">
        <div className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5">
          <McIcon scope="pixel" name="search" size={16} className="flex-shrink-0 text-mc-mute" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchContent ? '搜索文件内容…' : '搜索文件路径…'}
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
        <div className="mt-1 flex items-center gap-1 px-1">
          <button
            onClick={() => setSearchContent((v) => !v)}
            className={toggleClass(searchContent)}
            title="搜索文件内容（默认仅搜路径）"
          >
            内容
          </button>
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            className={toggleClass(caseSensitive)}
            title="区分大小写"
          >
            Aa
          </button>
          <button
            onClick={() => setUseRegex((v) => !v)}
            className={toggleClass(useRegex)}
            title="正则表达式"
          >
            .*
          </button>
          <button
            onClick={() => setWholeWord((v) => !v)}
            className={toggleClass(wholeWord)}
            title="全词匹配"
          >
            W
          </button>
          <span className="ml-auto text-xs text-mc-mute">
            {results.length} / {files.length}
          </span>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1">
        {results.length === 0 ? (
          <div className="py-8 text-center text-xs text-mc-mute">
            {files.length === 0
              ? '还没有生成文件'
              : searchContent
                ? '没有匹配的内容'
                : '没有匹配的文件'}
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
