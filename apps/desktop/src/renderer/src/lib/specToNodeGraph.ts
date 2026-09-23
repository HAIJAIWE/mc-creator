import type { NodeGraph, ModNode, ModEdge, NodeData } from '@mc-creator/shared';
import type { ModSpec, BlockSpec } from '@mc-creator/shared';
import { createDefaultNodeData } from '../store/node-graph-store.js';
import { getPorts } from '../components/lowcode/nodes/portSchemas.js';

/**
 * A 桥：ModSpec → NodeGraph
 *
 * 把 AI/表单生成的 ModSpec 渲染到低代码画布，让用户在节点图上审阅/精改。
 * 这是「单一真相源」设计里 spec → 图 的方向；反向（图 → spec）已有 compileNodeGraph。
 *
 * 第一版覆盖:items / blocks / entities / machines / recipes（含 recipe 的 craft 连边）。
 * 其余类型（fluids/biomes/dimensions/guis/multiblocks/event/condition/action/procedure/code）
 * 不渲染，命中时记入 warnings（数据仍在 spec 中，画布仅不展示）。
 *
 * 设计要点（与 compileNodeGraph 的 recipe 编译配套）：
 * - recipe 节点的输入/输出【只从 craft 边收集】（见 compileNodeGraph.ts compileRecipeNode），
 *   所以 A 桥必须为每个材料/产物造出 item 节点并连线，否则回编时配方会缺材料/无产物。
 * - 材料/产物若引用 vanilla 物品（不在 spec.items 中），生成"引用型" item 节点：
 *   data.itemId 保留原始字符串（含 'minecraft:' 前缀）——运行时安全，spec→图→spec 往返无损。
 */

export interface SpecToNodeGraphResult {
  graph: NodeGraph;
  warnings: string[];
}

/** ItemNodeData.category 合法值（与 ItemSpec.itemCategory 有差异，见 normalizeItemCategory） */
const ITEM_NODE_CATEGORIES = new Set([
  'sword',
  'pickaxe',
  'axe',
  'shovel',
  'hoe',
  'helmet',
  'chestplate',
  'leggings',
  'boots',
  'food',
  'potion',
  'bow',
  'crossbow',
  'shield',
  'fishing_rod',
  'shears',
  'flint_and_steel',
  'material',
  'misc',
]);

/** BlockSpec.blockType → BlockNodeData.modelType（行为型统一归为 custom 模型） */
function mapBlockModel(blockType: BlockSpec['blockType']): string {
  return blockType === 'full_block' ? 'cube_all' : 'custom';
}

/**
 * 构造一个节点：以 createDefaultNodeData 的默认字段为基底，覆写 fields。
 * 画布标题取 displayName / 对应 id 字段 / fallbackLabel。nodeId 必须由 fields 提供。
 */
function makeNode(
  kind: NodeData['kind'],
  fields: Partial<NodeData>,
  position: { x: number; y: number },
  fallbackLabel?: string,
): ModNode {
  const data = { ...createDefaultNodeData(kind, ''), ...fields } as NodeData;
  const nodeId = (data as { nodeId?: string }).nodeId ?? '';
  // label 未显式给时，用各 kind 的显示名/id 字段兜底
  const label =
    (data as { label?: string }).label ||
    (data as { displayName?: string }).displayName ||
    (data as { itemId?: string }).itemId ||
    (data as { blockId?: string }).blockId ||
    (data as { entityId?: string }).entityId ||
    (data as { machineId?: string }).machineId ||
    fallbackLabel ||
    kind;
  const finalData = { ...data, label, nodeId };
  return {
    id: nodeId,
    type: kind,
    position,
    data: finalData,
    ports: getPorts(finalData),
    selected: false,
  };
}

export function specToNodeGraph(spec: ModSpec): SpecToNodeGraphResult {
  const warnings: string[] = [];
  const nodes: ModNode[] = [];
  const edges: ModEdge[] = [];
  const itemNodeByItemId = new Map<string, string>(); // spec 物品 id -> nodeId
  const refNodeByItemId = new Map<string, string>(); // vanilla 原物品 id -> nodeId（同 id 只建一次）
  let refCounter = 0;
  let edgeCounter = 0;

  // === 物品（打印机：spec.items → item 节点） ===
  spec.items.forEach((it, i) => {
    const category = ITEM_NODE_CATEGORIES.has(it.itemCategory) ? it.itemCategory : 'misc';
    const nodeId = `item_${i}`;
    nodes.push(
      makeNode(
        'item',
        {
          nodeId,
          itemId: it.id,
          displayName: it.name,
          category,
          maxStackSize: it.maxStackSize,
          maxDamage: it.maxDamage,
          rarity: it.rarity,
          glow: false,
          ...(it.texturePath ? { texturePath: it.texturePath } : {}),
        } as Partial<NodeData>,
        { x: 40, y: i * 170 + 40 },
      ),
    );
    itemNodeByItemId.set(it.id, nodeId);
  });

  // === 方块 ===
  spec.blocks.forEach((b, i) => {
    const nodeId = `block_${i}`;
    nodes.push(
      makeNode(
        'block',
        {
          nodeId,
          blockId: b.id,
          displayName: b.name,
          hardness: b.hardness,
          blastResistance: b.resistance,
          luminance: b.lightLevel,
          transparent: b.transparent,
          solid: !b.noCollision,
          modelType: mapBlockModel(b.blockType),
          isBlockEntity: b.blockType !== 'full_block',
          ...(b.texturePaths?.top
            ? { texturePathTop: b.texturePaths.top }
            : b.texturePath
              ? { texturePathTop: b.texturePath }
              : {}),
        } as Partial<NodeData>,
        { x: 320, y: i * 170 + 40 },
      ),
    );
  });

  // === 实体 ===
  spec.entities.forEach((e, i) => {
    const nodeId = `entity_${i}`;
    nodes.push(
      makeNode(
        'entity',
        {
          nodeId,
          entityId: e.entityId,
          displayName: e.displayName,
          maxHealth: e.maxHealth,
          attackDamage: e.attackDamage,
          movementSpeed: e.movementSpeed,
          classification: e.classification,
          modelType: e.modelType,
          spawnWeight: e.spawnWeight,
          spawnBiomes: e.spawnBiomes,
          ...(e.texturePath ? { texturePath: e.texturePath } : {}),
        } as Partial<NodeData>,
        { x: 600, y: i * 170 + 40 },
      ),
    );
  });

  // === 机器 ===
  spec.machines.forEach((m, i) => {
    const nodeId = `machine_${i}`;
    nodes.push(
      makeNode(
        'machine',
        {
          nodeId,
          machineId: m.machineId,
          displayName: m.displayName,
          energyCapacity: m.energyCapacity,
          maxEnergyTransfer: m.maxEnergyTransfer,
          inputSlots: m.inputSlots,
          outputSlots: m.outputSlots,
          defaultProcessTime: m.defaultProcessTime,
          defaultEnergyPerTick: m.defaultEnergyPerTick,
          guiWidth: m.guiWidth,
          guiHeight: m.guiHeight,
          recipeMapJson: JSON.stringify(m.recipeMap ?? {}),
        } as Partial<NodeData>,
        { x: 880, y: i * 170 + 40 },
      ),
    );
  });

  // === 配方 + craft 连边（recipe 单独一列区） ===
  const resolveItemNode = (itemId: string): string => {
    const custom = itemNodeByItemId.get(itemId);
    if (custom) return custom;
    const existing = refNodeByItemId.get(itemId);
    if (existing) return existing;
    const nodeId = `item_v_${refCounter++}`;
    refNodeByItemId.set(itemId, nodeId);
    nodes.push(
      makeNode(
        'item',
        { nodeId, itemId, displayName: itemId },
        { x: 1140 + (refCounter % 2) * 280, y: Math.floor(refCounter / 2) * 170 + 40 },
      ),
    );
    return nodeId;
  };

  spec.recipes.forEach((r, i) => {
    const nodeId = `recipe_${i}`;
    nodes.push(
      makeNode(
        'recipe',
        {
          nodeId,
          recipeId: r.recipeId,
          recipeType: r.recipeType,
          outputCount: r.outputCount,
          cookTime: r.cookTime,
          experience: r.experience,
          pattern: r.pattern,
          ...(r.recipeType === 'smithing_transform'
            ? { template: r.template, base: r.base, addition: r.addition }
            : {}),
          ...(r.recipeType === 'brewing'
            ? {
                inputPotion: r.inputPotion,
                ingredientItem: r.ingredientItem,
                outputPotion: r.outputPotion,
              }
            : {}),
        } as Partial<NodeData>,
        { x: 1680, y: i * 170 + 40 },
      ),
    );

    // 材料连边：item.out → recipe.in（recipe.in 为 multiple，可多条）
    for (const input of r.inputs) {
      if (!input.item) continue;
      const src = resolveItemNode(input.item);
      edges.push({
        id: `edge_${edgeCounter++}`,
        source: src,
        sourceHandle: 'out',
        target: nodeId,
        targetHandle: 'in',
        kind: 'craft',
        disabled: false,
      });
      if (!itemNodeByItemId.has(input.item)) {
        warnings.push(
          `配方 ${r.recipeId} 的材料 ${input.item} 不在自定义物品中，已放入画布作引用节点`,
        );
      }
    }

    // 产物连边：recipe.out → item（compileRecipeNode 取第一个连出的 item 节点作为产物）
    if (!r.output) {
      warnings.push(`配方 ${r.recipeId} 缺少输出物品，画布无法表达该配方`);
    } else {
      const tgt = resolveItemNode(r.output);
      edges.push({
        id: `edge_${edgeCounter++}`,
        source: nodeId,
        sourceHandle: 'out',
        target: tgt,
        targetHandle: 'out',
        kind: 'craft',
        disabled: false,
      });
      if (!itemNodeByItemId.has(r.output)) {
        warnings.push(
          `配方 ${r.recipeId} 的产物 ${r.output} 不在自定义物品中，已放入画布作引用节点`,
        );
      }
    }
  });

  // === 逻辑节点（procedure/condition/action/event）+ control 连边 ===
  // spec 中 conditionId/actionId/procedureId/handlerId 即原节点 id，直接用作新节点 nodeId，
  // 保证编译回 spec 后 BFS 引用的 id 集合一致（compileEventNode / compileProcedureNode 按节点 id 收集）。
  const logicNodeById = new Map<string, ModNode>();

  spec.procedures.forEach((p, i) => {
    const node = makeNode(
      'procedure',
      {
        nodeId: p.procedureId,
        procedureName: p.procedureName,
        displayName: p.displayName || p.procedureName,
        inputs: p.inputs ?? [],
      } as Partial<NodeData>,
      { x: 1960, y: i * 170 + 40 },
    );
    nodes.push(node);
    logicNodeById.set(node.id, node);
  });

  spec.conditions.forEach((c, i) => {
    const node = makeNode(
      'condition',
      {
        nodeId: c.conditionId,
        conditionType: c.conditionType,
        conditionArgs: JSON.stringify(c.args ?? {}),
        invert: c.invert,
        ...(c.customCode ? { customCode: c.customCode } : {}),
      } as Partial<NodeData>,
      { x: 2240, y: i * 170 + 40 },
    );
    nodes.push(node);
    logicNodeById.set(node.id, node);
  });

  spec.actions.forEach((a, i) => {
    const node = makeNode(
      'action',
      {
        nodeId: a.actionId,
        actionType: a.actionType,
        actionArgs: JSON.stringify(a.args ?? {}),
        ...(a.customCode ? { customCode: a.customCode } : {}),
      } as Partial<NodeData>,
      { x: 2520, y: i * 170 + 40 },
    );
    nodes.push(node);
    logicNodeById.set(node.id, node);
  });

  // control 边（event/procedure → 其引用的 condition/action/procedure）
  const addControlEdges = (sourceId: string, ids: string[], label: string) => {
    for (const id of ids) {
      if (!logicNodeById.has(id)) {
        warnings.push(`${label}引用的节点 ${id} 不在本 spec 中，已跳过控制流连线`);
        continue;
      }
      edges.push({
        id: `edge_${edgeCounter++}`,
        source: sourceId,
        target: id,
        kind: 'control',
        disabled: false,
      });
    }
  };

  spec.eventHandlers.forEach((h, i) => {
    const node = makeNode(
      'event',
      {
        nodeId: h.handlerId,
        eventType: h.eventType,
        eventArgs: JSON.stringify(h.eventArgs ?? {}),
      } as Partial<NodeData>,
      { x: 2800, y: i * 170 + 40 },
    );
    nodes.push(node);
    addControlEdges(
      h.handlerId,
      [...h.conditionIds, ...h.actionIds, ...h.procedureCallIds],
      `事件 ${h.handlerId}`,
    );
  });

  spec.procedures.forEach((p) => {
    addControlEdges(
      p.procedureId,
      [...p.conditionIds, ...p.actionIds, ...p.procedureCallIds],
      `过程 ${p.procedureId}`,
    );
    if (p.procedureCallArgs && Object.keys(p.procedureCallArgs).length > 0) {
      warnings.push(`过程 ${p.procedureId} 的调用参数绑定暂未还原到画布（表单/AI 中仍保留）`);
    }
  });

  // === 世界生成 / GUI / 自定义代码节点（直接字段映射） ===
  spec.fluids.forEach((f, i) => {
    nodes.push(
      makeNode(
        'fluid',
        {
          nodeId: `fluid_${i}`,
          fluidId: f.fluidId,
          displayName: f.displayName,
          color: f.color,
          temperature: f.temperature,
          viscosity: f.viscosity,
          density: f.density,
          luminous: f.luminous,
        } as Partial<NodeData>,
        { x: 3080, y: i * 170 + 40 },
      ),
    );
  });

  spec.biomes.forEach((b, i) => {
    const node = makeNode(
      'biome',
      {
        nodeId: `biome_${i}`,
        biomeId: b.biomeId,
        displayName: b.displayName,
        precipitation: b.precipitation,
        temperature: b.temperature,
        temperatureModifier: b.temperatureModifier,
        downfall: b.downfall,
        skyColor: b.skyColor,
        waterColor: b.waterColor,
        waterFogColor: b.waterFogColor,
        fogColor: b.fogColor,
        surfaceBuilder: b.surfaceBuilder,
        spawnWeight: b.spawnWeight,
        spawnDimensions: b.spawnDimensions,
      } as Partial<NodeData>,
      { x: 3360, y: i * 170 + 40 },
    );
    nodes.push(node);
    if (b.grassColor != null || b.foliageColor != null || b.texturePath) {
      warnings.push(`生物群系 ${b.biomeId} 的草/树叶颜色与贴图暂未还原到画布`);
    }
  });

  spec.dimensions.forEach((d, i) => {
    nodes.push(
      makeNode(
        'dimension',
        {
          nodeId: `dimension_${i}`,
          dimensionId: d.dimensionId,
          displayName: d.displayName,
          baseType: d.baseType,
          fixedTime: d.fixedTime,
          hasSkyLight: d.hasSkyLight,
          hasCeiling: d.hasCeiling,
          ultrawarm: d.ultrawarm,
          natural: d.natural,
          minY: d.minY,
          height: d.height,
          effects: d.effects,
        } as Partial<NodeData>,
        { x: 3640, y: i * 170 + 40 },
      ),
    );
  });

  spec.guis.forEach((g, i) => {
    nodes.push(
      makeNode(
        'gui',
        {
          nodeId: `gui_${i}`,
          guiId: g.guiId,
          displayName: g.displayName,
          width: g.width,
          height: g.height,
          slotsJson: JSON.stringify(g.slots ?? []),
          showEnergyBar: g.showEnergyBar,
          showProgressBar: g.showProgressBar,
        } as Partial<NodeData>,
        { x: 3920, y: i * 170 + 40 },
      ),
    );
  });

  spec.multiblocks.forEach((m, i) => {
    nodes.push(
      makeNode(
        'multiblock',
        {
          nodeId: `multiblock_${i}`,
          structureId: m.structureId,
          displayName: m.displayName,
          width: m.width,
          height: m.height,
          depth: m.depth,
          hollow: m.hollow,
          controllerOffset: m.controllerOffset,
        } as Partial<NodeData>,
        { x: 4200, y: i * 170 + 40 },
      ),
    );
  });

  // 自定义代码片段 → code 节点（snippetId 即原节点 id，保证 compileCodeNode 往返稳定）
  spec.customCode.forEach((c, i) => {
    const node = makeNode(
      'code',
      {
        nodeId: c.snippetId,
        language: c.language,
        code: c.code,
        inputSignature: JSON.stringify(c.inputSignature ?? {}),
        outputSignature: JSON.stringify(c.outputSignature ?? {}),
        methodName: c.methodName,
      } as Partial<NodeData>,
      { x: 4480, y: i * 170 + 40 },
    );
    nodes.push(node);
  });

  const graph: NodeGraph = {
    version: 1,
    modId: spec.modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
    subgraphs: {},
  };

  return { graph, warnings };
}
