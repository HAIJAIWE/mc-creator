import { safeParseJson, stripNamespace } from './textUtils.js';

/** 从 fabric.mod.json 中提取 modId（id 字段） */
export function parseFabricModJson(content: string): string | null {
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
export function parseLangJson(content: string): Map<string, string> {
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
export interface ParsedRecipe {
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
export function parseRecipeJson(
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
export function extractItemFromIngredient(ing: unknown): string | null {
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
