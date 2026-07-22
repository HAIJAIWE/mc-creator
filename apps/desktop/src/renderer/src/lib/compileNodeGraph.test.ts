import { describe, it, expect } from 'vitest';
import {
  compileNodeGraph,
  getIncomingEdges,
  getOutgoingEdges,
  findSourceNode,
  findTargetNode,
} from './compileNodeGraph.js';
import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';

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
    expect(result.unsupported).toEqual([]);
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

    // 不再记录到 unsupported
    const recipeUnsupported = result.unsupported?.filter((u) => u.kind === 'recipe');
    expect(recipeUnsupported).toEqual([]);
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

    // 不再记录到 unsupported
    const entityUnsupported = result.unsupported?.filter((u) => u.kind === 'entity');
    expect(entityUnsupported).toEqual([]);
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

    // code 节点不应产生 warning 或 unsupported
    expect(result.warnings.filter((w) => w.includes('n1'))).toEqual([]);
    expect(result.unsupported?.filter((u) => u.kind === 'code')).toEqual([]);
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

    // multiblock 不应再被记入 unsupported 或 warning
    expect(result.unsupported?.filter((u) => u.kind === 'multiblock')).toEqual([]);
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

    // event 不应再被记入 unsupported 或 warning
    expect(result.unsupported?.filter((u) => u.kind === 'event')).toEqual([]);
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

    expect(result.unsupported?.filter((u) => u.kind === 'condition')).toEqual([]);
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

    expect(result.unsupported?.filter((u) => u.kind === 'action')).toEqual([]);
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
    expect(result.unsupported).toEqual([]);
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
    // 不应有任何 unsupported（所有类型均已编译）
    expect(result.unsupported).toEqual([]);
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

  it('modId 缺失时产生 error', () => {
    const graph: NodeGraph = {
      version: 1,
      modId: '',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
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
