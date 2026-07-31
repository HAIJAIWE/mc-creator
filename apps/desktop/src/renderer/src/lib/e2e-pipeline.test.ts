import { describe, it, expect } from 'vitest';
import { compileNodeGraph } from './compileNodeGraph.js';
import { FabricAdapter } from '@mc-creator/core';
import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeData,
  NodeKind,
  NodePort,
  GeneratorContext,
} from '@mc-creator/shared';

// === 测试辅助函数 ===
// 与 compileNodeGraph.test.ts 中的辅助函数保持一致（复刻，不 import）。
// node-graph-store.ts 中的 createDefaultNodeData / createDefaultPorts 未导出，
// 且任务约束不允许修改 store 文件，因此在测试文件内复刻同等逻辑。

function createDefaultNodeData(kind: NodeKind): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    formatVersion: 1,
  };
  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'new_item',
        displayName: '新物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: 'new_block',
        displayName: '新方块',
        hardness: 1.0,
        blastResistance: 3.0,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      } as NodeData;
    case 'entity':
      return {
        ...base,
        kind: 'entity',
        entityId: 'new_entity',
        displayName: '新生物',
        maxHealth: 20,
        attackDamage: 0,
        movementSpeed: 0.3,
        classification: 'misc',
        modelType: 'pig',
        spawnWeight: 0,
        spawnBiomes: [],
      } as NodeData;
    case 'recipe':
      return {
        ...base,
        kind: 'recipe',
        recipeId: 'new_recipe',
        recipeType: 'crafting_shaped',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      } as NodeData;
    case 'machine':
      return {
        ...base,
        kind: 'machine',
        machineId: 'new_machine',
        displayName: '新机器',
        energyCapacity: 10000,
        maxEnergyTransfer: 100,
        inputSlots: 1,
        outputSlots: 1,
        defaultProcessTime: 200,
        defaultEnergyPerTick: 10,
        guiWidth: 176,
        guiHeight: 166,
      } as NodeData;
    case 'multiblock':
      return {
        ...base,
        kind: 'multiblock',
        structureId: 'new_structure',
        displayName: '新多方块结构',
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 0 },
      } as NodeData;
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'player_right_click_block',
        eventArgs: '{}',
      } as NodeData;
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        invert: false,
      } as NodeData;
    case 'action':
      return {
        ...base,
        kind: 'action',
        actionType: 'spawn_entity',
        actionArgs: '{}',
      } as NodeData;
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '// test',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      } as NodeData;
    case 'comment':
      return {
        ...base,
        kind: 'comment',
        text: '备注',
        color: 'yellow',
      } as NodeData;
    case 'variable':
      return {
        ...base,
        kind: 'variable',
        varName: 'var1',
        varType: 'int',
        value: 0,
        isConstant: false,
      } as NodeData;
    case 'subgraph':
      return {
        ...base,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: null,
        customFields: {},
      } as NodeData;
    case 'loop':
      return {
        ...base,
        kind: 'loop',
        loopType: 'for',
        init: 'int i = 0',
        condition: 'i < 10',
        update: 'i++',
        loopVarName: 'i',
        loopVarType: 'int',
      } as NodeData;
    case 'procedure':
      // P1-3：过程节点默认数据（测试辅助）
      return {
        ...base,
        kind: 'procedure',
        procedureName: 'myProcedure',
        displayName: '新过程',
      } as NodeData;
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

function createDefaultPorts(kind: NodeKind): NodePort[] {
  switch (kind) {
    case 'item':
      return [
        {
          id: 'out',
          label: '物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'block':
      return [
        {
          id: 'out',
          label: '方块',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'entity':
      return [
        {
          id: 'out',
          label: '实体',
          type: 'entity',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'recipe':
      return [
        {
          id: 'in',
          label: '材料',
          type: 'item_stack',
          direction: 'in',
          required: true,
          multiple: true,
        },
        {
          id: 'out',
          label: '产物',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'machine':
      return [
        {
          id: 'in_item',
          label: '输入物品',
          type: 'item_stack',
          direction: 'in',
          required: false,
          multiple: true,
        },
        {
          id: 'in_energy',
          label: '能源输入',
          type: 'energy',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out_item',
          label: '输出物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'multiblock':
      return [
        {
          id: 'controller',
          label: '控制器',
          type: 'block_state',
          direction: 'in',
          required: true,
          multiple: false,
        },
        {
          id: 'out',
          label: '结构',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'event':
      return [
        {
          id: 'trigger',
          label: '触发',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'condition':
      return [
        {
          id: 'in',
          label: '输入',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'true',
          label: '真',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
        {
          id: 'false',
          label: '假',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'action':
      return [
        {
          id: 'in',
          label: '执行',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out',
          label: '完成',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'code':
      return [
        { id: 'in', label: '输入', type: 'any', direction: 'in', required: false, multiple: false },
        {
          id: 'out',
          label: '输出',
          type: 'any',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'comment':
      return [];
    default:
      return [];
  }
}

/** 构造测试用节点，覆盖默认 data 字段 */
function makeNode(id: string, kind: NodeKind, overrides?: Record<string, unknown>): ModNode {
  const baseData = createDefaultNodeData(kind);
  const merged = { ...baseData, ...overrides, nodeId: id } as NodeData;
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: merged,
    ports: createDefaultPorts(kind),
    selected: false,
  };
}

/** 构造测试用边 */
function makeEdge(
  id: string,
  source: string,
  target: string,
  opts?: {
    sourceHandle?: string;
    targetHandle?: string;
    kind?: ModEdge['kind'];
    disabled?: boolean;
  },
): ModEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts?.sourceHandle,
    targetHandle: opts?.targetHandle,
    kind: opts?.kind ?? 'craft',
    disabled: opts?.disabled ?? false,
  };
}

/** 构造测试用节点图 */
function makeGraph(nodes: ModNode[], edges: ModEdge[] = [], modId = 'test'): NodeGraph {
  return {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };
}

/** 用 FabricAdapter 把 ModSpec 翻译为 FileNode[] */
function generateFiles(spec: GeneratorContext['spec']) {
  const adapter = new FabricAdapter();
  const ctx: GeneratorContext = {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_mod',
    spec,
    projectPath: '',
  };
  return adapter.translate(ctx);
}

// === 测试用例 ===

describe('端到端管线：NodeGraph → compileNodeGraph → FabricAdapter → Java', () => {
  describe('场景 1：全类型节点图编译 + Java 生成', () => {
    // 构造包含所有节点类型的 NodeGraph
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
      // recipe：copper_ingot → bronze_recipe → bronze_ingot
      makeEdge('e_in', 'n_item_copper', 'n_recipe', {
        sourceHandle: 'out',
        targetHandle: 'in',
        kind: 'craft',
      }),
      makeEdge('e_out', 'n_recipe', 'n_item_bronze', {
        sourceHandle: 'out',
        kind: 'craft',
      }),
      // 控制流：event → condition → action
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

    const graph = makeGraph(nodes, edges, 'test_mod');
    const compileResult = compileNodeGraph(graph);
    const files = generateFiles(compileResult.spec);

    it('编译包含所有节点类型的图，spec 字段完整且无 error', () => {
      expect(compileResult.errors).toEqual([]);
      // 各 spec 字段数量符合预期
      expect(compileResult.spec.items).toHaveLength(2);
      expect(compileResult.spec.blocks).toHaveLength(1);
      expect(compileResult.spec.recipes).toHaveLength(1);
      expect(compileResult.spec.entities).toHaveLength(1);
      expect(compileResult.spec.machines).toHaveLength(1);
      expect(compileResult.spec.customCode).toHaveLength(1);
      expect(compileResult.spec.multiblocks).toHaveLength(1);
      expect(compileResult.spec.eventHandlers).toHaveLength(1);
      // event handler 应收集到 1 个 condition 和 1 个 action
      expect(compileResult.spec.eventHandlers[0].conditionIds).toHaveLength(1);
      expect(compileResult.spec.eventHandlers[0].actionIds).toHaveLength(1);
      expect(compileResult.spec.conditions).toHaveLength(1);
      expect(compileResult.spec.actions).toHaveLength(1);
    });

    it('FabricAdapter 生成 ModItems.java（含 BRONZE_INGOT 注册）', () => {
      const items = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModItems.java',
      );
      expect(items).toBeDefined();
      expect(items!.content).toContain('BRONZE_INGOT');
      expect(items!.content).toContain('"bronze_ingot"');
      // 也应包含 copper_ingot 注册
      expect(items!.content).toContain('COPPER_INGOT');
      expect(items!.content).toContain('"copper_ingot"');
    });

    it('FabricAdapter 生成 ModBlocks.java（含 BRONZE_BLOCK 注册）', () => {
      const blocks = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModBlocks.java',
      );
      expect(blocks).toBeDefined();
      expect(blocks!.content).toContain('BRONZE_BLOCK');
      expect(blocks!.content).toContain('"bronze_block"');
    });

    it('FabricAdapter 生成 ModRecipes.java（含 bronze_recipe）', () => {
      const recipes = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModRecipes.java',
      );
      expect(recipes).toBeDefined();
      expect(recipes!.content).toContain('bronze_recipe');
      expect(recipes!.content).toContain('BRONZE_RECIPE_ID');
    });

    it('FabricAdapter 生成 ModEntities.java（含 FIRE_ELEMENTAL 注册）', () => {
      const entities = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModEntities.java',
      );
      expect(entities).toBeDefined();
      expect(entities!.content).toContain('FIRE_ELEMENTAL');
      expect(entities!.content).toContain('"fire_elemental"');
    });

    it('FabricAdapter 生成 ModMachines.java（含 ORE_CRUSHER 注册）', () => {
      const machines = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModMachines.java',
      );
      expect(machines).toBeDefined();
      expect(machines!.content).toContain('ORE_CRUSHER');
      expect(machines!.content).toContain('"ore_crusher"');
    });

    it('FabricAdapter 生成 ModCustomCode.java（含 process 方法 + 用户代码）', () => {
      const code = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModCustomCode.java',
      );
      expect(code).toBeDefined();
      expect(code!.content).toContain('public static');
      expect(code!.content).toContain('process(');
      expect(code!.content).toContain('return input + 1;');
    });

    it('FabricAdapter 生成 ModMultiblocks.java（含 CRUSHER_STRUCTURE 常量）', () => {
      const multiblocks = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModMultiblocks.java',
      );
      expect(multiblocks).toBeDefined();
      expect(multiblocks!.content).toContain('CRUSHER_STRUCTURE');
      expect(multiblocks!.content).toContain('"crusher_structure"');
    });

    it('FabricAdapter 生成 ModEvents.java（含 handle_ 方法 + if/execute 逻辑）', () => {
      const events = files.find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java',
      );
      expect(events).toBeDefined();
      expect(events!.content).toContain('handle_');
      expect(events!.content).toContain('if (');
      expect(events!.content).toContain('check_');
      expect(events!.content).toContain('execute_');
    });
  });

  describe('场景 2：if/else 事件逻辑验证', () => {
    // 构造 event → condition(invert=false) → action 的图
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
    const compileResult = compileNodeGraph(makeGraph(nodes, edges, 'test_mod'));
    const eventsFile = generateFiles(compileResult.spec).find(
      (f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java',
    )!;

    it('ModEvents.java 包含 handle_ 方法（事件处理器）', () => {
      expect(eventsFile).toBeDefined();
      expect(eventsFile!.content).toContain('handle_e1');
      // private static void handle_e1(Object event)
      expect(eventsFile!.content).toMatch(/private\s+static\s+void\s+handle_e1\s*\(/);
    });

    it('ModEvents.java 包含 if ( + check_ 调用（条件判断）', () => {
      expect(eventsFile!.content).toContain('if (');
      expect(eventsFile!.content).toContain('check_c1');
      // invert=false 时不应出现 !check_
      expect(eventsFile!.content).toContain('if (check_c1(event))');
    });

    it('ModEvents.java 包含 execute_ 调用（动作执行）', () => {
      expect(eventsFile!.content).toContain('execute_a1');
      expect(eventsFile!.content).toContain('execute_a1(event);');
    });

    it('ModEvents.java 包含 check_ 方法定义（条件检查，return true 占位）', () => {
      expect(eventsFile!.content).toMatch(
        /private\s+static\s+boolean\s+check_c1\s*\(\s*Object\s+event\s*\)/,
      );
      expect(eventsFile!.content).toContain('return true;');
    });

    it('ModEvents.java 包含 execute_ 方法定义（TODO 占位）', () => {
      expect(eventsFile!.content).toMatch(
        /private\s+static\s+void\s+execute_a1\s*\(\s*Object\s+event\s*\)/,
      );
      expect(eventsFile!.content).toContain('TODO');
    });

    it('condition 的 invert=true 时，if 中有 !check_ 调用', () => {
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
      const invertResult = compileNodeGraph(makeGraph(invertNodes, invertEdges, 'test_mod'));
      // 顶层 condition 应记录 invert=true
      expect(invertResult.spec.conditions[0].invert).toBe(true);
      const invertEvents = generateFiles(invertResult.spec).find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java',
      )!;
      expect(invertEvents).toBeDefined();
      expect(invertEvents!.content).toContain('!check_c1(event)');
      expect(invertEvents!.content).toContain('if (!check_c1(event))');
    });
  });

  describe('场景 3：customCode 嵌入验证', () => {
    const nodes = [
      makeNode('code1', 'code', {
        language: 'java',
        code: 'return input + 1;',
        inputSignature: '{"input": "integer"}',
        outputSignature: '{"result": "integer"}',
        methodName: 'process',
      }),
    ];
    const compileResult = compileNodeGraph(makeGraph(nodes, [], 'test_mod'));
    const codeFile = generateFiles(compileResult.spec).find(
      (f) => f.path === 'src/main/java/com/example/test_mod/ModCustomCode.java',
    )!;

    it('ModCustomCode.java 包含 public static 方法（methodName: process）', () => {
      expect(codeFile).toBeDefined();
      expect(codeFile!.content).toMatch(/public\s+static\s+\w+\s+process\s*\(/);
    });

    it('ModCustomCode.java 包含用户代码 return input + 1;', () => {
      expect(codeFile!.content).toContain('return input + 1;');
    });

    it('ModCustomCode.java 包含 inputSignature/outputSignature 的 JSON 注释', () => {
      // 注释格式：
      //   // snippetId: <id> (language: <lang>)
      //   // inputSignature:  {...}
      //   // outputSignature: {...}
      expect(codeFile!.content).toContain('snippetId:');
      expect(codeFile!.content).toContain('inputSignature:');
      expect(codeFile!.content).toContain('outputSignature:');
      // 验证 JSON 内容被正确序列化（key 与 value 都出现）
      expect(codeFile!.content).toContain('"input"');
      expect(codeFile!.content).toContain('integer');
      expect(codeFile!.content).toContain('"result"');
    });
  });

  describe('场景 4：空 event handler（无 condition/action）验证', () => {
    // 构造一个只有 event 节点、没有 condition/action 节点的图
    const nodes = [
      makeNode('e1', 'event', {
        eventType: 'player_right_click_block',
        eventArgs: '{"hand": "main_hand"}',
      }),
    ];
    const compileResult = compileNodeGraph(makeGraph(nodes, [], 'test_mod'));

    it('编译后 eventHandlers[0].conditionIds/actionIds 为空数组', () => {
      expect(compileResult.errors).toEqual([]);
      expect(compileResult.spec.eventHandlers).toHaveLength(1);
      const handler = compileResult.spec.eventHandlers[0];
      expect(handler.conditionIds).toEqual([]);
      expect(handler.actionIds).toEqual([]);
    });

    it('ModEvents.java 中 handle_ 方法体含 // (无关联 condition 与 action) 注释', () => {
      const eventsFile = generateFiles(compileResult.spec).find(
        (f) => f.path === 'src/main/java/com/example/test_mod/ModEvents.java',
      );
      expect(eventsFile).toBeDefined();
      expect(eventsFile!.content).toContain('handle_e1');
      expect(eventsFile!.content).toContain('// (无关联 condition 与 action)');
    });
  });
});
