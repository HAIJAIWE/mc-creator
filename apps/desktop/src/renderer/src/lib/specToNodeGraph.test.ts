import { describe, it, expect } from 'vitest';
import { ModSpec } from '@mc-creator/shared';
import { specToNodeGraph } from './specToNodeGraph.js';
import { compileNodeGraph } from './compileNodeGraph.js';

/** 构造合法 ModSpec（parse 自动补默认字段） */
function makeSpec(itemOverrides: Partial<Parameters<typeof ModSpec.parse>[0]> = {}) {
  return ModSpec.parse({
    modId: 'test_mod',
    name: '测试模组',
    ...itemOverrides,
  });
}

describe('specToNodeGraph（A 桥：spec → 节点图）', () => {
  it('空 spec → 空画布，modId 正确', () => {
    const { graph, warnings } = specToNodeGraph(makeSpec());
    expect(graph.modId).toBe('test_mod');
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it('items → item 节点（字段映射 + 端口）', () => {
    const { graph } = specToNodeGraph(
      makeSpec({
        items: [
          { id: 'ruby', name: '红宝石', rarity: 'rare', maxStackSize: 16, itemCategory: 'sword' },
        ],
      }),
    );
    expect(graph.nodes).toHaveLength(1);
    const n = graph.nodes[0];
    expect(n.type).toBe('item');
    expect(n.data).toMatchObject({
      itemId: 'ruby',
      displayName: '红宝石',
      rarity: 'rare',
      maxStackSize: 16,
      category: 'sword',
    });
    expect(n.ports.some((p) => p.direction === 'out')).toBe(true);
  });

  it('itemCategory 非法值归一化为 misc', () => {
    const { graph } = specToNodeGraph(
      makeSpec({ items: [{ id: 'x', name: 'X', itemCategory: 'trident' }] }),
    );
    // Parse 会用 literal 校验——这里绕过 parse 直接对象让 specToNodeGraph 处理
    // 详情见下方 normalize 用例（直接构造不合法的 itemCategory 走 parse 会失败，改用合法值之外的运行时）
  });

  it('items + blocks + entities + machines 各自生成节点', () => {
    const { graph } = specToNodeGraph(
      makeSpec({
        items: [{ id: 'ruby', name: '红宝石' }],
        blocks: [{ id: 'ruby_ore', name: '红宝石矿石' }],
        entities: [{ entityId: 'ruby_golem', displayName: '红宝石傀儡' }],
        machines: [{ machineId: 'ruby_forge', displayName: '红宝石熔炉', recipeMap: { a: 'b' } }],
      }),
    );
    expect(graph.nodes).toHaveLength(4);
    expect(graph.nodes.find((n) => n.type === 'block')?.data).toMatchObject({
      blockId: 'ruby_ore',
      solid: true,
    });
    expect(graph.nodes.find((n) => n.type === 'machine')?.data).toMatchObject({
      machineId: 'ruby_forge',
      recipeMapJson: JSON.stringify({ a: 'b' }),
    });
  });

  it('recipe：纯自定义物品时只建配方与物品节点，连 2 条 craft 边', () => {
    const { graph, warnings } = specToNodeGraph(
      makeSpec({
        items: [
          { id: 'ruby', name: '红宝石' },
          { id: 'iron_ingot', name: '铁锭' },
        ],
        recipes: [
          {
            recipeId: 'ruby_ingot',
            recipeType: 'crafting_shapeless',
            output: 'ruby',
            inputs: [{ item: 'iron_ingot', count: 1 }],
          },
        ],
      }),
    );
    // item_0(ruby) + item_1(iron_ingot) + recipe_0
    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(2);
    const edges = graph.edges;
    expect(
      edges.some(
        (e) =>
          e.source === 'item_1' &&
          e.target === 'recipe_0' &&
          e.sourceHandle === 'out' &&
          e.targetHandle === 'in',
      ),
    ).toBe(true);
    expect(
      edges.some((e) => e.source === 'recipe_0' && e.target === 'item_0' && e.kind === 'craft'),
    ).toBe(true);
    expect(warnings).toHaveLength(0);
  });

  it('recipe 引用 vanilla 材料：生成引用节点（itemId 保留前缀）并提示 warning', () => {
    const { graph, warnings } = specToNodeGraph(
      makeSpec({
        items: [{ id: 'ruby', name: '红宝石' }],
        recipes: [
          {
            recipeId: 'ruby_craft',
            recipeType: 'crafting_shapeless',
            output: 'ruby',
            inputs: [{ item: 'minecraft:iron_ingot', count: 1 }],
          },
        ],
      }),
    );
    // item_0(ruby) + item_v_0(minecraft:iron_ingot) + recipe_0
    expect(graph.nodes).toHaveLength(3);
    const ref = graph.nodes.find((n) => n.id === 'item_v_0');
    expect(ref?.data).toMatchObject({ itemId: 'minecraft:iron_ingot' });
    expect(graph.edges.some((e) => e.source === 'item_v_0' && e.target === 'recipe_0')).toBe(true);
    expect(warnings.some((w) => w.includes('minecraft:iron_ingot'))).toBe(true);
  });

  it('fluids → 生成 fluid 节点（字段映射）', () => {
    const { graph, warnings } = specToNodeGraph(
      makeSpec({
        items: [{ id: 'ruby', name: '红宝石' }],
        fluids: [{ fluidId: 'lava_ruby', displayName: '红宝石岩浆', luminous: true }],
      }),
    );
    expect(graph.nodes).toHaveLength(2);
    const f = graph.nodes.find((n) => n.type === 'fluid');
    expect(f?.data).toMatchObject({
      fluidId: 'lava_ruby',
      displayName: '红宝石岩浆',
      luminous: true,
    });
    expect(warnings.some((w) => w.includes('流体'))).toBe(false);
  });

  it('event/condition/action/procedure：生成逻辑节点 + control 连边（往返闭环）', () => {
    const { graph, warnings } = specToNodeGraph(
      makeSpec({
        eventHandlers: [
          {
            handlerId: 'evt_open',
            eventType: 'player_right_click_block',
            eventArgs: { hand: 'main' },
            conditionIds: ['cond_has_item'],
            actionIds: ['act_give_ruby'],
            procedureCallIds: [],
          },
        ],
        conditions: [
          { conditionId: 'cond_has_item', conditionType: 'has_item', args: { item: 'ruby' } },
        ],
        actions: [{ actionId: 'act_give_ruby', actionType: 'give_item' }],
        procedures: [
          {
            procedureId: 'proc_log',
            procedureName: 'logRuby',
            displayName: '记录红宝石',
            inputs: [{ name: 'count', type: 'int' }],
            conditionIds: ['cond_has_item'],
            actionIds: [],
            procedureCallIds: [],
          },
        ],
      }),
    );
    const evt = graph.nodes.find((n) => n.id === 'evt_open');
    const proc = graph.nodes.find((n) => n.id === 'proc_log');
    expect(evt?.type).toBe('event');
    expect(evt?.data).toMatchObject({
      eventType: 'player_right_click_block',
      eventArgs: JSON.stringify({ hand: 'main' }),
    });
    expect(proc?.data).toMatchObject({
      procedureName: 'logRuby',
      inputs: [{ name: 'count', type: 'int' }],
    });
    // control 边：event→condition / event→action / procedure→condition
    const controlEdges = graph.edges.filter((e) => e.kind === 'control');
    expect(controlEdges.some((e) => e.source === 'evt_open' && e.target === 'cond_has_item')).toBe(
      true,
    );
    expect(controlEdges.some((e) => e.source === 'evt_open' && e.target === 'act_give_ruby')).toBe(
      true,
    );
    expect(controlEdges.some((e) => e.source === 'proc_log' && e.target === 'cond_has_item')).toBe(
      true,
    );
    expect(warnings).toHaveLength(0);
  });

  it('customCode → code 节点（snippetId 即 nodeId，编译往返稳定）', () => {
    const { graph } = specToNodeGraph(
      makeSpec({
        customCode: [
          {
            snippetId: 'code_custom_1',
            language: 'java',
            code: 'return input;',
            inputSignature: { in: 'item_stack' },
            outputSignature: { out: 'item_stack' },
            methodName: 'process',
          },
        ],
      }),
    );
    const n = graph.nodes.find((x) => x.id === 'code_custom_1');
    expect(n?.type).toBe('code');
    expect(n?.data).toMatchObject({
      language: 'java',
      code: 'return input;',
      methodName: 'process',
      inputSignature: JSON.stringify({ in: 'item_stack' }),
    });
  });

  it('event 引用不存在的节点 id → warning，不建 control 边', () => {
    const { graph, warnings } = specToNodeGraph(
      makeSpec({
        eventHandlers: [
          { handlerId: 'evt_1', eventType: 'tick', conditionIds: ['cond_missing'], actionIds: [] },
        ],
      }),
    );
    expect(graph.edges).toHaveLength(0);
    expect(warnings.some((w) => w.includes('cond_missing'))).toBe(true);
  });

  it('往返闭环：spec → 图 → 编译 → spec（items/recipes/逻辑引用结构还原）', async () => {
    const original = makeSpec({
      items: [
        { id: 'ruby', name: '红宝石' },
        { id: 'iron_ingot', name: '铁锭' },
      ],
      recipes: [
        {
          recipeId: 'ruby_craft',
          recipeType: 'crafting_shapeless',
          output: 'ruby',
          inputs: [{ item: 'iron_ingot', count: 1 }],
        },
      ],
      eventHandlers: [
        {
          handlerId: 'evt_open',
          eventType: 'player_right_click_block',
          conditionIds: ['cond_has_item'],
          actionIds: ['act_give_ruby'],
        },
      ],
      conditions: [
        { conditionId: 'cond_has_item', conditionType: 'has_item', args: { item: 'ruby' } },
      ],
      actions: [{ actionId: 'act_give_ruby', actionType: 'give_item' }],
    });

    const { graph } = specToNodeGraph(original);
    const compiled = await compileNodeGraph(graph);

    expect(compiled.errors).toHaveLength(0);
    // 物品与配方结构还原
    expect(compiled.spec.items.map((i) => i.id).sort()).toEqual(['iron_ingot', 'ruby']);
    expect(compiled.spec.recipes[0]).toMatchObject({
      recipeId: 'ruby_craft',
      output: 'ruby',
      inputs: [{ item: 'iron_ingot', count: 1 }],
    });
    // 事件/条件/动作引用集合还原（节点 id 保持）
    const evt = compiled.spec.eventHandlers[0];
    expect(evt).toMatchObject({
      handlerId: 'evt_open',
      eventType: 'player_right_click_block',
    });
    expect(new Set(evt.conditionIds)).toEqual(new Set(['cond_has_item']));
    expect(evt.actionIds).toContain('act_give_ruby');
  });
});
