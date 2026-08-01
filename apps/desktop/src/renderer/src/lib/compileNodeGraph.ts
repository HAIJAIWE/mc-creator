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
  ProcedureSpec,
  ProcedureNodeData,
} from '@mc-creator/shared';
import { compileVariable } from './compileVariable.js';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { compileLoop } from './compileLoop.js';
import { compileCustomNode } from './compileCustomNode.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import {
  registerCompiler,
  compileAll,
  type CompileContext,
  type CompilerOutput,
} from './nodeCompilerRegistry.js';

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
}

/** 编译入口 */
export function compileNodeGraph(graph: NodeGraph): CompileResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  // L-3 修复：惰性预取已安装外部 mod 列表（缓存为 null 时异步拉取一次）。
  // 本次编译仍以空缓存执行（isExternalModInstalled 返回 true 不误报），
  // 后续编译即可使用真实的已安装列表做未安装依赖检测。
  if (installedExternalModsCache === null) {
    import('../components/lowcode/custom/externalModList.js')
      .then((mod) => mod.listExternalMods())
      .then((mods) =>
        preloadExternalMods(mods.map((m) => ({ namespace: m.namespace, installed: m.installed }))),
      )
      .catch(() => {
        // IPC 失败：保持空缓存（不误报）
      });
  }

  // === 阶段 C：子图内联展开 ===
  // 把 customTypeId 为 null 的 subgraph 节点替换为其引用的子图内部节点。
  // customTypeId 非空的 subgraph 节点（自定义节点）不展开，由 compileCustomNode 处理。
  const inlineResult = inlineSubgraphNodes(graph, subgraphManager);
  warnings.push(...inlineResult.warnings);
  const inlinedGraph = inlineResult.graph;

  // P2 dogfood 优化：重建内联展开后的节点索引（子图展开后节点可能变化）
  const inlinedNodeMap = new Map(inlinedGraph.nodes.map((n) => [n.id, n]));

  // 过滤禁用节点
  const activeNodes = inlinedGraph.nodes.filter((n) => !n.data.disabled);

  // === P0-1: 节点级 codeLock（对标 MCreator codeLock）===
  // 锁定节点（codeLocked=true 且 lockedCode 非空）跳过常规编译，直接使用用户手改代码。
  // 锁定但 lockedCode 为空的节点回退到常规编译并产生 warning（提示用户补全或解锁）。
  // comment 节点即使锁定也不产生 customCode（本就跳过编译）。
  const lockedNodes = activeNodes.filter(
    (n) => n.data.codeLocked && n.data.lockedCode && n.data.kind !== 'comment',
  );
  const compilableNodes = activeNodes.filter((n) => !lockedNodes.includes(n));
  for (const n of activeNodes) {
    if (n.data.codeLocked && !n.data.lockedCode && n.data.kind !== 'comment') {
      warnings.push(
        `节点 ${n.id} 已锁定代码但 lockedCode 为空，回退到常规编译（请补全锁定代码或解锁节点）`,
      );
    }
  }

  // === 问题 13：modId 净化为合法命名空间 ===
  // modId 用作 Java 包名/资源命名空间，必须为小写字母/数字/下划线。
  // 净化规则：转小写 → 非法字符替换为下划线 → 折叠连续下划线 → 去除首尾下划线。
  const sanitizedModId = sanitizeModId(inlinedGraph.modId);

  // 校验：modId 必须有（净化前为空才报错）
  if (!inlinedGraph.modId) {
    errors.push('节点图缺少 modId，无法编译');
  } else if (!sanitizedModId) {
    // P1-2 dogfood 修复：原始 modId 非空但净化后为空（全是非法字符），明确报错
    errors.push(
      `modId「${inlinedGraph.modId}」净化后为空（全部为非法字符），请使用小写字母/数字/下划线`,
    );
  } else if (sanitizedModId !== inlinedGraph.modId.toLowerCase()) {
    // 净化后与原始不同（含有非法字符被替换），发出 warning
    warnings.push(`modId「${inlinedGraph.modId}」包含非法字符，已净化为「${sanitizedModId}」`);
  }

  // === P0-1: 锁定节点的手改代码先收集（跳过常规编译）===
  // 锁定节点不经过编译器注册表分发，直接用用户保存的 lockedCode 包装为 snippet。
  // language 固定为 java（MC mod 主体语言）；methodName/snippetId 用节点 id 保持可追溯。
  // 这部分先于 dispatch 收集，保证锁定代码排在 customCode 数组最前（便于回溯）。
  const lockedCustomCode: CustomCodeSnippetSpec[] = [];
  for (const node of lockedNodes) {
    lockedCustomCode.push({
      snippetId: node.id,
      language: 'java',
      code: node.data.lockedCode ?? '',
      inputSignature: {},
      outputSignature: {},
      methodName: `locked_${node.id}`,
    });
  }

  // === P1-2: 通过编译器注册表分发（对标 MCreator ModElementGenerator registry）===
  // 遍历 compilableNodes 一次，按 node.data.kind 查 nodeCompilerRegistry 分发，
  // 每个编译器返回贡献到 ModSpec 各字段的产出，由 compileAll 合并。
  // - comment 等文档型节点未注册 compiler，静默跳过（不产生 warning 或 error）
  // - 编译器抛异常由 compileAll 捕获转为 error（带 kind 前缀，不中断其他节点）
  // - 自定义节点（subgraph + customTypeId）的 schema 未注册错误经 output.errors 上报，
  //   保留「自定义节点 ... 编译失败」原始消息（见 subgraph compiler 注册）
  // - 配方/事件等需要查连线的编译器通过 ctx.graph 访问内联展开后的图
  // - 循环节点通过 ctx.compileLoopBody 递归编译 body 子图
  const ctx: CompileContext = {
    graph: inlinedGraph,
    sanitizedModId,
    nodeMap: inlinedNodeMap,
    // P1-4 dogfood 修复：传入 warnings 数组以便 compileLoopBody 报告 condition/procedure 节点
    compileLoopBody: (bodySubgraphId) => compileLoopBody(inlinedGraph, bodySubgraphId, warnings),
  };
  const { output: dispatched, errors: dispatchErrors } = compileAll(compilableNodes, ctx);
  errors.push(...dispatchErrors);
  if (dispatched.errors) errors.push(...dispatched.errors);
  if (dispatched.warnings) warnings.push(...dispatched.warnings);

  const items = dispatched.items ?? [];
  const blocks = dispatched.blocks ?? [];
  const recipes = dispatched.recipes ?? [];
  const entities = dispatched.entities ?? [];
  const machines = dispatched.machines ?? [];
  const multiblocks = dispatched.multiblocks ?? [];
  const eventHandlers = dispatched.eventHandlers ?? [];
  const conditions = dispatched.conditions ?? [];
  const actions = dispatched.actions ?? [];
  const procedures = dispatched.procedures ?? [];

  // === P2-5: 循环节点 body 子图的 condition/procedure 收集 ===
  // 循环体的 Java 代码引用 check_<id> / procedure_<name> 方法，
  // 因此需把循环体子图内的条件与过程节点编译进 spec.conditions / spec.procedures。
  // 按节点 id 去重（同一子图可能被多个 loop 节点引用）。
  {
    const loopSubgraphSpecs = compileLoopSubgraphSpecsAll(compilableNodes, inlinedGraph, warnings);
    for (const c of loopSubgraphSpecs.conditions) {
      if (!conditions.some((existing) => existing.conditionId === c.conditionId)) {
        conditions.push(c);
      }
    }
    for (const p of loopSubgraphSpecs.procedures) {
      if (!procedures.some((existing) => existing.procedureId === p.procedureId)) {
        procedures.push(p);
      }
    }
  }
  // customCode = 锁定代码（最前，便于回溯）+ dispatch 产出的 code/variable/loop/subgraph-custom（图顺序）
  const customCode: CustomCodeSnippetSpec[] = [
    ...lockedCustomCode,
    ...(dispatched.customCode ?? []),
  ];

  // === 阶段 C：外部 mod 依赖检测 ===
  // 扫描所有物品/方块/配方的 id 和 customCode，提取 modid 命名空间，
  // 与已安装外部 mod 列表比对，未安装的加 warning（不阻断编译）。
  // 注意：listExternalMods 是异步函数，但编译器同步执行——此处用同步缓存，
  // 真正的已安装列表由 preload 阶段异步预取并缓存到 module-level 变量。
  // 问题 14：使用净化后的 modId 做命名空间比较，避免大小写不一致误报当前 mod 引用。
  const externalNamespaces = collectExternalNamespaces(
    items,
    blocks,
    recipes,
    entities,
    machines,
    multiblocks,
    customCode,
    sanitizedModId,
  );
  for (const ns of externalNamespaces) {
    if (!isExternalModInstalled(ns)) {
      warnings.push(`引用了外部 mod 命名空间「${ns}」，但该 mod 未安装，运行时可能缺失依赖`);
    }
  }

  // === P1-4 dogfood：过程调用环检测 ===
  // 构建过程调用有向图，检测环（互递归在 Java 运行时导致 StackOverflowError）
  // P2-1 dogfood 修复：环检测去重——同一环内的成员只报一次，避免 A→B→A 产生两条重复 error
  // P1-6 dogfood 修复：孤立过程（无 event/procedure 引用）产生 warning，帮助用户发现死代码
  if (procedures.length > 0) {
    const procedureMap = new Map(procedures.map((p) => [p.procedureId, p.procedureCallIds]));
    const reportedCycleMembers = new Set<string>();

    // 环检测（去重）
    for (const proc of procedures) {
      if (proc.procedureCallIds.length === 0) continue;
      const visited = new Set<string>();
      const inStack = new Set<string>();
      const hasCycle = (pid: string): boolean => {
        if (inStack.has(pid)) return true;
        if (visited.has(pid)) return false;
        inStack.add(pid);
        const callees = procedureMap.get(pid);
        if (callees) {
          for (const calleeId of callees) {
            if (hasCycle(calleeId)) return true;
          }
        }
        inStack.delete(pid);
        visited.add(pid);
        return false;
      };
      if (hasCycle(proc.procedureId)) {
        // 仅当该过程自身不在已报告的环中时才报告（避免对同一环重复报告）
        // P2-1 dogfood 修复：把当前 inStack（含整个环的成员）全部标记为已报告，
        // 否则 A→B→A 互递归会对 A 和 B 各报一条 error。
        if (!reportedCycleMembers.has(proc.procedureId)) {
          for (const memberId of inStack) reportedCycleMembers.add(memberId);
          errors.push(
            `过程 ${proc.procedureId}（${proc.procedureName}）存在递归调用链，Java 运行时将导致 StackOverflowError`,
          );
        }
      }
    }

    // P1-6：孤立过程检测——未被任何 event/procedure 的 procedureCallIds 引用的过程是死代码
    const calledProcedureIds = new Set<string>();
    for (const eh of eventHandlers) {
      for (const pid of eh.procedureCallIds) calledProcedureIds.add(pid);
    }
    for (const proc of procedures) {
      for (const pid of proc.procedureCallIds) calledProcedureIds.add(pid);
    }
    for (const proc of procedures) {
      if (!calledProcedureIds.has(proc.procedureId)) {
        warnings.push(
          `过程 ${proc.procedureId}（${proc.procedureName}）未被任何事件或过程引用，生成的 Java 方法将无调用方`,
        );
      }
    }
  }

  // === 问题 24：customCode 按 snippetId 去重 ===
  // 子图内联展开后可能引入重复 snippetId（虽然 inlineSubgraphNodes 已做 ID 碰撞处理，
  // 但仍可能出现用户手动构造的重复或边界情况）。保留首次出现的 snippet，重复项加 warning。
  const dedupedCustomCode = deduplicateCustomCode(customCode, warnings);

  // === 问题 19：边数量统计只计入未禁用边 ===
  const activeEdgeCount = inlinedGraph.edges.filter((e) => !e.disabled).length;

  const spec: ModSpec = {
    modId: sanitizedModId || 'unnamed_mod',
    version: '1.0.0',
    name: sanitizedModId || '未命名 Mod',
    description: `由节点图编译生成（${activeNodes.length} 个节点，${activeEdgeCount} 条连线）`,
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
    customCode: dedupedCustomCode,
    multiblocks,
    // Task D：流体（当前无流体节点，恒为空数组；为 ModSpec 兼容保留）
    fluids: [],
    eventHandlers,
    conditions,
    actions,
    procedures,
  };

  return { spec, warnings, errors };
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
function compileRecipeNode(
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
 * - P2-4 dogfood：解析失败时通过 warnings 报告（不阻断编译）
 * - snippetId 使用节点 id，便于调试与回溯
 *
 * @param warnings P2-4：接收解析警告的数组（可选，向后兼容）
 */
function compileCodeNode(node: ModNode, warnings?: string[]): CustomCodeSnippetSpec {
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
 *
 * P1-3：同时收集可达的 procedure 节点 id 到 procedureCallIds。
 * - 遇到 procedure 节点时记录到 procedureCallIds，但【不继续遍历其下游】
 *   （procedure 的 condition/action 体归属 procedure 自身，在 compileProcedureNode 收集）
 * - 这样 event handler 只负责「调用过程」，过程体逻辑在 procedure 方法内
 */
function compileEventNode(
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
          `net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("minecraft:${src.data.itemId}"))`,
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
function compileConditionNode(node: ModNode, warnings?: string[]): ConditionSpec {
  if (node.data.kind !== 'condition') {
    throw new Error(`节点 ${node.id} 不是 condition 类型`);
  }
  const data = node.data;
  return {
    conditionId: node.id,
    conditionType: data.conditionType,
    args: parseArgsJson(data.conditionArgs, warnings, node.id),
    invert: data.invert,
  };
}

/** 编译动作节点：解析 actionArgs JSON，扁平映射到 ActionSpec。P2-4：warnings 报告解析失败 */
function compileActionNode(node: ModNode, warnings?: string[]): ActionSpec {
  if (node.data.kind !== 'action') {
    throw new Error(`节点 ${node.id} 不是 action 类型`);
  }
  const data = node.data;
  return {
    actionId: node.id,
    actionType: data.actionType,
    args: parseArgsJson(data.actionArgs, warnings, node.id),
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
function compileProcedureNode(
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

// === JSON 解析辅助 ===

/**
 * 解析节点参数 JSON 字符串为 record。
 * 解析失败或非对象时返回空对象（不阻断编译，保证 spec 可用）。
 *
 * P2-4 dogfood 修复：传入 warnings + nodeId 时，解析失败或类型不符会 push warning，
 * 帮助用户定位哪个节点的参数 JSON 有问题。不传时保持原有静默行为（向后兼容）。
 */
function parseArgsJson(
  json: string,
  warnings?: string[],
  nodeId?: string,
): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // 解析成功但不是对象（如字符串/数字/数组）
    if (warnings && nodeId) {
      const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;
      warnings.push(`节点 ${nodeId} 的参数 JSON 应为对象，实际为 ${actualType}，已忽略`);
    }
    return {};
  } catch (e) {
    // JSON 语法错误
    if (warnings && nodeId) {
      warnings.push(`节点 ${nodeId} 的参数 JSON 解析失败：${(e as Error).message}，已忽略`);
    }
    return {};
  }
}

/**
 * 解析端口签名 JSON 字符串为 Record<portId, PortType>。
 * 解析失败或非对象时返回空对象。
 *
 * P2-4 dogfood 修复：传入 warnings + nodeId 时，解析失败或类型不符会 push warning。
 */
function parseSignatureJson(
  json: string,
  warnings?: string[],
  nodeId?: string,
): Record<string, string> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 端口签名的值应为字符串（PortType），非字符串值会被过滤
      const result: Record<string, string> = {};
      let hasNonStringValue = false;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') {
          result[key] = value;
        } else {
          hasNonStringValue = true;
        }
      }
      if (hasNonStringValue && warnings && nodeId) {
        warnings.push(
          `节点 ${nodeId} 的端口签名 JSON 含非字符串值，已过滤（端口签名值应为 PortType 字符串）`,
        );
      }
      return result;
    }
    // 解析成功但不是对象
    if (warnings && nodeId) {
      const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;
      warnings.push(`节点 ${nodeId} 的端口签名 JSON 应为对象，实际为 ${actualType}，已忽略`);
    }
    return {};
  } catch (e) {
    if (warnings && nodeId) {
      warnings.push(`节点 ${nodeId} 的端口签名 JSON 解析失败：${(e as Error).message}，已忽略`);
    }
    return {};
  }
}

// === 连线关系查询辅助 ===

/**
 * P2 dogfood 优化：构建边索引，按 source/target 分组，加速 getIncomingEdges/getOutgoingEdges。
 * 原实现每次调用都线性扫描 graph.edges（O(E)），大型图中配方编译和事件 BFS 频繁调用
 * 导致编译慢。构建索引后降为 O(1) 查找 + O(k) 遍历（k 为实际连入/连出边数）。
 */
function buildEdgeIndex(graph: NodeGraph): {
  outgoing: Map<string, ModEdge[]>;
  incoming: Map<string, ModEdge[]>;
} {
  const outgoing = new Map<string, ModEdge[]>();
  const incoming = new Map<string, ModEdge[]>();
  for (const edge of graph.edges) {
    if (edge.disabled) continue;
    let outList = outgoing.get(edge.source);
    if (!outList) {
      outList = [];
      outgoing.set(edge.source, outList);
    }
    outList.push(edge);
    let inList = incoming.get(edge.target);
    if (!inList) {
      inList = [];
      incoming.set(edge.target, inList);
    }
    inList.push(edge);
  }
  return { outgoing, incoming };
}

/** 缓存边索引（与 connectionRules 的 getNodeMap 同理，引用不变时复用） */
let cachedEdgeGraphRef: NodeGraph | null = null;
let cachedEdgeIndex: ReturnType<typeof buildEdgeIndex> | null = null;

function getEdgeIndex(graph: NodeGraph): ReturnType<typeof buildEdgeIndex> {
  if (cachedEdgeGraphRef === graph && cachedEdgeIndex) return cachedEdgeIndex;
  cachedEdgeGraphRef = graph;
  cachedEdgeIndex = buildEdgeIndex(graph);
  return cachedEdgeIndex;
}

/** 获取节点的所有输入连线 */
export function getIncomingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return getEdgeIndex(graph).incoming.get(nodeId) ?? [];
}

/** 获取节点的所有输出连线 */
export function getOutgoingEdges(graph: NodeGraph, nodeId: string): ModEdge[] {
  return getEdgeIndex(graph).outgoing.get(nodeId) ?? [];
}

/** 获取节点某端口的输出连线 */
export function getEdgesFromPort(graph: NodeGraph, nodeId: string, portId: string): ModEdge[] {
  return (getEdgeIndex(graph).outgoing.get(nodeId) ?? []).filter((e) => e.sourceHandle === portId);
}

/** 获取节点某端口的输入连线 */
export function getEdgesToPort(graph: NodeGraph, nodeId: string, portId: string): ModEdge[] {
  return (getEdgeIndex(graph).incoming.get(nodeId) ?? []).filter((e) => e.targetHandle === portId);
}

/** 根据连线找到源节点（优先从 nodeMap 查找，回退到线性扫描） */
export function findSourceNode(
  graph: NodeGraph,
  edge: ModEdge,
  nodeMap?: Map<string, ModNode>,
): ModNode | null {
  if (nodeMap) return nodeMap.get(edge.source) ?? null;
  return graph.nodes.find((n) => n.id === edge.source) ?? null;
}

/** 根据连线找到目标节点（优先从 nodeMap 查找，回退到线性扫描） */
export function findTargetNode(
  graph: NodeGraph,
  edge: ModEdge,
  nodeMap?: Map<string, ModNode>,
): ModNode | null {
  if (nodeMap) return nodeMap.get(edge.target) ?? null;
  return graph.nodes.find((n) => n.id === edge.target) ?? null;
}

// === 阶段 C 辅助函数 ===

/**
 * P2-5：遍历所有可编译的 loop 节点，汇总各 body 子图的 condition/procedure 编译结果。
 */
function compileLoopSubgraphSpecsAll(
  nodes: ModNode[],
  graph: NodeGraph,
  warnings?: string[],
): { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } {
  const result: { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } = {
    conditions: [],
    procedures: [],
  };
  for (const node of nodes) {
    if (node.data.kind !== 'loop') continue;
    if (!node.data.bodySubgraphId) continue;
    const sub = compileLoopSubgraphSpecs(graph, node.data.bodySubgraphId, warnings);
    result.conditions.push(...sub.conditions);
    result.procedures.push(...sub.procedures);
  }
  return result;
}

/**
 * 编译循环节点的循环体：从 bodySubgraphId 引用的子图中提取代码节点/动作节点的代码，
 * 拼接为循环体代码字符串。无 bodySubgraphId 或子图未找到时返回空注释。
 *
 * P2-5：condition 节点编译为 `if (check_<id>(ctx)) { ... }`（条件方法由
 * compileLoopSubgraphSpecs 收集进 spec.conditions，adapter 生成 check_ 方法）；
 * procedure 节点编译为 `procedure_<name>(ctx);` 调用（同样由子图收集进 spec.procedures）。
 */
function compileLoopBody(graph: NodeGraph, bodySubgraphId?: string, warnings?: string[]): string {
  if (!bodySubgraphId) return '// no body';
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return '// body subgraph not found';
  const lines: string[] = [];
  for (const node of sg.nodes) {
    // 跳过禁用节点，与主编译流程一致
    if (node.data.disabled) continue;
    if (node.data.kind === 'code') {
      // 与主编译流程一致：codeLocked 节点使用用户手改的 lockedCode
      lines.push(
        node.data.codeLocked && node.data.lockedCode ? node.data.lockedCode : node.data.code,
      );
    } else if (node.data.kind === 'action') {
      lines.push(`execute_${node.id}(ctx);`);
    } else if (node.data.kind === 'condition') {
      // P2-5：循环体中的条件节点编译为 if (check_<id>(ctx)) 块，内嵌其 control 下游逻辑
      const downstream = sg.edges
        .filter((e) => e.source === node.id && e.kind === 'control' && !e.disabled)
        .map((e) => sg.nodes.find((n) => n.id === e.target))
        .filter((n): n is ModNode => !!n && !n.data.disabled);
      const innerLines: string[] = [];
      for (const dn of downstream) {
        if (dn.data.kind === 'code') {
          innerLines.push(
            dn.data.codeLocked && dn.data.lockedCode ? dn.data.lockedCode : dn.data.code,
          );
        } else if (dn.data.kind === 'action') {
          innerLines.push(`execute_${dn.id}(ctx);`);
        } else if (dn.data.kind === 'procedure') {
          innerLines.push(`procedure_${dn.data.procedureName}(ctx);`);
        }
      }
      const inner =
        innerLines.length > 0
          ? innerLines.map((l) => `            ${l}`).join('\n')
          : '            // (无循环体逻辑)';
      lines.push(`if (check_${node.id}(ctx)) {\n${inner}\n        }`);
    } else if (node.data.kind === 'procedure') {
      // P2-5：循环体中的过程调用编译为 procedure_<name>(ctx);
      lines.push(`procedure_${node.data.procedureName}(ctx);`);
    }
  }
  return lines.length > 0 ? lines.join('\n  ') : '// empty body';
}

/**
 * P2-5：收集循环节点 body 子图中的 condition / procedure 节点，编译为 spec 字段，
 * 供 adapter 生成 check_<id> 方法与 procedure_<name> 方法（循环体代码引用它们）。
 * procedure 的体内逻辑基于子图自身的 nodes/edges 做 BFS（复用 compileProcedureNode）。
 */
function compileLoopSubgraphSpecs(
  graph: NodeGraph,
  bodySubgraphId: string,
  warnings?: string[],
): { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } {
  const result: { conditions: ConditionSpec[]; procedures: ProcedureSpec[] } = {
    conditions: [],
    procedures: [],
  };
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return result;
  for (const node of sg.nodes) {
    if (node.data.disabled) continue;
    if (node.data.kind === 'condition') {
      try {
        result.conditions.push(compileConditionNode(node, warnings));
      } catch {
        warnings?.push(`循环体中的条件节点 ${node.id} 编译失败`);
      }
    } else if (node.data.kind === 'procedure') {
      try {
        const sgGraph: NodeGraph = {
          modId: graph.modId,
          version: 1,
          viewport: { x: 0, y: 0, zoom: 1 },
          nodes: sg.nodes,
          edges: sg.edges,
          subgraphs: {},
        };
        result.procedures.push(compileProcedureNode(sgGraph, node));
      } catch {
        warnings?.push(`循环体中的过程节点 ${node.id} 编译失败`);
      }
    }
  }
  return result;
}

/**
 * 收集所有引用的外部 mod 命名空间（排除 'minecraft' 和当前 modId）。
 * P2-3 dogfood 修复：扫描范围扩展至 entities/machines/multiblocks 的 id 字段。
 */
function collectExternalNamespaces(
  items: ItemSpec[],
  blocks: BlockSpec[],
  recipes: ModRecipeSpec[],
  entities: EntitySpec[],
  machines: MachineSpec[],
  multiblocks: MultiBlockSpec[],
  customCode: CustomCodeSnippetSpec[],
  currentModId: string,
): Set<string> {
  const namespaces = new Set<string>();
  const extractNs = (id: string | undefined) => {
    if (!id || typeof id !== 'string') return;
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
  // P2-3 dogfood 修复：扫描 entities/machines/multiblocks 的 id（可能引用外部 mod）
  for (const entity of entities) extractNs(entity.entityId);
  for (const machine of machines) extractNs(machine.machineId);
  for (const mb of multiblocks) extractNs(mb.structureId);
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

/**
 * 净化 modId 为合法的 Java 包名/资源命名空间（问题 13）。
 *
 * 规则：转小写 → 非 [a-z0-9_] 字符替换为下划线 → 折叠连续下划线 → 去除首尾下划线。
 * 空字符串或净化后为空时返回空字符串（由调用方决定回退值）。
 */
function sanitizeModId(modId: string): string {
  return modId
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * 按 snippetId 去重 customCode 数组（问题 24）。
 *
 * 保留首次出现的 snippet，后续重复项被丢弃并产生 warning。
 * 子图内联展开后可能引入重复 snippetId，去重避免生成重复的 Java 方法/字段声明。
 */
function deduplicateCustomCode(
  snippets: CustomCodeSnippetSpec[],
  warnings: string[],
): CustomCodeSnippetSpec[] {
  const seen = new Set<string>();
  const result: CustomCodeSnippetSpec[] = [];
  for (const snippet of snippets) {
    if (seen.has(snippet.snippetId)) {
      warnings.push(
        `customCode snippet「${snippet.snippetId}」重复，已去重保留首次出现的片段（duplicate snippetId）`,
      );
      continue;
    }
    seen.add(snippet.snippetId);
    result.push(snippet);
  }
  return result;
}

// === P1-2: 内置节点编译器注册（对标 MCreator ModElementGenerator registry）===
//
// 每种 NodeKind 注册一个 compiler，把 per-kind 编译函数适配为统一的 CompilerOutput 契约。
// 主编译器 compileNodeGraph 通过 compileAll 查表分发，新增内置类型只需在此追加 registerCompiler。
//
// 注册在模块加载时执行（顶层副作用）。编译函数保持私有，仅通过 registry 暴露。
// 注意：comment 节点不注册（compileAll 静默跳过，保持「仅文档用途」语义）。

registerCompiler({
  kind: 'item',
  compile: (node) => ({ items: [compileItemNode(node)] }),
});

registerCompiler({
  kind: 'block',
  compile: (node) => ({ blocks: [compileBlockNode(node)] }),
});

registerCompiler({
  kind: 'recipe',
  // 配方编译需要查连线（输入/输出物品），通过 ctx.graph 访问内联展开后的图
  // P2 dogfood 优化：传入 ctx.nodeMap 加速节点查找
  compile: (node, ctx) => ({ recipes: [compileRecipeNode(ctx.graph, node, ctx.nodeMap)] }),
});

registerCompiler({
  kind: 'entity',
  compile: (node) => ({ entities: [compileEntityNode(node)] }),
});

registerCompiler({
  kind: 'machine',
  compile: (node) => ({ machines: [compileMachineNode(node)] }),
});

registerCompiler({
  kind: 'code',
  // CodeNode 代码原样收集到 customCode（保留端口签名，由 mod-generator 决定嵌入位置）
  // P2-4 dogfood：解析端口签名 JSON 失败时通过 warnings 报告
  compile: (node) => {
    const warnings: string[] = [];
    const spec = compileCodeNode(node, warnings);
    const output: CompilerOutput = { customCode: [spec] };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  },
});

registerCompiler({
  kind: 'variable',
  // variable → Java 字段声明，push 到 customCode
  compile: (node) => {
    if (node.data.kind !== 'variable') return {};
    const { snippet } = compileVariable(node.data);
    return { customCode: [snippet] };
  },
});

registerCompiler({
  kind: 'loop',
  // loop → Java 循环代码，bodyCode 从 bodySubgraphId 子图编译（通过 ctx.compileLoopBody 递归）
  compile: (node, ctx) => {
    if (node.data.kind !== 'loop') return {};
    const bodyCode = ctx.compileLoopBody(node.data.bodySubgraphId);
    const { snippet } = compileLoop(node.data, bodyCode);
    return { customCode: [snippet] };
  },
});

registerCompiler({
  kind: 'multiblock',
  compile: (node) => ({ multiblocks: [compileMultiblockNode(node)] }),
});

registerCompiler({
  kind: 'event',
  // 事件编译需要沿 control 边 BFS 收集可达 condition/action，通过 ctx.graph 访问
  // P2-4 dogfood：解析 eventArgs JSON 失败时通过 warnings 报告
  // P2 dogfood 优化：传入 ctx.nodeMap 加速 BFS 中的节点查找
  compile: (node, ctx) => {
    const warnings: string[] = [];
    const spec = compileEventNode(ctx.graph, node, warnings, ctx.nodeMap);
    const output: CompilerOutput = { eventHandlers: [spec] };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  },
});

registerCompiler({
  kind: 'condition',
  // P2-4 dogfood：解析 conditionArgs JSON 失败时通过 warnings 报告
  compile: (node) => {
    const warnings: string[] = [];
    const spec = compileConditionNode(node, warnings);
    const output: CompilerOutput = { conditions: [spec] };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  },
});

registerCompiler({
  kind: 'action',
  // P2-4 dogfood：解析 actionArgs JSON 失败时通过 warnings 报告
  compile: (node) => {
    const warnings: string[] = [];
    const spec = compileActionNode(node, warnings);
    const output: CompilerOutput = { actions: [spec] };
    if (warnings.length > 0) output.warnings = warnings;
    return output;
  },
});

registerCompiler({
  kind: 'procedure',
  // P1-3：过程编译需要沿 control 边 BFS 收集过程体，通过 ctx.graph 访问
  // P2 dogfood 优化：传入 ctx.nodeMap 加速 BFS 中的节点查找
  compile: (node, ctx) => ({ procedures: [compileProcedureNode(ctx.graph, node, ctx.nodeMap)] }),
});

registerCompiler({
  kind: 'subgraph',
  // 自定义节点（customTypeId 非空）用 compileCustomNode 渲染 codeTemplate。
  // customTypeId 为 null 的 subgraph 节点已在 inlineSubgraphNodes 阶段内联展开，
  // 此处兜底：customTypeId 为 null 时返回空产出（不报错，保持原「静默跳过」语义）。
  // compileCustomNode 失败时返回 { error }（不抛异常），转成 output.errors 保留原始消息。
  compile: (node) => {
    if (node.data.kind !== 'subgraph') return {};
    if (!node.data.customTypeId) return {};
    const result = compileCustomNode(node.data, node.data.customFields);
    if (result.error) {
      return { errors: [`自定义节点 ${node.id} 编译失败：${result.error}`] };
    }
    if (result.snippet) {
      return { customCode: [result.snippet] };
    }
    return {};
  },
});

// comment 节点不注册 compiler：compileAll 遇到未注册 kind 静默跳过，
// 保持「仅文档用途，不产生 spec/warning/error」语义。
