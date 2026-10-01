import type { FileNode } from '@mc-creator/shared';
import type { ExtractedCodeNode, ExtractedRecipe } from './types.js';
import { safeParseJson, basenameNoExt, stripNamespace } from './textUtils.js';
import { extractItemFromIngredient } from './jsonParsers.js';

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

// === 内部辅助：实体提取（spec 未要求导出，但 ExtractionSummary 需要 entities 计数） ===

/**
 * 从 Java 源码中提取实体注册信息（内部使用，不导出）。
 *
 * 匹配模式：register("xxx", EntityType.Builder...) 或 register("xxx", FabricEntityTypeBuilder...)
 */
export function extractEntitiesInternal(content: string): Array<{
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
export function isFileConsumed(file: FileNode): boolean {
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
