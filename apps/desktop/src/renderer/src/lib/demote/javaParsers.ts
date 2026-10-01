import type { ModNode, NodeKind, FileNode } from '@mc-creator/shared';
import { makeNode } from './nodeFactory.js';
import { sanitizeId, basenameNoExt, extractFirstPublicMethodName } from './textUtils.js';

// === 内部上下文 ===

export interface DemoteContext {
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
export function genNodeId(ctx: DemoteContext, kind: NodeKind, suffix: string): string {
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

// === Java 文件解析 ===

/** 提取物品注册：register("xxx", new Item(...)) */
export function parseItemsJava(content: string, ctx: DemoteContext): ModNode[] {
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
export function parseBlocksJava(content: string, ctx: DemoteContext): ModNode[] {
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
export function parseEntitiesJava(content: string, ctx: DemoteContext): ModNode[] {
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
export function mapEventType(apiPath: string): {
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
  return { eventType: 'custom', label: apiPath };
}

/** 提取事件注册：<EventApi>.register(...)，如 ServerTickEvents.END_SERVER_TICK.register */
export function parseEventsJava(content: string, ctx: DemoteContext): ModNode[] {
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

/** 无法识别的 Java 文件 → 转为 CodeNode 保留 */
export function parseCodeNodeFromJava(file: FileNode, ctx: DemoteContext): ModNode {
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
export function isUnrecognizedJava(content: string): boolean {
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
export function parseJavaFile(file: FileNode, ctx: DemoteContext): ModNode[] {
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
