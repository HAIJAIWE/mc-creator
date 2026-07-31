import type { ModRecipeSpec, RecipeSpec } from '@mc-creator/shared';

/**
 * 判断对象是否为 ModRecipeSpec（loader 无关的抽象配方）。
 *
 * 用于在 datapack-generator 中区分两种格式：
 * - ModRecipeSpec（loader 无关，由节点图编译而来）：标志性字段是 `recipeId`
 * - datapack RecipeSpec（vanilla 数据包 JSON 格式）：用 `id`
 *
 * 通过 `recipeId` 字段的存在与否来区分二者。
 */
export function isModRecipe(r: unknown): r is ModRecipeSpec {
  return typeof r === 'object' && r !== null && 'recipeId' in r;
}

/**
 * 将 loader 无关的 ModRecipeSpec 转换为 vanilla 数据包 RecipeSpec 格式。
 * 用于让 datapack-generator 消费节点图编译出的 ModSpec.recipes。
 *
 * 字段映射：
 * - recipeId → id
 * - recipeType → type（枚举值兼容）
 * - output → result
 * - outputCount → count
 * - cookTime → cookingTime（字段名不同，值直接映射）
 * - experience → experience
 * - inputs/pattern 按 recipeType 分支：
 *   - crafting_shapeless：inputs → ingredients[]（每个 input.item 作为一个元素），pattern 忽略
 *   - crafting_shaped：pattern → pattern[]，inputs → key（用 input.slot 作为键，value 为 [input.item]）
 *     slot 为空的 input 跳过（不参与 key 映射）
 *   - smelting/blasting/smoking：取第一个 input.item → ingredient，其他 inputs 忽略
 *   - stonecutting：取第一个 input.item → source
 * - 未使用的 datapack RecipeSpec 字段（condition/group/template/base/addition 等）使用默认值，
 *   不在转换中显式设置；showNotification 显式设为 true（与 schema 默认值一致）。
 *
 * 边界处理：空 inputs / 未知 recipeType 不抛错，用最小有效结构兜底。
 */
export function modRecipeToDatapackRecipe(modRecipe: ModRecipeSpec): RecipeSpec {
  // 基础字段直接映射（这些字段在所有 recipeType 下都通用）
  const base: RecipeSpec = {
    id: modRecipe.recipeId,
    type: modRecipe.recipeType,
    result: modRecipe.output,
    count: modRecipe.outputCount,
    experience: modRecipe.experience,
    cookingTime: modRecipe.cookTime,
    showNotification: true,
  };

  // 按 recipeType 分支处理 inputs / pattern
  switch (modRecipe.recipeType) {
    case 'crafting_shapeless': {
      // inputs → ingredients（每个 input.item 作为一个元素），pattern 忽略
      base.ingredients = modRecipe.inputs.map((input) => input.item);
      break;
    }
    case 'crafting_shaped': {
      // pattern 直接用
      base.pattern = modRecipe.pattern;
      // inputs → key（用 input.slot 作为键，value 为 [input.item]）
      // 跳过 slot 为空的 input（不参与 key 映射）
      const key: Record<string, string[]> = {};
      for (const input of modRecipe.inputs) {
        const slot = input.slot?.trim();
        if (slot) {
          key[slot] = [input.item];
        }
      }
      base.key = key;
      break;
    }
    case 'smelting':
    case 'blasting':
    case 'smoking': {
      // 取第一个 input.item → ingredient，其他 inputs 忽略
      // 空 inputs 时使用空字符串兜底（datapack-generator 会进一步处理）
      const first = modRecipe.inputs[0];
      base.ingredient = first?.item ?? '';
      break;
    }
    case 'stonecutting': {
      // 取第一个 input.item → source
      // 空 inputs 时使用空字符串兜底
      const first = modRecipe.inputs[0];
      base.source = first?.item ?? '';
      break;
    }
    default: {
      // 未知 recipeType（理论上 ModRecipeSpec 枚举限制了不会到达这里）
      // 兜底：仅保留基础字段，若有 inputs 取第一个作为 ingredient 作为最小有效结构
      if (modRecipe.inputs.length > 0) {
        base.ingredient = modRecipe.inputs[0].item;
      }
      break;
    }
  }

  return base;
}
