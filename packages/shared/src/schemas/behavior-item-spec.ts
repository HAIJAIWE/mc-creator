import { z } from 'zod';

/**
 * 行为包自定义物品定义（基岩版 1.21.0+ 数据驱动）。
 *
 * 支持盔甲 / 工具 / 武器 / 普通物品四类，数值组件由生成器映射为
 * minecraft:damage / minecraft:armor / minecraft:tool 等组件。
 */
export const BpItemEntrySpec = z.object({
  /** 物品 ID（小写，不含命名空间） */
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名称（自动生成语言条目） */
  name: z.string(),
  /** 分类（创造模式物品栏分组） */
  category: z.enum(['equipment', 'tools', 'weapons', 'items']).default('equipment'),
  /** 最大堆叠数 */
  maxStackSize: z.number().int().min(1).max(64).default(1),
  /** 耐久度（0 表示不可损坏） */
  durability: z.number().int().min(0).default(0),
  /** 攻击伤害（武器/工具） */
  attackDamage: z.number().min(0).default(0),
  /** 攻击速度（武器） */
  attackSpeed: z.number().min(0).default(0),
  /**
   * 盔甲数值：{ protection: 防护值, slot: 穿戴栏位 }。
   * 提供后自动附加 minecraft:armor + minecraft:wearable 组件。
   */
  armor: z
    .object({
      protection: z.number().min(0).default(0),
      slot: z.enum(['head', 'chest', 'legs', 'feet']).default('chest'),
    })
    .optional(),
  /**
   * 工具规则：挖掘等级与效率。
   * level 对应材质等级（1=木/金, 2=石, 3=铁, 4=钻石, 5=下界合金）。
   */
  tool: z
    .object({
      level: z.number().int().min(1).max(5).default(1),
      efficiency: z.number().min(0).default(2),
      /** 适用方块标签（默认通用挖掘标签） */
      tags: z
        .array(z.string())
        .default([
          'minecraft:is_pickaxe',
          'minecraft:is_hoe',
          'minecraft:is_shovel',
          'minecraft:is_axe',
        ]),
    })
    .optional(),
  /** 附魔能力值（0-15，越高越容易获得高等级附魔） */
  enchantable: z.number().int().min(0).max(15).default(0),
  /** 是否显示附魔光泽（发光效果） */
  foils: z.boolean().default(false),
  /** 贴图基色（#RRGGBB），自动生成 16x16 物品纹理 PNG */
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#7f8c8d'),
  /** 贴图辅色（渐晕/描边），默认取基色加深 */
  secondaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** 原始组件 JSON，追加到 minecraft:item 的 components */
  customComponents: z.array(z.record(z.unknown())).default([]),
});

/** BehaviorItemSpec：基岩版行为包自定义物品规格 */
export const BehaviorItemSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  description: z.string().default(''),
  /** 基岩版 format_version（默认 2 = 经典 manifest） */
  packFormat: z.number().int().default(2),
  /** 基岩版引擎版本（min_engine_version） */
  mcVersion: z.array(z.number().int()).default([1, 21, 0]),
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
  items: z.array(BpItemEntrySpec).default([]),
  lang: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

export type BehaviorItemSpec = z.infer<typeof BehaviorItemSpec>;
export type BpItemEntrySpec = z.infer<typeof BpItemEntrySpec>;
