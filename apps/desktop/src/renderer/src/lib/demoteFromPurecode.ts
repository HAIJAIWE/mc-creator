import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeData,
  NodeKind,
  NodePort,
  FileNode,
} from '@mc-creator/shared';

/**
 * L3 → L2 反向降级路径：从 PurecodeWorkspace 中的 Java/JSON 文件反向提取信息，
 * 生成对应的节点图（NodeGraph）。
 *
 * 设计参考：
 * - `apps/desktop/src/renderer/src/lib/promoteToPurecode.ts` 的正向提升逻辑（反向参考）
 * - `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts` 的节点 → ModSpec 编译器
 * - `packages/shared/src/schemas/node-graph-spec.ts` 的节点图 schema
 *
 * 解析策略（不要求完整 AST，目标覆盖 80% 常见模式）：
 * - Java 文件用正则 + 字符串匹配识别注册模式
 * - JSON 文件用 JSON.parse 后按字段提取
 * - 无法识别的 Java 文件作为 CodeNode 保留（用户手动处理）
 *
 * 集成说明：
 *   本模块仅负责生成 DemoteResult，不直接修改 node-graph-store。
 *   调用方（PurecodeWorkspace 的 DemoteButton）负责把结果交给
 *   useNodeGraphStore.getState().loadGraph + setMode('lowcode')。
 */

// === 对外类型 ===

export interface DemoteResult {
  /** 反向生成的节点图 */
  graph: NodeGraph;
  /** 警告信息（无法识别的代码、降级过程中的妥协） */
  warnings: string[];
  /** 提取到的元素统计 */
  stats: {
    items: number;
    blocks: number;
    entities: number;
    recipes: number;
    events: number;
    codeNodes: number; // 无法识别的代码片段，保留为 CodeNode
  };
}

// === 常量 ===

/** 默认 modId（与 compileNodeGraph 一致） */
const DEFAULT_MOD_ID = 'unnamed_mod';

/** 各类节点的 Y 轴基线（按 kind 分行排列，避免节点重叠） */
const Y_BY_KIND: Record<string, number> = {
  item: 100,
  block: 300,
  entity: 500,
  recipe: 700,
  event: 900,
  code: 1100,
};

/** 节点 X 轴起点与间距 */
const X_START = 200;
const X_STEP = 250;

// === 默认节点数据构造 ===
// 与 nodeGraphSerializer.test.ts 中 createDefaultNodeData 的逻辑保持一致，
// 确保降级生成的节点能通过 validateGraph 校验。

function createDefaultNodeData(kind: NodeKind, id: string): NodeData {
  const base = { nodeId: id, label: id, note: '', disabled: false, collapsed: false };
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
    default: {
      // 类型安全：穷尽性检查
      const _exhaustive: never = kind;
      throw new Error(`未支持的节点类型: ${String(_exhaustive)}`);
    }
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
    default:
      return [];
  }
}

/** 构造一个完整节点（自动填默认字段 + 端口，位置由布局算法统一设置） */
function makeNode(id: string, kind: NodeKind, overrides: Record<string, unknown> = {}): ModNode {
  const baseData = createDefaultNodeData(kind, id);
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

// === 内部上下文 ===

interface DemoteContext {
  /** 当前 modId（已解析） */
  modId: string;
  /** lang 文件中 id → displayName 映射（用于回填节点 label） */
  langMap: Map<string, string>;
  /** 累积警告 */
  warnings: string[];
  /** 已使用的节点 id（用于去重检测） */
  usedNodeIds: Set<string>;
  /** 已使用的物品/方块/实体 id（用于重复注册检测） */
  usedItemIds: Set<string>;
  usedBlockIds: Set<string>;
  usedEntityIds: Set<string>;
}

/** 生成一个唯一的节点 id（kind_prefix_index 风格） */
function genNodeId(ctx: DemoteContext, kind: NodeKind, suffix: string): string {
  let i = 0;
  let candidate = `${kind}_${suffix}`;
  // 如有冲突，加数字后缀
  while (ctx.usedNodeIds.has(candidate)) {
    i += 1;
    candidate = `${kind}_${suffix}_${i}`;
  }
  ctx.usedNodeIds.add(candidate);
  return candidate;
}

/** 把字符串规范化为合法的 itemId/blockId/entityId（小写下划线） */
function sanitizeId(raw: string): string {
  const lower = raw.toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9_]/g, '_');
  return cleaned || 'unknown';
}

/** 取路径最后一段作为文件名（不含扩展名） */
function basenameNoExt(path: string): string {
  const slash = path.lastIndexOf('/');
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

// === Java 文件解析 ===

/** 提取物品注册：register("xxx", new Item(...)) */
function parseItemsJava(content: string, ctx: DemoteContext): ModNode[] {
  const nodes: ModNode[] = [];
  // 模式 1：register("xxx", new Item(...))
  const itemRegex = /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*new\s+Item\b/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(content)) !== null) {
    const rawId = m[1];
    const itemId = sanitizeId(rawId);
    if (ctx.usedItemIds.has(itemId)) {
      ctx.warnings.push(`物品 ID 重复：${itemId}（仅保留首次注册）`);
      continue;
    }
    ctx.usedItemIds.add(itemId);

    // 尝试提取稀有度（向后扫描 80 字符内的 .rarity(Rarity.XXX)）
    const tail = content.slice(m.index, m.index + 400);
    const rarityMatch = /\.rarity\s*\(\s*Rarity\.(\w+)/.exec(tail);
    const rarity =
      rarityMatch && ['common', 'uncommon', 'rare', 'epic'].includes(rarityMatch[1].toLowerCase())
        ? (rarityMatch[1].toLowerCase() as 'common' | 'uncommon' | 'rare' | 'epic')
        : 'common';

    const displayName = ctx.langMap.get(`item.${ctx.modId}.${itemId}`) ?? itemId;
    const id = genNodeId(ctx, 'item', itemId);
    nodes.push(
      makeNode(id, 'item', {
        itemId,
        displayName,
        label: displayName,
        rarity,
        maxStackSize: 64,
        maxDamage: 0,
        category: 'misc',
        glow: false,
      }),
    );
  }
  return nodes;
}

/** 提取方块注册：register("xxx", new Block(...))，并尝试提取 hardness/luminance */
function parseBlocksJava(content: string, ctx: DemoteContext): ModNode[] {
  const nodes: ModNode[] = [];
  const blockRegex = /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*new\s+Block\b/g;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(content)) !== null) {
    const rawId = m[1];
    const blockId = sanitizeId(rawId);
    if (ctx.usedBlockIds.has(blockId)) {
      ctx.warnings.push(`方块 ID 重复：${blockId}（仅保留首次注册）`);
      continue;
    }
    ctx.usedBlockIds.add(blockId);

    // 向后扫描 600 字符，提取 hardness/luminance/resistance
    const tail = content.slice(m.index, m.index + 600);

    // strength(x, y) - 第一个是 hardness，第二个是 resistance
    let hardness = 1.0;
    let blastResistance = 3.0;
    const strengthMatch = /\.strength\s*\(\s*([\d.]+)f?\s*,\s*([\d.]+)f?\s*\)/.exec(tail);
    if (strengthMatch) {
      hardness = parseFloat(strengthMatch[1]);
      blastResistance = parseFloat(strengthMatch[2]);
    } else {
      const hardnessMatch = /\.hardness\s*\(\s*([\d.]+)f?\s*\)/.exec(tail);
      if (hardnessMatch) hardness = parseFloat(hardnessMatch[1]);
      const resistanceMatch = /\.resistance\s*\(\s*([\d.]+)f?\s*\)/.exec(tail);
      if (resistanceMatch) blastResistance = parseFloat(resistanceMatch[1]);
    }

    // luminance - 可能是 luminance(15) 或 luminance(state -> 15)
    let luminance = 0;
    const luminanceMatch = /\.luminance\s*\(\s*(?:state\s*->\s*)?([\d.]+)f?\s*\)/.exec(tail);
    if (luminanceMatch) {
      const val = parseInt(luminanceMatch[1], 10);
      if (val >= 0 && val <= 15) luminance = val;
    }

    // 透明 / 非固体：包含 .nonOpaque() 或 .noCollision()
    const transparent = /\.nonOpaque\s*\(\s*\)/.test(tail);
    const solid = !/\.noCollision\s*\(\s*\)/.test(tail);

    const displayName = ctx.langMap.get(`block.${ctx.modId}.${blockId}`) ?? blockId;
    const id = genNodeId(ctx, 'block', blockId);
    nodes.push(
      makeNode(id, 'block', {
        blockId,
        displayName,
        label: displayName,
        hardness,
        blastResistance,
        luminance,
        transparent,
        solid,
        modelType: 'cube_all',
        isBlockEntity: false,
      }),
    );
  }
  return nodes;
}

/** 提取实体注册：register("xxx", EntityType.Builder...) */
function parseEntitiesJava(content: string, ctx: DemoteContext): ModNode[] {
  const nodes: ModNode[] = [];
  // 模式：register("xxx", EntityType.Builder.create(...).dimensions(...).build())
  //      或 register("xxx", FabricEntityTypeBuilder.create(...).build())
  const entityRegex =
    /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*(?:EntityType|FabricEntityTypeBuilder)\b/g;
  let m: RegExpExecArray | null;
  while ((m = entityRegex.exec(content)) !== null) {
    const rawId = m[1];
    const entityId = sanitizeId(rawId);
    if (ctx.usedEntityIds.has(entityId)) {
      ctx.warnings.push(`实体 ID 重复：${entityId}（仅保留首次注册）`);
      continue;
    }
    ctx.usedEntityIds.add(entityId);

    // 从 createAttributes 方法中提取 maxHealth / movementSpeed / attackDamage
    let maxHealth = 20;
    let movementSpeed = 0.3;
    let attackDamage = 0;
    const healthMatch = /\.maxHealth\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (healthMatch) maxHealth = parseFloat(healthMatch[1]);
    const speedMatch = /\.movementSpeed\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (speedMatch) movementSpeed = parseFloat(speedMatch[1]);
    const damageMatch = /\.attackDamage\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (damageMatch) attackDamage = parseFloat(damageMatch[1]);

    // 分类：SpawnGroup.MONSTER/CREATURE/AMBIENT/WATER_CREATURE 等
    let classification: 'animal' | 'monster' | 'water_creature' | 'ambient' | 'misc' = 'misc';
    const spawnGroupMatch = /SpawnGroup\.(\w+)/.exec(content);
    if (spawnGroupMatch) {
      const group = spawnGroupMatch[1].toUpperCase();
      if (group === 'MONSTER') classification = 'monster';
      else if (group === 'CREATURE') classification = 'animal';
      else if (group === 'WATER_CREATURE' || group === 'UNDERWATER_CREATURE' || group === 'AQUATIC')
        classification = 'water_creature';
      else if (group === 'AMBIENT') classification = 'ambient';
      else classification = 'misc';
    }

    const displayName = ctx.langMap.get(`entity.${ctx.modId}.${entityId}`) ?? entityId;
    const id = genNodeId(ctx, 'entity', entityId);
    nodes.push(
      makeNode(id, 'entity', {
        entityId,
        displayName,
        label: displayName,
        maxHealth,
        movementSpeed,
        attackDamage,
        classification,
        modelType: 'pig',
        spawnWeight: 0,
        spawnBiomes: [],
      }),
    );
  }
  return nodes;
}

/** Fabric 事件 API → EventNodeData.eventType 映射 */
function mapEventType(apiPath: string): {
  eventType:
    | 'tick'
    | 'block_break'
    | 'block_place'
    | 'entity_death'
    | 'entity_hurt'
    | 'item_use'
    | 'player_join'
    | 'player_quit'
    | 'custom';
  label: string;
} {
  // 标准化：去掉空格，按点分割
  const parts = apiPath.replace(/\s+/g, '').split('.');
  // 取后两段作为关键判定（如 ServerTickEvents.END_SERVER_TICK）
  const last2 = parts.slice(-2).join('.');
  const last1 = parts[parts.length - 1] ?? '';

  // ServerTickEvents.START_SERVER_TICK / END_SERVER_TICK → tick
  if (/ServerTickEvents/i.test(apiPath)) return { eventType: 'tick', label: '服务端 Tick' };
  // PlayerBlockBreakEvents.AFTER / BEFORE → block_break
  if (/PlayerBlockBreakEvents/i.test(apiPath))
    return { eventType: 'block_break', label: '方块破坏' };
  // ServerBlockPlaceEvents 等 hypothetical → block_place
  if (/BlockPlaceEvents/i.test(apiPath)) return { eventType: 'block_place', label: '方块放置' };
  // ServerEntityEvents.ENTITY_UNLOAD / ENTITY_LOAD 等
  if (/EntityDeathEvents|ServerEntityEvents.*DEATH/i.test(apiPath))
    return { eventType: 'entity_death', label: '实体死亡' };
  if (/EntityHurtEvents|ServerEntityEvents.*HURT/i.test(apiPath))
    return { eventType: 'entity_hurt', label: '实体受伤' };
  // ServerPlayerEvents
  if (/ServerPlayerEvents/i.test(apiPath)) {
    if (/JOIN|CONNECT/i.test(last1)) return { eventType: 'player_join', label: '玩家加入' };
    if (/QUIT|DISCONNECT/i.test(last1)) return { eventType: 'player_quit', label: '玩家退出' };
  }
  // UseItemEvents / ItemUseCallback
  if (/UseItemEvents|ItemUseCallback/i.test(apiPath))
    return { eventType: 'item_use', label: '物品使用' };

  // 兜底
  void last2;
  return { eventType: 'custom', label: apiPath };
}

/** 提取事件注册：<EventApi>.register(...)，如 ServerTickEvents.END_SERVER_TICK.register */
function parseEventsJava(content: string, ctx: DemoteContext): ModNode[] {
  const nodes: ModNode[] = [];
  // 匹配 ServerTickEvents.END_SERVER_TICK.register( 这类调用
  // 第一个分组捕获完整的 API 路径（不含 .register）
  const eventRegex = /\b([A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+)\.register\s*\(/g;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = eventRegex.exec(content)) !== null) {
    const apiPath = m[1];
    // 排除 ItemType.register / BlockType.register 等非事件 API
    // 事件 API 通常以 Events 结尾或包含 Events.
    if (!/Event/i.test(apiPath)) continue;
    const { eventType, label } = mapEventType(apiPath);
    const id = genNodeId(ctx, 'event', `${idx}`);
    idx += 1;
    nodes.push(
      makeNode(id, 'event', {
        eventType,
        eventArgs: JSON.stringify({ api: apiPath }),
        label: `${label} #${idx}`,
      }),
    );
  }
  return nodes;
}

/** 提取首个 public 方法名（用于 CodeNode.methodName），找不到时回退到 'process' */
function extractFirstPublicMethodName(content: string): string {
  // 匹配 public [static] [final] <ReturnType> <methodName>(
  // 排除 class/interface 关键字
  const methodRegex =
    /public\s+(?:static\s+)?(?:final\s+)?(?!class\b|interface\b|enum\b|record\b)(?:[\w<>\],?\s[]+?)\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(content)) !== null) {
    const name = m[1];
    // 过滤构造函数：方法名等于类名时跳过
    const classMatch = /\b(?:class|interface|enum|record)\s+(\w+)/.exec(content);
    if (classMatch && name === classMatch[1]) continue;
    // 过滤 Java 关键字
    if (['if', 'while', 'for', 'switch', 'return', 'new'].includes(name)) continue;
    return name;
  }
  return 'process';
}

/** 无法识别的 Java 文件 → 转为 CodeNode 保留 */
function parseCodeNodeFromJava(file: FileNode, ctx: DemoteContext): ModNode {
  const methodName = extractFirstPublicMethodName(file.content);
  const fileName = basenameNoExt(file.path);
  const id = genNodeId(ctx, 'code', fileName);
  return makeNode(id, 'code', {
    language: 'java',
    code: file.content,
    methodName,
    label: fileName,
    note: `未识别的 Java 文件：${file.path}`,
  });
}

/** 判断 Java 文件是否应作为 CodeNode 保留（未匹配到任何已知注册模式） */
function isUnrecognizedJava(content: string): boolean {
  // 复用各 parser 的判定逻辑：如果 4 个 parser 都返回空数组，视为未识别
  const itemRegex = /register\s*\(\s*"[a-zA-Z0-9_]+"\s*,\s*new\s+Item\b/;
  const blockRegex = /register\s*\(\s*"[a-zA-Z0-9_]+"\s*,\s*new\s+Block\b/;
  const entityRegex =
    /register\s*\(\s*"[a-zA-Z0-9_]+"\s*,\s*(?:EntityType|FabricEntityTypeBuilder)\b/;
  const eventRegex = /\b[A-Z][A-Za-z0-9_]*(?:\.[A-Z][A-Za-z0-9_]*)+\.register\s*\(/;
  return (
    !itemRegex.test(content) &&
    !blockRegex.test(content) &&
    !entityRegex.test(content) &&
    !eventRegex.test(content)
  );
}

/** 对单个 Java 文件进行解析，返回提取到的节点列表 */
function parseJavaFile(file: FileNode, ctx: DemoteContext): ModNode[] {
  const content = file.content;
  const fileName = basenameNoExt(file.path).toLowerCase();

  // 快速判定：未识别 → CodeNode
  if (isUnrecognizedJava(content)) {
    return [parseCodeNodeFromJava(file, ctx)];
  }

  // 已识别：尝试 4 种 parser，收集所有匹配结果
  // （单个文件可能同时包含多种注册，例如 ModItems.java 中既有物品又有方块注册）
  const nodes: ModNode[] = [];

  // 文件名提示优先级（仅为可读性，实际匹配仍由正则决定）
  // - ModItems.java → items
  // - ModBlocks.java → blocks
  // - ModEntities.java → entities
  // - ModEvents.java → events
  void fileName; // 仅用于未来扩展（按文件名优先排序）

  const items = parseItemsJava(content, ctx);
  const blocks = parseBlocksJava(content, ctx);
  const entities = parseEntitiesJava(content, ctx);
  const events = parseEventsJava(content, ctx);

  nodes.push(...items, ...blocks, ...entities, ...events);

  // 兜底：所有 parser 都没匹配到（理论上 isUnrecognizedJava 已过滤）
  if (nodes.length === 0) {
    return [parseCodeNodeFromJava(file, ctx)];
  }

  return nodes;
}

// === JSON 文件解析 ===

/** 安全解析 JSON，失败时返回 null */
function safeParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** 从 fabric.mod.json 中提取 modId（id 字段） */
function parseFabricModJson(content: string): string | null {
  const parsed = safeParseJson(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const id = (parsed as { id?: unknown }).id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  return null;
}

/** 从 lang/en_us.json 中建立 id → displayName 映射 */
function parseLangJson(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const parsed = safeParseJson(content);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        map.set(key, value);
      }
    }
  }
  return map;
}

/** recipe JSON 的解析结果 */
interface ParsedRecipe {
  recipeId: string;
  recipeType:
    'crafting_shaped' | 'crafting_shapeless' | 'smelting' | 'blasting' | 'smoking' | 'stonecutting';
  pattern: string[];
  outputItem: string; // 已剥离命名空间
  outputCount: number;
  cookTime: number;
  experience: number;
  inputItems: string[]; // 已剥离命名空间
}

/** 从 datapack recipe JSON 中解析配方信息 */
function parseRecipeJson(
  content: string,
  recipeId: string,
  warnings: string[],
): ParsedRecipe | null {
  const parsed = safeParseJson(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(`配方 ${recipeId} 不是合法 JSON 对象，已跳过`);
    return null;
  }
  const obj = parsed as Record<string, unknown>;

  // 配方类型
  const typeRaw = typeof obj.type === 'string' ? obj.type : '';
  let recipeType: ParsedRecipe['recipeType'] = 'crafting_shaped';
  if (typeRaw.endsWith('crafting_shaped')) recipeType = 'crafting_shaped';
  else if (typeRaw.endsWith('crafting_shapeless')) recipeType = 'crafting_shapeless';
  else if (typeRaw.endsWith('smelting')) recipeType = 'smelting';
  else if (typeRaw.endsWith('blasting')) recipeType = 'blasting';
  else if (typeRaw.endsWith('smoking')) recipeType = 'smoking';
  else if (typeRaw.endsWith('stonecutting')) recipeType = 'stonecutting';
  else if (typeRaw)
    warnings.push(`配方 ${recipeId} 的 type="${typeRaw}" 不在已知类型列表，默认为 crafting_shaped`);

  // 模式（仅 shaped 用）
  const pattern: string[] = Array.isArray(obj.pattern)
    ? obj.pattern.filter((p): p is string => typeof p === 'string').slice(0, 3)
    : [];

  // 输出物品：result.item 或 result.id（1.21+）
  let outputItem = '';
  let outputCount = 1;
  const result = obj.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const out = typeof r.item === 'string' ? r.item : typeof r.id === 'string' ? r.id : '';
    outputItem = stripNamespace(out);
    if (typeof r.count === 'number') outputCount = Math.max(1, Math.floor(r.count));
  }
  if (!outputItem) {
    warnings.push(`配方 ${recipeId} 缺少 result.item/id 字段，无法生成输出连线`);
  }

  // 输入物品：key.<char>.item/id 或 ingredients[].item/id 或 ingredient.item/id
  const inputItems: string[] = [];
  if (
    recipeType === 'crafting_shaped' &&
    obj.key &&
    typeof obj.key === 'object' &&
    !Array.isArray(obj.key)
  ) {
    for (const value of Object.values(obj.key as Record<string, unknown>)) {
      const item = extractItemFromIngredient(value);
      if (item) inputItems.push(item);
    }
  } else if (recipeType === 'crafting_shapeless' && Array.isArray(obj.ingredients)) {
    for (const ing of obj.ingredients) {
      const item = extractItemFromIngredient(ing);
      if (item) inputItems.push(item);
    }
  } else if (
    (recipeType === 'smelting' || recipeType === 'blasting' || recipeType === 'smoking') &&
    obj.ingredient
  ) {
    const item = extractItemFromIngredient(obj.ingredient);
    if (item) inputItems.push(item);
  } else if (recipeType === 'stonecutting' && obj.ingredient) {
    const item = extractItemFromIngredient(obj.ingredient);
    if (item) inputItems.push(item);
  }

  // 烧炼时间 / 经验
  let cookTime = 200;
  let experience = 0;
  if (typeof obj.cookingtime === 'number') cookTime = Math.max(1, Math.floor(obj.cookingtime));
  else if (typeof obj.cookTime === 'number') cookTime = Math.max(1, Math.floor(obj.cookTime));
  if (typeof obj.experience === 'number') experience = Math.max(0, obj.experience);

  return {
    recipeId,
    recipeType,
    pattern,
    outputItem,
    outputCount,
    cookTime,
    experience,
    inputItems,
  };
}

/** 从 ingredient 单元（可能是 {item: "xxx"} / {id: "xxx"} / 字符串）中提取物品 id，剥离命名空间 */
function extractItemFromIngredient(ing: unknown): string | null {
  if (!ing || typeof ing !== 'object') {
    if (typeof ing === 'string') return stripNamespace(ing);
    return null;
  }
  const obj = ing as Record<string, unknown>;
  // 1.21+：{ id: "minecraft:iron_ingot" } 或 { id: "minecraft:iron_ingot", count: 2 }
  if (typeof obj.id === 'string') return stripNamespace(obj.id);
  // 1.20-：{ item: "minecraft:iron_ingot" }
  if (typeof obj.item === 'string') return stripNamespace(obj.item);
  // 数组形式：{ ingredients: [...] }（嵌套），取第一个
  if (Array.isArray(obj.items) && obj.items.length > 0) {
    return extractItemFromIngredient(obj.items[0]);
  }
  return null;
}

/** 剥离命名空间前缀：minecraft:iron_ingot → iron_ingot */
function stripNamespace(itemId: string): string {
  const colon = itemId.indexOf(':');
  return colon >= 0 ? itemId.slice(colon + 1) : itemId;
}

// === 节点位置布局 ===

/**
 * 按 kind 分行排列节点：
 * - items 在 y=100，blocks 在 y=300，entities 在 y=500，recipes 在 y=700，events 在 y=900，code 在 y=1100
 * - 每行内节点按提取顺序 x=200+index*250
 *
 * 注意：此为按 kind 分行的内部布局算法，会就地修改节点 position。
 * 对外暴露的 spec-compliant 版本为 `layoutNodes`（见文件末尾），采用网格布局（x+=260，每 5 个节点 y+=180）。
 */
function applyLayoutByKind(nodes: ModNode[]): void {
  // 按 kind 分桶（保持插入顺序）
  const buckets = new Map<string, ModNode[]>();
  for (const node of nodes) {
    const kind = node.data.kind;
    if (!buckets.has(kind)) buckets.set(kind, []);
    buckets.get(kind)!.push(node);
  }
  // 给每个桶分配位置
  for (const [kind, group] of buckets) {
    const y = Y_BY_KIND[kind] ?? 1300; // 未知 kind 放在更下方
    group.forEach((node, idx) => {
      node.position = { x: X_START + idx * X_STEP, y };
    });
  }
}

// === 边生成 ===

/**
 * 生成 recipe → item 边（按 outputItem 匹配 itemId）。
 *
 * @param nodes 节点列表（用于建立 itemId → item 节点 id 映射）
 * @param recipeOutputs 每个配方节点的输出物品（recipeId/nodeId → outputItem，已剥离命名空间）
 * @param warnings 警告收集器
 */
function generateRecipeEdges(
  nodes: ModNode[],
  recipeOutputs: Array<{ nodeId: string; outputItem: string; recipeId: string }>,
  warnings: string[],
): ModEdge[] {
  const edges: ModEdge[] = [];
  // 建立 itemId → item 节点 id 映射
  const itemIndex = new Map<string, string>(); // itemId → nodeId
  for (const node of nodes) {
    if (node.data.kind === 'item') {
      const itemId = (node.data as { itemId: string }).itemId;
      itemIndex.set(itemId, node.id);
    }
  }
  // 遍历 recipe 输出列表，生成 craft 边
  let edgeIdx = 0;
  for (const { nodeId, outputItem, recipeId } of recipeOutputs) {
    if (!outputItem) continue;
    const targetNodeId = itemIndex.get(outputItem);
    if (!targetNodeId) {
      warnings.push(`配方 ${recipeId} 引用了不存在的物品 ${outputItem}，未生成输出连线`);
      continue;
    }
    const edgeId = `edge_recipe_${edgeIdx++}`;
    edges.push({
      id: edgeId,
      source: nodeId,
      target: targetNodeId,
      sourceHandle: 'out',
      targetHandle: undefined,
      kind: 'craft',
      label: undefined,
      disabled: false,
    });
  }
  return edges;
}

// === 主入口 ===

/**
 * 从 FileNode[] 反向生成节点图。
 *
 * 解析流程：
 * 1. 解析 fabric.mod.json 提取 modId（如未传入 modId 参数）
 * 2. 解析 lang/en_us.json 建立 id → displayName 映射
 * 3. 解析所有 Java 文件，提取 items/blocks/entities/events/code 节点
 * 4. 解析所有 recipe JSON 文件，提取 recipe 节点
 * 5. 应用节点位置布局（按 kind 分行）
 * 6. 生成 recipe → item 边
 * 7. 汇总统计与警告
 *
 * @param files PurecodeWorkspace 中的文件列表
 * @param modId 当前 modId（优先级最高；空值时尝试从 fabric.mod.json 提取；都无则用 'unnamed_mod'）
 */
export function demoteJavaToNodeGraph(files: FileNode[], modId?: string): DemoteResult {
  const warnings: string[] = [];
  const usedNodeIds = new Set<string>();
  const usedItemIds = new Set<string>();
  const usedBlockIds = new Set<string>();
  const usedEntityIds = new Set<string>();

  // === 第 1 步：解析 modId ===
  let resolvedModId = modId?.trim() || '';
  if (!resolvedModId) {
    // 从 fabric.mod.json 提取
    const fabricFile = files.find((f) => f.path.endsWith('fabric.mod.json'));
    if (fabricFile) {
      const extracted = parseFabricModJson(fabricFile.content);
      if (extracted) resolvedModId = extracted;
    }
  }
  if (!resolvedModId) resolvedModId = DEFAULT_MOD_ID;

  // === 第 2 步：解析 lang 文件，建立映射 ===
  const langMap = new Map<string, string>();
  for (const file of files) {
    // 匹配 lang/en_us.json 或 assets/<modid>/lang/en_us.json
    if (/lang\/en_us\.json$/.test(file.path) || /lang\/zh_cn\.json$/.test(file.path)) {
      const partial = parseLangJson(file.content);
      for (const [k, v] of partial) langMap.set(k, v);
    }
  }

  // === 第 3 步：解析 Java 文件 ===
  const ctx: DemoteContext = {
    modId: resolvedModId,
    langMap,
    warnings,
    usedNodeIds,
    usedItemIds,
    usedBlockIds,
    usedEntityIds,
  };

  const nodes: ModNode[] = [];
  for (const file of files) {
    if (!file.path.endsWith('.java')) continue;
    const javaNodes = parseJavaFile(file, ctx);
    nodes.push(...javaNodes);
  }

  // === 第 4 步：解析 recipe JSON 文件 ===
  // 匹配 data/<modid>/recipe/*.json 或 data/<modid>/recipes/*.json
  // （Minecraft 1.21+ 使用单数 recipe/，老版本使用复数 recipes/）
  const recipeOutputs: Array<{ nodeId: string; outputItem: string; recipeId: string }> = [];
  for (const file of files) {
    if (!file.path.endsWith('.json')) continue;
    if (!/\/recipe(s)?\//.test(file.path)) continue;
    if (file.path.endsWith('fabric.mod.json')) continue;

    const recipeId = sanitizeId(basenameNoExt(file.path));
    if (recipeId === 'unknown') {
      warnings.push(`无法从路径 ${file.path} 推导 recipeId，已跳过`);
      continue;
    }
    const parsed = parseRecipeJson(file.content, recipeId, warnings);
    if (!parsed) continue;

    // 生成 recipe 节点
    const id = genNodeId(ctx, 'recipe', recipeId);
    const node = makeNode(id, 'recipe', {
      recipeId: parsed.recipeId,
      recipeType: parsed.recipeType,
      pattern: parsed.pattern,
      outputCount: parsed.outputCount,
      cookTime: parsed.cookTime,
      experience: parsed.experience,
      label: `配方: ${parsed.recipeId}`,
    });
    nodes.push(node);
    recipeOutputs.push({ nodeId: id, outputItem: parsed.outputItem, recipeId: parsed.recipeId });
  }

  // === 第 5 步：应用布局 ===
  applyLayoutByKind(nodes);

  // === 第 6 步：生成边 ===
  const edges = generateRecipeEdges(nodes, recipeOutputs, warnings);

  // === 第 7 步：汇总统计 ===
  const stats = {
    items: nodes.filter((n) => n.data.kind === 'item').length,
    blocks: nodes.filter((n) => n.data.kind === 'block').length,
    entities: nodes.filter((n) => n.data.kind === 'entity').length,
    recipes: nodes.filter((n) => n.data.kind === 'recipe').length,
    events: nodes.filter((n) => n.data.kind === 'event').length,
    codeNodes: nodes.filter((n) => n.data.kind === 'code').length,
  };

  const graph: NodeGraph = {
    version: 1,
    modId: resolvedModId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
  };

  return { graph, warnings, stats };
}

// ============================================================================
// === Spec-compliant 附加导出（additive，不破坏已有 DemoteButton.tsx） ===
// ============================================================================
//
// 以下导出按用户任务规范实现：
//   - DemotionResult / ExtractionSummary 类型
//   - extractModId / extractItems / extractBlocks / extractCodeNodes / extractRecipes / layoutNodes 辅助函数
//   - demoteJavaToNodeGraphSimple 主函数（一参 FileNode[] → DemotionResult）
//
// 命名说明：
//   规范要求主函数名为 `demoteJavaToNodeGraph(files): DemotionResult`（一参），
//   但上方已有同名函数 `demoteJavaToNodeGraph(files, modId?): DemoteResult`（两参，被
//   同级 Agent 创建的 DemoteButton.tsx 引用）。为避免破坏 DemoteButton.tsx（用户
//   禁止修改 Agent E/F/H 的文件），这里采用 `demoteJavaToNodeGraphSimple` 命名，
//   功能完全等价于规范要求的一参版本。
//
// 布局算法：
//   规范要求网格布局（x+=260，每 5 个节点 y+=180），与上方按 kind 分行的 applyLayoutByKind
//   不同。这里导出的 `layoutNodes` 实现网格布局。

// === 对外类型（spec-compliant） ===

/** 提取摘要（spec: ExtractionSummary） */
export interface ExtractionSummary {
  items: number;
  blocks: number;
  entities: number;
  recipes: number;
  code: number;
}

/** 反向降级结果（spec: DemotionResult） */
export interface DemotionResult {
  /** 反向生成的节点图 */
  graph: NodeGraph;
  /** 警告信息 */
  warnings: string[];
  /** 无法识别的文件路径列表 */
  unsupported: string[];
  /** 提取摘要 */
  extracted: ExtractionSummary;
}

// === 辅助类型 ===

/** extractCodeNodes 返回的代码节点信息 */
export interface ExtractedCodeNode {
  nodeId: string;
  methodName: string;
  label: string;
  note: string;
  language: string;
  inputSignature: string;
  outputSignature: string;
  code: string;
}

/** extractRecipes 返回的配方信息 */
export interface ExtractedRecipe {
  recipeId: string;
  recipeType: string;
  outputItem: string;
  outputCount: number;
  pattern: string[];
  inputItems: string[];
}

// === 辅助函数（spec-compliant，纯函数，便于测试） ===

/**
 * 从文件列表中提取 modId（spec: MOD_ID from ModMain.java）。
 *
 * 优先级：
 * 1. 任意 Java 文件中的 `MOD_ID = "xxx"` 模式（ModMain.java 由 promoteToPurecode 生成）
 * 2. fabric.mod.json 的 `id` 字段
 * 3. 回退到 'untitled'（与 promoteToPurecode.ts 的 safeModId 默认值一致，确保往返等价）
 */
export function extractModId(files: FileNode[]): string {
  // 1. 从 Java 文件中查找 MOD_ID = "xxx"
  for (const file of files) {
    if (!file.path.endsWith('.java')) continue;
    const match = /MOD_ID\s*=\s*"([^"]+)"/.exec(file.content);
    if (match && match[1]) {
      return match[1];
    }
  }
  // 2. 从 fabric.mod.json 提取
  for (const file of files) {
    if (!file.path.endsWith('fabric.mod.json')) continue;
    const parsed = safeParseJson(file.content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const id = (parsed as { id?: unknown }).id;
      if (typeof id === 'string' && id.trim()) {
        return id.trim();
      }
    }
  }
  // 3. 回退（与 promoteToPurecode.ts safeModId 一致）
  return 'untitled';
}

/**
 * 从 Java 源码中提取物品注册信息（spec: register("xxx") from ModItems.java）。
 *
 * 匹配模式：register("xxx", new Item(...))
 * 同时尝试提取稀有度（.rarity(Rarity.XXX)），默认 'common'。
 *
 * @param content Java 文件内容（通常是 ModItems.java）
 * @returns 物品信息数组（itemId + rarity）
 */
export function extractItems(content: string): Array<{ itemId: string; rarity: string }> {
  const items: Array<{ itemId: string; rarity: string }> = [];
  const itemRegex = /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*new\s+Item\b/g;
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(content)) !== null) {
    const itemId = m[1];
    // 向后扫描 400 字符，提取稀有度
    const tail = content.slice(m.index, m.index + 400);
    const rarityMatch = /\.rarity\s*\(\s*Rarity\.(\w+)/.exec(tail);
    const rarity =
      rarityMatch && ['common', 'uncommon', 'rare', 'epic'].includes(rarityMatch[1].toLowerCase())
        ? rarityMatch[1].toLowerCase()
        : 'common';
    items.push({ itemId, rarity });
  }
  return items;
}

/**
 * 从 Java 源码中提取方块注册信息（spec: register("xxx") from ModBlocks.java）。
 *
 * 匹配模式：register("xxx", new Block(...))
 * 同时尝试提取硬度（.strength(x, y) 或 .hardness(x)）和亮度（.luminance(n)）。
 *
 * @param content Java 文件内容（通常是 ModBlocks.java）
 * @returns 方块信息数组（blockId + hardness + luminance）
 */
export function extractBlocks(
  content: string,
): Array<{ blockId: string; hardness: number; luminance: number }> {
  const blocks: Array<{ blockId: string; hardness: number; luminance: number }> = [];
  const blockRegex = /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*new\s+Block\b/g;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(content)) !== null) {
    const blockId = m[1];
    const tail = content.slice(m.index, m.index + 600);

    // 硬度：优先 .strength(x, y)，其次 .hardness(x)
    let hardness = 1.0;
    const strengthMatch = /\.strength\s*\(\s*([\d.]+)f?\s*,\s*([\d.]+)f?\s*\)/.exec(tail);
    if (strengthMatch) {
      hardness = parseFloat(strengthMatch[1]);
    } else {
      const hardnessMatch = /\.hardness\s*\(\s*([\d.]+)f?\s*\)/.exec(tail);
      if (hardnessMatch) hardness = parseFloat(hardnessMatch[1]);
    }

    // 亮度：.luminance(n) 或 .luminance(state -> n)
    let luminance = 0;
    const luminanceMatch = /\.luminance\s*\(\s*(?:state\s*->\s*)?([\d.]+)f?\s*\)/.exec(tail);
    if (luminanceMatch) {
      const val = parseInt(luminanceMatch[1], 10);
      if (val >= 0 && val <= 15) luminance = val;
    }

    blocks.push({ blockId, hardness, luminance });
  }
  return blocks;
}

/**
 * 从 ModCustomCode.java 中提取代码节点信息（spec: methodName from ModCustomCode.java）。
 *
 * 解析 promoteToPurecode.ts 生成的注释块格式：
 *   // === 从节点图 Code 节点提升生成 ===
 *   // nodeId: xxx
 *   // label: xxx
 *   // note: xxx
 *   // language: xxx
 *   // inputSignature:  {...}
 *   // outputSignature: {...}
 *   public static <type> <methodName>(<params>) {
 *       <code>
 *   }
 *
 * 此函数是 L2→L3→L2 往返等价的关键：它把提升时生成的结构化注释反向还原为代码节点。
 *
 * @param content Java 文件内容（通常是 ModCustomCode.java）
 * @returns 代码节点信息数组
 */
export function extractCodeNodes(content: string): ExtractedCodeNode[] {
  const nodes: ExtractedCodeNode[] = [];
  // 匹配每个代码块：注释标记 + 注释行 + public static 方法定义
  // 方法体的结束标记是 \n    }（换行 + 4 个空格 + 闭花括号，与类内方法层级一致）
  const blockRegex =
    /\/\/ === 从节点图 Code 节点提升生成 ===\n((?:\s*\/\/[^\n]*\n)*)\s*public static (\w+)\s+(\w+)\s*\(([^)]*)\)\s*\{([\s\S]*?)\n {4}\}/g;
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(content)) !== null) {
    const commentBlock = m[1];
    const methodName = m[3];
    const body = m[5];

    // 从注释块中提取各字段
    const nodeId = /\/\/ nodeId:\s*(\S+)/.exec(commentBlock)?.[1] ?? '';
    const label = /\/\/ label:\s*(.*)/.exec(commentBlock)?.[1]?.trim() ?? '';
    const note = /\/\/ note:\s*(.*)/.exec(commentBlock)?.[1]?.trim() ?? '';
    const language = /\/\/ language:\s*(\S+)/.exec(commentBlock)?.[1] ?? 'java';
    const inputSignature = /\/\/ inputSignature:\s*(.*)/.exec(commentBlock)?.[1]?.trim() ?? '{}';
    const outputSignature = /\/\/ outputSignature:\s*(.*)/.exec(commentBlock)?.[1]?.trim() ?? '{}';

    // 还原代码体：去掉 indentBody 添加的 8 空格缩进
    const code = body
      .split('\n')
      .slice(1) // 跳过 { 后的空行
      .map((line) => line.replace(/^ {8}/, ''))
      .join('\n')
      .trim();

    nodes.push({
      nodeId,
      methodName,
      label,
      note,
      language,
      inputSignature,
      outputSignature,
      code,
    });
  }
  return nodes;
}

/**
 * 从 datapack recipe JSON 文件中提取配方信息（spec: type/result from *.json recipe files）。
 *
 * @param file JSON 文件（路径需包含 /recipe/ 或 /recipes/）
 * @returns 配方信息，或 null（不是合法配方文件）
 */
export function extractRecipes(file: FileNode): ExtractedRecipe | null {
  if (!file.path.endsWith('.json')) return null;
  if (!/\/recipe(s)?\//.test(file.path)) return null;

  const parsed = safeParseJson(file.content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const obj = parsed as Record<string, unknown>;

  // recipeId 从文件名提取
  const recipeId = basenameNoExt(file.path);

  // recipeType 从 type 字段提取（剥离命名空间前缀）
  const typeRaw = typeof obj.type === 'string' ? obj.type : '';
  const recipeType = typeRaw.includes(':')
    ? (typeRaw.split(':').pop() ?? 'crafting_shaped')
    : typeRaw || 'crafting_shaped';

  // 输出物品：result.item 或 result.id
  let outputItem = '';
  let outputCount = 1;
  const result = obj.result;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const r = result as Record<string, unknown>;
    const out = typeof r.item === 'string' ? r.item : typeof r.id === 'string' ? r.id : '';
    outputItem = stripNamespace(out);
    if (typeof r.count === 'number') outputCount = Math.max(1, Math.floor(r.count));
  }

  // 模式（仅 shaped 用）
  const pattern: string[] = Array.isArray(obj.pattern)
    ? obj.pattern.filter((p): p is string => typeof p === 'string').slice(0, 3)
    : [];

  // 输入物品
  const inputItems: string[] = [];
  if (obj.key && typeof obj.key === 'object' && !Array.isArray(obj.key)) {
    for (const value of Object.values(obj.key as Record<string, unknown>)) {
      const item = extractItemFromIngredient(value);
      if (item) inputItems.push(item);
    }
  } else if (Array.isArray(obj.ingredients)) {
    for (const ing of obj.ingredients) {
      const item = extractItemFromIngredient(ing);
      if (item) inputItems.push(item);
    }
  }

  return { recipeId, recipeType, outputItem, outputCount, pattern, inputItems };
}

/**
 * 网格布局（spec: x+=260，每 5 个节点 y+=180）。
 *
 * 节点按提取顺序排列：
 *   - 第 0 个节点：(0, 0)
 *   - 第 1 个节点：(260, 0)  — x += 260
 *   - ...
 *   - 第 4 个节点：(1040, 0)
 *   - 第 5 个节点：(0, 180)  — y += 180，x 重置
 *   - 第 6 个节点：(260, 180)
 *   - ...
 *
 * @param nodes 节点列表
 * @returns 位置数组（与节点列表一一对应）
 */
export function layoutNodes(nodes: ModNode[]): Array<{ x: number; y: number }> {
  const X_STEP = 260;
  const Y_STEP = 180;
  const COLS = 5;
  const X_START = 0;
  const Y_START = 0;

  return nodes.map((_, idx) => {
    const col = idx % COLS;
    const row = Math.floor(idx / COLS);
    return {
      x: X_START + col * X_STEP,
      y: Y_START + row * Y_STEP,
    };
  });
}

// === 内部辅助：实体提取（spec 未要求导出，但 ExtractionSummary 需要 entities 计数） ===

/**
 * 从 Java 源码中提取实体注册信息（内部使用，不导出）。
 *
 * 匹配模式：register("xxx", EntityType.Builder...) 或 register("xxx", FabricEntityTypeBuilder...)
 */
function extractEntitiesInternal(content: string): Array<{
  entityId: string;
  maxHealth: number;
  movementSpeed: number;
  attackDamage: number;
  classification: string;
}> {
  const entities: Array<{
    entityId: string;
    maxHealth: number;
    movementSpeed: number;
    attackDamage: number;
    classification: string;
  }> = [];

  const entityRegex =
    /register\s*\(\s*"([a-zA-Z0-9_]+)"\s*,\s*(?:EntityType|FabricEntityTypeBuilder)\b/g;
  let m: RegExpExecArray | null;
  while ((m = entityRegex.exec(content)) !== null) {
    const entityId = m[1];

    let maxHealth = 20;
    let movementSpeed = 0.3;
    let attackDamage = 0;
    const healthMatch = /\.maxHealth\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (healthMatch) maxHealth = parseFloat(healthMatch[1]);
    const speedMatch = /\.movementSpeed\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (speedMatch) movementSpeed = parseFloat(speedMatch[1]);
    const damageMatch = /\.attackDamage\s*\(\s*([\d.]+)f?\s*\)/.exec(content);
    if (damageMatch) attackDamage = parseFloat(damageMatch[1]);

    let classification = 'misc';
    const spawnGroupMatch = /SpawnGroup\.(\w+)/.exec(content);
    if (spawnGroupMatch) {
      const group = spawnGroupMatch[1].toUpperCase();
      if (group === 'MONSTER') classification = 'monster';
      else if (group === 'CREATURE') classification = 'animal';
      else if (group === 'WATER_CREATURE' || group === 'UNDERWATER_CREATURE' || group === 'AQUATIC')
        classification = 'water_creature';
      else if (group === 'AMBIENT') classification = 'ambient';
    }

    entities.push({ entityId, maxHealth, movementSpeed, attackDamage, classification });
  }

  return entities;
}

// === 内部辅助：判断文件是否被降级器消费 ===

/**
 * 判断文件是否被降级器消费（即用于 modId/lang/recipe/节点提取）。
 * 未被消费的文件计入 unsupported。
 */
function isFileConsumed(file: FileNode): boolean {
  // Java 文件：总是被消费（识别为具体节点，或回退为 CodeNode）
  if (file.path.endsWith('.java')) return true;
  // fabric.mod.json：被消费（用于 modId 提取）
  if (file.path.endsWith('fabric.mod.json')) return true;
  // lang 文件：被消费（用于 displayName 回填）
  if (/lang\/(en_us|zh_cn)\.json$/.test(file.path)) return true;
  // recipe JSON：被消费（用于配方提取）
  if (file.path.endsWith('.json') && /\/recipe(s)?\//.test(file.path)) return true;
  // 其余文件（build.gradle、随机 .json、.toml 等）：未消费
  return false;
}

// === 主函数（spec-compliant，一参版本） ===

/**
 * 从 PurecodeWorkspace 的 Java/JSON 文件反向生成节点图（spec-compliant 主函数）。
 *
 * 解析策略：
 * 1. extractModId：从 ModMain.java 提取 MOD_ID（回退 fabric.mod.json → 'untitled'）
 * 2. 遍历 Java 文件：
 *    - 若含 `// === 从节点图 Code 节点提升生成 ===` 标记 → extractCodeNodes（往返等价关键）
 *    - 否则用 extractItems / extractBlocks / extractEntitiesInternal 提取注册信息
 *    - 全部提取为空 → 整个文件作为 CodeNode 保留
 * 3. 遍历 JSON 文件：extractRecipes 提取配方（fabric.mod.json/lang 文件已消费，跳过）
 * 4. layoutNodes：网格布局（x+=260，每 5 个节点 y+=180）
 * 5. 汇总 extracted / unsupported / warnings
 *
 * @param files PurecodeWorkspace 中的文件列表
 * @returns DemotionResult（含 graph / warnings / unsupported / extracted）
 */
export function demoteJavaToNodeGraphSimple(files: FileNode[]): DemotionResult {
  const warnings: string[] = [];
  const unsupported: string[] = [];
  const nodes: ModNode[] = [];
  const usedNodeIds = new Set<string>();

  // 生成唯一节点 id 的辅助
  const genId = (kind: string, suffix: string): string => {
    let i = 0;
    let candidate = `${kind}_${suffix}`;
    while (usedNodeIds.has(candidate)) {
      i += 1;
      candidate = `${kind}_${suffix}_${i}`;
    }
    usedNodeIds.add(candidate);
    return candidate;
  };

  // 1. 提取 modId
  const modId = extractModId(files);

  // 2. 遍历文件，提取节点
  for (const file of files) {
    if (file.path.endsWith('.java')) {
      const content = file.content;

      // 优先检查是否为 ModCustomCode.java（含提升标记）—— 往返等价关键
      const codeNodes = extractCodeNodes(content);
      if (codeNodes.length > 0) {
        for (const cn of codeNodes) {
          // 保留原始 nodeId（确保往返等价）
          const id = cn.nodeId || genId('code', cn.methodName);
          usedNodeIds.add(id);
          nodes.push(
            makeNode(id, 'code', {
              language: cn.language,
              code: cn.code,
              methodName: cn.methodName,
              label: cn.label || cn.methodName,
              note: cn.note,
              inputSignature: cn.inputSignature,
              outputSignature: cn.outputSignature,
            }),
          );
        }
        continue; // ModCustomCode.java 不再做 items/blocks/entities 提取
      }

      // 普通 Java 文件：提取 items/blocks/entities
      const items = extractItems(content);
      for (const item of items) {
        const id = genId('item', item.itemId);
        nodes.push(
          makeNode(id, 'item', {
            itemId: item.itemId,
            displayName: item.itemId,
            label: item.itemId,
            rarity: item.rarity as 'common' | 'uncommon' | 'rare' | 'epic',
          }),
        );
      }

      const blocks = extractBlocks(content);
      for (const block of blocks) {
        const id = genId('block', block.blockId);
        nodes.push(
          makeNode(id, 'block', {
            blockId: block.blockId,
            displayName: block.blockId,
            label: block.blockId,
            hardness: block.hardness,
            luminance: block.luminance,
          }),
        );
      }

      const entities = extractEntitiesInternal(content);
      for (const entity of entities) {
        const id = genId('entity', entity.entityId);
        nodes.push(
          makeNode(id, 'entity', {
            entityId: entity.entityId,
            displayName: entity.entityId,
            label: entity.entityId,
            maxHealth: entity.maxHealth,
            movementSpeed: entity.movementSpeed,
            attackDamage: entity.attackDamage,
            classification: entity.classification as
              'animal' | 'monster' | 'water_creature' | 'ambient' | 'misc',
          }),
        );
      }

      // 未识别的 Java 文件 → CodeNode 保留
      // 但跳过 ModMain 风格文件（含 MOD_ID = "xxx" 且无 register/code-marker）：
      // 这类文件已被 extractModId 消费（仅用于提取 modId），不应生成 CodeNode，
      // 否则会破坏 L2→L3→L2 往返等价（promoteMultipleCodeNodes 生成的 ModMain.java 会被误判为 CodeNode）
      if (items.length === 0 && blocks.length === 0 && entities.length === 0) {
        const isModMainStyle = /MOD_ID\s*=\s*"/.test(content);
        if (!isModMainStyle) {
          const fileName = basenameNoExt(file.path);
          const id = genId('code', fileName);
          nodes.push(
            makeNode(id, 'code', {
              language: 'java',
              code: content,
              methodName: extractFirstPublicMethodName(content),
              label: fileName,
              note: `未识别的 Java 文件：${file.path}`,
            }),
          );
        }
      }
    } else if (file.path.endsWith('.json')) {
      // fabric.mod.json 和 lang 文件已消费，跳过
      if (file.path.endsWith('fabric.mod.json')) continue;
      if (/lang\/(en_us|zh_cn)\.json$/.test(file.path)) continue;

      // 尝试配方提取
      const recipe = extractRecipes(file);
      if (recipe) {
        const id = genId('recipe', recipe.recipeId);
        nodes.push(
          makeNode(id, 'recipe', {
            recipeId: recipe.recipeId,
            recipeType: recipe.recipeType as
              | 'crafting_shaped'
              | 'crafting_shapeless'
              | 'smelting'
              | 'blasting'
              | 'smoking'
              | 'stonecutting',
            pattern: recipe.pattern,
            outputCount: recipe.outputCount,
            label: `配方: ${recipe.recipeId}`,
          }),
        );
      } else {
        // 非配方的 JSON 文件 → unsupported
        if (!isFileConsumed(file)) {
          unsupported.push(file.path);
        }
      }
    } else {
      // 非 Java 非 JSON 文件 → unsupported
      unsupported.push(file.path);
    }
  }

  // 3. 应用网格布局
  const positions = layoutNodes(nodes);
  nodes.forEach((node, idx) => {
    node.position = positions[idx];
  });

  // 4. 构建图
  const graph: NodeGraph = {
    version: 1,
    modId,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
  };

  // 5. 汇总提取摘要
  const extracted: ExtractionSummary = {
    items: nodes.filter((n) => n.data.kind === 'item').length,
    blocks: nodes.filter((n) => n.data.kind === 'block').length,
    entities: nodes.filter((n) => n.data.kind === 'entity').length,
    recipes: nodes.filter((n) => n.data.kind === 'recipe').length,
    code: nodes.filter((n) => n.data.kind === 'code').length,
  };

  return { graph, warnings, unsupported, extracted };
}
