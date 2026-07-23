import type {
  NodeGraph,
  ModNode,
  ModEdge,
  ModSpec,
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
} from '@mc-creator/shared';
import { compileVariable } from './compileVariable.js';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { compileLoop } from './compileLoop.js';
import { compileCustomNode } from './compileCustomNode.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';

/**
 * 节点图编译器
 *
 * 将 NodeGraph 编译为 ModSpec（已有 schema），
 * 由 mod-generator 进一步生成 Java 文件。
 *
 * 编译策略：
 * 1. 遍历所有未禁用的节点，按类型分发到对应的编译函数
 * 2. 处理连线关系（如配方 → 物品引用）
 * 3. 代码节点（CodeNode）的代码嵌入到 ModSpec 的 customCode 字段
 *    （由 mod-generator 在生成 Java 时插入到对应位置）
 *
 * P1.3 已支持：items/blocks/recipes/entities/machines 完整编译。
 * P1.4 已支持：code/multiblock/event/condition/action 节点编译到 ModSpec 顶层。
 *   - event/condition/action 采用扁平结构编译到顶层 conditions/actions 数组。
 *   - comment 节点仅文档用途，编译时跳过。
 * P1.5 已支持：通过 control 边建立 event → condition → action 控制流链引用。
 *   - EventHandlerSpec.conditionIds/actionIds 通过 BFS 收集可达节点 id（去重）。
 *   - 顶层 conditions/actions 数组保持扁平列表不变（向后兼容 P1.4）。
 */

export interface CompileResult {
  /** 编译出的 ModSpec */
  spec: ModSpec;
  /** 警告信息（非致命错误） */
  warnings: string[];
  /** 错误信息（致命错误，spec 仍可部分使用） */
  errors: string[];
  /** 暂未集成到 ModSpec 顶层的节点编译结果（如 multiblock/event/condition/action/code，待后续扩展） */
  unsupported?: Array<{ kind: string; nodeId: string; summary: string }>;
}

/** 编译入口 */
export function compileNodeGraph(graph: NodeGraph): CompileResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const unsupported: Array<{ kind: string; nodeId: string; summary: string }> = [];

  // === 阶段 C：子图内联展开 ===
  // 把 customTypeId 为 null 的 subgraph 节点替换为其引用的子图内部节点。
  // customTypeId 非空的 subgraph 节点（自定义节点）不展开，由 compileCustomNode 处理。
  const inlineResult = inlineSubgraphNodes(graph, subgraphManager);
  warnings.push(...inlineResult.warnings);
  const inlinedGraph = inlineResult.graph;

  // 过滤禁用节点
  const activeNodes = inlinedGraph.nodes.filter((n) => !n.data.disabled);

  // 校验：modId 必须有
  if (!inlinedGraph.modId) {
    errors.push('节点图缺少 modId，无法编译');
  }

  // === 编译物品 ===
  const items: ItemSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'item') continue;
    try {
      items.push(compileItemNode(node));
    } catch (e) {
      errors.push(`物品节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译方块 ===
  const blocks: BlockSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'block') continue;
    try {
      blocks.push(compileBlockNode(node));
    } catch (e) {
      errors.push(`方块节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译配方 ===
  // 配方节点的输入连线指向材料物品节点（item.out → recipe.in），
  // 输出连线指向产物物品节点（recipe.out → item）。
  // P1.3：编译到 ModSpec.recipes 顶层字段。
  const recipes: ModRecipeSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'recipe') continue;
    try {
      recipes.push(compileRecipeNode(inlinedGraph, node));
    } catch (e) {
      errors.push(`配方节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译实体 ===
  // P1.3：编译到 ModSpec.entities 顶层字段。
  const entities: EntitySpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'entity') continue;
    try {
      entities.push(compileEntityNode(node));
    } catch (e) {
      errors.push(`实体节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译机器 ===
  // P1.3：编译到 ModSpec.machines 顶层字段。
  const machines: MachineSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'machine') continue;
    try {
      machines.push(compileMachineNode(node));
    } catch (e) {
      errors.push(`机器节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译代码节点 ===
  // CodeNode 的代码原样收集到 spec.customCode（保留端口签名，由 mod-generator 决定嵌入位置）。
  const customCode: CustomCodeSnippetSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'code') continue;
    try {
      customCode.push(compileCodeNode(node));
    } catch (e) {
      errors.push(`代码节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 阶段 C：编译变量节点 ===
  // variable → Java 字段声明，push 到 customCode 数组（不覆盖 code 节点结果）
  for (const node of activeNodes) {
    if (node.data.kind !== 'variable') continue;
    try {
      const { snippet } = compileVariable(node.data);
      customCode.push(snippet);
    } catch (e) {
      errors.push(`变量节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 阶段 C：编译循环节点 ===
  // loop → Java 循环代码，bodyCode 从 bodySubgraphId 子图编译（无则空体）
  for (const node of activeNodes) {
    if (node.data.kind !== 'loop') continue;
    try {
      const bodyCode = compileLoopBody(inlinedGraph, node.data.bodySubgraphId);
      const { snippet } = compileLoop(node.data, bodyCode);
      customCode.push(snippet);
    } catch (e) {
      errors.push(`循环节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译多方块结构 ===
  // P1.4：编译到 ModSpec.multiblocks 顶层字段。
  const multiblocks: MultiBlockSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'multiblock') continue;
    try {
      multiblocks.push(compileMultiblockNode(node));
    } catch (e) {
      errors.push(`多方块节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 编译事件/条件/动作节点 ===
  // P1.4：采用扁平结构编译到 ModSpec 顶层（conditions/actions 数组）。
  // P1.5：通过 control 边建立引用（event → condition → action），
  //       EventHandlerSpec.conditionIds/actionIds 记录该事件处理器关联的节点 id。
  const eventHandlers: EventHandlerSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'event') continue;
    try {
      eventHandlers.push(compileEventNode(inlinedGraph, node));
    } catch (e) {
      errors.push(`事件节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  const conditions: ConditionSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'condition') continue;
    try {
      conditions.push(compileConditionNode(node));
    } catch (e) {
      errors.push(`条件节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  const actions: ActionSpec[] = [];
  for (const node of activeNodes) {
    if (node.data.kind !== 'action') continue;
    try {
      actions.push(compileActionNode(node));
    } catch (e) {
      errors.push(`动作节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // comment 节点仅文档用途，编译时跳过（不产生 warning 或 error）。

  // === 阶段 C：编译自定义节点 ===
  // subgraph 节点中 customTypeId 非空的为自定义节点，用 compileCustomNode 渲染 codeTemplate。
  // customTypeId 为 null 的 subgraph 节点已在前面内联展开，此处不应再出现。
  for (const node of activeNodes) {
    if (node.data.kind !== 'subgraph') continue;
    if (node.data.customTypeId) {
      const result = compileCustomNode(node.data, node.data.customFields);
      if (result.error) {
        errors.push(`自定义节点 ${node.id} 编译失败：${result.error}`);
      } else if (result.snippet) {
        customCode.push(result.snippet);
      }
    }
  }

  // === 阶段 C：外部 mod 依赖检测 ===
  // 扫描所有物品/方块/配方的 id 和 customCode，提取 modid 命名空间，
  // 与已安装外部 mod 列表比对，未安装的加 warning（不阻断编译）。
  // 注意：listExternalMods 是异步函数，但编译器同步执行——此处用同步缓存，
  // 真正的已安装列表由 preload 阶段异步预取并缓存到 module-level 变量。
  const externalNamespaces = collectExternalNamespaces(
    items,
    blocks,
    recipes,
    customCode,
    inlinedGraph.modId,
  );
  for (const ns of externalNamespaces) {
    if (!isExternalModInstalled(ns)) {
      warnings.push(`引用了外部 mod 命名空间「${ns}」，但该 mod 未安装，运行时可能缺失依赖`);
    }
  }

  const spec: ModSpec = {
    modId: inlinedGraph.modId || 'unnamed_mod',
    version: '1.0.0',
    name: inlinedGraph.modId || '未命名 Mod',
    description: `由节点图编译生成（${activeNodes.length} 个节点，${inlinedGraph.edges.length} 条连线）`,
    items,
    blocks,
    license: 'MIT',
    authors: [],
    credits: '',
    dependencies: [],
    website: '',
    lootTables: [],
    advancements: [],
    tags: [],
    functions: [],
    recipes,
    entities,
    machines,
    customCode,
    multiblocks,
    eventHandlers,
    conditions,
    actions,
  };

  return { spec, warnings, errors, unsupported };
}

// === 节点编译函数 ===

function compileItemNode(node: ModNode): ItemSpec {
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

function compileBlockNode(node: ModNode): BlockSpec {
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
function compileRecipeNode(graph: NodeGraph, node: ModNode): ModRecipeSpec {
  if (node.data.kind !== 'recipe') {
    throw new Error(`节点 ${node.id} 不是 recipe 类型`);
  }
  const data = node.data;

  // 收集输入物品
  const inputs: ModRecipeInputSpec[] = [];
  for (const edge of getIncomingEdges(graph, node.id)) {
    const sourceNode = findSourceNode(graph, edge);
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
    const targetNode = findTargetNode(graph, edge);
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
  };
}

/** 编译实体节点：直接从 EntityNodeData 映射到 EntitySpec */
function compileEntityNode(node: ModNode): EntitySpec {
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
function compileMachineNode(node: ModNode): MachineSpec {
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
  };
}

/**
 * 编译代码节点：原样保留用户代码与端口签名。
 * - inputSignature/outputSignature 是 JSON 字符串，解析为 Record<portId, PortType>
 * - 解析失败时回退为空对象（不阻断编译，仅产生 warning 由调用方收集）
 * - snippetId 使用节点 id，便于调试与回溯
 */
function compileCodeNode(node: ModNode): CustomCodeSnippetSpec {
  if (node.data.kind !== 'code') {
    throw new Error(`节点 ${node.id} 不是 code 类型`);
  }
  const data = node.data;
  return {
    snippetId: node.id,
    language: data.language,
    code: data.code,
    inputSignature: parseSignatureJson(data.inputSignature),
    outputSignature: parseSignatureJson(data.outputSignature),
    methodName: data.methodName,
  };
}

/** 编译多方块节点：直接从 MultiBlockNodeData 映射到 MultiBlockSpec */
function compileMultiblockNode(node: ModNode): MultiBlockSpec {
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
 */
function compileEventNode(graph: NodeGraph, node: ModNode): EventHandlerSpec {
  if (node.data.kind !== 'event') {
    throw new Error(`节点 ${node.id} 不是 event 类型`);
  }
  const data = node.data;

  const conditionIds = new Set<string>();
  const actionIds = new Set<string>();
  const visited = new Set<string>();

  // BFS：从 event 节点出发，沿 control 边收集所有可达的 condition/action 节点
  // event 节点本身不计入 conditionIds/actionIds，仅作为遍历起点
  const queue: string[] = [node.id];
  visited.add(node.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    for (const edge of getOutgoingEdges(graph, currentId)) {
      // 只沿 control 边遍历（忽略 craft/flow/data 等其他类型边）
      if (edge.kind !== 'control') continue;
      const targetNode = findTargetNode(graph, edge);
      if (!targetNode) continue;
      if (visited.has(targetNode.id)) continue;
      visited.add(targetNode.id);

      if (targetNode.data.kind === 'condition') {
        conditionIds.add(targetNode.id);
        // 继续遍历该 condition 的下游（true/false 出端口均会通过 getOutgoingEdges 覆盖）
        queue.push(targetNode.id);
      } else if (targetNode.data.kind === 'action') {
        actionIds.add(targetNode.id);
        // action 有 out 端口，可能链式连接下游 action，继续遍历
        queue.push(targetNode.id);
      }
      // 其他类型节点（item/block/entity 等）不沿 control 边继续遍历
    }
  }

  return {
    handlerId: node.id,
    eventType: data.eventType,
    eventArgs: parseArgsJson(data.eventArgs),
    conditionIds: [...conditionIds],
    actionIds: [...actionIds],
  };
}

/** 编译条件节点：解析 conditionArgs JSON，扁平映射到 ConditionSpec */
function compileConditionNode(node: ModNode): ConditionSpec {
  if (node.data.kind !== 'condition') {
    throw new Error(`节点 ${node.id} 不是 condition 类型`);
  }
  const data = node.data;
  return {
    conditionId: node.id,
    conditionType: data.conditionType,
    args: parseArgsJson(data.conditionArgs),
    invert: data.invert,
  };
}

/** 编译动作节点：解析 actionArgs JSON，扁平映射到 ActionSpec */
function compileActionNode(node: ModNode): ActionSpec {
  if (node.data.kind !== 'action') {
    throw new Error(`节点 ${node.id} 不是 action 类型`);
  }
  const data = node.data;
  return {
    actionId: node.id,
    actionType: data.actionType,
    args: parseArgsJson(data.actionArgs),
  };
}

// === JSON 解析辅助 ===

/**
 * 解析节点参数 JSON 字符串为 record。
 * 解析失败或非对象时返回空对象（不阻断编译，保证 spec 可用）。
 */
function parseArgsJson(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * 解析端口签名 JSON 字符串为 Record<portId, PortType>。
 * 解析失败或非对象时返回空对象。
 */
function parseSignatureJson(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 端口签名的值应为字符串（PortType），非字符串值会被过滤
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') {
          result[key] = value;
        }
      }
      return result;
    }
    return {};
  } catch {
    return {};
  }
}

// === 连线关系查询辅助 ===

/** 获取节点的所有输入连线 */
export function getIncomingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return graph.edges.filter((e) => e.target === nodeId && !e.disabled);
}

/** 获取节点的所有输出连线 */
export function getOutgoingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return graph.edges.filter((e) => e.source === nodeId && !e.disabled);
}

/** 获取节点某端口的输出连线 */
export function getEdgesFromPort(graph: NodeGraph, nodeId: string, portId: string): ModEdge[] {
  return graph.edges.filter((e) => e.source === nodeId && e.sourceHandle === portId && !e.disabled);
}

/** 获取节点某端口的输入连线 */
export function getEdgesToPort(graph: NodeGraph, nodeId: string, portId: string): ModEdge[] {
  return graph.edges.filter((e) => e.target === nodeId && e.targetHandle === portId && !e.disabled);
}

/** 根据连线找到源节点 */
export function findSourceNode(graph: NodeGraph, edge: ModEdge): ModNode | null {
  return graph.nodes.find((n) => n.id === edge.source) ?? null;
}

/** 根据连线找到目标节点 */
export function findTargetNode(graph: NodeGraph, edge: ModEdge): ModNode | null {
  return graph.nodes.find((n) => n.id === edge.target) ?? null;
}

// === 阶段 C 辅助函数 ===

/**
 * 编译循环节点的循环体：从 bodySubgraphId 引用的子图中提取代码节点/动作节点的代码，
 * 拼接为循环体代码字符串。无 bodySubgraphId 或子图未找到时返回空注释。
 */
function compileLoopBody(graph: NodeGraph, bodySubgraphId?: string): string {
  if (!bodySubgraphId) return '// no body';
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return '// body subgraph not found';
  const lines: string[] = [];
  for (const node of sg.nodes) {
    if (node.data.kind === 'code') {
      lines.push(node.data.code);
    } else if (node.data.kind === 'action') {
      lines.push(`// action: ${node.data.actionType}`);
    }
  }
  return lines.length > 0 ? lines.join('\n  ') : '// empty body';
}

/**
 * 收集所有引用的外部 mod 命名空间（排除 'minecraft' 和当前 modId）。
 * 扫描物品/方块/配方的 id（modid:path 格式）和 customCode 中的 import 语句。
 */
function collectExternalNamespaces(
  items: ItemSpec[],
  blocks: BlockSpec[],
  recipes: ModRecipeSpec[],
  customCode: CustomCodeSnippetSpec[],
  currentModId: string,
): Set<string> {
  const namespaces = new Set<string>();
  const extractNs = (id: string) => {
    const idx = id.indexOf(':');
    if (idx > 0) {
      const ns = id.substring(0, idx);
      if (ns !== 'minecraft' && ns !== currentModId) {
        namespaces.add(ns);
      }
    }
  };
  for (const item of items) extractNs(item.id);
  for (const block of blocks) extractNs(block.id);
  for (const recipe of recipes) {
    extractNs(recipe.output);
    for (const input of recipe.inputs) extractNs(input.item);
  }
  for (const cc of customCode) {
    // 扫描 import 语句中的包名（com.xxx.yyy → xxx 作为 modid 猜测）
    const importMatches = cc.code.matchAll(/import\s+com\.([a-z0-9_]+)\./gi);
    for (const m of importMatches) {
      namespaces.add(m[1]);
    }
  }
  return namespaces;
}

/** 已安装外部 mod 缓存（由 preload 阶段异步填充，编译器同步读取） */
let installedExternalModsCache: Set<string> | null = null;

/**
 * 预加载外部 mod 缓存（导出供调用方在编译前异步预取已安装 mod 列表）。
 * 编译器内部用 isExternalModInstalled 同步读缓存。
 */
export function preloadExternalMods(mods: Array<{ namespace: string; installed: boolean }>): void {
  installedExternalModsCache = new Set(mods.filter((m) => m.installed).map((m) => m.namespace));
}

/**
 * 检查外部 mod 是否已安装（同步，读缓存）。
 * 缓存为 null 时（未 preload）默认返回 true（不误报），避免阻塞编译。
 */
function isExternalModInstalled(namespace: string): boolean {
  if (!installedExternalModsCache) return true; // 未 preload，不误报
  return installedExternalModsCache.has(namespace);
}
