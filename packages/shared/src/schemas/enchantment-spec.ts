import { z } from 'zod';

/**
 * 附魔效果定义（1.21+ 数据驱动附魔）。
 *
 * type 为常见效果的语义化类型，生成器负责映射为 1.21 的
 * enchantment effect JSON（minecraft:damage / minecraft:knockback 等效果组）。
 * 需要更复杂的行为时可用 extra 透传原始字段，或用 customEffects 直接给 JSON。
 */
export const DataEnchantmentEffectSpec = z.object({
  type: z.enum([
    'damage_bonus', // 额外伤害（可指定目标：亡灵 / 节肢 / 灾厄）
    'mob_experience', // 击杀生物额外经验
    'loot_bonus', // 额外战利品（需要 extra.lootTable 指定战利品表）
    'knockback', // 击退等级
    'burning_time', // 点燃攻击目标（火焰附加）
    'healing', // 攻击时治疗自身（吸血）
    'attribute', // 属性加成（extra.attribute 指定属性，默认 movement_speed）
  ]),
  /** 每级数值（线性增长）；damage_bonus 的起始值可用 extra.base 覆盖 */
  amount: z.number().default(1),
  /** damage_bonus 的目标类型 */
  target: z.enum(['all', 'undead', 'arthropods', 'illagers']).default('all'),
  /** 透传的原始字段（合并进生成的效果 JSON，可覆盖默认值） */
  extra: z.record(z.unknown()).default({}),
});

/** 单个附魔定义 */
export const DataEnchantmentEntrySpec = z.object({
  /** 附魔 ID（小写，不含命名空间） */
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名称（自动生成语言文件条目 enchantment.<ns>.<id>） */
  name: z.string(),
  /** 描述（自动生成语言文件条目 enchantment.<ns>.<id>.desc） */
  description: z.string().default(''),
  /** 最大等级 */
  maxLevel: z.number().int().min(1).max(10).default(5),
  /** 限定物品：minecraft:xxx 或 #minecraft:enchantable/xxx；空数组由生成器兜底 */
  supportedItems: z.array(z.string()).default([]),
  /** 生效栏位 */
  slots: z.array(z.enum(['mainhand', 'offhand', 'armor', 'any'])).default(['any']),
  /** 抽取权重（1-1023） */
  weight: z.number().int().min(1).max(1023).default(10),
  /** 附魔台等级成本曲线（min_cost） */
  minCostBase: z.number().int().min(1).default(5),
  minCostPerLevel: z.number().int().default(8),
  /** 附魔台等级成本曲线（max_cost） */
  maxCostBase: z.number().int().min(1).default(9),
  maxCostPerLevel: z.number().int().default(8),
  /** 铁砧附加成本 */
  anvilCost: z.number().int().min(1).default(1),
  /** 互斥集合 tag（如 "#minecraft:exclusive_set/damage"），空字符串不输出 */
  exclusiveSet: z.string().default(''),
  /** 语义化效果列表 */
  effects: z.array(DataEnchantmentEffectSpec).default([]),
  /**
   * 原始效果 JSON：每个元素形如 { group: "minecraft:damage", effect: {...} }，
   * 会追加到对应效果组；组必须是合法的 1.21 效果组名（minecraft:damage 等）。
   */
  customEffects: z
    .array(
      z.object({
        group: z.string(),
        effect: z.record(z.unknown()),
      }),
    )
    .default([]),
});

/** DataEnchantmentSpec：1.21+ 数据驱动附魔包规格 */
export const DataEnchantmentSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  /** 数据包 pack_format（默认 61 = 1.21.1），生成时会按 MC 版本自动校正 */
  packFormat: z.number().int().default(61),
  enchantments: z.array(DataEnchantmentEntrySpec).default([]),
  /**
   * 语言条目：{ [langCode]: { [key]: value } }。
   * 每个附魔的 name / description 会自动生成条目，此处可覆盖。
   */
  lang: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

export type DataEnchantmentSpec = z.infer<typeof DataEnchantmentSpec>;
export type DataEnchantmentEntrySpec = z.infer<typeof DataEnchantmentEntrySpec>;
export type DataEnchantmentEffectSpec = z.infer<typeof DataEnchantmentEffectSpec>;
