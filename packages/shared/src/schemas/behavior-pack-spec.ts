import { z } from 'zod';

/** 行为包实体行为定义 */
export const BpEntitySpec = z.object({
  identifier: z.string(), // namespace:entity_id
  components: z.record(z.unknown()).default({}),
  events: z.record(z.unknown()).default({}),
  description_groups: z.array(z.string()).default([]),
});

/** 行为包配方 */
export const BpRecipeSpec = z.object({
  identifier: z.string(), // namespace:recipe_id
  type: z.enum(['shaped_crafting', 'shapeless_crafting', 'furnace']),
  result: z.string(), // 产物物品 ID
  count: z.number().int().min(1).default(1),
  // shaped 配方用
  pattern: z.array(z.string()).optional(),
  key: z.record(z.string(), z.array(z.string())).optional(),
  // shapeless 配方用
  items: z.array(z.string()).optional(),
});

/** 行为包战利品表条目 */
export const BpLootEntrySpec = z.object({
  type: z.string().default('item'), // item / loot_table / empty
  name: z.string(),
  weight: z.number().int().min(1).default(1),
  count: z.number().int().min(1).default(1),
});

/** 行为包战利品池 */
export const BpLootPoolSpec = z.object({
  rolls: z.number().int().min(1).default(1),
  entries: z.array(BpLootEntrySpec).default([]),
});

/** 行为包战利品表 */
export const BpLootTableSpec = z.object({
  path: z.string(), // 如 entities/zombie 或 chests/village
  pools: z.array(BpLootPoolSpec).default([]),
});

/** BehaviorPackSpec：基岩版行为包规格 */
export const BehaviorPackSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  packFormat: z.number().int().default(2), // 基岩版 manifest format_version 默认 2
  mcVersion: z.array(z.number().int()).default([1, 0, 0]),
  header: z
    .object({
      name: z.string().optional(),
      description: z.string().optional(),
      uuid: z.string().optional(),
      version: z.array(z.number().int()).optional(),
      min_engine_version: z.array(z.number().int()).optional(),
    })
    .default({}),
  dependencies: z
    .array(
      z.object({
        uuid: z.string(),
        version: z.array(z.number().int()),
      }),
    )
    .default([]),
  entities: z.array(BpEntitySpec).default([]),
  recipes: z.array(BpRecipeSpec).default([]),
  lootTables: z.array(BpLootTableSpec).default([]),
});

export type BehaviorPackSpec = z.infer<typeof BehaviorPackSpec>;
export type BpEntitySpec = z.infer<typeof BpEntitySpec>;
export type BpRecipeSpec = z.infer<typeof BpRecipeSpec>;
export type BpLootTableSpec = z.infer<typeof BpLootTableSpec>;
export type BpLootPoolSpec = z.infer<typeof BpLootPoolSpec>;
export type BpLootEntrySpec = z.infer<typeof BpLootEntrySpec>;
