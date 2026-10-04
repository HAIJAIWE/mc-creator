/**
 * TF-IDF 检索器 + 内存 LRU 缓存。
 *
 * 设计取舍（约束：不引入重型向量 DB）：
 * - 纯手写 TF-IDF，无新增依赖；中文按字/二元组切分，中英混合查询均可命中。
 * - 检索结果内存 LRU（上限 100 条 key），同 query（含同 generatorType/topK）直接命中。
 */
import { KNOWLEDGE_BASE } from './knowledge-base.js';
import type { RagHit, RagSearchOptions, RagSearchResult, RagDocument } from './types.js';

/** LRU 上限 */
const CACHE_MAX = 100;
/** 返回给 UI/注入的 snippet 最大长度 */
const SNIPPET_MAX = 500;

interface ScoredDoc {
  doc: RagDocument;
  /** 预计算的词频表 */
  tf: Map<string, number>;
  /** 文档词数（归一化用） */
  len: number;
}

/** 中文按 run 切 unigram+bigram，拉丁/数字 token 保留（len>=2） */
export function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  const latin = lower.match(/[a-z0-9_]+/g) ?? [];
  for (const t of latin) {
    if (t.length >= 2) out.push(t);
  }
  const runs = lower.match(/[一-鿿]+/gu) ?? [];
  for (const run of runs) {
    const chars = [...run];
    for (const ch of chars) out.push(ch);
    for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
  }
  return out;
}

/** 索引文本：标题 + 标签（双倍加权） + 正文 */
function indexText(doc: RagDocument): string {
  return `${doc.title} ${doc.tags.join(' ')} ${doc.tags.join(' ')} ${doc.content}`;
}

function buildIndex(docs: RagDocument[]): { scored: ScoredDoc[]; df: Map<string, number> } {
  const scored: ScoredDoc[] = docs.map((doc) => {
    const tf = new Map<string, number>();
    const tokens = tokenize(indexText(doc));
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { doc, tf, len: Math.max(tokens.length, 1) };
  });
  const df = new Map<string, number>();
  for (const s of scored) {
    for (const term of s.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);
  }
  return { scored, df };
}

const { scored: SCORED, df: DF } = buildIndex(KNOWLEDGE_BASE);
const DOC_COUNT = SCORED.length;

function idf(term: string): number {
  const df = DF.get(term) ?? 0;
  return Math.log((DOC_COUNT + 1) / (df + 1)) + 1;
}

/** LRU 缓存：key → hits（Map 插入序即访问序，命中时删后重插） */
const cache = new Map<string, RagHit[]>();
let cacheHits = 0;
let cacheMisses = 0;

function cacheKey(query: string, generatorType: string | undefined, topK: number): string {
  return `${generatorType ?? '*'}|${topK}|${query.trim().toLowerCase().slice(0, 200)}`;
}

function toHit(doc: RagDocument, score: number): RagHit {
  const snippet =
    doc.content.length > SNIPPET_MAX ? doc.content.slice(0, SNIPPET_MAX) + '…' : doc.content;
  const hit: RagHit = { title: doc.title, snippet, source: doc.source, score };
  if (doc.url !== undefined) hit.url = doc.url;
  return hit;
}

/**
 * 检索知识库（同步，纯内存计算）。
 * - 空 query 直接返回空结果（不污染缓存）。
 * - generatorType 过滤：通用文档（generatorTypes 为空）始终保留。
 */
export function searchKnowledge(query: string, opts?: RagSearchOptions): RagSearchResult {
  const topK = opts?.topK ?? 5;
  const generatorType = opts?.generatorType;
  if (!query.trim()) return { hits: [], cached: false };

  const key = cacheKey(query, generatorType, topK);
  const cached = cache.get(key);
  if (cached) {
    // LRU：命中后移到末尾
    cache.delete(key);
    cache.set(key, cached);
    cacheHits++;
    return { hits: cached, cached: true };
  }

  const qTerms = tokenize(query);
  const qSet = new Set(qTerms);
  const ranked: Array<{ doc: RagDocument; score: number }> = [];
  for (const s of SCORED) {
    if (generatorType && s.doc.generatorTypes.length > 0) {
      if (!s.doc.generatorTypes.includes(generatorType)) continue;
    }
    let score = 0;
    for (const term of qSet) {
      const tf = s.tf.get(term);
      if (tf !== undefined) score += (1 + Math.log(tf)) * idf(term);
    }
    if (score > 0) ranked.push({ doc: s.doc, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  const hits = ranked.slice(0, Math.max(topK, 1)).map((r) => toHit(r.doc, r.score));

  cache.set(key, hits);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cacheMisses++;
  return { hits, cached: false };
}

/** 缓存统计（供调试/验证 LRU 命中） */
export function getRagCacheStats(): { size: number; hits: number; misses: number } {
  return { size: cache.size, hits: cacheHits, misses: cacheMisses };
}

/** 清空缓存（测试用） */
export function clearRagCache(): void {
  cache.clear();
  cacheHits = 0;
  cacheMisses = 0;
}

/**
 * 把检索命中拼成注入 system message 的片段（注明来源，要求模型引用时标注出处）。
 * 无命中时返回空字符串，调用方直接拼接即可。
 */
export function formatRagSection(
  hits: Array<Pick<RagHit, 'title' | 'snippet' | 'source'>>,
): string {
  if (hits.length === 0) return '';
  const lines = hits.map(
    (h, i) => `${i + 1}. 【${h.title}】（来源：${h.source}）\n${h.snippet}`,
  );
  return [
    '## 本地知识库参考（RAG 检索 top' + hits.length + '，仅供参考）',
    ...lines,
    '引用要求：回答中用到上述知识时必须注明来源标题；不要编造来源中没有的字段名、数值或配方；若知识与用户需求冲突，以用户需求为准并明确指出差异。',
  ].join('\n');
}
