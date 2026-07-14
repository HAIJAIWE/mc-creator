import { z } from 'zod';

/** 配方类型 */
export const RecipeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum(['crafting_shaped', 'crafting_shapeless', 'smelting', 'stonecutting']),
  result: z.string(),           // 产物物品 ID，如 minecraft:diamond
  count: z.number().int().min(1).default(1),
  // shaped 配方用
  pattern: z.array(z.string()).optional(),
  key: z.record(z.string(), z.array(z.string())).optional(),
  // shapeless 配方用
  ingredients: z.array(z.string()).optional(),
});

/** 标签 */
export const TagSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum(['item', 'block', 'entity_type', 'fluid', 'function']),
  values: z.array(z.string()),
  replace: z.boolean().default(false),
});

/** 函数（mcfunction） */
export const FunctionSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  commands: z.array(z.string()),
});

/** 进度 */
export const AdvancementSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  title: z.string(),
  description: z.string(),
  icon: z.string(),           // 物品 ID
  trigger: z.string(),        // 触发器，如 minecraft:inventory_changed
  conditions: z.string().optional(), // 条件 JSON 字符串
});

/** 战利品表条目 */
export const LootEntrySpec = z.object({
  name: z.string(),
  weight: z.number().int().min(1).default(1),
  count: z.number().int().min(1).default(1),
});

/** 战利品池 */
export const LootPoolSpec = z.object({
  rolls: z.number().int().min(1).default(1),
  entries: z.array(LootEntrySpec).default([]),
});

/** 战利品表（P10 新增） */
export const LootTableSpec = z.object({
  namespace: z.string().default('minecraft'),
  path: z.string(),
  type: z.enum(['block', 'entity', 'chest', 'fishing']).default('block'),
  pools: z.array(LootPoolSpec).default([]),
});

/** 谓词（P10 新增） */
export const PredicateSpec = z.object({
  namespace: z.string().default('minecraft'),
  path: z.string(),
  condition: z.string(),
});

/** 简易标签条目（itemTags / blockTags 共用结构，P10 新增） */
export const SimpleTagSpec = z.object({
  namespace: z.string().default('minecraft'),
  tag: z.string(),
  values: z.array(z.string()).default([]),
  replace: z.boolean().default(false),
});

/** DatapackSpec：loader 无关的数据包规格 */
export const DatapackSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  packFormat: z.number().int().default(48), // 1.21.11
  recipes: z.array(RecipeSpec).default([]),
  tags: z.array(TagSpec).default([]),
  functions: z.array(FunctionSpec).default([]),
  advancements: z.array(AdvancementSpec).default([]),
  // P10 新增字段（向后兼容：均带 default）
  lootTables: z.array(LootTableSpec).default([]),
  predicates: z.array(PredicateSpec).default([]),
  itemTags: z.array(SimpleTagSpec).default([]),
  blockTags: z.array(SimpleTagSpec).default([]),
});

export type DatapackSpec = z.infer<typeof DatapackSpec>;
export type RecipeSpec = z.infer<typeof RecipeSpec>;
export type TagSpec = z.infer<typeof TagSpec>;
export type FunctionSpec = z.infer<typeof FunctionSpec>;
export type AdvancementSpec = z.infer<typeof AdvancementSpec>;
export type LootTableSpec = z.infer<typeof LootTableSpec>;
export type LootPoolSpec = z.infer<typeof LootPoolSpec>;
export type LootEntrySpec = z.infer<typeof LootEntrySpec>;
export type PredicateSpec = z.infer<typeof PredicateSpec>;
export type SimpleTagSpec = z.infer<typeof SimpleTagSpec>;
