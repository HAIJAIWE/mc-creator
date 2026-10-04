import { z } from 'zod';

// === RAG 知识库检索（本地 TF-IDF，主进程内存 LRU） ===
export const RAG_SEARCH = 'rag:search';

/** 单条引用来源（与 core RagHit 对齐，供 UI 展示“引用来源”） */
export const RagHitSchema = z.object({
  title: z.string(),
  snippet: z.string(),
  source: z.string(),
  url: z.string().optional(),
  score: z.number(),
});
export type RagHitT = z.infer<typeof RagHitSchema>;

export const RagSearchRequest = z.object({
  query: z.string().min(1),
  generatorType: z.string().optional(),
  topK: z.number().int().min(1).max(10).default(5),
});
export type RagSearchReq = z.infer<typeof RagSearchRequest>;

export const RagSearchResponse = z.object({
  hits: z.array(RagHitSchema),
  /** true=命中主进程内存 LRU，未重新计算 */
  cached: z.boolean(),
});
export type RagSearchRes = z.infer<typeof RagSearchResponse>;
