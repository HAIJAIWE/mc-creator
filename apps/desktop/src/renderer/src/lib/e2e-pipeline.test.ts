import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { compileNodeGraph } from './compileNodeGraph.js';
import { FabricAdapter } from '@mc-creator/core/generators/mod/fabric-adapter.js';
import type { NodeGraph, FileNode, GeneratorContext } from '@mc-creator/shared';
import { ModNode, ModEdge, NodeKind } from '@mc-creator/shared';

/**
 * E2E 管线测试：NodeGraph → compileNodeGraph → FabricAdapter → Java 代码
 *
 * 覆盖场景：
 * 1. 全类型节点图编译 + Java 生成
 * 2. if/else 事件逻辑验证（invert=true/false）
 * 3. customCode 嵌入验证
 * 4. 子图嵌套 + 条件反转验证
 */

function makeNode(id: string, kind: NodeKind, extra: Partial<ModNode['data']> = {}): ModNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { nodeId: id, kind, ...extra } as ModNode['data'],
    ports: [],
    selected: false,
  };
}

function makeEdge(
  id: string,
  source: string,
  target: string,
  extra: Partial<ModEdge> = {},
): ModEdge {
  return {
    id,
    source,
    target,
    disabled: false,
    ...extra,
  } as ModEdge;
}

function makeGraph(nodes: ModNode[], edges: ModEdge[], modId: string): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

function makeContext(spec: any): GeneratorContext {
  return {
    spec,
    mcVersion: '1.21.11',
    loader: 'fabric',
    modId: spec.modId,
    projectPath: '',
  };
}

/**
 * 场景 1：全类型节点图编译 + Java 生成
 */
describe('场景 1：全类型节点图编译 + Java 生成', () => {
  let compileResult: Awaited<ReturnType<typeof compileNodeGraph>>;
  let files: FileNode[];

  beforeAll(async () => {
    const nodes = [
      makeNode('n_item_copper', 'item', { itemId: 'copper_ingot', displayName: '铜锭' }),
      makeNode('n_item_bronze', 'item', { itemId: 'bronze_ingot', displayName: '青铜锭' }),
      makeNode('n_block', 'block', { blockId: 'bronze_block', displayName: '青铜块' }),
      makeNode('n_recipe', 'recipe', {
        recipeId: 'bronze_recipe',
        recipeType: 'crafting_shapeless',
        outputCount: 1,
      }),
      makeNode('n_entity', 'entity', {
        entityId: 'fire_elemental',
        displayName: '火元素',
        classification: 'monster',
        modelType: 'zombie',
      }),
      makeNode('n_machine', 'machine', {
        machineId: 'ore_crusher',
        displayName: '矿石粉碎机',
      }),
      makeNode('n_code', 'code', {
        language: 'java',
        code: 'return input + 1;',
        inputSignature: '{"input": "integer"}',
        outputSignature: '{"result": "integer"}',
        methodName: 'process',
      }),
      makeNode('n_multiblock', 'multiblock', {
        structureId: 'crusher_structure',
        displayName: '粉碎机结构',
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 1 },
      }),
      makeNode('n_event', 'event', { eventType: 'player_right_click_block' }),
      makeNode('n_condition', 'condition', {
        conditionType: 'has_item',
        conditionArgs: '{"item": "minecraft:stick"}',
        invert: false,
      }),
      makeNode('n_action', 'action', {
        actionType: 'spawn_entity',
        actionArgs: '{"entity": "minecraft:zombie"}',
      }),
    ];

    const edges = [
      makeEdge('e_in', 'n_item_copper', 'n_recipe', {
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
      }),
      makeEdge('e_out', 'n_recipe', 'n_item_bronze', {
        sourceHandle: 'out',
        kind: 'craft',
      }),
      makeEdge('e_evt_cond', 'n_event', 'n_condition', {
        sourceHandle: 'trigger',
        targetHandle: 'in',
        kind: 'control',
      }),
      makeEdge('e_cond_act', 'n_condition', 'n_action', {
        sourceHandle: 'true',
        targetHandle: 'in',
        kind: 'control',
      }),
    ];

    const graph = makeGraph(
      [
        makeNode('n_item_copper', 'item', { itemId: 'copper_ingot', displayName: '铜锭' }),
        makeNode('n_item_bronze', 'item', { itemId: 'bronze_ingot', displayName: '青铜锭' }),
        makeNode('n_block', 'block', { blockId: 'bronze_block', displayName: '青铜块' }),
        makeNode('n_recipe', 'recipe', {
          recipeId: 'bronze_recipe',
          recipeType: 'crafting_shapeless',
          outputCount: 1,
        }),
        makeNode('n_entity', 'entity', {
          entityId: 'fire_elemental',
          displayName: '火元素',
          classification: 'monster',
          modelType: 'zombie',
        }),
        makeNode('n_machine', 'machine', {
          machineId: 'ore_crusher',
          displayName: '矿石粉碎机',
        }),
        makeNode('n_code', 'code', {
          language: 'java',
          code: 'return input + 1;',
          inputSignature: '{"input": "integer"}',
          outputSignature: '{"result": "integer"}',
          methodName: 'process',
        }),
        makeNode('n_multiblock', 'multiblock', {
          structureId: 'crusher_structure',
          displayName: '粉碎机结构',
          width: 3,
          height: 3,
          depth: 3,
          hollow: true,
          controllerOffset: { x: 1, y: 1, z: 1 },
        }),
        makeNode('n_event', 'event', { eventType: 'player_right_click_block' }),
        makeNode('n_condition', 'condition', {
          conditionType: 'has_item',
          conditionArgs: '{"item": "minecraft:stick"}',
          invert: false,
        }),
        makeNode('n_action', 'action', {
          actionType: 'spawn_entity',
          actionArgs: '{"entity": "minecraft:zombie"}',
        }),
      ],
      [
        makeEdge('e_in', 'n_item_copper', 'n_recipe', {
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'craft',
        }),
        makeEdge('e_out', 'n_recipe', 'n_item_bronze', {
          sourceHandle: 'out',
          kind: 'craft',
        }),
        makeEdge('e_evt_cond', 'n_event', 'n_condition', {
          sourceHandle: 'trigger',
          targetHandle: 'in',
          kind: 'control',
        }),
        makeEdge('e_cond_act', 'n_condition', 'n_action', {
          sourceHandle: 'true',
          targetHandle: 'in',
          kind: 'control',
        }),
      ],
      'test_mod',
    );

    const compileResult = await compileNodeGraph(graph);
    const files = new FabricAdapter().translate(makeContext(compileResult.spec));
    (globalThis as any).__e2e_compileResult1 = { compileResult, files };
  });

  beforeEach(() => {
    const { compileResult, files } = (globalThis as any).__e2e_compileResult1;
    (globalThis as any).__e2e_compileResult = { compileResult, files };
  });

  it('编译包含所有节点类型的图，spec 字段完整且无 error', () => {
    const { compileResult } = (globalThis as any).__e2e_compileResult;
    expect(compileResult.errors).toEqual([]);
    expect(compileResult.spec.items).toHaveLength(2);
    expect(compileResult.spec.blocks).toHaveLength(1);
    expect(compileResult.spec.recipes).toHaveLength(1);
    expect(compileResult.spec.entities).toHaveLength(1);
    expect(compileResult.spec.machines).toHaveLength(1);
    expect(compileResult.spec.customCode).toHaveLength(1);
    expect(compileResult.spec.multiblocks).toHaveLength(1);
    expect(compileResult.spec.eventHandlers).toHaveLength(1);
    expect(compileResult.spec.eventHandlers[0].conditionIds).toHaveLength(1);
    expect(compileResult.spec.eventHandlers[0].actionIds).toHaveLength(1);
    expect(compileResult.spec.conditions).toHaveLength(1);
    expect(compileResult.spec.actions).toHaveLength(1);
  });

  it('FabricAdapter 生成 ModItems.java（含 BRONZE_INGOT 注册）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const items = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModItems.java',
    );
    expect(items).toBeDefined();
    expect(items!.content).toContain('BRONZE_INGOT');
    expect(items!.content).toContain('"bronze_ingot"');
    expect(items!.content).toContain('COPPER_INGOT');
    expect(items!.content).toContain('"copper_ingot"');
  });

  it('FabricAdapter 生成 ModBlocks.java（含 BRONZE_BLOCK 注册）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const blocks = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModBlocks.java',
    );
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('BRONZE_BLOCK');
    expect(blocks!.content).toContain('"bronze_block"');
  });

  it('FabricAdapter 生成 ModRecipes.java（含 bronze_recipe）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const recipes = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModRecipes.java',
    );
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('bronze_recipe');
    expect(recipes!.content).toContain('BRONZE_RECIPE_ID');
  });

  it('FabricAdapter 生成 ModEntities.java（含 FIRE_ELEMENTAL 注册）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const entities = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModEntities.java',
    );
    expect(entities).toBeDefined();
    expect(entities!.content).toContain('FIRE_ELEMENTAL');
    expect(entities!.content).toContain('"fire_elemental"');
  });

  it('FabricAdapter 生成 ModMachines.java（含 ORE_CRUSHER 注册）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const machines = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModMachines.java',
    );
    expect(machines).toBeDefined();
    expect(machines!.content).toContain('ORE_CRUSHER');
    expect(machines!.content).toContain('"ore_crusher"');
  });

  it('FabricAdapter 生成 ModCustomCode.java（含 process 方法 + 用户代码）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const code = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModCustomCode.java',
    );
    expect(code).toBeDefined();
    expect(code!.content).toContain('public static');
    expect(code!.content).toContain('process(');
    expect(code!.content).toContain('return input + 1;');
  });

  it('FabricAdapter 生成 ModMultiblocks.java（含 CRUSHER_STRUCTURE 常量）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const multiblocks = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModMultiblocks.java',
    );
    expect(multiblocks).toBeDefined();
    expect(multiblocks!.content).toContain('CRUSHER_STRUCTURE');
    expect(multiblocks!.content).toContain('"crusher_structure"');
  });

  it('FabricAdapter 生成 ModEvents.java（含 handle_ 方法 + if/execute 逻辑）', () => {
    const { files } = (globalThis as any).__e2e_compileResult;
    const events = files.find(
      (f: FileNode) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain('handle_');
    expect(events!.content).toContain('if (');
    expect(events!.content).toContain('check_');
    expect(events!.content).toContain('execute_');
  });
});

/**
 * 场景 2：if/else 事件逻辑验证
 */
describe('场景 2：if/else 事件逻辑验证', () => {
  let eventsFile: FileNode;

  beforeAll(async () => {
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_right_click_block' }),
      makeNode('c1', 'condition', {
        conditionType: 'has_item',
        conditionArgs: '{"item": "minecraft:stick"}',
        invert: false,
      }),
      makeNode('a1', 'action', {
        actionType: 'spawn_entity',
        actionArgs: '{"entity": "minecraft:zombie"}',
      }),
    ];
    const edges = [
      makeEdge('ec1', 'e1', 'c1', {
        sourceHandle: 'trigger',
        targetHandle: 'in',
        kind: 'control',
      }),
      makeEdge('ca1', 'c1', 'a1', {
        sourceHandle: 'true',
        targetHandle: 'in',
        kind: 'control',
      }),
    ];
    const graph = makeGraph(nodes, edges, 'test_mod');
    const compileResult = await compileNodeGraph(graph);
    const files = new FabricAdapter().translate(makeContext(compileResult.spec));
    eventsFile = files.find((f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java')!;
    (globalThis as any).__e2e_eventsFile = eventsFile;
  });

  beforeEach(() => {
    eventsFile = (globalThis as any).__e2e_eventsFile;
  });

  it('ModEvents.java 包含 handle_ 方法（事件处理器）', () => {
    expect(eventsFile).toBeDefined();
    expect(eventsFile!.content).toContain('handle_');
    expect(eventsFile!.content).toMatch(/private\s+static\s+void\s+handle_e1\s*\(/);
  });

  it('ModEvents.java 包含 if ( + check_ 调用（条件判断）', () => {
    expect(eventsFile!.content).toContain('if (');
    expect(eventsFile!.content).toContain('check_c1');
    expect(eventsFile!.content).toContain('if (check_c1(ctx))');
  });

  it('ModEvents.java 包含 execute_ 调用（动作执行）', () => {
    expect(eventsFile!.content).toContain('execute_a1');
    expect(eventsFile!.content).toContain('execute_a1(ctx);');
  });

  it('ModEvents.java 包含 check_ 方法定义（条件检查，has_item 生成真实逻辑）', () => {
    expect(eventsFile!.content).toMatch(
      /private\s+static\s+boolean\s+check_c1\s*\(\s*EventContext\s+ctx\s*\)/,
    );
    expect(eventsFile!.content).toContain('countItem(');
    expect(eventsFile!.content).not.toContain('// TODO: 实现 has_item 检查逻辑');
  });

  it('ModEvents.java 包含 execute_ 方法定义（spawn_entity 生成真实逻辑）', () => {
    expect(eventsFile!.content).toMatch(
      /private\s+static\s+void\s+execute_a1\s*\(\s*EventContext\s+ctx\s*\)/,
    );
    expect(eventsFile!.content).toContain('ctx.level.addFreshEntity(');
    expect(eventsFile!.content).not.toContain('// TODO: 实现 spawn_entity 执行逻辑');
  });

  it('condition 的 invert=true 时，if 中有 !check_ 调用', async () => {
    const invertNodes = [
      makeNode('e1', 'event', { eventType: 'player_right_click_block' }),
      makeNode('c1', 'condition', {
        conditionType: 'has_item',
        conditionArgs: '{"item": "minecraft:stick"}',
        invert: true,
      }),
      makeNode('a1', 'action', { actionType: 'spawn_entity' }),
    ];
    const invertEdges = [
      makeEdge('ec1', 'e1', 'c1', {
        sourceHandle: 'trigger',
        targetHandle: 'in',
        kind: 'control',
      }),
      makeEdge('ca1', 'c1', 'a1', {
        sourceHandle: 'true',
        targetHandle: 'in',
        kind: 'control',
      }),
    ];
    const invertGraph = makeGraph(invertNodes, invertEdges, 'test_mod');
    const invertResult = await compileNodeGraph(invertGraph);
    expect(invertResult.spec.conditions[0].invert).toBe(true);
    const invertEvents = new FabricAdapter()
      .translate(makeContext(invertResult.spec))
      .find((f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java')!;
    expect(invertEvents).toBeDefined();
    expect(invertEvents!.content).toContain('!check_c1(ctx)');
    expect(invertEvents!.content).toContain('if (!check_c1(ctx))');
  });
});

/**
 * 场景 3：customCode 嵌入验证
 */
describe('场景 3：customCode 嵌入验证', () => {
  let codeFile: FileNode;

  beforeAll(async () => {
    const nodes = [
      makeNode('code1', 'code', {
        language: 'java',
        code: 'return input + 1;',
        inputSignature: '{"input": "integer"}',
        outputSignature: '{"result": "integer"}',
        methodName: 'process',
      }),
    ];
    const graph = makeGraph(nodes, [], 'test_mod');
    const compileResult = await compileNodeGraph(graph);
    const files = new FabricAdapter().translate(makeContext(compileResult.spec));
    codeFile = files.find(
      (f) => f.path === 'src/main/java/com/example/test_mod/ModCustomCode.java',
    )!;
    (globalThis as any).__e2e_codeFile = codeFile;
  });

  beforeEach(() => {
    codeFile = (globalThis as any).__e2e_codeFile;
  });

  it('ModCustomCode.java 包含 public static 方法（methodName: process）', () => {
    expect(codeFile).toBeDefined();
    expect(codeFile!.content).toMatch(/public\s+static\s+\w+\s+process\s*\(/);
  });

  it('ModCustomCode.java 包含用户代码 return input + 1;', () => {
    expect(codeFile!.content).toContain('return input + 1;');
  });

  it('ModCustomCode.java 包含 inputSignature/outputSignature 的 JSON 注释', () => {
    expect(codeFile!.content).toContain('// inputSignature:');
    expect(codeFile!.content).toContain('// outputSignature:');
  });
});

/**
 * 场景 4：子图嵌套 + 条件反转验证
 */
describe('场景 4：子图嵌套 + 条件反转验证', () => {
  it('子图封装后的 condition invert=true 在 ModEvents.java 中生成 !check_', async () => {
    // 1. 先构造两个 item 节点
    const id1 = 'i1';
    const id2 = 'i2';
    const innerNodes = [
      makeNode(id1, 'item', { itemId: 'sword_1', displayName: '剑' }),
      makeNode(id2, 'item', { itemId: 'shield_1', displayName: '盾' }),
    ];

    // 2. 封装为子图
    const sgNodes = [
      makeNode('sg1', 'subgraph', {
        subgraphId: 'sg_inner',
        subgraphName: '内层',
        customTypeId: null,
        kind: 'subgraph',
      }),
    ];
    const sgEdges = [];
    const innerGraph = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: innerNodes,
      edges: [],
      subgraphs: {
        sg_inner: { id: 'sg_inner', name: '内层', nodes: innerNodes, edges: [], portMappings: [] },
      },
    };

    // 3. 外层图：事件 -> 条件(invert=true) -> 动作
    const outerNodes = [
      makeNode('e1', 'event', { eventType: 'player_right_click_block' }),
      makeNode('c1', 'condition', {
        conditionType: 'has_item',
        conditionArgs: '{"item": "minecraft:diamond"}',
        invert: true,
      }),
      makeNode('a1', 'action', { actionType: 'spawn_entity' }),
      makeNode('sg_outer', 'subgraph', {
        subgraphId: 'sg_inner',
        subgraphName: '内层',
        customTypeId: null,
        kind: 'subgraph',
      }),
    ];
    const outerEdges = [
      makeEdge('ec1', 'e1', 'c1', { sourceHandle: 'trigger', targetHandle: 'in', kind: 'control' }),
      makeEdge('ca1', 'c1', 'a1', { sourceHandle: 'true', targetHandle: 'in', kind: 'control' }),
    ];

    // 合并图（手动组装完整图）
    const fullGraph: NodeGraph = {
      version: 1,
      modId: 'test_mod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [...innerNodes, ...outerNodes],
      edges: [
        makeEdge('ec1', 'e1', 'c1', {
          sourceHandle: 'trigger',
          targetHandle: 'in',
          kind: 'control',
        }),
        makeEdge('ca1', 'c1', 'a1', { sourceHandle: 'true', targetHandle: 'in', kind: 'control' }),
      ],
      subgraphs: {
        sg_inner: { id: 'sg_inner', name: '内层', nodes: innerNodes, edges: [], portMappings: [] },
      },
    };

    const compileResult = await compileNodeGraph(fullGraph);
    expect(compileResult.spec.conditions[0].invert).toBe(true);
    const eventsFile = new FabricAdapter()
      .translate(makeContext(compileResult.spec))
      .find((f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java')!;
    expect(eventsFile).toBeDefined();
    expect(eventsFile!.content).toContain('!check_c1(ctx)');
    expect(eventsFile!.content).toContain('if (!check_c1(ctx))');
  });
});
