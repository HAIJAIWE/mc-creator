import { describe, it, expect, beforeEach } from 'vitest';
import {
  compileNodeGraph,
  preloadExternalMods,
  getIncomingEdges,
  getOutgoingEdges,
  findSourceNode,
  findTargetNode,
} from './compileNodeGraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeData,
  NodeKind,
  NodePort,
  SubgraphDefinition,
} from '@mc-creator/shared';

// === 测试辅助函数 ===
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
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: '',
        addition: '',
        inputPotion: 'minecraft:water',
        ingredientItem: '',
        outputPotion: '',
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

// === 测试用例 ===

describe('compileNodeGraph', () => {
  it('空图编译返回空 spec', () => {
    const result = compileNodeGraph(makeGraph([], []));
    expect(result.spec.items).toEqual([]);
    expect(result.spec.blocks).toEqual([]);
    expect(result.spec.recipes).toEqual([]);
    expect(result.spec.entities).toEqual([]);
    expect(result.spec.machines).toEqual([]);
    expect(result.spec.customCode).toEqual([]);
    expect(result.spec.multiblocks).toEqual([]);
    expect(result.spec.eventHandlers).toEqual([]);
    expect(result.spec.conditions).toEqual([]);
    expect(result.spec.actions).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('编译单个 item 节点', () => {
    const itemNode = makeNode('n1', 'item', {
      itemId: 'sword_iron',
      displayName: '铁剑',
      rarity: 'rare',
      maxDamage: 100,
    });
    const result = compileNodeGraph(makeGraph([itemNode]));
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('sword_iron');
    expect(result.spec.items[0].name).toBe('铁剑');
    expect(result.spec.items[0].rarity).toBe('rare');
    expect(result.spec.items[0].maxDamage).toBe(100);
  });

  it('编译单个 block 节点', () => {
    const blockNode = makeNode('n1', 'block', {
      blockId: 'test_block',
      displayName: '测试方块',
      hardness: 5,
      luminance: 12,
    });
    const result = compileNodeGraph(makeGraph([blockNode]));
    expect(result.spec.blocks).toHaveLength(1);
    expect(result.spec.blocks[0].id).toBe('test_block');
    expect(result.spec.blocks[0].name).toBe('测试方块');
    expect(result.spec.blocks[0].hardness).toBe(5);
    expect(result.spec.blocks[0].lightLevel).toBe(12);
  });

  it('编译 item + block 混合图', () => {
    const nodes = [
      makeNode('n1', 'item', { itemId: 'item_a' }),
      makeNode('n2', 'item', { itemId: 'item_b' }),
      makeNode('n3', 'block', { blockId: 'block_c' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    expect(result.spec.items).toHaveLength(2);
    expect(result.spec.blocks).toHaveLength(1);
    expect(result.spec.items.map((i) => i.id).sort()).toEqual(['item_a', 'item_b']);
    expect(result.spec.blocks[0].id).toBe('block_c');
  });

  it('recipe 节点编译到 spec.recipes（含输入/输出物品 id）', () => {
    const nodes = [
      makeNode('n1', 'item', { itemId: 'ingot_copper', displayName: '铜锭' }),
      makeNode('n2', 'item', { itemId: 'ingot_tin', displayName: '锡锭' }),
      makeNode('n3', 'item', { itemId: 'bronze_ingot', displayName: '青铜锭' }),
      makeNode('n4', 'recipe', { recipeId: 'bronze_recipe', outputCount: 2 }),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n4', { sourceHandle: 'out', targetHandle: 'in' }),
      makeEdge('e2', 'n2', 'n4', { sourceHandle: 'out', targetHandle: 'in' }),
      makeEdge('e3', 'n4', 'n3', { sourceHandle: 'out' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    // recipe 应编译到 spec.recipes，不再产生 warning 或 unsupported
    expect(result.spec.recipes).toHaveLength(1);
    const recipe = result.spec.recipes[0];
    expect(recipe.recipeId).toBe('bronze_recipe');
    expect(recipe.output).toBe('bronze_ingot');
    expect(recipe.outputCount).toBe(2);
    expect(recipe.inputs).toHaveLength(2);
    expect(recipe.inputs.map((i) => i.item).sort()).toEqual(['ingot_copper', 'ingot_tin']);

    // 不再产生 recipe 相关 warning
    const recipeWarnings = result.warnings.filter((w) => w.includes('bronze_recipe'));
    expect(recipeWarnings).toEqual([]);
  });

  it('recipe 节点无输出连线时产生 error', () => {
    const recipeNode = makeNode('n1', 'recipe', { recipeId: 'empty_recipe' });
    const result = compileNodeGraph(makeGraph([recipeNode]));

    // 无输出连线应产生 error（而非 warning）
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('empty_recipe');
    expect(result.errors[0]).toContain('没有输出物品连线');

    // spec.recipes 不应包含失败的配方
    expect(result.spec.recipes).toEqual([]);
  });

  it('entity 节点编译到 spec.entities（含关键属性）', () => {
    const entityNode = makeNode('n1', 'entity', {
      entityId: 'fire_elemental',
      displayName: '火元素',
      classification: 'monster',
      modelType: 'zombie',
      maxHealth: 30,
      attackDamage: 8,
      movementSpeed: 0.4,
      spawnWeight: 10,
      spawnBiomes: ['nether', 'basalt_deltas'],
    });
    const result = compileNodeGraph(makeGraph([entityNode]));

    // entity 应编译到 spec.entities，不再产生 warning 或 unsupported
    expect(result.spec.entities).toHaveLength(1);
    const entity = result.spec.entities[0];
    expect(entity.entityId).toBe('fire_elemental');
    expect(entity.displayName).toBe('火元素');
    expect(entity.classification).toBe('monster');
    expect(entity.modelType).toBe('zombie');
    expect(entity.maxHealth).toBe(30);
    expect(entity.attackDamage).toBe(8);
    expect(entity.movementSpeed).toBe(0.4);
    expect(entity.spawnWeight).toBe(10);
    expect(entity.spawnBiomes).toEqual(['nether', 'basalt_deltas']);

    // 不再产生 entity 相关 warning
    const entityWarnings = result.warnings.filter((w) => w.includes('fire_elemental'));
    expect(entityWarnings).toEqual([]);
  });

  it('machine 节点编译到 spec.machines（含能源/GUI 配置）', () => {
    const machineNode = makeNode('n1', 'machine', {
      machineId: 'ore_crusher',
      displayName: '矿石粉碎机',
      energyCapacity: 20000,
      maxEnergyTransfer: 200,
      inputSlots: 2,
      outputSlots: 1,
      defaultProcessTime: 100,
      defaultEnergyPerTick: 20,
      guiWidth: 176,
      guiHeight: 166,
    });
    const result = compileNodeGraph(makeGraph([machineNode]));

    expect(result.spec.machines).toHaveLength(1);
    const machine = result.spec.machines[0];
    expect(machine.machineId).toBe('ore_crusher');
    expect(machine.displayName).toBe('矿石粉碎机');
    expect(machine.energyCapacity).toBe(20000);
    expect(machine.maxEnergyTransfer).toBe(200);
    expect(machine.inputSlots).toBe(2);
    expect(machine.outputSlots).toBe(1);
    expect(machine.defaultProcessTime).toBe(100);
    expect(machine.defaultEnergyPerTick).toBe(20);
    expect(machine.guiWidth).toBe(176);
    expect(machine.guiHeight).toBe(166);

    // machine 不应产生 warning（已正式编译）
    const machineWarnings = result.warnings.filter((w) => w.includes('ore_crusher'));
    expect(machineWarnings).toEqual([]);
  });

  it('多个 recipe/entity/machine 混合编译', () => {
    const nodes = [
      makeNode('n1', 'item', { itemId: 'input_a' }),
      makeNode('n2', 'item', { itemId: 'output_a' }),
      makeNode('n3', 'recipe', { recipeId: 'recipe_1' }),
      makeNode('n4', 'entity', { entityId: 'mob_1' }),
      makeNode('n5', 'machine', { machineId: 'machine_1' }),
    ];
    const edges = [
      makeEdge('e1', 'n1', 'n3', { sourceHandle: 'out', targetHandle: 'in' }),
      makeEdge('e2', 'n3', 'n2', { sourceHandle: 'out' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.items).toHaveLength(2);
    expect(result.spec.recipes).toHaveLength(1);
    expect(result.spec.entities).toHaveLength(1);
    expect(result.spec.machines).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('code 节点编译到 spec.customCode（保留代码与端口签名）', () => {
    const codeNode = makeNode('n1', 'code', {
      language: 'java',
      code: 'return input + 1;',
      inputSignature: '{"in": "integer"}',
      outputSignature: '{"out": "integer"}',
      methodName: 'increment',
    });
    const result = compileNodeGraph(makeGraph([codeNode]));

    expect(result.spec.customCode).toHaveLength(1);
    const snippet = result.spec.customCode[0];
    expect(snippet.snippetId).toBe('n1');
    expect(snippet.language).toBe('java');
    expect(snippet.code).toBe('return input + 1;');
    expect(snippet.methodName).toBe('increment');
    expect(snippet.inputSignature).toEqual({ in: 'integer' });
    expect(snippet.outputSignature).toEqual({ out: 'integer' });

    // code 节点不应产生 warning
    expect(result.warnings.filter((w) => w.includes('n1'))).toEqual([]);
  });

  it('code 节点的非法 JSON 签名被安全回退为空对象', () => {
    const codeNode = makeNode('n1', 'code', {
      inputSignature: '{not valid json',
      outputSignature: '[]',
      methodName: 'broken',
    });
    const result = compileNodeGraph(makeGraph([codeNode]));

    expect(result.spec.customCode).toHaveLength(1);
    expect(result.spec.customCode[0].inputSignature).toEqual({});
    expect(result.spec.customCode[0].outputSignature).toEqual({});
    // 不应产生 error（解析失败回退空对象，不阻断编译）
    expect(result.errors).toEqual([]);
  });

  it('multiblock 节点编译到 spec.multiblocks（含尺寸与控制器偏移）', () => {
    const multiblockNode = makeNode('n1', 'multiblock', {
      structureId: 'smeltery',
      displayName: '冶炼炉',
      width: 3,
      height: 4,
      depth: 3,
      hollow: true,
      controllerOffset: { x: 1, y: 0, z: 1 },
    });
    const result = compileNodeGraph(makeGraph([multiblockNode]));

    expect(result.spec.multiblocks).toHaveLength(1);
    const mb = result.spec.multiblocks[0];
    expect(mb.structureId).toBe('smeltery');
    expect(mb.displayName).toBe('冶炼炉');
    expect(mb.width).toBe(3);
    expect(mb.height).toBe(4);
    expect(mb.depth).toBe(3);
    expect(mb.hollow).toBe(true);
    expect(mb.controllerOffset).toEqual({ x: 1, y: 0, z: 1 });

    // multiblock 不应再产生 warning
    expect(result.warnings.filter((w) => w.includes('smeltery'))).toEqual([]);
  });

  it('event 节点编译到 spec.eventHandlers（含事件参数解析）', () => {
    const eventNode = makeNode('n1', 'event', {
      eventType: 'player_right_click_block',
      eventArgs: '{"hand": "main_hand", "block": "minecraft:stone"}',
    });
    const result = compileNodeGraph(makeGraph([eventNode]));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    expect(handler.handlerId).toBe('n1');
    expect(handler.eventType).toBe('player_right_click_block');
    expect(handler.eventArgs).toEqual({ hand: 'main_hand', block: 'minecraft:stone' });
    // P1.5：无 control 边时 conditionIds/actionIds 默认为空数组
    expect(handler.conditionIds).toEqual([]);
    expect(handler.actionIds).toEqual([]);

    // event 不应再产生 warning
    expect(result.warnings.filter((w) => w.includes('n1'))).toEqual([]);
  });

  it('event → condition → action 控制流链编译（含 conditionIds/actionIds 引用）', () => {
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('a1', 'action', { actionType: 'give_item' }),
    ];
    const edges = [
      makeEdge('ec1', 'e1', 'c1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ca1', 'c1', 'a1', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    expect(handler.handlerId).toBe('e1');
    // conditionIds 包含下游 condition 节点 id
    expect(handler.conditionIds).toEqual(['c1']);
    // actionIds 包含下游 action 节点 id（通过 condition 间接连接）
    expect(handler.actionIds).toEqual(['a1']);

    // 顶层 spec.conditions / spec.actions 仍保留所有节点（扁平列表不变）
    expect(result.spec.conditions).toHaveLength(1);
    expect(result.spec.conditions[0].conditionId).toBe('c1');
    expect(result.spec.actions).toHaveLength(1);
    expect(result.spec.actions[0].actionId).toBe('a1');
  });

  it('event 直接 → action（无 condition 中介）编译（P1.5 控制流链）', () => {
    const nodes = [
      makeNode('e1', 'event', { eventType: 'block_break' }),
      makeNode('a1', 'action', { actionType: 'spawn_entity' }),
      makeNode('a2', 'action', { actionType: 'play_sound' }),
    ];
    const edges = [
      makeEdge('ea1', 'e1', 'a1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ea2', 'e1', 'a2', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    // 无 condition 中介
    expect(handler.conditionIds).toEqual([]);
    // 直接连接的 action 全部收集
    expect(handler.actionIds.sort()).toEqual(['a1', 'a2']);
  });

  it('多个 condition/action 混合链编译（P1.5 控制流链）', () => {
    // 一个 event 连 2 个 condition，每个 condition 连 2 个 action
    // 同时 event 直接连 1 个 action
    const nodes = [
      makeNode('e1', 'event', { eventType: 'tick' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('c2', 'condition', { conditionType: 'is_raining' }),
      makeNode('a1', 'action', { actionType: 'give_item' }),
      makeNode('a2', 'action', { actionType: 'play_sound' }),
      makeNode('a3', 'action', { actionType: 'damage' }),
      makeNode('a4', 'action', { actionType: 'heal' }),
      makeNode('a5', 'action', { actionType: 'teleport' }),
    ];
    const edges = [
      // event → 2 conditions
      makeEdge('ec1', 'e1', 'c1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ec2', 'e1', 'c2', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      // c1 → a1, a2 (true 分支)
      makeEdge('ca1', 'c1', 'a1', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
      makeEdge('ca2', 'c1', 'a2', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
      // c2 → a3, a4 (true 分支)
      makeEdge('ca3', 'c2', 'a3', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
      makeEdge('ca4', 'c2', 'a4', { kind: 'control', sourceHandle: 'false', targetHandle: 'in' }),
      // event → a5 (直接，无 condition 中介)
      makeEdge('ea5', 'e1', 'a5', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    // 应收集 2 个 condition
    expect(handler.conditionIds.sort()).toEqual(['c1', 'c2']);
    // 应收集 5 个 action（c1 的 2 个 + c2 的 2 个 + 直接的 1 个）
    expect(handler.actionIds.sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'a5']);

    // 扁平 spec 仍保留所有节点完整数据
    expect(result.spec.conditions).toHaveLength(2);
    expect(result.spec.actions).toHaveLength(5);
  });

  it('event 节点无 control 边时 conditionIds/actionIds 为空数组', () => {
    // event 节点存在但没有任何 control 边连出
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('a1', 'action', { actionType: 'give_item' }),
    ];
    // 故意只构造 craft 边（非 control），验证不会误收集
    const edges = [
      makeEdge('ec1', 'e1', 'c1', { kind: 'craft', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ca1', 'c1', 'a1', { kind: 'data', sourceHandle: 'true', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    expect(handler.handlerId).toBe('e1');
    // 无 control 边时 conditionIds/actionIds 为空数组（不沿 craft/data 边收集）
    expect(handler.conditionIds).toEqual([]);
    expect(handler.actionIds).toEqual([]);

    // 顶层扁平数组仍包含所有节点
    expect(result.spec.conditions).toHaveLength(1);
    expect(result.spec.actions).toHaveLength(1);
  });

  it('复杂控制流（共享 action 去重：condition1 → action2, condition2 → action2）', () => {
    // event → condition1 → action1, action2
    // event → condition2 → action2（与 condition1 共享 action2）
    // 验证 action2 在 eventHandlers.actionIds 中只出现一次（去重）
    const nodes = [
      makeNode('e1', 'event', { eventType: 'tick' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('c2', 'condition', { conditionType: 'is_raining' }),
      makeNode('a1', 'action', { actionType: 'give_item' }),
      makeNode('a2', 'action', { actionType: 'play_sound' }),
    ];
    const edges = [
      // event → 2 conditions
      makeEdge('ec1', 'e1', 'c1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ec2', 'e1', 'c2', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      // c1 → a1, a2
      makeEdge('ca1', 'c1', 'a1', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
      makeEdge('ca2', 'c1', 'a2', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
      // c2 → a2（共享 action2）
      makeEdge('ca3', 'c2', 'a2', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    // 应收集 2 个 condition
    expect(handler.conditionIds.sort()).toEqual(['c1', 'c2']);
    // actionIds 去重：a2 同时在 c1 和 c2 下游，但只出现一次
    expect(handler.actionIds.sort()).toEqual(['a1', 'a2']);
    expect(handler.actionIds).toHaveLength(2);

    // 顶层扁平数组仍包含所有节点（不因去重而丢失）
    expect(result.spec.conditions).toHaveLength(2);
    expect(result.spec.actions).toHaveLength(2);
    expect(result.spec.actions.map((a) => a.actionId).sort()).toEqual(['a1', 'a2']);
  });

  it('condition 节点编译到 spec.conditions（含取反与参数解析）', () => {
    const conditionNode = makeNode('n1', 'condition', {
      conditionType: 'health_below',
      conditionArgs: '{"threshold": 10}',
      invert: true,
    });
    const result = compileNodeGraph(makeGraph([conditionNode]));

    expect(result.spec.conditions).toHaveLength(1);
    const cond = result.spec.conditions[0];
    expect(cond.conditionId).toBe('n1');
    expect(cond.conditionType).toBe('health_below');
    expect(cond.args).toEqual({ threshold: 10 });
    expect(cond.invert).toBe(true);

    expect(result.warnings.filter((w) => w.includes('n1'))).toEqual([]);
  });

  it('action 节点编译到 spec.actions（含动作参数解析）', () => {
    const actionNode = makeNode('n1', 'action', {
      actionType: 'spawn_entity',
      actionArgs: '{"entity": "minecraft:zombie", "count": 3}',
    });
    const result = compileNodeGraph(makeGraph([actionNode]));

    expect(result.spec.actions).toHaveLength(1);
    const act = result.spec.actions[0];
    expect(act.actionId).toBe('n1');
    expect(act.actionType).toBe('spawn_entity');
    expect(act.args).toEqual({ entity: 'minecraft:zombie', count: 3 });

    expect(result.warnings.filter((w) => w.includes('n1'))).toEqual([]);
  });

  it('event/condition/action 节点非法 JSON 参数安全回退为空对象', () => {
    const nodes = [
      makeNode('n1', 'event', { eventArgs: 'not json' }),
      makeNode('n2', 'condition', { conditionArgs: '[1,2,3]' }), // 数组非对象
      makeNode('n3', 'action', { actionArgs: '"string"' }), // 字符串非对象
    ];
    const result = compileNodeGraph(makeGraph(nodes));

    expect(result.spec.eventHandlers).toHaveLength(1);
    expect(result.spec.eventHandlers[0].eventArgs).toEqual({});
    expect(result.spec.conditions).toHaveLength(1);
    expect(result.spec.conditions[0].args).toEqual({});
    expect(result.spec.actions).toHaveLength(1);
    expect(result.spec.actions[0].args).toEqual({});
    // 非法 JSON 不产生 error（安全回退）
    expect(result.errors).toEqual([]);
  });

  // === P1-3：过程系统（对标 MCreator procedure） ===

  it('procedure 节点编译到 spec.procedures（含过程名）', () => {
    const nodes = [
      makeNode('p1', 'procedure', { procedureName: 'grantReward', displayName: '发放奖励' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));

    expect(result.spec.procedures).toHaveLength(1);
    const proc = result.spec.procedures[0];
    expect(proc.procedureId).toBe('p1');
    expect(proc.procedureName).toBe('grantReward');
    expect(proc.displayName).toBe('发放奖励');
    // 无 control 边时各 id 列表为空
    expect(proc.conditionIds).toEqual([]);
    expect(proc.actionIds).toEqual([]);
    expect(proc.procedureCallIds).toEqual([]);
  });

  it('procedure → condition → action 过程体编译（BFS 收集 conditionIds/actionIds）', () => {
    const nodes = [
      makeNode('p1', 'procedure', { procedureName: 'onTick' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('a1', 'action', { actionType: 'give_item' }),
    ];
    const edges = [
      makeEdge('pc1', 'p1', 'c1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ca1', 'c1', 'a1', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.procedures).toHaveLength(1);
    const proc = result.spec.procedures[0];
    expect(proc.conditionIds).toEqual(['c1']);
    expect(proc.actionIds).toEqual(['a1']);
    expect(proc.procedureCallIds).toEqual([]);
  });

  it('event → procedure 调用编译（procedureCallIds 引用，不内联过程体）', () => {
    // event 调用 procedure；procedure 自身含 condition/action 过程体
    // event 不应收集 procedure 的 condition/action（那些归属 procedure）
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('p1', 'procedure', { procedureName: 'greet' }),
      makeNode('c1', 'condition', { conditionType: 'is_day' }),
      makeNode('a1', 'action', { actionType: 'send_message' }),
    ];
    const edges = [
      // event → procedure（调用）
      makeEdge('ep1', 'e1', 'p1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      // procedure → condition → action（过程体）
      makeEdge('pc1', 'p1', 'c1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ca1', 'c1', 'a1', { kind: 'control', sourceHandle: 'true', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    // event handler 记录 procedureCallIds，但不收集 procedure 的 condition/action
    expect(result.spec.eventHandlers).toHaveLength(1);
    const handler = result.spec.eventHandlers[0];
    expect(handler.procedureCallIds).toEqual(['p1']);
    expect(handler.conditionIds).toEqual([]);
    expect(handler.actionIds).toEqual([]);

    // procedure 自身记录过程体
    expect(result.spec.procedures).toHaveLength(1);
    const proc = result.spec.procedures[0];
    expect(proc.procedureId).toBe('p1');
    expect(proc.conditionIds).toEqual(['c1']);
    expect(proc.actionIds).toEqual(['a1']);
  });

  it('多个 event 复用同一 procedure（命名可复用：单一 ProcedureSpec + 多处调用）', () => {
    // 两个 event 都调用同一个 procedure → procedure 只出现一次，两个 handler 都引用它
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('e2', 'event', { eventType: 'player_quit' }),
      makeNode('p1', 'procedure', { procedureName: 'logEvent' }),
      makeNode('a1', 'action', { actionType: 'send_message' }),
    ];
    const edges = [
      makeEdge('ep1', 'e1', 'p1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('ep2', 'e2', 'p1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('pa1', 'p1', 'a1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    // procedure 只出现一次（按节点 id 唯一）
    expect(result.spec.procedures).toHaveLength(1);
    expect(result.spec.procedures[0].procedureId).toBe('p1');
    expect(result.spec.procedures[0].actionIds).toEqual(['a1']);

    // 两个 event handler 都引用该 procedure
    expect(result.spec.eventHandlers).toHaveLength(2);
    expect(result.spec.eventHandlers[0].procedureCallIds).toEqual(['p1']);
    expect(result.spec.eventHandlers[1].procedureCallIds).toEqual(['p1']);
  });

  it('procedure 嵌套调用（procedure → procedure，不内联被调用过程的体）', () => {
    // p1 调用 p2；p2 有自己的 action 体
    // p1 的 procedureCallIds 含 p2，但 actionIds 不含 p2 的 action
    const nodes = [
      makeNode('p1', 'procedure', { procedureName: 'outer' }),
      makeNode('p2', 'procedure', { procedureName: 'inner' }),
      makeNode('a1', 'action', { actionType: 'play_sound' }),
    ];
    const edges = [
      makeEdge('pp1', 'p1', 'p2', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      makeEdge('pa1', 'p2', 'a1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.procedures).toHaveLength(2);
    const outer = result.spec.procedures.find((p) => p.procedureId === 'p1')!;
    const inner = result.spec.procedures.find((p) => p.procedureId === 'p2')!;

    // outer 调用 inner，但不收集 inner 的 action
    expect(outer.procedureCallIds).toEqual(['p2']);
    expect(outer.actionIds).toEqual([]);
    expect(outer.conditionIds).toEqual([]);

    // inner 自身含 action
    expect(inner.procedureCallIds).toEqual([]);
    expect(inner.actionIds).toEqual(['a1']);
  });

  it('procedure 节点无 control 边时各 id 列表为空数组', () => {
    const nodes = [makeNode('p1', 'procedure', { procedureName: 'empty' })];
    // 只连 craft 边（非 control），验证不会误收集
    const edges = [
      makeEdge('pitem', 'p1', 'i1', { kind: 'craft', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const nodes2 = [...nodes, makeNode('i1', 'item')];
    const result = compileNodeGraph(makeGraph(nodes2, edges));

    expect(result.spec.procedures).toHaveLength(1);
    const proc = result.spec.procedures[0];
    expect(proc.conditionIds).toEqual([]);
    expect(proc.actionIds).toEqual([]);
    expect(proc.procedureCallIds).toEqual([]);
  });

  it('P40: procedure 节点 inputs 编译进 ProcedureSpec', () => {
    const nodes = [
      makeNode('p1', 'procedure', {
        procedureName: 'grantReward',
        inputs: [
          { name: 'amount', type: 'int' },
          { name: 'item', type: 'string' },
        ],
      }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    expect(result.spec.procedures).toHaveLength(1);
    expect(result.spec.procedures[0].inputs).toEqual([
      { name: 'amount', type: 'int' },
      { name: 'item', type: 'string' },
    ]);
  });

  it('P40: 调用方 data 边 → procedureCallArgs（variable 透传 varName）', () => {
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('p1', 'procedure', {
        procedureName: 'grantReward',
        inputs: [
          { name: 'amount', type: 'int' },
          { name: 'item', type: 'string' },
        ],
      }),
      makeNode('v1', 'variable', { varName: 'count' }),
      makeNode('i1', 'item', { itemId: 'diamond' }),
    ];
    const edges = [
      makeEdge('ep1', 'e1', 'p1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
      // variable → in_amount，item → in_item（data 边）
      makeEdge('va1', 'v1', 'p1', { kind: 'data', sourceHandle: 'out', targetHandle: 'in_amount' }),
      makeEdge('ii1', 'i1', 'p1', { kind: 'data', sourceHandle: 'out', targetHandle: 'in_item' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    const handler = result.spec.eventHandlers[0];
    expect(handler.procedureCallArgs).toEqual({
      p1: [
        'count',
        'net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:diamond"))',
      ],
    });
  });

  it('P40: 未连 data 边的 input 回退为空字符串', () => {
    const nodes = [
      makeNode('e1', 'event', { eventType: 'player_join' }),
      makeNode('p1', 'procedure', {
        procedureName: 'grantReward',
        inputs: [{ name: 'amount', type: 'int' }],
      }),
    ];
    const edges = [
      makeEdge('ep1', 'e1', 'p1', { kind: 'control', sourceHandle: 'trigger', targetHandle: 'in' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));
    expect(result.spec.eventHandlers[0].procedureCallArgs).toEqual({ p1: [''] });
  });

  it('comment 节点被跳过（不产生 spec/warning/unsupported）', () => {
    const commentNode = makeNode('n1', 'comment', { text: '这是个备注', color: 'blue' });
    const result = compileNodeGraph(makeGraph([commentNode]));

    // comment 不进入任何 spec 字段
    expect(result.spec.items).toEqual([]);
    expect(result.spec.customCode).toEqual([]);
    expect(result.spec.eventHandlers).toEqual([]);
    // 不产生 warning 或 error
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('所有节点类型混合编译（item/block/recipe/entity/machine/code/multiblock/event/condition/action）', () => {
    const nodes = [
      makeNode('n1', 'item', { itemId: 'mixed_item' }),
      makeNode('n2', 'block', { blockId: 'mixed_block' }),
      makeNode('n3', 'recipe', { recipeId: 'mixed_recipe' }),
      makeNode('n4', 'entity', { entityId: 'mixed_entity' }),
      makeNode('n5', 'machine', { machineId: 'mixed_machine' }),
      makeNode('n6', 'code', { methodName: 'mixed_logic' }),
      makeNode('n7', 'multiblock', { structureId: 'mixed_structure' }),
      makeNode('n8', 'event', { eventType: 'tick' }),
      makeNode('n9', 'condition', { conditionType: 'is_day' }),
      makeNode('n10', 'action', { actionType: 'give_item' }),
      makeNode('n11', 'comment', { text: '混合图备注' }),
    ];
    const edges = [
      // recipe 需要至少一条输出边
      makeEdge('e1', 'n3', 'n1', { sourceHandle: 'out' }),
    ];
    const result = compileNodeGraph(makeGraph(nodes, edges));

    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.blocks).toHaveLength(1);
    expect(result.spec.recipes).toHaveLength(1);
    expect(result.spec.entities).toHaveLength(1);
    expect(result.spec.machines).toHaveLength(1);
    expect(result.spec.customCode).toHaveLength(1);
    expect(result.spec.multiblocks).toHaveLength(1);
    expect(result.spec.eventHandlers).toHaveLength(1);
    expect(result.spec.conditions).toHaveLength(1);
    expect(result.spec.actions).toHaveLength(1);
    // comment 不计入任何字段
    // 所有节点应正常编译，无 error
    expect(result.errors).toEqual([]);
  });

  it('孤立 item 节点（无连线）仍能编译到 items 数组', () => {
    const itemNode = makeNode('n1', 'item', { itemId: 'lonely_item' });
    const result = compileNodeGraph(makeGraph([itemNode]));
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('lonely_item');
    // 孤立 item 不应产生 warning
    expect(result.warnings.filter((w) => w.includes('lonely_item'))).toEqual([]);
  });

  it('禁用节点被跳过', () => {
    const nodes = [
      makeNode('n1', 'item', { itemId: 'active_item' }),
      makeNode('n2', 'item', { itemId: 'disabled_item', disabled: true }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('active_item');
  });

  // === P0-1: 节点级 codeLock 测试 ===

  it('锁定节点（codeLocked + lockedCode）使用手改代码，跳过常规编译', () => {
    const userCode = 'public class LockedItem { /* 用户手改 */ }';
    const nodes = [
      makeNode('n1', 'item', { itemId: 'normal_item' }),
      makeNode('n2', 'item', {
        nodeId: 'n2',
        itemId: 'locked_item',
        codeLocked: true,
        formatVersion: 1,
        lockedCode: userCode,
      }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    // 锁定节点不出现在 items 数组（跳过常规编译）
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('normal_item');
    // 锁定代码出现在 customCode 数组
    const lockedSnippet = result.spec.customCode.find((c) => c.snippetId === 'n2');
    expect(lockedSnippet).toBeTruthy();
    expect(lockedSnippet?.code).toBe(userCode);
    expect(lockedSnippet?.language).toBe('java');
  });

  it('锁定节点无 lockedCode 时回退到常规编译并产生 warning', () => {
    const nodes = [
      makeNode('n1', 'item', {
        nodeId: 'n1',
        itemId: 'empty_locked_item',
        codeLocked: true,
        formatVersion: 1,
        // lockedCode 缺省
      }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    // 回退到常规编译：items 数组有该节点
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('empty_locked_item');
    // 产生 warning 提示用户
    expect(result.warnings.some((w) => w.includes('n1') && w.toLowerCase().includes('lock'))).toBe(
      true,
    );
  });

  it('锁定 code 节点使用 lockedCode 而非节点原始 code 字段', () => {
    const originalCode = 'System.out.println("original");';
    const userModifiedCode = 'System.out.println("user modified");';
    const nodes = [
      makeNode('n1', 'code', {
        nodeId: 'n1',
        code: originalCode,
        codeLocked: true,
        formatVersion: 1,
        lockedCode: userModifiedCode,
      }),
    ];
    const result = compileNodeGraph(makeGraph(nodes));
    // customCode 只有一条（来自锁定代码），不含原始 code
    expect(result.spec.customCode).toHaveLength(1);
    expect(result.spec.customCode[0].code).toBe(userModifiedCode);
    expect(result.spec.customCode[0].snippetId).toBe('n1');
  });

  it('未锁定节点（codeLocked=false）正常编译不受影响', () => {
    const nodes = [makeNode('n1', 'item', { itemId: 'unlocked_item', codeLocked: false })];
    const result = compileNodeGraph(makeGraph(nodes));
    expect(result.spec.items).toHaveLength(1);
    expect(result.spec.items[0].id).toBe('unlocked_item');
    // 不应产生 lock 相关 warning
    expect(result.warnings.some((w) => w.toLowerCase().includes('lock'))).toBe(false);
  });

  it('modId 缺失时产生 error', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: '',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('modId');
  });
});

// === 连线查询辅助函数测试 ===

describe('getIncomingEdges', () => {
  it('返回所有连入目标节点的边', () => {
    const n1 = makeNode('n1', 'item');
    const n2 = makeNode('n2', 'item');
    const n3 = makeNode('n3', 'recipe');
    const edges = [
      makeEdge('e1', 'n1', 'n3', { targetHandle: 'in' }),
      makeEdge('e2', 'n2', 'n3', { targetHandle: 'in' }),
    ];
    const graph = makeGraph([n1, n2, n3], edges);
    const incoming = getIncomingEdges(graph, 'n3');
    expect(incoming).toHaveLength(2);
    expect(incoming.map((e) => e.source).sort()).toEqual(['n1', 'n2']);
  });

  it('无连线时返回空数组', () => {
    const n1 = makeNode('n1', 'item');
    const graph = makeGraph([n1], []);
    expect(getIncomingEdges(graph, 'n1')).toEqual([]);
  });

  it('过滤 disabled 边', () => {
    const n1 = makeNode('n1', 'item');
    const n3 = makeNode('n3', 'recipe');
    const edges = [
      makeEdge('e1', 'n1', 'n3', { disabled: true }),
      makeEdge('e2', 'n1', 'n3', { disabled: false }),
    ];
    const graph = makeGraph([n1, n3], edges);
    const incoming = getIncomingEdges(graph, 'n3');
    expect(incoming).toHaveLength(1);
    expect(incoming[0].id).toBe('e2');
  });
});

describe('getOutgoingEdges', () => {
  it('返回所有从源节点出发的边', () => {
    const n1 = makeNode('n1', 'recipe');
    const n2 = makeNode('n2', 'item');
    const n3 = makeNode('n3', 'item');
    const edges = [
      makeEdge('e1', 'n1', 'n2', { sourceHandle: 'out' }),
      makeEdge('e2', 'n1', 'n3', { sourceHandle: 'out' }),
    ];
    const graph = makeGraph([n1, n2, n3], edges);
    const outgoing = getOutgoingEdges(graph, 'n1');
    expect(outgoing).toHaveLength(2);
    expect(outgoing.map((e) => e.target).sort()).toEqual(['n2', 'n3']);
  });

  it('无连线时返回空数组', () => {
    const n1 = makeNode('n1', 'item');
    const graph = makeGraph([n1], []);
    expect(getOutgoingEdges(graph, 'n1')).toEqual([]);
  });
});

describe('findSourceNode', () => {
  it('返回连线的源节点', () => {
    const n1 = makeNode('n1', 'item');
    const n2 = makeNode('n2', 'recipe');
    const edge = makeEdge('e1', 'n1', 'n2');
    const graph = makeGraph([n1, n2], [edge]);
    const source = findSourceNode(graph, edge);
    expect(source).not.toBeNull();
    expect(source?.id).toBe('n1');
  });

  it('找不到源节点时返回 null', () => {
    const n2 = makeNode('n2', 'recipe');
    const edge = makeEdge('e1', 'missing', 'n2');
    const graph = makeGraph([n2], [edge]);
    expect(findSourceNode(graph, edge)).toBeNull();
  });
});

describe('findTargetNode', () => {
  it('返回连线的目标节点', () => {
    const n1 = makeNode('n1', 'item');
    const n2 = makeNode('n2', 'recipe');
    const edge = makeEdge('e1', 'n1', 'n2');
    const graph = makeGraph([n1, n2], [edge]);
    const target = findTargetNode(graph, edge);
    expect(target).not.toBeNull();
    expect(target?.id).toBe('n2');
  });

  it('找不到目标节点时返回 null', () => {
    const n1 = makeNode('n1', 'item');
    const edge = makeEdge('e1', 'n1', 'missing');
    const graph = makeGraph([n1], [edge]);
    expect(findTargetNode(graph, edge)).toBeNull();
  });
});

// === 阶段 C 集成测试（Task 32） ===

function makeVariable(id: string, varName: string): ModNode {
  return {
    id,
    type: 'variable',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: varName,
      note: '',
      disabled: false,
      kind: 'variable',
      varName,
      varType: 'int',
      value: 10,
      isConstant: true,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    },
    ports: [],
    selected: false,
  };
}

function makeLoop(id: string): ModNode {
  return {
    id,
    type: 'loop',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: 'loop',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'for',
      init: 'int i = 0',
      condition: 'i < 3',
      update: 'i++',
      loopVarName: 'i',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    },
    ports: [],
    selected: false,
  };
}

function makeCustom(id: string, typeId: string, fields: Record<string, unknown> = {}): ModNode {
  return {
    id,
    type: 'subgraph',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      label: 'custom',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: typeId,
      customFields: fields,
      collapsed: false,
      codeLocked: false,
      formatVersion: 1,
    },
    ports: [],
    selected: false,
  };
}

describe('compileNodeGraph 阶段 C 集成', () => {
  beforeEach(() => {
    subgraphManager.clear();
    customNodeRegistry.clear();
  });

  it('变量节点编译后 customCode 数组含变量 snippet', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeVariable('v1', 'MAX')],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const varSnippet = result.spec.customCode.find((c) => c.snippetId === 'v1');
    expect(varSnippet).toBeDefined();
    expect(varSnippet!.code).toContain('MAX');
  });

  it('子图节点先内联展开再编译（customTypeId 为 null）', () => {
    const innerItem: ModNode = {
      id: 'inner_1',
      type: 'item',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'inner_1',
        label: 'inner',
        note: '',
        disabled: false,
        kind: 'item',
        itemId: 'inner_item',
        displayName: 'Inner',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    const sgDef: SubgraphDefinition = {
      id: 'sg_1',
      name: '内层',
      nodes: [innerItem],
      edges: [],
      portMappings: [],
    };
    subgraphManager.register(sgDef);
    const sgNode: ModNode = {
      id: 's1',
      type: 'subgraph',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 's1',
        label: 'sg',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: 'sg_1',
        subgraphName: '内层',
        customTypeId: null,
        customFields: {},
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode],
      edges: [],
      subgraphs: { sg_1: sgDef },
    };
    const result = compileNodeGraph(graph);
    // 内联后 inner_1 被编译为 item
    expect(result.spec.items.some((i) => i.id === 'inner_item')).toBe(true);
  });

  it('循环节点编译后 customCode 含循环代码', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeLoop('l1')],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    const loopSnippet = result.spec.customCode.find((c) => c.snippetId === 'l1');
    expect(loopSnippet).toBeDefined();
    expect(loopSnippet!.code).toContain('for (');
  });

  it('自定义节点编译后 customCode 含 Mustache 渲染结果', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
      codeTemplate: 'int s = {{field:speed}};',
    });
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeCustom('c1', 'mymod:crafter', { speed: 99 })],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    const customSnippet = result.spec.customCode.find((c) => c.snippetId === 'c1');
    expect(customSnippet).toBeDefined();
    expect(customSnippet!.code).toBe('int s = 99;');
  });

  it('自定义节点 schema 未注册时报 error', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeCustom('c2', 'unregistered:type')],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.errors.some((e) => e.includes('未注册'))).toBe(true);
  });

  it('外部 mod 命名空间引用检测（installed=false 加 warning）', () => {
    // 预加载外部 mod 缓存：create 标记为未安装
    preloadExternalMods([{ namespace: 'create', installed: false }]);
    // 物品 itemId 引用 create:cog
    const itemNode: ModNode = {
      id: 'i1',
      type: 'item',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'i1',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'item',
        itemId: 'create:cog',
        displayName: 'Cog',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [itemNode],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.warnings.some((w) => w.includes('create'))).toBe(true);
    // 清理缓存，避免影响后续测试
    preloadExternalMods([{ namespace: 'create', installed: true }]);
  });

  // === 问题 13：modId 净化为合法命名空间 ===
  it('modId 含大写/空格/特殊字符时被净化为合法命名空间（问题 13）', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: 'My Cool Mod!',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    // modId 应被净化为小写、下划线形式
    expect(result.spec.modId).toBe('my_cool_mod');
    // 不应产生 modId 缺失 error（因为有值，只是格式不规范）
    expect(result.errors.some((e) => e.includes('modId'))).toBe(false);
  });

  // === 问题 14：命名空间检测使用净化后的 modId ===
  it('命名空间检测使用净化后的 modId，不误报当前 mod 的引用（问题 14）', () => {
    // modId 含大写和空格，净化后为 my_mod
    // 物品 id 用 my_mod:item 不应被误报为外部命名空间
    preloadExternalMods([{ namespace: 'my_mod', installed: false }]);
    const itemNode: ModNode = {
      id: 'i1',
      type: 'item',
      position: { x: 0, y: 0 },
      data: {
        nodeId: 'i1',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'item',
        itemId: 'my_mod:item',
        displayName: 'Item',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      },
      ports: [],
      selected: false,
    };
    const graph: NodeGraph = {
      version: 1,
      modId: 'My Mod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [itemNode],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    // my_mod:item 与净化后的 modId(my_mod) 一致，不应产生外部依赖 warning
    // 注意：modId 净化警告也包含 my_mod 字符串，需排除净化警告精确检查
    const externalWarnings = result.warnings.filter(
      (w) => w.includes('外部 mod') || w.includes('未安装'),
    );
    expect(externalWarnings.some((w) => w.includes('my_mod'))).toBe(false);
    // 清理缓存
    preloadExternalMods([]);
  });

  // === 问题 19：边数量统计只计入未禁用边 ===
  it('description 中边数量只计入未禁用边（问题 19）', () => {
    const n1 = makeNode('n1', 'item', { itemId: 'a' });
    const n2 = makeNode('n2', 'item', { itemId: 'b' });
    const n3 = makeNode('n3', 'item', { itemId: 'c' });
    // 2 条启用边 + 1 条禁用边
    const edges = [
      makeEdge('e1', 'n1', 'n2'),
      makeEdge('e2', 'n2', 'n3'),
      makeEdge('e3', 'n1', 'n3', { disabled: true }),
    ];
    const result = compileNodeGraph(makeGraph([n1, n2, n3], edges));
    // description 应显示 2 条连线（不含禁用边）
    expect(result.spec.description).toContain('2 条连线');
    expect(result.spec.description).not.toContain('3 条连线');
  });

  // === 问题 24：customCode 按 snippetId 去重 ===
  it('customCode 按 snippetId 去重，重复项产生 warning（问题 24）', () => {
    // 构造两个 variable 节点使用相同 nodeId（模拟子图内联后 ID 碰撞场景）
    // 正常情况下 ReactFlow 不允许重复 ID，但子图内联展开可能引入重复
    const graph: NodeGraph = {
      version: 1,
      modId: 'testmod',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeVariable('dup', 'VAR_A'), makeVariable('dup', 'VAR_B')],
      edges: [],
      subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    // customCode 中 snippetId='dup' 只应出现一次
    const dupSnippets = result.spec.customCode.filter((c) => c.snippetId === 'dup');
    expect(dupSnippets).toHaveLength(1);
    // 应产生去重 warning
    expect(
      result.warnings.some(
        (w) => w.includes('dup') && (w.includes('去重') || w.includes('duplicate')),
      ),
    ).toBe(true);
  });
});
