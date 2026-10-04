import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { RagHitT } from '../../../shared/ipc-channels.js';
import { ipcClient } from '../lib/ipc-client.js';

/** 单条来源行：标题 + 来源徽标 + 片段；有外链则可点击跳转 */
function RagSourceItem({ hit }: { hit: RagHitT }) {
  const [expanded, setExpanded] = useState(false);
  const isExternal = hit.url !== undefined && /^https?:\/\//.test(hit.url);
  const snippet = expanded || hit.snippet.length <= 220 ? hit.snippet : hit.snippet.slice(0, 220) + '…';

  return (
    <div className="rounded-mc border border-mc-border bg-mc-bg px-2 py-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-mc-text">{hit.title}</span>
        <span className="rounded-mc bg-mc-surface-3 px-1 py-px text-[10px] text-mc-dim">
          {hit.source}
        </span>
        {isExternal && (
          <a
            href={hit.url}
            target="_blank"
            rel="noreferrer"
            className="ml-auto flex items-center gap-0.5 text-[10px] text-mc-accent-bright hover:underline"
            title={`跳转到${hit.source}`}
          >
            <ExternalLink className="h-3 w-3" />
            跳转
          </a>
        )}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="mt-0.5 whitespace-pre-wrap break-words text-left font-mono text-[11px] text-mc-dim hover:text-mc-text"
        title={expanded ? '收起片段' : '展开片段'}
      >
        {snippet}
      </button>
    </div>
  );
}

/** 纯展示：给定 hits 渲染引用来源列表（无数据时渲染空） */
export function RagSourcesList({ hits }: { hits: RagHitT[] }) {
  if (hits.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {hits.map((h, i) => (
        <RagSourceItem key={`${h.title}-${i}`} hit={h} />
      ))}
    </div>
  );
}

/**
 * 引用来源折叠列表（容器）。
 * 默认折叠，首次展开时才经 rag:search 查询（失败/无命中则显示“暂无引用”）。
 */
export function RagSources({ query, generatorType }: { query: string; generatorType?: string }) {
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<RagHitT[] | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && hits === null && !loading && query.trim()) {
      setLoading(true);
      ipcClient
        .ragSearch(generatorType ? { query, generatorType, topK: 5 } : { query, topK: 5 })
        .then((res) => setHits(res.hits))
        .catch(() => setHits([]))
        .finally(() => setLoading(false));
    }
  };

  return (
    <div className="mt-1.5 rounded-mc border border-mc-border/60 bg-mc-surface-2/50">
      <button
        onClick={toggle}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] text-mc-dim hover:text-mc-text"
        title="查看本次回答参考的本地知识库来源"
      >
        <BookOpen className="h-3 w-3" />
        <span>引用来源{hits !== null ? `（${hits.length}）` : ''}</span>
        <span className="ml-auto">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        </span>
      </button>
      {open && (
        <div className="px-2 pb-2">
          {loading && <div className="text-[11px] text-mc-mute">检索中…</div>}
          {!loading && hits !== null && hits.length === 0 && (
            <div className="text-[11px] text-mc-mute">暂无引用来源</div>
          )}
          {!loading && hits !== null && hits.length > 0 && <RagSourcesList hits={hits} />}
        </div>
      )}
    </div>
  );
}
