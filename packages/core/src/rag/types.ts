/**
 * RAG 检索公共类型。
 *
 * 轻量本地知识库：TF-IDF 检索，不引入向量数据库。
 * 知识条目覆盖 Minecraft Wiki 常用配方、Fabric/NeoForge API 示例、内置生成器模板。
 */

/** 知识库文档（入库条目，多为 md/json 代码片段） */
export interface RagDocument {
  /** 稳定唯一 id，如 'recipe-shaped' */
  id: string;
  /** 展示标题，如 '有形合成配方 crafting_shaped' */
  title: string;
  /** 正文（md/json 片段，中英关键词混合以便命中中文查询） */
  content: string;
  /** 来源标注（展示给用户 + 注入 system message 注明出处，避免幻觉引用） */
  source: string;
  /** 可点击跳转的外链（仅对确认存在的门户/页面填写，不确定的留空） */
  url?: string;
  /**
   * 适用的生成器类型（如 ['datapack']、['mod']、['kubejs']）。
   * 空数组表示通用知识，不过滤。
   */
  generatorTypes: string[];
  /** 检索加权标签（中英关键词） */
  tags: string[];
}

/** 单次检索命中（返回给调用方 / UI 展示的形态） */
export interface RagHit {
  title: string;
  snippet: string;
  source: string;
  url?: string;
  /** TF-IDF 相关度得分（越大越相关，仅用于排序/调试） */
  score: number;
}

/** 检索选项 */
export interface RagSearchOptions {
  /** 返回条数，默认 5 */
  topK?: number | undefined;
  /** 按生成器类型过滤（如 'datapack'、'mod'）；缺省/undefined 不过滤 */
  generatorType?: string | undefined;
}

/** 检索结果（含是否命中缓存） */
export interface RagSearchResult {
  hits: RagHit[];
  /** true 表示本次直接命中内存 LRU，未重新计算 */
  cached: boolean;
}
