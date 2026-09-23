import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeGraph, ModNode } from '@mc-creator/shared';
import { compileNodeGraph } from './compileNodeGraph.js';
import { applyGraphToProject } from './applyGraphToProject.js';

// mock 掉生成器入口，让 B 桥测试聚焦"编译 → 产文件 → 结构"链路
vi.mock('./generate-files.js', () => ({
  generateFilesForType: vi.fn(async () => ({
    files: [{ path: 'src/main/java/com/example/mock/MockMod.java', content: 'mock' }],
    warnings: [],
    spec: {},
  })),
}));

import { generateFilesForType } from './generate-files.js';

function makeItemNode(id: string, nodeId: string, position = { x: 0, y: 0 }): ModNode {
  return {
    id: nodeId,
    type: 'item',
    position,
    data: {
      kind: 'item',
      nodeId,
      label: id,
      note: '',
      disabled: false,
      collapsed: false,
      codeLocked: false,
      itemId: id,
      displayName: id,
      category: 'misc',
      maxStackSize: 64,
      maxDamage: 0,
      rarity: 'common',
      glow: false,
      formatVersion: 1,
    },
    ports: [
      {
        id: 'out',
        label: '物品',
        type: 'item_stack',
        direction: 'out',
        required: false,
        multiple: false,
      },
    ],
    selected: false,
  };
}

function makeGraph(nodes: ModNode[], edges: NodeGraph['edges'] = []): NodeGraph {
  return {
    version: 1,
    modId: 'test_mod',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

describe('applyGraphToProject（B 桥：图 → spec → 文件）', () => {
  beforeEach(() => vi.clearAllMocks());

  it('编译通过 → 返回 spec 与生成 files', async () => {
    const graph = makeGraph([makeItemNode('ruby', 'item_0', { x: 0, y: 0 })]);
    const result = await applyGraphToProject(graph, {
      generatorType: 'mod',
      loader: 'fabric',
      mcVersion: '1.21.11',
    });
    expect(result.errors).toHaveLength(0);
    expect(result.spec.modId).toBe('test_mod');
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('ruby');
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toContain('.java');
    expect(generateFilesForType).toHaveBeenCalled();
  });

  it('编译报错（recipe 无输出连线）→ 不生成文件', async () => {
    const item = makeItemNode('ruby', 'item_0');
    const recipe: ModNode = {
      id: 'recipe_0',
      type: 'recipe',
      position: { x: 200, y: 0 },
      data: {
        kind: 'recipe',
        nodeId: 'recipe_0',
        label: '配方',
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        recipeId: 'broken_recipe',
        recipeType: 'crafting_shapeless',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: '',
        addition: '',
        inputPotion: 'minecraft:water',
        ingredientItem: '',
        outputPotion: '',
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    // recipe 没有连出 item → compile 报"没有输出物品连线"
    const graph = makeGraph([item, recipe]);
    const result = await applyGraphToProject(graph, {
      generatorType: 'mod',
      loader: 'fabric',
      mcVersion: '1.21.11',
    });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.files).toHaveLength(0);
    expect(generateFilesForType).not.toHaveBeenCalled();
  });

  // 确保 compileNodeGraph 依赖仍正常（回归护栏）
  it('compileNodeGraph 对空图返回空 spec', async () => {
    const result = await compileNodeGraph(makeGraph([]));
    expect(result.errors).toHaveLength(0);
    expect(result.spec.items).toHaveLength(0);
  });
});
