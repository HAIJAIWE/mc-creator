import { z } from 'zod';

/** 物品食物属性（可选） */
export const FoodSpec = z.object({
  hunger: z.number().int().min(0).max(20),
  saturation: z.number().min(0).default(0.6),
});

/** Mod 依赖条目 */
export const ModDependencySpec = z.object({
  modId: z.string(),
  version: z.string().default(''),
  mandatory: z.boolean().default(true),
});

/** 物品条目（loader 无关） */
export const ItemSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), // 小写下划线
  name: z.string(), // 显示名
  maxStackSize: z.number().int().min(1).max(64).default(64),
  // P10 新增字段（向后兼容：均带 default）
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic']).default('common'),
  maxDamage: z.number().int().min(0).default(0), // 0 表示不可损坏
  fuelTick: z.number().int().min(0).default(0), // 燃料燃烧 tick 数（0 = 非燃料）
  food: FoodSpec.optional(), // 不填表示非食物
  lore: z.string().default(''), // 物品说明（tooltips）
});

/** 方块条目 */
export const BlockSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  material: z.enum(['wood', 'stone', 'metal', 'rock']).default('wood'),
  hardness: z.number().min(0).default(1.5),
  // P10 新增字段（向后兼容：均带 default）
  miningLevel: z.number().int().min(0).max(10).default(0), // 挖掘等级（0=木镐，1=石镐...）
  lightLevel: z.number().int().min(0).max(15).default(0), // 发光等级
  resistance: z.number().min(0).default(6.0), // 爆炸抗性
  soundType: z.enum(['wood', 'stone', 'metal', 'grass', 'sand', 'glass']).default('stone'),
  dropSelf: z.boolean().default(true), // false 时掉落其他物品
  dropItem: z.string().default(''), // dropSelf=false 时掉落的物品 id（如 'minecraft:stick'）
});

/** ModSpec：loader 无关的结构化规格（规格 §3.3） */
export const ModSpec = z.object({
  modId: z.string().regex(/^[a-z0-9_]+$/),
  version: z.string().default('1.0.0'),
  name: z.string(),
  description: z.string().default(''),
  items: z.array(ItemSpec).default([]),
  blocks: z.array(BlockSpec).default([]),
  // P10 新增顶层字段（向后兼容：均带 default）
  license: z.string().default('MIT'),
  authors: z.array(z.string()).default([]),
  credits: z.string().default(''),
  dependencies: z.array(ModDependencySpec).default([]),
  website: z.string().default(''),
});

export type ModSpec = z.infer<typeof ModSpec>;
export type ItemSpec = z.infer<typeof ItemSpec>;
export type BlockSpec = z.infer<typeof BlockSpec>;
export type FoodSpec = z.infer<typeof FoodSpec>;
export type ModDependencySpec = z.infer<typeof ModDependencySpec>;
