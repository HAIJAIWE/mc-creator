import { describe, it, expect } from 'vitest';
import { NODE_GRAPH_TEMPLATES } from './nodeGraphTemplates.js';

describe('nodeGraphTemplates 新增模板（Plan B Task 6）', () => {
  it('总模板数 >= 11（原 6 + 新增 5）', () => {
    expect(NODE_GRAPH_TEMPLATES.length).toBeGreaterThanOrEqual(11);
  });

  it('包含铁剑模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'iron-sword');
    expect(t).toBeDefined();
    expect(t!.category).toBe('combat');
    expect(t!.graph.nodes[0].data.kind).toBe('item');
  });

  it('包含钻石镐模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'diamond-pickaxe');
    expect(t).toBeDefined();
    expect(t!.category).toBe('item');
  });

  it('包含金苹果模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'golden-apple');
    expect(t).toBeDefined();
    expect(t!.graph.nodes[0].data.kind).toBe('item');
  });

  it('包含熔炉配方模板且 recipeType 为 smelting', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'furnace-recipe');
    expect(t).toBeDefined();
    expect(t!.graph.nodes.length).toBe(2);
    expect(t!.graph.edges.length).toBe(1);
  });

  it('包含简单发电机模板且为多节点', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'basic-generator');
    expect(t).toBeDefined();
    expect(t!.graph.nodes.length).toBe(2);
    expect(t!.graph.edges.length).toBe(1);
  });

  it('所有新模板 nodeCount 与实际 nodes 长度一致', () => {
    const newIds = [
      'iron-sword',
      'diamond-pickaxe',
      'golden-apple',
      'furnace-recipe',
      'basic-generator',
    ];
    for (const id of newIds) {
      const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === id)!;
      expect(t.nodeCount, `${id}.nodeCount`).toBe(t.graph.nodes.length);
    }
  });
});
