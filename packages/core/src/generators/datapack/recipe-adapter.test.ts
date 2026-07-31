import { describe, it, expect } from 'vitest';
import { modRecipeToDatapackRecipe, isModRecipe } from './recipe-adapter.js';
import { ModRecipeSpec, RecipeSpec } from '@mc-creator/shared';

describe('modRecipeToDatapackRecipe', () => {
  // ===== 基础字段映射 =====

  it('recipeId → id、output → result、outputCount → count', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'iron_to_diamond',
        recipeType: 'crafting_shapeless',
        inputs: [{ item: 'minecraft:iron_ingot', count: 1, slot: '' }],
        output: 'minecraft:diamond',
        outputCount: 4,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(result.id).toBe('iron_to_diamond');
    expect(result.result).toBe('minecraft:diamond');
    expect(result.count).toBe(4);
  });

  it('cookTime → cookingTime、experience → experience', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'smelt_iron',
        recipeType: 'smelting',
        inputs: [{ item: 'minecraft:raw_iron', count: 1, slot: '' }],
        output: 'minecraft:iron_ingot',
        outputCount: 1,
        cookTime: 150,
        experience: 0.7,
        pattern: [],
      }),
    );
    expect(result.cookingTime).toBe(150);
    expect(result.experience).toBe(0.7);
  });

  it('type 字段直接映射（枚举值兼容）', () => {
    for (const t of [
      'crafting_shaped',
      'crafting_shapeless',
      'smelting',
      'blasting',
      'smoking',
      'stonecutting',
    ] as const) {
      const result = modRecipeToDatapackRecipe(
        ModRecipeSpec.parse({
          recipeId: `test_${t}`,
          recipeType: t,
          inputs: [],
          output: 'minecraft:stone',
          outputCount: 1,
          cookTime: 200,
          experience: 0,
          pattern: [],
        }),
      );
      expect(result.type).toBe(t);
    }
  });

  // ===== crafting_shapeless =====

  it('crafting_shapeless：inputs → ingredients，pattern 忽略', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'shapeless_mix',
        recipeType: 'crafting_shapeless',
        inputs: [
          { item: 'minecraft:iron_ingot', count: 1, slot: '' },
          { item: 'minecraft:stick', count: 1, slot: '' },
          { item: 'minecraft:redstone', count: 1, slot: '' },
        ],
        output: 'minecraft:compass',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: ['AB'], // shapeless 应忽略 pattern
      }),
    );
    expect(result.ingredients).toEqual([
      'minecraft:iron_ingot',
      'minecraft:stick',
      'minecraft:redstone',
    ]);
    // pattern 字段不应被设置
    expect(result.pattern).toBeUndefined();
    expect(result.key).toBeUndefined();
    expect(result.ingredient).toBeUndefined();
  });

  // ===== crafting_shaped =====

  it('crafting_shaped：pattern + inputs → pattern + key（slot 作为键）', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'shaped_pickaxe',
        recipeType: 'crafting_shaped',
        inputs: [
          { item: 'minecraft:diamond', count: 3, slot: 'D' },
          { item: 'minecraft:stick', count: 2, slot: 'S' },
        ],
        output: 'minecraft:diamond_pickaxe',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: ['DDD', ' S ', ' S '],
      }),
    );
    expect(result.pattern).toEqual(['DDD', ' S ', ' S ']);
    expect(result.key).toEqual({
      D: ['minecraft:diamond'],
      S: ['minecraft:stick'],
    });
    // shapeless 字段不应被设置
    expect(result.ingredients).toBeUndefined();
    expect(result.ingredient).toBeUndefined();
  });

  it('crafting_shaped：slot 为空的 input 跳过（不参与 key 映射）', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'shaped_skip_empty_slot',
        recipeType: 'crafting_shaped',
        inputs: [
          { item: 'minecraft:diamond', count: 1, slot: 'D' },
          { item: 'minecraft:stick', count: 1, slot: '' }, // 空 slot 跳过
          { item: 'minecraft:emerald', count: 1, slot: '   ' }, // 空白 slot 跳过
        ],
        output: 'minecraft:diamond_block',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: ['D'],
      }),
    );
    expect(result.key).toEqual({ D: ['minecraft:diamond'] });
    expect(Object.keys(result.key!)).toHaveLength(1);
  });

  // ===== smelting / blasting / smoking =====

  it('smelting：第一个 input → ingredient，cookTime → cookingTime', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'smelt_iron_ingot',
        recipeType: 'smelting',
        inputs: [
          { item: 'minecraft:raw_iron', count: 1, slot: '' },
          { item: 'minecraft:coal', count: 1, slot: '' }, // 应忽略
        ],
        output: 'minecraft:iron_ingot',
        outputCount: 1,
        cookTime: 200,
        experience: 0.7,
        pattern: [],
      }),
    );
    expect(result.ingredient).toBe('minecraft:raw_iron');
    expect(result.cookingTime).toBe(200);
    expect(result.experience).toBe(0.7);
    expect(result.source).toBeUndefined();
  });

  it('blasting：第一个 input → ingredient', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'blast_gold',
        recipeType: 'blasting',
        inputs: [{ item: 'minecraft:raw_gold', count: 1, slot: '' }],
        output: 'minecraft:gold_ingot',
        outputCount: 1,
        cookTime: 100,
        experience: 1.0,
        pattern: [],
      }),
    );
    expect(result.ingredient).toBe('minecraft:raw_gold');
    expect(result.cookingTime).toBe(100);
  });

  it('smoking：第一个 input → ingredient', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'smoke_beef',
        recipeType: 'smoking',
        inputs: [{ item: 'minecraft:beef', count: 1, slot: '' }],
        output: 'minecraft:cooked_beef',
        outputCount: 1,
        cookTime: 100,
        experience: 0.35,
        pattern: [],
      }),
    );
    expect(result.ingredient).toBe('minecraft:beef');
    expect(result.cookingTime).toBe(100);
  });

  // ===== stonecutting =====

  it('stonecutting：第一个 input → source', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'cut_stone_bricks',
        recipeType: 'stonecutting',
        inputs: [{ item: 'minecraft:stone', count: 1, slot: '' }],
        output: 'minecraft:stone_brick_stairs',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(result.source).toBe('minecraft:stone');
    expect(result.ingredient).toBeUndefined();
    expect(result.ingredients).toBeUndefined();
  });

  // ===== P41：新增 4 种配方类型 =====

  it('P41: campfire_cooking 第一个 input → ingredient', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'camp_beef',
        recipeType: 'campfire_cooking',
        inputs: [{ item: 'minecraft:beef', count: 1, slot: '' }],
        output: 'minecraft:cooked_beef',
        outputCount: 1,
        cookTime: 600,
        experience: 0.35,
        pattern: [],
      }),
    );
    expect(result.type).toBe('campfire_cooking');
    expect(result.ingredient).toBe('minecraft:beef');
    expect(result.cookingTime).toBe(600);
    expect(result.experience).toBe(0.35);
  });

  it('P41: smithing_transform 前三个 input → template/base/addition，缺省回退字段', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'smith_netherite',
        recipeType: 'smithing_transform',
        inputs: [
          { item: 'minecraft:netherite_upgrade_smithing_template', count: 1, slot: '' },
          { item: 'minecraft:diamond_sword', count: 1, slot: '' },
          { item: 'minecraft:netherite_ingot', count: 1, slot: '' },
        ],
        output: 'minecraft:netherite_sword',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(result.template).toBe('minecraft:netherite_upgrade_smithing_template');
    expect(result.base).toBe('minecraft:diamond_sword');
    expect(result.addition).toBe('minecraft:netherite_ingot');
  });

  it('P41: smithing_transform 空 inputs 时用 ModRecipeSpec 默认字段', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'smith_default',
        recipeType: 'smithing_transform',
        inputs: [],
        output: 'minecraft:netherite_sword',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: 'minecraft:diamond_sword',
        addition: 'minecraft:netherite_ingot',
      }),
    );
    expect(result.template).toBe('minecraft:netherite_upgrade_smithing_template');
    expect(result.base).toBe('minecraft:diamond_sword');
    expect(result.addition).toBe('minecraft:netherite_ingot');
  });

  it('P41: smithing_trim 同样映射 template/base/addition', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'trim_armor',
        recipeType: 'smithing_trim',
        inputs: [
          { item: 'minecraft:coast_armor_trim_smithing_template', count: 1, slot: '' },
          { item: 'minecraft:diamond_helmet', count: 1, slot: '' },
          { item: 'minecraft:emerald', count: 1, slot: '' },
        ],
        output: 'minecraft:diamond_helmet',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(result.template).toBe('minecraft:coast_armor_trim_smithing_template');
    expect(result.base).toBe('minecraft:diamond_helmet');
    expect(result.addition).toBe('minecraft:emerald');
  });

  it('P41: brewing inputs[0] → ingredientItem，药水字段直通', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'brew_awkward',
        recipeType: 'brewing',
        inputs: [{ item: 'minecraft:nether_wart', count: 1, slot: '' }],
        output: 'minecraft:awkward_potion',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
        inputPotion: 'minecraft:water',
        ingredientItem: 'minecraft:nether_wart',
        outputPotion: 'minecraft:awkward_potion',
      }),
    );
    expect(result.ingredientItem).toBe('minecraft:nether_wart');
    expect(result.inputPotion).toBe('minecraft:water');
    expect(result.outputPotion).toBe('minecraft:awkward_potion');
  });

  // ===== 空 inputs 边界情况 =====

  it('空 inputs 时各 recipeType 不报错（生成最小有效结构）', () => {
    // crafting_shapeless
    const shapelessEmpty = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'empty_shapeless',
        recipeType: 'crafting_shapeless',
        inputs: [],
        output: 'minecraft:air',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(shapelessEmpty.ingredients).toEqual([]);

    // crafting_shaped
    const shapedEmpty = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'empty_shaped',
        recipeType: 'crafting_shaped',
        inputs: [],
        output: 'minecraft:air',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(shapedEmpty.pattern).toEqual([]);
    expect(shapedEmpty.key).toEqual({});

    // smelting
    const smeltingEmpty = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'empty_smelting',
        recipeType: 'smelting',
        inputs: [],
        output: 'minecraft:air',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(smeltingEmpty.ingredient).toBe('');

    // stonecutting
    const stonecuttingEmpty = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'empty_stonecutting',
        recipeType: 'stonecutting',
        inputs: [],
        output: 'minecraft:air',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(stonecuttingEmpty.source).toBe('');
  });

  // ===== showNotification / 默认字段 =====

  it('showNotification 默认为 true', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'default_show_notif',
        recipeType: 'crafting_shapeless',
        inputs: [],
        output: 'minecraft:dirt',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      }),
    );
    expect(result.showNotification).toBe(true);
  });

  it('condition/group/template/base/addition 等字段不在转换中设置', () => {
    const result = modRecipeToDatapackRecipe(
      ModRecipeSpec.parse({
        recipeId: 'no_extra_fields',
        recipeType: 'crafting_shaped',
        inputs: [{ item: 'minecraft:stone', count: 1, slot: 'A' }],
        output: 'minecraft:stone_bricks',
        outputCount: 4,
        cookTime: 200,
        experience: 0,
        pattern: ['A'],
      }),
    );
    // 这些字段在 RecipeSpec 中是可选的，转换函数不主动设置
    expect(result.condition).toBeUndefined();
    expect(result.group).toBeUndefined();
    expect(result.template).toBeUndefined();
    expect(result.base).toBeUndefined();
    expect(result.addition).toBeUndefined();
    expect(result.inputPotion).toBeUndefined();
    expect(result.ingredientItem).toBeUndefined();
    expect(result.outputPotion).toBeUndefined();
  });

  // ===== 通过 RecipeSpec schema 校验 =====

  it('转换结果能通过 RecipeSpec.parse 校验', () => {
    // 对所有支持的 recipeType 都验证输出符合 datapack RecipeSpec schema
    const cases: Array<{ recipeId: string; recipeType: string; inputs: any[]; pattern: string[] }> =
      [
        {
          recipeId: 'v_shapeless',
          recipeType: 'crafting_shapeless',
          inputs: [{ item: 'minecraft:iron_ingot', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_shaped',
          recipeType: 'crafting_shaped',
          inputs: [{ item: 'minecraft:diamond', count: 1, slot: 'D' }],
          pattern: ['D'],
        },
        {
          recipeId: 'v_smelting',
          recipeType: 'smelting',
          inputs: [{ item: 'minecraft:raw_iron', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_blasting',
          recipeType: 'blasting',
          inputs: [{ item: 'minecraft:raw_copper', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_smoking',
          recipeType: 'smoking',
          inputs: [{ item: 'minecraft:potato', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_stonecutting',
          recipeType: 'stonecutting',
          inputs: [{ item: 'minecraft:stone', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_campfire',
          recipeType: 'campfire_cooking',
          inputs: [{ item: 'minecraft:beef', count: 1, slot: '' }],
          pattern: [],
        },
        {
          recipeId: 'v_smithing_transform',
          recipeType: 'smithing_transform',
          inputs: [
            { item: 'minecraft:netherite_upgrade_smithing_template', count: 1, slot: '' },
            { item: 'minecraft:diamond_sword', count: 1, slot: '' },
            { item: 'minecraft:netherite_ingot', count: 1, slot: '' },
          ],
          pattern: [],
        },
        {
          recipeId: 'v_smithing_trim',
          recipeType: 'smithing_trim',
          inputs: [
            { item: 'minecraft:coast_armor_trim_smithing_template', count: 1, slot: '' },
            { item: 'minecraft:diamond_helmet', count: 1, slot: '' },
            { item: 'minecraft:emerald', count: 1, slot: '' },
          ],
          pattern: [],
        },
        {
          recipeId: 'v_brewing',
          recipeType: 'brewing',
          inputs: [{ item: 'minecraft:nether_wart', count: 1, slot: '' }],
          pattern: [],
        },
      ];

    for (const c of cases) {
      const modRecipe = ModRecipeSpec.parse({
        recipeId: c.recipeId,
        recipeType: c.recipeType as any,
        inputs: c.inputs,
        output: 'minecraft:output',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: c.pattern,
      });
      const datapackRecipe = modRecipeToDatapackRecipe(modRecipe);
      // 不抛错即视为通过
      expect(() => RecipeSpec.parse(datapackRecipe)).not.toThrow();
    }
  });
});

describe('isModRecipe', () => {
  it('对含 recipeId 字段的对象返回 true', () => {
    const modRecipe = {
      recipeId: 'foo',
      recipeType: 'crafting_shaped',
      inputs: [],
      output: 'minecraft:stone',
      outputCount: 1,
      cookTime: 200,
      experience: 0,
      pattern: [],
    };
    expect(isModRecipe(modRecipe)).toBe(true);
  });

  it('对 datapack RecipeSpec（含 id 而非 recipeId）返回 false', () => {
    const datapackRecipe = RecipeSpec.parse({
      id: 'foo',
      type: 'crafting_shaped',
      result: 'minecraft:stone',
      count: 1,
      pattern: [],
      key: {},
    });
    expect(isModRecipe(datapackRecipe)).toBe(false);
  });

  it('对 null / undefined / 非对象返回 false', () => {
    expect(isModRecipe(null)).toBe(false);
    expect(isModRecipe(undefined)).toBe(false);
    expect(isModRecipe('string')).toBe(false);
    expect(isModRecipe(42)).toBe(false);
    expect(isModRecipe({})).toBe(false);
  });
});
