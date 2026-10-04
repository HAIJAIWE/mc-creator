import { describe, it, expect, beforeEach } from 'vitest';
import {
  searchKnowledge,
  clearRagCache,
  getRagCacheStats,
  formatRagSection,
  KNOWLEDGE_BASE,
} from './index.js';

beforeEach(() => {
  clearRagCache();
});

describe('RAG 检索器', () => {
  it('知识库非空（配方/API/模板三类齐备）', () => {
    expect(KNOWLEDGE_BASE.length).toBeGreaterThanOrEqual(20);
    const ids = KNOWLEDGE_BASE.map((d) => d.id);
    expect(ids).toContain('recipe-shaped');
    expect(ids).toContain('fabric-item-register');
    expect(ids).toContain('template-new-ore');
  });

  it('中文查询命中：附魔 → 附魔知识 top2 内（含 Wiki 附魔文档）', () => {
    const { hits } = searchKnowledge('我想做一个锋利附魔，支持剑，能升级到5级', {
      topK: 5,
      generatorType: 'datapack',
    });
    expect(hits.length).toBeGreaterThan(0);
    const top2 = hits.slice(0, 2).map((h) => h.title);
    // Wiki 附魔文档（字段规范）与 new_ore 式模板都是合理首选，至少其一在前二
    expect(top2.some((t) => t.includes('附魔'))).toBe(true);
  });

  it('中文查询命中：红宝石套装 → new_ore 模板', () => {
    const { hits } = searchKnowledge('红宝石矿石套装，包含工具和盔甲', { topK: 5 });
    const titles = hits.map((h) => h.title);
    expect(titles.some((t) => t.includes('new_ore'))).toBe(true);
  });

  it('英文查询命中：Fabric 注册', () => {
    const { hits } = searchKnowledge('Fabric register custom item Registry', {
      topK: 5,
      generatorType: 'mod',
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.title).toContain('Fabric');
  });

  it('generatorType 过滤：kubejs 查询不返回 crafttweaker 专属文档', () => {
    const { hits } = searchKnowledge('配方合成 ZenScript craftingTable', {
      topK: 5,
      generatorType: 'kubejs',
    });
    expect(hits.every((h) => !h.title.includes('CraftTweaker'))).toBe(true);
  });

  it('topK 生效：最多返回 topK 条', () => {
    const { hits } = searchKnowledge('配方', { topK: 3 });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('返回形态为 {title, snippet, source} 且 snippet 有截断上限', () => {
    const { hits } = searchKnowledge('熔炉烧炼', { topK: 5 });
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) {
      expect(typeof h.title).toBe('string');
      expect(typeof h.snippet).toBe('string');
      expect(typeof h.source).toBe('string');
      expect(h.snippet.length).toBeLessThanOrEqual(520);
    }
  });

  it('LRU 缓存：同 query 第二次命中 cached=true', () => {
    const q = '下界合金锻造台升级怎么做';
    const first = searchKnowledge(q, { topK: 5 });
    expect(first.cached).toBe(false);
    const second = searchKnowledge(q, { topK: 5 });
    expect(second.cached).toBe(true);
    expect(second.hits).toEqual(first.hits);
    const stats = getRagCacheStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
  });

  it('空 query 返回空结果且不计入缓存', () => {
    const r = searchKnowledge('   ');
    expect(r.hits).toEqual([]);
    expect(r.cached).toBe(false);
    expect(getRagCacheStats().size).toBe(0);
  });

  it('formatRagSection 注明来源、无命中返回空串', () => {
    expect(formatRagSection([])).toBe('');
    const { hits } = searchKnowledge('酿造药水', { topK: 2 });
    const section = formatRagSection(hits);
    expect(section).toContain('来源：');
    expect(section).toContain('不要编造');
  });
});
