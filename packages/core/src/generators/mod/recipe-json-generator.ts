import type { ModSpecLike } from './mod-common.js';

type RecipeSpec = NonNullable<ModSpecLike['recipes']>[number];

/**
 * Generate single recipe JSON object (Minecraft datapack format)
 */
export function generateRecipeJson(spec: ModSpecLike, recipe: RecipeSpec) {
  const base = {
    type: `minecraft:${recipe.recipeType}`,
  };

  const recipeType = recipe.recipeType;

  if (recipeType === 'crafting_shaped') {
    const pattern = recipe.pattern ?? ['###', '###', '###'];
    const keyObj: Record<string, { item: string }> = {};

    // Build key from inputs (slot -> item mapping)
    for (const input of recipe.inputs ?? []) {
      const slot = input.slot;
      if (slot && slot.length === 1) {
        keyObj[slot] = { item: input.item };
      }
    }

    // Fallback: derive key from pattern if inputs don't have slots
    if (Object.keys(keyObj).length === 0) {
      const seen: Record<string, boolean> = {};
      const uniqueChars = pattern
        .join('')
        .replace(/ /g, '')
        .split('')
        .filter((c) => c !== ' ' && !seen[c] && (seen[c] = true));
      for (const char of uniqueChars) {
        keyObj[char] = { item: `minecraft:${char.toLowerCase()}` };
      }
    }

    return {
      ...base,
      pattern,
      key: keyObj,
      result: { id: recipe.output, count: recipe.outputCount },
    };
  }

  if (recipeType === 'crafting_shapeless') {
    const ingredients = (recipe.inputs ?? []).map((input) => ({ item: input.item }));
    return {
      ...base,
      ingredients,
      result: { id: recipe.output, count: recipe.outputCount },
    };
  }

  if (
    recipeType === 'smelting' ||
    recipeType === 'blasting' ||
    recipeType === 'smoking' ||
    recipeType === 'campfire_cooking'
  ) {
    const firstInput = (recipe.inputs ?? [])[0];
    return {
      ...base,
      ingredient: { item: firstInput?.item ?? 'minecraft:cobblestone' },
      result: recipe.output,
      experience: recipe.experience ?? 0.0,
      cookingtime: recipe.cookTime ?? 200,
    };
  }

  if (recipeType === 'stonecutting') {
    const firstInput = (recipe.inputs ?? [])[0];
    return {
      ...base,
      ingredient: { item: firstInput?.item ?? 'minecraft:stone' },
      result: { id: recipe.output, count: recipe.outputCount },
    };
  }

  // Custom recipe type: fall back to generic structure
  return {
    ...base,
    result: { id: recipe.output, count: recipe.outputCount },
  };
}

/**
 * Generate recipe JSON files (datapack format)
 * Generate data/${modId}/recipes/${recipeId}.json files for Fabric/NeoForge datapack loading
 */
export function fabricModRecipeJson(spec: ModSpecLike, pkg: string) {
  return (spec.recipes ?? []).map((recipe) => {
    const recipeJson = generateRecipeJson(spec, recipe);
    return {
      path: `src/main/resources/data/${spec.modId}/recipes/${recipe.recipeId}.json`,
      content: JSON.stringify(recipeJson, null, 2),
    };
  });
}
