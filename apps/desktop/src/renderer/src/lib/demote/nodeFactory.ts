import type { NodeData, NodeKind, ModNode } from '@mc-creator/shared';
import { LATEST_FORMAT_VERSION } from '@mc-creator/shared';
import { getPorts } from '../../domain/portSchemas.js';

// === 默认节点数据构造 ===
// 与 nodeGraphSerializer.test.ts 中 createDefaultNodeData 的逻辑保持一致，
// 确保降级生成的节点能通过 validateGraph 校验。

export function createDefaultNodeData(kind: NodeKind, id: string): NodeData {
  const base = {
    nodeId: id,
    label: id,
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    // P1-1：新建节点使用最新 formatVersion
    formatVersion: LATEST_FORMAT_VERSION,
  };
  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: id,
        displayName: id,
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
        blockId: id,
        displayName: id,
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
        entityId: id,
        displayName: id,
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
        recipeId: id,
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
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'tick',
        eventArgs: '{}',
      } as NodeData;
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      } as NodeData;
    // 以下类型当前降级器暂不生成，提供默认值以备未来扩展。
    case 'machine':
      return {
        ...base,
        kind: 'machine',
        machineId: id,
        displayName: id,
        energyCapacity: 10000,
        maxEnergyTransfer: 100,
        inputSlots: 1,
        outputSlots: 1,
        defaultProcessTime: 200,
        defaultEnergyPerTick: 10,
        guiWidth: 176,
        guiHeight: 166,
        recipeMapJson: '{}',
      } as NodeData;
    case 'multiblock':
      return {
        ...base,
        kind: 'multiblock',
        structureId: id,
        displayName: id,
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 0 },
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
    case 'comment':
      return {
        ...base,
        kind: 'comment',
        text: '',
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
      // P1-3：过程节点默认数据
      return {
        ...base,
        kind: 'procedure',
        procedureName: 'myProcedure',
        displayName: '新过程',
      } as NodeData;
    case 'biome':
      return {
        ...base,
        kind: 'biome',
        biomeId: 'my_biome',
        displayName: '新生物群系',
        precipitation: 'rain',
        temperature: 0.5,
        temperatureModifier: 'none',
        downfall: 0.5,
        skyColor: 0x78a7ff,
        waterColor: 0x3f76e4,
        waterFogColor: 0x050533,
        fogColor: 0xc0d8ff,
        surfaceBuilder: 'minecraft:grass',
        spawnWeight: 10,
        spawnDimensions: ['minecraft:overworld'],
      } as NodeData;
    case 'dimension':
      return {
        ...base,
        kind: 'dimension',
        dimensionId: 'my_dimension',
        displayName: '新维度',
        baseType: 'overworld',
        fixedTime: null,
        hasSkyLight: true,
        hasCeiling: false,
        ultrawarm: false,
        natural: true,
        minY: -64,
        height: 384,
        effects: 'overworld',
      } as NodeData;
    case 'fluid':
      return {
        ...base,
        kind: 'fluid',
        fluidId: 'my_fluid',
        displayName: '新流体',
        color: 0x00aaff,
        temperature: 300,
        viscosity: 1000,
        density: 1000,
        luminous: false,
      } as NodeData;
    case 'gui':
      return {
        ...base,
        kind: 'gui',
        guiId: 'my_gui',
        displayName: '新 GUI',
        width: 176,
        height: 166,
        slotsJson: '[]',
        showEnergyBar: false,
        showProgressBar: false,
      } as NodeData;
    default: {
      // 类型安全：穷尽性检查
      const _exhaustive: never = kind;
      throw new Error(`未支持的节点类型: ${String(_exhaustive)}`);
    }
  }
}

/** 构造一个完整节点（自动填默认字段 + 端口，位置由布局算法统一设置） */
export function makeNode(
  id: string,
  kind: NodeKind,
  overrides: Record<string, unknown> = {},
): ModNode {
  const baseData = createDefaultNodeData(kind, id);
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
