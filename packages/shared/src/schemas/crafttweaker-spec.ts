import { z } from 'zod';

/** CraftTweaker 配方类型（与 KubeJS 对齐：shaped/shapeless/smelting/stonecutting/custom） */
export const CraftTweakerRecipeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum(['shaped', 'shapeless', 'smelting', 'stonecutting', 'custom']).default('shaped'),
  result: z.string(), // 产物物品 ID，如 minecraft:diamond
  count: z.number().int().min(1).default(1),
  // shaped 配方用：pattern（如 ['III','III','III']）
  pattern: z.array(z.string()).optional(),
  // shaped 配方用：键映射（如 { I: ['minecraft:iron_ingot'] }）
  key: z.record(z.string(), z.array(z.string())).optional(),
  // shapeless/smelting/stonecutting 配方用
  ingredients: z.array(z.string()).optional(),
  // 自定义配方的 ZenScript 调用代码（type 为 custom 时使用）
  customCode: z.string().optional(),
});

/** CraftTweaker 标签 */
export const CraftTweakerTagSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum(['item', 'block', 'entity_type', 'fluid']).default('item'),
  values: z.array(z.string()).default([]),
  replace: z.boolean().default(false),
});

/** CraftTweaker 事件处理（handler 是 ZenScript 代码字符串） */
export const CraftTweakerEventSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  // 事件类型，如 block.right_click / player.logged_in / player.logged_out / entity.died / tick
  type: z.string(),
  // 关联的目标 ID（可选，如 'minecraft:stone'、'minecraft:overworld'，仅作为注释保留）
  target: z.string().default(''),
  // 事件处理 ZenScript 代码（作为字符串嵌入到事件回调中）
  handler: z.string(),
});

/** CraftTweaker 物品工具提示 */
export const CraftTweakerTooltipSpec = z.object({
  // 物品 ID，如 minecraft:diamond
  itemId: z.string(),
  // 显示的多行文本
  lines: z.array(z.string()).default([]),
  // 是否为高级提示（仅在调试时显示）
  advanced: z.boolean().default(false),
});

/** CraftTweaker 语言文件（按语言代码 → 键值对） */
export const CraftTweakerLangSpec = z
  .record(z.string(), z.record(z.string(), z.string()))
  .default({});

/**
 * CraftTweakerSpec：CraftTweaker 脚本生成规格。
 *
 * 注意：暂不支持自定义注册表（CraftTweaker 注册表语法复杂，需要单独模块支持）。
 */
export const CraftTweakerSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  packFormat: z.number().int().default(48), // 1.21.x
  mcVersion: z.string().default('1.21.1'),
  recipes: z.array(CraftTweakerRecipeSpec).default([]),
  tags: z.array(CraftTweakerTagSpec).default([]),
  events: z.array(CraftTweakerEventSpec).default([]),
  tooltips: z.array(CraftTweakerTooltipSpec).default([]),
  lang: CraftTweakerLangSpec,
});

export type CraftTweakerRecipeSpec = z.infer<typeof CraftTweakerRecipeSpec>;
export type CraftTweakerTagSpec = z.infer<typeof CraftTweakerTagSpec>;
export type CraftTweakerEventSpec = z.infer<typeof CraftTweakerEventSpec>;
export type CraftTweakerTooltipSpec = z.infer<typeof CraftTweakerTooltipSpec>;
export type CraftTweakerLangSpec = z.infer<typeof CraftTweakerLangSpec>;
export type CraftTweakerSpec = z.infer<typeof CraftTweakerSpec>;
