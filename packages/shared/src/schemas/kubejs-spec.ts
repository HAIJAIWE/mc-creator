import { z } from 'zod';

/** KubeJS 配方类型（P36 增强：blasting/smoking 高炉/烟熏炉） */
export const KubejsRecipeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z
    .enum(['shaped', 'shapeless', 'smelting', 'blasting', 'smoking', 'stonecutting', 'custom'])
    .default('shaped'),
  result: z.string(), // 产物物品 ID，如 minecraft:diamond
  count: z.number().int().min(1).default(1),
  // P36：烧炼类配方经验值（smelting/blasting/smoking 用）
  experience: z.number().min(0).optional(),
  // P36：烧炼类配方时长 tick（smelting/blasting/smoking 用）
  cookingTime: z.number().int().min(1).optional(),
  // shaped 配方用：pattern（如 ['III','III','III']）
  pattern: z.array(z.string()).optional(),
  // shaped 配方用：键映射（如 { I: ['minecraft:iron_ingot'] }）
  key: z.record(z.string(), z.array(z.string())).optional(),
  // shapeless/smelting/stonecutting 配方用
  ingredients: z.array(z.string()).optional(),
  // 自定义配方的 KubeJS 调用代码（type 为 custom 时使用）
  customCode: z.string().optional(),
});

/** KubeJS 标签 */
export const KubejsTagSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum(['item', 'block', 'entity_type', 'fluid', 'function']).default('item'),
  values: z.array(z.string()).default([]),
  replace: z.boolean().default(false),
});

/** KubeJS 事件处理（handler 是 JavaScript 代码字符串） */
export const KubejsEventSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  // 事件类型，如 block.right_click / player.logged_in / block.break / entity.died / tick
  type: z.string(),
  // 关联的目标 ID（可选，如 'minecraft:stone'、'minecraft:overworld'）
  target: z.string().default(''),
  // 事件处理 JavaScript 代码（作为字符串嵌入到生成脚本中）
  handler: z.string(),
});

/** KubeJS 物品工具提示 */
export const KubejsTooltipSpec = z.object({
  // 物品 ID，如 minecraft:diamond
  itemId: z.string(),
  // 显示的多行文本
  lines: z.array(z.string()).default([]),
  // 是否为高级提示（仅在调试时显示）
  advanced: z.boolean().default(false),
});

/** KubeJS 语言文件（按语言代码 → 键值对） */
export const KubejsLangSpec = z.record(z.string(), z.record(z.string(), z.string())).default({});

/** KubeJS 自定义注册表条目 */
export const KubejsRegistrySpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  // 注册表类型，如 item / block / sound / fluid
  type: z.enum(['item', 'block', 'sound', 'fluid']).default('item'),
  // 注册的具体条目 ID 列表（如 ['ruby', 'ruby_ore']）
  items: z.array(z.string()).default([]),
  // 注册的具体方块 ID 列表（type 为 block 时使用）
  blocks: z.array(z.string()).default([]),
  // 可选：自定义注册代码片段
  customCode: z.string().optional(),
});

/** KubejsSpec：KubeJS 脚本生成规格 */
export const KubejsSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  packFormat: z.number().int().default(48), // 1.21.x
  // S-9 修复：默认 MC 版本与 DEFAULT_MC_VERSION ('1.21.11') 对齐
  mcVersion: z.string().default('1.21.11'),
  recipes: z.array(KubejsRecipeSpec).default([]),
  tags: z.array(KubejsTagSpec).default([]),
  events: z.array(KubejsEventSpec).default([]),
  tooltips: z.array(KubejsTooltipSpec).default([]),
  lang: KubejsLangSpec,
  registry: z.array(KubejsRegistrySpec).default([]),
});

export type KubejsRecipeSpec = z.infer<typeof KubejsRecipeSpec>;
export type KubejsTagSpec = z.infer<typeof KubejsTagSpec>;
export type KubejsEventSpec = z.infer<typeof KubejsEventSpec>;
export type KubejsTooltipSpec = z.infer<typeof KubejsTooltipSpec>;
export type KubejsLangSpec = z.infer<typeof KubejsLangSpec>;
export type KubejsRegistrySpec = z.infer<typeof KubejsRegistrySpec>;
export type KubejsSpec = z.infer<typeof KubejsSpec>;
