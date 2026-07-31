/**
 * MC 常用配方预设：工具/盔甲/食物/矿物压缩等常见配方模板。
 * 用于快速创建 Mod 物品的合成配方。
 */

export interface RecipePreset {
  /** 预设名称 */
  name: string;
  /** 配方类型 */
  type: string;
  /** 描述 */
  description: string;
  /** 预设配方模板（用 {material} / {modId} 作占位符） */
  template: Record<string, unknown>;
}

/** 工具配方预设（合成台有形） */
export const TOOL_RECIPE_PRESETS: RecipePreset[] = [
  {
    name: '镐',
    type: 'crafting_shaped',
    description: '三材料 + 二木棍',
    template: {
      pattern: ['MMM', ' S ', ' S '],
      key: { M: '{material}', S: 'minecraft:stick' },
      result: '{modId}:{material_name}_pickaxe',
    },
  },
  {
    name: '斧',
    type: 'crafting_shaped',
    description: '二材料 + 二木棍',
    template: {
      pattern: ['MM', 'MS', ' S'],
      key: { M: '{material}', S: 'minecraft:stick' },
      result: '{modId}:{material_name}_axe',
    },
  },
  {
    name: '锹',
    type: 'crafting_shaped',
    description: '一材料 + 二木棍',
    template: {
      pattern: ['M', 'S', 'S'],
      key: { M: '{material}', S: 'minecraft:stick' },
      result: '{modId}:{material_name}_shovel',
    },
  },
  {
    name: '锄',
    type: 'crafting_shaped',
    description: '二材料 + 二木棍',
    template: {
      pattern: ['MM', ' S', ' S'],
      key: { M: '{material}', S: 'minecraft:stick' },
      result: '{modId}:{material_name}_hoe',
    },
  },
  {
    name: '剑',
    type: 'crafting_shaped',
    description: '二材料 + 一木棍',
    template: {
      pattern: ['M', 'M', 'S'],
      key: { M: '{material}', S: 'minecraft:stick' },
      result: '{modId}:{material_name}_sword',
    },
  },
];

/** 盔甲配方预设 */
export const ARMOR_RECIPE_PRESETS: RecipePreset[] = [
  {
    name: '头盔',
    type: 'crafting_shaped',
    description: '5 材料排列',
    template: {
      pattern: ['MMM', 'M M'],
      // 注：key 值为数组（与 RecipeSpec.key 的 z.record(z.string(), z.array(z.string())) 对齐）
      key: { M: ['{material}'] },
      result: '{modId}:{material_name}_helmet',
    },
  },
  {
    name: '胸甲',
    type: 'crafting_shaped',
    description: '8 材料排列',
    template: {
      pattern: ['M M', 'MMM', 'MMM'],
      // 注：key 值为数组（与 RecipeSpec.key 的 z.record(z.string(), z.array(z.string())) 对齐）
      key: { M: ['{material}'] },
      result: '{modId}:{material_name}_chestplate',
    },
  },
  {
    name: '护腿',
    type: 'crafting_shaped',
    description: '7 材料排列',
    template: {
      pattern: ['MMM', 'M M', 'M M'],
      // 注：key 值为数组（与 RecipeSpec.key 的 z.record(z.string(), z.array(z.string())) 对齐）
      key: { M: ['{material}'] },
      result: '{modId}:{material_name}_leggings',
    },
  },
  {
    name: '靴子',
    type: 'crafting_shaped',
    description: '4 材料排列',
    template: {
      pattern: ['M M', 'M M'],
      // 注：key 值为数组（与 RecipeSpec.key 的 z.record(z.string(), z.array(z.string())) 对齐）
      key: { M: ['{material}'] },
      result: '{modId}:{material_name}_boots',
    },
  },
];

/** 矿物处理预设（熔炼/高炉/烟熏） */
export const SMELTING_RECIPE_PRESETS: RecipePreset[] = [
  {
    name: '矿石→锭（熔炼）',
    type: 'smelting',
    description: '矿石熔炼为锭',
    template: { ingredient: '{ore}', result: '{ingot}', experience: 1.0, cookingTime: 200 },
  },
  {
    name: '矿石→锭（高炉）',
    type: 'blasting',
    description: '矿石高炉炼锭（2x 速度）',
    template: { ingredient: '{ore}', result: '{ingot}', experience: 1.0, cookingTime: 100 },
  },
  {
    name: '原矿→锭（熔炼）',
    type: 'smelting',
    description: '原矿熔炼为锭',
    template: { ingredient: '{raw_ore}', result: '{ingot}', experience: 0.7, cookingTime: 200 },
  },
  {
    name: '食物（烟熏）',
    type: 'smoking',
    description: '生食烟熏为熟食',
    template: {
      ingredient: '{raw_food}',
      result: '{cooked_food}',
      experience: 0.35,
      cookingTime: 100,
    },
  },
  {
    name: '食物（营火）',
    type: 'campfire_cooking',
    description: '生食营火慢烤',
    template: {
      ingredient: '{raw_food}',
      result: '{cooked_food}',
      experience: 0.35,
      cookingTime: 600,
    },
  },
];

/** 存储方块预设（9x 压缩/解压） */
export const STORAGE_RECIPE_PRESETS: RecipePreset[] = [
  {
    name: '9 锭→方块',
    type: 'crafting_shaped',
    description: '9 个锭压缩为存储方块',
    template: {
      pattern: ['MMM', 'MMM', 'MMM'],
      // 注：key 值为数组（与 RecipeSpec.key 的 z.record(z.string(), z.array(z.string())) 对齐）
      key: { M: ['{ingot}'] },
      result: '{storage_block}',
    },
  },
  {
    name: '方块→9 锭',
    type: 'crafting_shapeless',
    description: '存储方块解压为 9 个锭',
    template: { ingredients: ['{storage_block}'], result: '{ingot}', count: 9 },
  },
];

/** 所有配方预设 */
export const ALL_RECIPE_PRESETS: RecipePreset[] = [
  ...TOOL_RECIPE_PRESETS,
  ...ARMOR_RECIPE_PRESETS,
  ...SMELTING_RECIPE_PRESETS,
  ...STORAGE_RECIPE_PRESETS,
];
