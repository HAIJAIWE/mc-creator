import type {
  NodeGraph,
  ModNode,
  ItemSpec,
  BlockSpec,
  ModRecipeSpec,
  ModRecipeInputSpec,
  EntitySpec,
  MachineSpec,
  CustomCodeSnippetSpec,
  MultiBlockSpec,
  EventHandlerSpec,
  ConditionSpec,
  ActionSpec,
  ProcedureSpec,
  ProcedureNodeData,
  ModBiomeSpec,
  ModDimensionSpec,
  FluidSpec,
  GuiSpec,
  GuiSlotSpec,
} from '@mc-creator/shared';
import { findSourceNode, findTargetNode, getIncomingEdges, getOutgoingEdges } from './edgeIndex.js';
import { parseArgsJson, parseSignatureJson } from './jsonParsing.js';

// === 节点编译函数 ===

export function compileItemNode(node: ModNode): ItemSpec {
  if (node.data.kind !== 'item') {
    throw new Error(`节点 ${node.id} 不是 item 类型`);
  }
  const data = node.data;
  return {
    id: data.itemId,
    name: data.displayName || data.itemId,
    maxStackSize: data.maxStackSize,
    rarity: data.rarity,
    maxDamage: data.maxDamage,
    fuelTick: 0,
    lore: data.note || '',
    attributes: [],
    defaultEnchantments: [],
    itemCategory: data.category,
    creativeTab: 'inventory',
    texturePath: data.texturePath,
  } as ItemSpec;
}

export function compileBlockNode(node: ModNode): BlockSpec {
  if (node.data.kind !== 'block') {
    throw new Error(`节点 ${node.id} 不是 block 类型`);
  }
  const data = node.data;
  return {
    id: data.blockId,
    name: data.displayName || data.blockId,
    material: inferMaterialFromBlock(data),
    hardness: data.hardness,
    miningLevel: 0,
    lightLevel: data.luminance,
    resistance: data.blastResistance,
    soundType: inferSoundTypeFromBlock(data),
    dropSelf: true,
    dropItem: '',
    stateProperties: [],
    collisionShapes: [],
    blockType: data.isBlockEntity ? 'custom' : 'full_block',
    transparent: data.transparent,
    noCollision: !data.solid,
    texturePath: data.texturePathTop,
  } as BlockSpec;
}

function inferMaterialFromBlock(data: {
  modelType: string;
  transparent: boolean;
  solid: boolean;
}): BlockSpec['material'] {
  if (data.transparent) return 'glass';
  if (!data.solid) return 'plant';
  return 'stone';
}

function inferSoundTypeFromBlock(data: {
  modelType: string;
  transparent: boolean;
}): BlockSpec['soundType'] {
  if (data.transparent) return 'glass';
  return 'stone';
}

/**
 * 编译配方节点：通过连线收集输入/输出物品 id。
 * - 输入：getIncomingEdges 找到连入 recipe 的 item 节点（item.out → recipe.in）
 * - 输出：getOutgoingEdges 找到 recipe 连出的 item 节点（recipe.out → item），取第一个作为 output
 * - 无输出连线时报错（配方必须有产物）
 */
export function compileRecipeNode(
  graph: NodeGraph,
  node: ModNode,
  nodeMap?: Map<string, ModNode>,
): ModRecipeSpec {
  if (node.data.kind !== 'recipe') {
    throw new Error(`节点 ${node.id} 不是 recipe 类型`);
  }
  const data = node.data;

  // 收集输入物品
  const inputs: ModRecipeInputSpec[] = [];
  for (const edge of getIncomingEdges(graph, node.id)) {
    const sourceNode = findSourceNode(graph, edge, nodeMap);
    if (sourceNode?.data.kind === 'item') {
      inputs.push({
        item: sourceNode.data.itemId,
        count: 1,
        slot: '', // shapeless 默认空，shaped 由用户在 pattern 中定义
      });
    }
  }

  // 收集输出物品（取第一个连出的 item 节点作为产物）
  let output = '';
  for (const edge of getOutgoingEdges(graph, node.id)) {
    const targetNode = findTargetNode(graph, edge, nodeMap);
    if (targetNode?.data.kind === 'item') {
      output = targetNode.data.itemId;
      break;
    }
  }
  if (!output) {
    throw new Error(`配方节点 ${node.id}（${data.recipeId}）没有输出物品连线`);
  }

  return {
    recipeId: data.recipeId,
    recipeType: data.recipeType,
    inputs,
    output,
    outputCount: data.outputCount,
    cookTime: data.cookTime,
    experience: data.experience,
    pattern: data.pattern,
    // P41：smithing/brewing 扩展字段（RecipeNodeData 新字段，旧数据回退默认值）
    template: data.template ?? 'minecraft:netherite_upgrade_smithing_template',
    base: data.base ?? '',
    addition: data.addition ?? '',
    inputPotion: data.inputPotion ?? 'minecraft:water',
    ingredientItem: data.ingredientItem ?? '',
    outputPotion: data.outputPotion ?? '',
  };
}

/** 编译实体节点：直接从 EntityNodeData 映射到 EntitySpec */
export function compileEntityNode(node: ModNode): EntitySpec {
  if (node.data.kind !== 'entity') {
    throw new Error(`节点 ${node.id} 不是 entity 类型`);
  }
  const data = node.data;
  return {
    entityId: data.entityId,
    displayName: data.displayName || data.entityId,
    maxHealth: data.maxHealth,
    attackDamage: data.attackDamage,
    movementSpeed: data.movementSpeed,
    classification: data.classification,
    modelType: data.modelType,
    spawnWeight: data.spawnWeight,
    spawnBiomes: data.spawnBiomes,
    texturePath: data.texturePath,
  };
}

/** 编译机器节点：直接从 MachineNodeData 映射到 MachineSpec */
export function compileMachineNode(node: ModNode): MachineSpec {
  if (node.data.kind !== 'machine') {
    throw new Error(`节点 ${node.id} 不是 machine 类型`);
  }
  const data = node.data;
  return {
    machineId: data.machineId,
    displayName: data.displayName || data.machineId,
    energyCapacity: data.energyCapacity,
    maxEnergyTransfer: data.maxEnergyTransfer,
    inputSlots: data.inputSlots,
    outputSlots: data.outputSlots,
    defaultProcessTime: data.defaultProcessTime,
    defaultEnergyPerTick: data.defaultEnergyPerTick,
    guiWidth: data.guiWidth,
    guiHeight: data.guiHeight,
    // T5: 配方映射（解析 recipeMapJson）
    recipeMap: parseRecipeMap(data.recipeMapJson),
  };
}

/** T5: 解析配方映射 JSON，失败回退空对象 */
function parseRecipeMap(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // 忽略
  }
  return {};
}

/** 编译生物群系节点 */
export function compileBiomeNode(node: ModNode): ModBiomeSpec {
  if (node.data.kind !== 'biome') {
    throw new Error(`节点 ${node.id} 不是 biome 类型`);
  }
  const data = node.data;
  return {
    biomeId: data.biomeId,
    displayName: data.displayName || data.biomeId,
    precipitation: data.precipitation,
    temperature: data.temperature,
    temperatureModifier: data.temperatureModifier,
    downfall: data.downfall,
    skyColor: data.skyColor,
    waterColor: data.waterColor,
    waterFogColor: data.waterFogColor,
    fogColor: data.fogColor,
    surfaceBuilder: data.surfaceBuilder,
    category: 'plains',
    spawnWeight: data.spawnWeight,
    spawnDimensions: data.spawnDimensions,
  };
}

/** 编译维度节点 */
export function compileDimensionNode(node: ModNode): ModDimensionSpec {
  if (node.data.kind !== 'dimension') {
    throw new Error(`节点 ${node.id} 不是 dimension 类型`);
  }
  const data = node.data;
  return {
    dimensionId: data.dimensionId,
    displayName: data.displayName || data.dimensionId,
    baseType: data.baseType,
    fixedTime: data.fixedTime,
    hasSkyLight: data.hasSkyLight,
    hasCeiling: data.hasCeiling,
    ultrawarm: data.ultrawarm,
    natural: data.natural,
    coordinateScale: 1.0,
    minY: data.minY,
    height: data.height,
    logicalHeight: data.height,
    ambientLight: 0,
    piglinSafe: false,
    bedWorks: true,
    respawnAnchorWorks: false,
    effects: data.effects,
  };
}

/** 编译流体节点 */
export function compileFluidNode(node: ModNode): FluidSpec {
  if (node.data.kind !== 'fluid') {
    throw new Error(`节点 ${node.id} 不是 fluid 类型`);
  }
  const data = node.data;
  return {
    fluidId: data.fluidId,
    displayName: data.displayName || data.fluidId,
    color: data.color,
    temperature: data.temperature,
    viscosity: data.viscosity,
    density: data.density,
    luminous: data.luminous,
  };
}

/** 编译 GUI 节点：解析 slotsJson → GuiSlotSpec[] */
export function compileGuiNode(node: ModNode): GuiSpec {
  if (node.data.kind !== 'gui') {
    throw new Error(`节点 ${node.id} 不是 gui 类型`);
  }
  const data = node.data;
  let slots: GuiSlotSpec[] = [];
  try {
    const parsed = JSON.parse(data.slotsJson || '[]');
    if (Array.isArray(parsed)) {
      slots = parsed as GuiSlotSpec[];
    }
  } catch {
    // 解析失败：空槽位
  }
  return {
    guiId: data.guiId,
    displayName: data.displayName || data.guiId,
    width: data.width,
    height: data.height,
    slots,
    showEnergyBar: data.showEnergyBar,
    showProgressBar: data.showProgressBar,
  };
}

/**
 * 编译代码节点：原样保留用户代码与端口签名。
 * - inputSignature/outputSignature 是 JSON 字符串，解析为 Record<portId, PortType>
 * - P2-4 dogfood：解析失败时通过 warnings 报告（不阻断编译）
 * - snippetId 使用节点 id，便于调试与回溯
 *
 * @param warnings P2-4：接收解析警告的数组（可选，向后兼容）
 */
export function compileCodeNode(node: ModNode, warnings?: string[]): CustomCodeSnippetSpec {
  if (node.data.kind !== 'code') {
    throw new Error(`节点 ${node.id} 不是 code 类型`);
  }
  const data = node.data;
  return {
    snippetId: node.id,
    language: data.language,
    code: data.code,
    inputSignature: parseSignatureJson(data.inputSignature, warnings, node.id),
    outputSignature: parseSignatureJson(data.outputSignature, warnings, node.id),
    methodName: data.methodName,
  };
}

/** 编译多方块节点：直接从 MultiBlockNodeData 映射到 MultiBlockSpec */
export function compileMultiblockNode(node: ModNode): MultiBlockSpec {
  if (node.data.kind !== 'multiblock') {
    throw new Error(`节点 ${node.id} 不是 multiblock 类型`);
  }
  const data = node.data;
  return {
    structureId: data.structureId,
    displayName: data.displayName || data.structureId,
    width: data.width,
    height: data.height,
    depth: data.depth,
    hollow: data.hollow,
    controllerOffset: data.controllerOffset,
  };
}

/**
 * 编译事件节点：解析 eventArgs JSON，扁平映射到 EventHandlerSpec。
 * P1.5：通过 control 边 BFS 收集所有可达的 condition/action 节点 id：
 * - 从 event 节点出发，沿 edge.kind === 'control' 的出边遍历
 * - conditionIds：所有可达的 condition 节点 id（condition 节点有 true/false 两个出端口，都遍历）
 * - actionIds：所有可达的 action 节点 id（含 event 直接连接、通过 condition 间接连接、action 链式连接）
 * - 用 visited Set 避免循环，用 Set 去重避免同一节点被多条路径收集
 *
 * P1-3：同时收集可达的 procedure 节点 id 到 procedureCallIds。
 * - 遇到 procedure 节点时记录到 procedureCallIds，但【不继续遍历其下游】
 *   （procedure 的 condition/action 体归属 procedure 自身，在 compileProcedureNode 收集）
 * - 这样 event handler 只负责「调用过程」，过程体逻辑在 procedure 方法内
 */
export function compileEventNode(
  graph: NodeGraph,
  node: ModNode,
  warnings?: string[],
  nodeMap?: Map<string, ModNode>,
): EventHandlerSpec {
  if (node.data.kind !== 'event') {
    throw new Error(`节点 ${node.id} 不是 event 类型`);
  }
  const data = node.data;

  const conditionIds = new Set<string>();
  const actionIds = new Set<string>();
  const procedureCallIds = new Set<string>();
  const visited = new Set<string>();

  /** BFS：从 event 节点出发，沿 control 边收集所有可达的 condition/action/procedure 节点
   * event 节点本身不计入各 id 列表，仅作为遍历起点 */
  // P2 dogfood 优化：用双指针替代 queue.shift()（shift 是 O(n)，双指针整体 O(V+E)）
  const bfsQueue: string[] = [node.id];
  let bfsHead = 0;
  visited.add(node.id);

  while (bfsHead < bfsQueue.length) {
    const currentId = bfsQueue[bfsHead++];
    for (const edge of getOutgoingEdges(graph, currentId)) {
      // 只沿 control 边遍历（忽略 craft/flow/data 等其他类型边）
      if (edge.kind !== 'control') continue;
      const targetNode = findTargetNode(graph, edge, nodeMap);
      if (!targetNode) continue;
      if (visited.has(targetNode.id)) continue;
      visited.add(targetNode.id);

      // 跳过禁用节点——禁用节点不参与控制流，其 ID 不应出现在引用列表中
      // 否则会产生悬空引用（conditionIds/actionIds/procedureCallIds 引用不存在的实体）
      if (targetNode.data.disabled) continue;
      // 跳过锁定节点——锁定节点编译为 lockedCode 而非 spec.conditions/actions/procedures
      if (targetNode.data.codeLocked && targetNode.data.lockedCode) continue;

      if (targetNode.data.kind === 'condition') {
        conditionIds.add(targetNode.id);
        // 继续遍历该 condition 的下游（true/false 出端口均会通过 getOutgoingEdges 覆盖）
        bfsQueue.push(targetNode.id);
      } else if (targetNode.data.kind === 'action') {
        actionIds.add(targetNode.id);
        // action 有 out 端口，可能链式连接下游 action，继续遍历
        bfsQueue.push(targetNode.id);
      } else if (targetNode.data.kind === 'procedure') {
        // P1-3：记录过程调用，但不继续遍历过程体（过程体由 compileProcedureNode 收集）
        procedureCallIds.add(targetNode.id);
      }
      // 其他类型节点（item/block/entity 等）不沿 control 边继续遍历
    }
  }

  return {
    handlerId: node.id,
    eventType: data.eventType,
    eventArgs: parseArgsJson(data.eventArgs, warnings, node.id),
    conditionIds: [...conditionIds],
    actionIds: [...actionIds],
    procedureCallIds: [...procedureCallIds],
    procedureCallArgs: collectProcedureCallArgs(graph, node.id, procedureCallIds, nodeMap),
  };
}

/**
 * P40：解析过程调用的参数表达式。
 * 对每个被调用过程，按 inputs 顺序收集表达式：
 * - 查找指向过程节点对应输入端口（id 形如 `in_<name>`）的 data 边
 * - 源节点表达式：variable 节点 → varName；item 节点 → itemLookup 表达式；其他 → ''（生成器回退默认值）
 * 返回 procedureId → 表达式数组（长度与过程 inputs 对齐，缺省补 ''）。
 */
function collectProcedureCallArgs(
  graph: NodeGraph,
  _callerNodeId: string,
  procedureCallIds: Set<string>,
  nodeMap?: Map<string, ModNode>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const idToNode = nodeMap ?? new Map(graph.nodes.map((n) => [n.id, n]));

  for (const procId of procedureCallIds) {
    const procNode = idToNode.get(procId);
    if (!procNode || procNode.data.kind !== 'procedure') continue;
    const inputs = procNode.data.inputs ?? [];
    const args: string[] = [];
    for (const input of inputs) {
      // 输入端口 id 约定：`in_<name>`（与 ProcedureNode 端口定义一致）
      const portId = `in_${input.name}`;
      const edge = graph.edges.find(
        (e) => e.target === procId && e.targetHandle === portId && e.kind === 'data' && !e.disabled,
      );
      if (!edge) {
        args.push('');
        continue;
      }
      const src = idToNode.get(edge.source);
      if (!src) {
        args.push('');
        continue;
      }
      if (src.data.kind === 'variable' && src.data.varName) {
        args.push(src.data.varName);
      } else if (src.data.kind === 'item' && src.data.itemId) {
        args.push(
          `net.minecraft.registry.Registries.ITEM.get(new net.minecraft.util.Identifier("minecraft:${src.data.itemId}"))`,
        );
      } else {
        args.push('');
      }
    }
    result[procId] = args;
  }
  return result;
}

/** 编译条件节点：解析 conditionArgs JSON，扁平映射到 ConditionSpec。P2-4：warnings 报告解析失败 */
export function compileConditionNode(node: ModNode, warnings?: string[]): ConditionSpec {
  if (node.data.kind !== 'condition') {
    throw new Error(`节点 ${node.id} 不是 condition 类型`);
  }
  const data = node.data;
  return {
    conditionId: node.id,
    conditionType: data.conditionType,
    args: parseArgsJson(data.conditionArgs, warnings, node.id),
    customCode: data.customCode ?? '',
    invert: data.invert,
  };
}

/** 编译动作节点：解析 actionArgs JSON，扁平映射到 ActionSpec。P2-4：warnings 报告解析失败 */
export function compileActionNode(node: ModNode, warnings?: string[]): ActionSpec {
  if (node.data.kind !== 'action') {
    throw new Error(`节点 ${node.id} 不是 action 类型`);
  }
  const data = node.data;
  return {
    actionId: node.id,
    actionType: data.actionType,
    args: parseArgsJson(data.actionArgs, warnings, node.id),
    customCode: data.customCode ?? '',
  };
}

/**
 * P1-3：编译过程节点为 ProcedureSpec。
 *
 * 对标 MCreator procedure：命名的可复用逻辑单元，编译为独立 Java 方法。
 *
 * BFS 收集过程体（与 compileEventNode 同构）：
 * - 从 procedure 节点出发，沿 control 边遍历
 * - conditionIds：可达的 condition 节点 id（继续遍历其下游 true/false 分支）
 * - actionIds：可达的 action 节点 id（继续遍历其链式下游）
 * - procedureCallIds：可达的 procedure 节点 id（过程嵌套调用，不继续遍历其体）
 * - 遇到 procedure 节点时记录但不继续遍历（嵌套过程体归属被调用过程自身）
 *
 * 复用语义：同一 procedure 节点可被多个 event/procedure 引用，
 * 但 ProcedureSpec 只在 procedures 数组中出现一次（按节点 id 唯一），
 * Java 生成时产生单一方法定义 + 多处调用。
 */
export function compileProcedureNode(
  graph: NodeGraph,
  node: ModNode,
  nodeMap?: Map<string, ModNode>,
): ProcedureSpec {
  if (node.data.kind !== 'procedure') {
    throw new Error(`节点 ${node.id} 不是 procedure 类型`);
  }
  const data = node.data as ProcedureNodeData;

  const conditionIds = new Set<string>();
  const actionIds = new Set<string>();
  const procedureCallIds = new Set<string>();
  const visited = new Set<string>();

  // P2 dogfood 优化：双指针 BFS（同 compileEventNode）
  const bfsQueue: string[] = [node.id];
  let bfsHead = 0;
  visited.add(node.id);

  while (bfsHead < bfsQueue.length) {
    const currentId = bfsQueue[bfsHead++];
    for (const edge of getOutgoingEdges(graph, currentId)) {
      if (edge.kind !== 'control') continue;
      const targetNode = findTargetNode(graph, edge, nodeMap);
      if (!targetNode) continue;
      if (visited.has(targetNode.id)) continue;
      visited.add(targetNode.id);

      // 跳过禁用节点——与 compileEventNode 一致，避免悬空引用
      if (targetNode.data.disabled) continue;
      if (targetNode.data.codeLocked && targetNode.data.lockedCode) continue;

      if (targetNode.data.kind === 'condition') {
        conditionIds.add(targetNode.id);
        bfsQueue.push(targetNode.id);
      } else if (targetNode.data.kind === 'action') {
        actionIds.add(targetNode.id);
        bfsQueue.push(targetNode.id);
      } else if (targetNode.data.kind === 'procedure') {
        // 嵌套过程调用：记录但不继续遍历（被调用过程的体归它自己）
        procedureCallIds.add(targetNode.id);
      }
    }
  }

  return {
    procedureId: node.id,
    procedureName: data.procedureName,
    displayName: data.displayName,
    inputs: (data.inputs ?? [])
      .filter((i) => i.name)
      .map((i) => ({ name: i.name, type: i.type || 'int' })),
    conditionIds: [...conditionIds],
    actionIds: [...actionIds],
    procedureCallIds: [...procedureCallIds],
    procedureCallArgs: collectProcedureCallArgs(graph, node.id, procedureCallIds, nodeMap),
  };
}
