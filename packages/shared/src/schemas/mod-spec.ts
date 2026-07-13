import { z } from 'zod';

/** 物品条目（loader 无关） */
export const ItemSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), // 小写下划线
  name: z.string(),                       // 显示名
  maxStackSize: z.number().int().min(1).max(64).default(64),
});

/** 方块条目 */
export const BlockSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  material: z.enum(['wood', 'stone', 'metal', 'rock']).default('wood'),
  hardness: z.number().min(0).default(1.5),
});

/** ModSpec：loader 无关的结构化规格（规格 §3.3） */
export const ModSpec = z.object({
  modId: z.string().regex(/^[a-z0-9_]+$/),
  version: z.string().default('1.0.0'),
  name: z.string(),
  description: z.string().default(''),
  items: z.array(ItemSpec).default([]),
  blocks: z.array(BlockSpec).default([]),
});

export type ModSpec = z.infer<typeof ModSpec>;
export type ItemSpec = z.infer<typeof ItemSpec>;
export type BlockSpec = z.infer<typeof BlockSpec>;
