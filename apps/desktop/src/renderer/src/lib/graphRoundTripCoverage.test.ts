import { describe, it, expect, afterEach } from 'vitest';
import { ModSpec } from '@mc-creator/shared';
import type { ModEdge, ModNode, NodeData, NodeGraph, NodeKind } from '@mc-creator/shared';
import { compileNodeGraph } from './compileNodeGraph.js';
import { specToNodeGraph } from './specToNodeGraph.js';
import { createDefaultNodeData } from '../store/node-graph-store.js';
import { getPorts } from '../domain/portSchemas.js';
import { customNodeRegistry } from '../domain/customNodeRegistry.js';
import { NODE_METADATA } from '../components/lowcode/nodes/index.js';

/**
 * 节点图 19 种类型「逐个」往返一致性覆盖（架构约束）。
 *
 * 已有 graphRoundTrip.test.ts 只用一份 richSpec 覆盖少数场景，未按节点类型逐个遍历。
 * 本文件对 NODE_METADATA 前 19 项 kind 逐一做：
 *   单节点（或满足该类型 schema 的最小合法图）
 *     --compileNodeGraph--> ModSpec
 *     --specToNodeGraph--> NodeGraph'
 * 并对每种类型断言：① 节点存活 ② 类型是否不变 ③ 1~2 个代表性字段保真，
 * 且用「编译确有预期产出」做防空转守卫（证明不是空图随便过）。
 *
 * 逐类型结论（调查结果，详见各用例注释）：
 * - 15 种内容/逻辑节点（item/block/entity/recipe/machine/multiblock/event/condition/action/
 *   code/procedure/biome/dimension/fluid/gui）往返后节点存活、类型不变、关键字段保真。
 * - comment：纯画布注释，NODE_METADATA 标注「文档用途，不参与编译」→ 设计上节点消失。
 * - variable / loop / subgraph：画布专有概念，ModSpec 无对应类型，编译进 customCode，
 *   还原时统一成为 code 节点 → 节点 id 与内容均保留，仅 kind 变为 code（有损映射，非数据丢失）。
 */

/** NODE_METADATA 前 19 项 kind（= shared 的 NodeKind 全部 19 种） */
const NODE_TYPES_19: NodeKind[] = [
  'item',
  'block',
  'entity',
  'recipe',
  'machine',
  'multiblock',
  'event',
  'condition',
  'action',
  'code',
  'comment',
  'variable',
  'subgraph',
  'loop',
  'procedure',
  'biome',
  'dimension',
  'fluid',
  'gui',
];

// === 夹具工具（复用 createDefaultNodeData / getPorts，避免与实现漂移）===

/** 构造测试节点：以默认 data 为基底，覆写字段并把 id 同步到 nodeId */
function makeNode(id: string, kind: NodeKind, overrides: Record<string, unknown> = {}): ModNode {
  const baseData = createDefaultNodeData(kind, '');
  const merged = { ...baseData, ...overrides, nodeId: id } as NodeData;
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: merged,
    ports: getPorts(merged),
    selected: false,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  opts: { sourceHandle?: string; targetHandle?: string; kind?: ModEdge['kind'] } = {},
): ModEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts.sourceHandle,
    targetHandle: opts.targetHandle,
    kind: opts.kind ?? 'craft',
    disabled: false,
  };
}

function makeGraph(nodes: ModNode[], edges: ModEdge[] = [], modId = 'cover_mod'): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

/** 图 → compileNodeGraph → specToNodeGraph → 新图 */
async function roundTrip(nodes: ModNode[], edges: ModEdge[] = []) {
  const compiled = await compileNodeGraph(makeGraph(nodes, edges));
  const { graph } = specToNodeGraph(compiled.spec);
  return { compiled, graph };
}

describe('节点图 19 种类型往返一致性覆盖', () => {
  it('覆盖清单 = NODE_METADATA 前 19 项 kind（节点类型漂移守卫）', () => {
    const metaKinds = NODE_METADATA.slice(0, 19).map((m) => m.kind);
    expect(NODE_TYPES_19).toHaveLength(19);
    expect(new Set(NODE_TYPES_19).size).toBe(19);
    expect(NODE_TYPES_19).toEqual(metaKinds);
  });

  it('item：item 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_item', 'item', {
        itemId: 'cover_ruby',
        displayName: '覆盖红宝石',
        rarity: 'epic',
        maxStackSize: 16,
        category: 'sword',
      }),
    ]);

    // 防空转守卫：编译确实产出 1 个物品
    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.items).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.data.kind === 'item' && n.data.itemId === 'cover_ruby');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('item');
    expect(rt?.data.kind).toBe('item');
    expect(rt?.data).toMatchObject({
      itemId: 'cover_ruby',
      displayName: '覆盖红宝石',
      rarity: 'epic',
      maxStackSize: 16,
      category: 'sword',
    });
  });

  it('block：block 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_block', 'block', {
        blockId: 'cover_ore',
        displayName: '覆盖矿石',
        hardness: 3.5,
        blastResistance: 9,
        luminance: 4,
        // 非默认模型类型：曾经会被完全丢弃、往返后坍缩成 cube_all
        modelType: 'cross',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.blocks).toHaveLength(1);
    // 编译必须把模型类型带进 spec（此前 BlockSpec 无此字段，被静默丢弃）
    expect(compiled.spec.blocks?.[0].modelType).toBe('cross');

    const rt = graph.nodes.find((n) => n.data.kind === 'block' && n.data.blockId === 'cover_ore');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('block');
    expect(rt?.data.kind).toBe('block');
    expect(rt?.data).toMatchObject({
      blockId: 'cover_ore',
      displayName: '覆盖矿石',
      hardness: 3.5,
      blastResistance: 9,
      luminance: 4,
      modelType: 'cross',
    });
  });

  it('block：旧 spec 未记录 modelType 时，仍按 blockType 推导（不改变历史行为）', () => {
    // modelType 在 BlockSpec 里是 .optional()（无默认值），所以 ModSpec.parse 不会补齐它，
    // 正好等价于「历史 spec 里没有该字段」。
    const legacy = ModSpec.parse({
      modId: 'legacy',
      name: 'Legacy',
      blocks: [
        { id: 'legacy_full', name: '整块', blockType: 'full_block' },
        { id: 'legacy_slab', name: '半砖', blockType: 'slab' },
      ],
    });
    expect(legacy.blocks[0].modelType).toBeUndefined();

    const { graph } = specToNodeGraph(legacy);
    const full = graph.nodes.find(
      (n) => n.data.kind === 'block' && n.data.blockId === 'legacy_full',
    );
    const slab = graph.nodes.find(
      (n) => n.data.kind === 'block' && n.data.blockId === 'legacy_slab',
    );
    expect(full?.data).toMatchObject({ modelType: 'cube_all' });
    expect(slab?.data).toMatchObject({ modelType: 'custom' });
  });

  it('entity：entity 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_entity', 'entity', {
        entityId: 'cover_golem',
        displayName: '覆盖傀儡',
        maxHealth: 40,
        attackDamage: 6,
        movementSpeed: 0.25,
        classification: 'monster',
        modelType: 'zombie',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.entities).toHaveLength(1);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'entity' && n.data.entityId === 'cover_golem',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('entity');
    expect(rt?.data.kind).toBe('entity');
    expect(rt?.data).toMatchObject({
      entityId: 'cover_golem',
      displayName: '覆盖傀儡',
      maxHealth: 40,
      attackDamage: 6,
      classification: 'monster',
    });
  });

  it('recipe：recipe 节点往返后存活，类型与关键字段保真', async () => {
    // recipe 编译依赖 craft 连边（材料入 / 产物出），故夹具需含 item 节点，这是该类型的最小合法图
    const { compiled, graph } = await roundTrip(
      [
        makeNode('item_in', 'item', { itemId: 'cover_ingot', displayName: '覆盖锭' }),
        makeNode('item_out', 'item', { itemId: 'cover_plate', displayName: '覆盖板' }),
        makeNode('recipe_x', 'recipe', {
          recipeId: 'cover_smelt',
          recipeType: 'smelting',
          cookTime: 150,
          outputCount: 1,
        }),
      ],
      [
        makeEdge('e_in', 'item_in', 'recipe_x', { sourceHandle: 'out', targetHandle: 'in' }),
        makeEdge('e_out', 'recipe_x', 'item_out', { sourceHandle: 'out' }),
      ],
    );

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.recipes).toHaveLength(1);
    expect(compiled.spec.items).toHaveLength(2);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'recipe' && n.data.recipeId === 'cover_smelt',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('recipe');
    expect(rt?.data.kind).toBe('recipe');
    expect(rt?.data).toMatchObject({
      recipeId: 'cover_smelt',
      recipeType: 'smelting',
      cookTime: 150,
      outputCount: 1,
    });
  });

  it('machine：machine 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_machine', 'machine', {
        machineId: 'cover_forge',
        displayName: '覆盖熔炉',
        energyCapacity: 50000,
        maxEnergyTransfer: 500,
        inputSlots: 2,
        outputSlots: 1,
        guiWidth: 200,
        guiHeight: 180,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.machines).toHaveLength(1);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'machine' && n.data.machineId === 'cover_forge',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('machine');
    expect(rt?.data.kind).toBe('machine');
    expect(rt?.data).toMatchObject({
      machineId: 'cover_forge',
      displayName: '覆盖熔炉',
      energyCapacity: 50000,
      inputSlots: 2,
    });
  });

  it('multiblock：multiblock 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_mb', 'multiblock', {
        structureId: 'cover_altar',
        displayName: '覆盖祭坛',
        width: 3,
        height: 3,
        depth: 3,
        hollow: false,
        controllerOffset: { x: 1, y: 1, z: 1 },
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.multiblocks).toHaveLength(1);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'multiblock' && n.data.structureId === 'cover_altar',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('multiblock');
    expect(rt?.data.kind).toBe('multiblock');
    expect(rt?.data).toMatchObject({
      structureId: 'cover_altar',
      displayName: '覆盖祭坛',
      width: 3,
      hollow: false,
      controllerOffset: { x: 1, y: 1, z: 1 },
    });
  });

  it('event：event 节点往返后存活，节点 id/类型/关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('evt_cover', 'event', {
        eventType: 'player_join',
        eventArgs: '{"message":"hi"}',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.eventHandlers).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.id === 'evt_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('event');
    expect(rt?.data.kind).toBe('event');
    if (rt && rt.data.kind === 'event') {
      expect(rt.data.eventType).toBe('player_join');
      expect(JSON.parse(rt.data.eventArgs)).toEqual({ message: 'hi' });
    }
  });

  it('condition：condition 节点往返后存活，节点 id/类型/关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('cond_cover', 'condition', {
        conditionType: 'has_item',
        conditionArgs: '{"item":"cover_ruby"}',
        invert: true,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.conditions).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.id === 'cond_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('condition');
    expect(rt?.data.kind).toBe('condition');
    if (rt && rt.data.kind === 'condition') {
      expect(rt.data.conditionType).toBe('has_item');
      expect(rt.data.invert).toBe(true);
      expect(JSON.parse(rt.data.conditionArgs)).toEqual({ item: 'cover_ruby' });
    }
  });

  it('action：action 节点往返后存活，节点 id/类型/关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('act_cover', 'action', {
        actionType: 'give_item',
        actionArgs: '{"item":"cover_ruby","count":3}',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.actions).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.id === 'act_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('action');
    expect(rt?.data.kind).toBe('action');
    if (rt && rt.data.kind === 'action') {
      expect(rt.data.actionType).toBe('give_item');
      expect(JSON.parse(rt.data.actionArgs)).toEqual({ item: 'cover_ruby', count: 3 });
    }
  });

  it('code：code 节点往返后存活，节点 id/类型/关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('code_cover', 'code', {
        language: 'java',
        code: 'return 42;',
        methodName: 'compute',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.customCode).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.id === 'code_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('code');
    expect(rt?.data.kind).toBe('code');
    if (rt && rt.data.kind === 'code') {
      expect(rt.data.language).toBe('java');
      expect(rt.data.code).toBe('return 42;');
      expect(rt.data.methodName).toBe('compute');
    }
  });

  it('comment：纯画布注释，设计上不参与编译 → 节点在往返后消失（设计如此，非 bug）', async () => {
    const nodes = [makeNode('cmt_cover', 'comment', { text: '仅画布备注', color: 'blue' })];
    const { compiled, graph } = await roundTrip(nodes);

    // 防空转守卫：夹具确有 1 个 comment 节点，而它不产出任何 spec 内容
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.kind).toBe('comment');
    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.items).toEqual([]);
    expect(compiled.spec.customCode).toEqual([]);
    expect(compiled.spec.eventHandlers).toEqual([]);

    // 结论：设计如此。comment 无编译器注册、specToNodeGraph 也不产出 comment，
    // 画布无法把这层「注释」语义带进 ModSpec（与 KNOWN_LOSSY 中数据包类内容同类）。
    expect(graph.nodes).toHaveLength(0);
  });

  it('variable：往返后节点 id 与内容保留，但 kind 变为 code（有损映射，非数据丢失）', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('var_cover', 'variable', {
        varName: 'COVER_MAX',
        varType: 'int',
        value: 42,
        isConstant: true,
      }),
    ]);

    // 防空转守卫：变量确实编译成 1 条 customCode 片段
    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.customCode).toHaveLength(1);
    expect(compiled.spec.customCode[0].snippetId).toBe('var_cover');

    // 画布专有概念：ModSpec 无 variable 类型，编译为 Java 字段声明（customCode），
    // specToNodeGraph 把 customCode 统一还原为 code 节点 → id/内容保留，仅 kind 变 code。
    const rt = graph.nodes.find((n) => n.id === 'var_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('code');
    expect(rt?.data.kind).toBe('code');
    if (rt && rt.data.kind === 'code') {
      expect(rt.data.code).toContain('COVER_MAX');
    }
  });

  it('loop：往返后节点 id 与内容保留，但 kind 变为 code（有损映射，非数据丢失）', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('loop_cover', 'loop', {
        loopType: 'for',
        init: 'int i = 0',
        condition: 'i < 3',
        update: 'i++',
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.customCode).toHaveLength(1);
    expect(compiled.spec.customCode[0].snippetId).toBe('loop_cover');

    const rt = graph.nodes.find((n) => n.id === 'loop_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('code');
    expect(rt?.data.kind).toBe('code');
    if (rt && rt.data.kind === 'code') {
      expect(rt.data.code).toContain('for (');
    }
  });

  it('subgraph：自定义节点形态往返后 id 与渲染代码保留，kind 变为 code（有损映射，非数据丢失）', async () => {
    // 代表性子图夹具取「自定义节点」形态（customTypeId 非空，单节点自包含）；
    // 普通子图容器（customTypeId 为 null）编译时被内联展开，其内部节点取而代之（设计如此）。
    customNodeRegistry.register({
      typeId: 'cover:custom',
      label: '覆盖自定义节点',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
      codeTemplate: 'int s = {{field:speed}};',
    });

    const { compiled, graph } = await roundTrip([
      makeNode('sg_cover', 'subgraph', {
        subgraphId: '',
        customTypeId: 'cover:custom',
        customFields: { speed: 7 },
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.customCode).toHaveLength(1);
    expect(compiled.spec.customCode[0].snippetId).toBe('sg_cover');
    expect(compiled.spec.customCode[0].code).toBe('int s = 7;');

    const rt = graph.nodes.find((n) => n.id === 'sg_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('code');
    expect(rt?.data.kind).toBe('code');
    if (rt && rt.data.kind === 'code') {
      expect(rt.data.code).toBe('int s = 7;');
    }
  });

  it('procedure：procedure 节点往返后存活，节点 id/类型/关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('proc_cover', 'procedure', {
        procedureName: 'coverProcedure',
        displayName: '覆盖过程',
        inputs: [{ name: 'amount', type: 'int' }],
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.procedures).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.id === 'proc_cover');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('procedure');
    expect(rt?.data.kind).toBe('procedure');
    if (rt && rt.data.kind === 'procedure') {
      expect(rt.data.procedureName).toBe('coverProcedure');
      expect(rt.data.displayName).toBe('覆盖过程');
      expect(rt.data.inputs).toEqual([{ name: 'amount', type: 'int' }]);
    }
  });

  it('biome：biome 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_biome', 'biome', {
        biomeId: 'cover_plains',
        displayName: '覆盖平原',
        precipitation: 'snow',
        temperature: -0.5,
        skyColor: 0x88aaff,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.biomes).toHaveLength(1);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'biome' && n.data.biomeId === 'cover_plains',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('biome');
    expect(rt?.data.kind).toBe('biome');
    expect(rt?.data).toMatchObject({
      biomeId: 'cover_plains',
      displayName: '覆盖平原',
      precipitation: 'snow',
      temperature: -0.5,
      skyColor: 0x88aaff,
    });
  });

  it('dimension：dimension 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_dim', 'dimension', {
        dimensionId: 'cover_dim',
        displayName: '覆盖维度',
        baseType: 'nether',
        fixedTime: 6000,
        hasCeiling: true,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.dimensions).toHaveLength(1);

    const rt = graph.nodes.find(
      (n) => n.data.kind === 'dimension' && n.data.dimensionId === 'cover_dim',
    );
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('dimension');
    expect(rt?.data.kind).toBe('dimension');
    expect(rt?.data).toMatchObject({
      dimensionId: 'cover_dim',
      displayName: '覆盖维度',
      baseType: 'nether',
      fixedTime: 6000,
      hasCeiling: true,
    });
  });

  it('fluid：fluid 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_fluid', 'fluid', {
        fluidId: 'cover_juice',
        displayName: '覆盖流体',
        color: 0xff0044,
        temperature: 900,
        luminous: true,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.fluids).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.data.kind === 'fluid' && n.data.fluidId === 'cover_juice');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('fluid');
    expect(rt?.data.kind).toBe('fluid');
    expect(rt?.data).toMatchObject({
      fluidId: 'cover_juice',
      displayName: '覆盖流体',
      color: 0xff0044,
      temperature: 900,
      luminous: true,
    });
  });

  it('gui：gui 节点往返后存活，类型与关键字段保真', async () => {
    const { compiled, graph } = await roundTrip([
      makeNode('n_gui', 'gui', {
        guiId: 'cover_gui',
        displayName: '覆盖界面',
        width: 200,
        height: 190,
        showEnergyBar: true,
      }),
    ]);

    expect(compiled.errors).toEqual([]);
    expect(compiled.spec.guis).toHaveLength(1);

    const rt = graph.nodes.find((n) => n.data.kind === 'gui' && n.data.guiId === 'cover_gui');
    expect(rt).toBeDefined();
    expect(rt?.type).toBe('gui');
    expect(rt?.data.kind).toBe('gui');
    expect(rt?.data).toMatchObject({
      guiId: 'cover_gui',
      displayName: '覆盖界面',
      width: 200,
      height: 190,
      showEnergyBar: true,
    });
  });
});

// 自定义节点注册表为进程单例，用例内注册后清理，避免污染其他测试
afterEach(() => {
  customNodeRegistry.clear();
});
