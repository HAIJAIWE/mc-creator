/** 配方/标签/函数/进度/战利品表/谓词 → JSON 内容 writer（无实例状态）。 */
import type {
  AdvancementSpec,
  FileNode,
  FunctionSpec,
  LootTableSpec,
  PredicateSpec,
  RecipeSpec,
  SimpleTagSpec,
  TagSpec,
} from '@mc-creator/shared';
import { safeJsonParse, sanitizePathSegment, toIngredient } from './common.js';

export function generateRecipe(namespace: string, r: RecipeSpec): FileNode {
  let recipeObj: Record<string, unknown>;

  switch (r.type) {
    case 'crafting_shaped':
      recipeObj = {
        type: 'minecraft:crafting_shaped',
        pattern: r.pattern ?? [],
        // G-3：key 值（string[]）转换为 {item|tag} 成分对象
        key: Object.fromEntries(
          Object.entries(r.key ?? {}).map(([k, vals]) => [
            k,
            toIngredient((Array.isArray(vals) ? vals[0] : (vals as unknown as string)) ?? ''),
          ]),
        ),
        result: { id: r.result, count: r.count },
      };
      break;
    case 'crafting_shapeless':
      recipeObj = {
        type: 'minecraft:crafting_shapeless',
        ingredients: (r.ingredients ?? []).map((i) => toIngredient(i)),
        result: { id: r.result, count: r.count },
      };
      break;
    case 'smelting':
      recipeObj = {
        type: 'minecraft:smelting',
        ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
        result: r.result,
        experience: r.experience ?? 0.1,
        cookingtime: r.cookingTime,
      };
      break;
    case 'blasting':
      recipeObj = {
        type: 'minecraft:blasting',
        ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
        result: r.result,
        experience: r.experience ?? 0.1,
        cookingtime: r.cookingTime ?? 100,
      };
      break;
    case 'smoking':
      recipeObj = {
        type: 'minecraft:smoking',
        ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
        result: r.result,
        experience: r.experience ?? 0.1,
        cookingtime: r.cookingTime ?? 100,
      };
      break;
    case 'campfire_cooking':
      recipeObj = {
        type: 'minecraft:campfire_cooking',
        ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
        result: r.result,
        experience: r.experience ?? 0.1,
        cookingtime: r.cookingTime ?? 600,
      };
      break;
    case 'stonecutting':
      recipeObj = {
        type: 'minecraft:stonecutting',
        ingredient: toIngredient(r.source ?? r.ingredients?.[0] ?? ''),
        result: r.result,
        count: r.count,
      };
      break;
    case 'smithing_transform':
      recipeObj = {
        type: 'minecraft:smithing_transform',
        template: toIngredient(r.template ?? 'minecraft:netherite_upgrade_smithing_template'),
        base: toIngredient(r.base ?? ''),
        addition: toIngredient(r.addition ?? ''),
        result: { id: r.result },
      };
      break;
    case 'smithing_trim':
      recipeObj = {
        type: 'minecraft:smithing_trim',
        template: toIngredient(r.template ?? ''),
        base: toIngredient(r.base ?? ''),
        addition: toIngredient(r.addition ?? ''),
      };
      break;
    case 'brewing':
      recipeObj = {
        type: 'minecraft:brewing',
        input: { potion: r.inputPotion ?? 'minecraft:water' },
        ingredient: { item: r.ingredientItem ?? '' },
        result: { potion: r.outputPotion ?? '' },
      };
      break;
    default:
      // 未知配方类型：生成基本结构
      recipeObj = {
        type: `minecraft:${r.type}`,
        result: { id: r.result, count: r.count },
      };
      break;
  }

  // 条件配方：添加 condition 字段
  if (r.condition) {
    try {
      recipeObj.condition = JSON.parse(r.condition);
    } catch {
      recipeObj.condition = r.condition;
    }
  }

  // 配方书分组
  if (r.group) {
    recipeObj.group = r.group;
  }

  // 解锁通知控制
  if (!r.showNotification) {
    recipeObj.show_notification = false;
  }

  return {
    path: `data/${namespace}/recipe/${sanitizePathSegment(r.id)}.json`,
    content: JSON.stringify(recipeObj, null, 2),
  };
}

export function generateTag(namespace: string, t: TagSpec): FileNode {
  return {
    path: `data/${namespace}/tags/${sanitizePathSegment(t.type)}/${sanitizePathSegment(t.id)}.json`,
    content: JSON.stringify({ replace: t.replace, values: t.values }, null, 2),
  };
}

export function generateFunction(namespace: string, f: FunctionSpec): FileNode {
  return {
    path: `data/${namespace}/function/${sanitizePathSegment(f.id)}.mcfunction`,
    content: f.commands.join('\n') + '\n',
  };
}

export function generateAdvancement(namespace: string, a: AdvancementSpec): FileNode {
  // P0 dogfood 修复：JSON.parse 无 try/catch 会导致整个 generate 崩溃
  const parsedConditions = a.conditions ? safeJsonParse(a.conditions, {}) : {};
  // P1 dogfood 修复：criteria 结构应为 { [条件名]: { trigger, conditions } }
  // 而非 { trigger: { trigger, conditions } }，否则 Minecraft 无法加载
  const displayObj: Record<string, unknown> = {
    icon: { id: a.icon },
    title: a.title,
    description: a.description,
  };
  if (a.frame && a.frame !== 'task') displayObj.frame = a.frame;
  const advObj: Record<string, unknown> = {
    display: displayObj,
    // Task E：高级 criteria 配置优先（多条件进度），否则回退简单 trigger 模式
    criteria:
      a.criteria && Object.keys(a.criteria).length > 0
        ? a.criteria
        : {
            [a.id]: {
              trigger: a.trigger,
              conditions: parsedConditions,
            },
          },
  };
  if (a.parent) advObj.parent = a.parent;
  return {
    path: `data/${namespace}/advancement/${sanitizePathSegment(a.id)}.json`,
    content: JSON.stringify(advObj, null, 2),
  };
}

/** P10：生成战利品表 → data/<namespace>/loot_table/<type>/<path>.json（目录为单数，G-11 修复） */
export function generateLootTable(l: LootTableSpec): FileNode {
  const lootObj: Record<string, unknown> = {
    type: `minecraft:${l.type}`,
    pools: l.pools.map((p) => {
      const poolObj: Record<string, unknown> = {
        rolls: p.rolls,
        entries: p.entries.map((e) => {
          const entryObj: Record<string, unknown> = {
            type: `minecraft:${e.type}`,
            name: e.name,
            weight: e.weight,
            count: e.count,
          };
          // Task E：条目函数（set_count/enchant_with_levels 等）
          if (e.functions.length > 0) entryObj.functions = e.functions;
          // Task E：条目条件
          if (e.conditions.length > 0) entryObj.conditions = e.conditions;
          return entryObj;
        }),
      };
      // Task E：额外掷骰（附魔幸运）
      if (p.bonusRolls > 0) poolObj.bonus_rolls = p.bonusRolls;
      // Task E：池条件（如方块被正确工具挖掘）
      if (p.conditions.length > 0) poolObj.conditions = p.conditions;
      return poolObj;
    }),
  };
  return {
    path: `data/${sanitizePathSegment(l.namespace)}/loot_table/${sanitizePathSegment(l.type)}/${sanitizePathSegment(l.path)}.json`,
    content: JSON.stringify(lootObj, null, 2),
  };
}

/** P10：生成谓词 → data/<namespace>/predicate/<path>.json（目录为单数，G-11 修复） */
export function generatePredicate(p: PredicateSpec): FileNode {
  // P0 dogfood 修复：JSON.parse 无 try/catch 会导致整个 generate 崩溃
  // Major 修复：谓词文件顶层就是条件对象本身，不应再包一层 condition 字段
  // 解析失败时 fallback 为固定无效谓词（minecraft:impossible），避免把原始文本包进 condition
  const predObj = safeJsonParse(p.condition, { condition: 'minecraft:impossible' });
  return {
    path: `data/${sanitizePathSegment(p.namespace)}/predicate/${sanitizePathSegment(p.path)}.json`,
    content: JSON.stringify(predObj, null, 2),
  };
}

/** P10：生成 itemTag / blockTag → data/<namespace>/tags/<kind>/<tag>.json */
export function generateSimpleTag(kind: 'item' | 'block', t: SimpleTagSpec): FileNode {
  const tagObj = {
    replace: t.replace,
    values: t.values,
  };
  return {
    path: `data/${sanitizePathSegment(t.namespace)}/tags/${kind}/${sanitizePathSegment(t.tag)}.json`,
    content: JSON.stringify(tagObj, null, 2),
  };
}
