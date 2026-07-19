import { z } from 'zod';

// === 物品相关 ===

/** 物品食物属性 */
export const FoodSpec = z.object({
  hunger: z.number().int().min(0).max(20),
  saturation: z.number().min(0).default(0.6),
  /** 食物效果（可多个） */
  effects: z
    .array(
      z.object({
        effectId: z.string(), // 如 'minecraft:speed'
        duration: z.number().int().min(0).default(200), // 持续 tick
        amplifier: z.number().int().min(0).default(0), // 等级（0=I）
        probability: z.number().min(0).max(1).default(1.0), // 概率
      }),
    )
    .default([]),
  canAlwaysEat: z.boolean().default(false), // 饱满时也能吃
});

/** 物品属性修饰符（通用属性系统） */
export const AttributeModifierSpec = z.object({
  attribute: z.enum([
    'generic.max_health',
    'generic.knockback_resistance',
    'generic.movement_speed',
    'generic.attack_damage',
    'generic.attack_speed',
    'generic.armor',
    'generic.armor_toughness',
    'generic.luck',
    'generic.max_absorption',
    'generic.follow_range',
    'generic.spawn_reinforcements_chance',
    'generic.flying_speed',
    'generic.attack_knockback',
  ]),
  operation: z.enum(['add_value', 'add_multiplied_base', 'add_multiplied_total']),
  value: z.number(),
  slot: z.enum(['mainhand', 'offhand', 'head', 'chest', 'legs', 'feet', 'any']).default('any'),
});

/** 物品附魔定义 */
export const EnchantmentSpec = z.object({
  enchantmentId: z.string(), // 如 'minecraft:sharpness'
  level: z.number().int().min(1),
});

/** 物品条目（loader 无关） */
export const ItemSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), // 小写下划线
  name: z.string(), // 显示名
  maxStackSize: z.number().int().min(1).max(64).default(64),
  // 基础属性
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic']).default('common'),
  maxDamage: z.number().int().min(0).default(0), // 0 表示不可损坏
  fuelTick: z.number().int().min(0).default(0), // 燃料燃烧 tick 数（0 = 非燃料）
  food: FoodSpec.optional(), // 不填表示非食物
  lore: z.string().default(''), // 物品说明（tooltips）
  // 新增：属性修饰符
  attributes: z.array(AttributeModifierSpec).default([]),
  // 新增：默认附魔
  defaultEnchantments: z.array(EnchantmentSpec).default([]),
  // 新增：物品分类/标签
  itemCategory: z
    .enum([
      'sword',
      'pickaxe',
      'axe',
      'shovel',
      'hoe', // 工具
      'helmet',
      'chestplate',
      'leggings',
      'boots', // 防具
      'food',
      'potion',
      'bow',
      'crossbow',
      'trident', // 其他
      'misc', // 杂项
    ])
    .default('misc'),
  // 新增：创造模式标签页（MC 1.19.3+ 标准分类，与 itemCategory 互补）
  creativeTab: z
    .enum([
      'building_blocks',
      'colored_blocks',
      'natural_blocks',
      'functional_blocks',
      'redstone_blocks',
      'tools',
      'combat',
      'food_and_drinks',
      'ingredients',
      'spawn_eggs',
      'op',
      'inventory',
    ])
    .default('inventory'),
  // 新增：自定义模型数据（resource_pack 联动）
  customModelData: z.number().int().optional(),
  // 新增：纹理路径覆盖
  texturePath: z.string().optional(),
});

// === 方块相关 ===

/** 方块状态属性定义 */
export const BlockStatePropertySpec = z.object({
  name: z.string(), // 如 'facing', 'powered', 'half'
  type: z.enum(['bool', 'int', 'enum']),
  values: z.array(z.string()).default([]), // enum 类型的可选值
  defaultValue: z.string().default(''), // 默认值
  min: z.number().int().optional(), // int 类型的最小值
  max: z.number().int().optional(), // int 类型的最大值
});

/** 方块碰撞体积定义 */
export const AABBShapeSpec = z.object({
  minX: z.number().min(0).max(16).default(0),
  minY: z.number().min(0).max(16).default(0),
  minZ: z.number().min(0).max(16).default(0),
  maxX: z.number().min(0).max(16).default(16),
  maxY: z.number().min(0).max(16).default(16),
  maxZ: z.number().min(0).max(16).default(16),
});

/** 方块条目 */
export const BlockSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  material: z
    .enum([
      'wood',
      'stone',
      'metal',
      'rock',
      'cloth',
      'plant',
      'sand',
      'glass',
      'ice',
      'water',
      'lava',
    ])
    .default('wood'),
  hardness: z.number().min(0).default(1.5),
  // 基础属性
  miningLevel: z.number().int().min(0).max(10).default(0), // 挖掘等级
  lightLevel: z.number().int().min(0).max(15).default(0), // 发光等级
  resistance: z.number().min(0).default(6.0), // 爆炸抗性
  soundType: z
    .enum(['wood', 'stone', 'metal', 'grass', 'sand', 'glass', 'cloth', 'ladder', 'anvil', 'slime'])
    .default('stone'),
  dropSelf: z.boolean().default(true), // false 时掉落其他物品
  dropItem: z.string().default(''), // dropSelf=false 时掉落的物品 id
  // 新增：方块状态属性
  stateProperties: z.array(BlockStatePropertySpec).default([]),
  // 新增：碰撞体积（可多个，如台阶的上半部分）
  collisionShapes: z.array(AABBShapeSpec).default([]),
  // 新增：方块行为类型
  blockType: z
    .enum([
      'full_block',
      'slab',
      'stairs',
      'fence',
      'fence_gate',
      'wall',
      'door',
      'trapdoor',
      'button',
      'pressure_plate',
      'lever',
      'sign',
      'bed',
      'chest',
      'piston',
      'torch',
      'custom',
    ])
    .default('full_block'),
  // 新增：是否透明/可穿越
  transparent: z.boolean().default(false),
  noCollision: z.boolean().default(false),
  // 新增：纹理路径覆盖（6面）
  texturePath: z.string().optional(), // 单一纹理
  texturePaths: z
    .object({
      top: z.string().optional(),
      bottom: z.string().optional(),
      north: z.string().optional(),
      south: z.string().optional(),
      east: z.string().optional(),
      west: z.string().optional(),
    })
    .optional(), // 多面纹理
});

// === 依赖 ===

/** Mod 依赖条目 */
export const ModDependencySpec = z.object({
  modId: z.string(),
  version: z.string().default(''),
  mandatory: z.boolean().default(true),
});

// === 战利品/进度/配方（顶层 Spec 可选字段） ===

/** 战利品表条目（简化版，ModSpec 专用） */
export const ModLootTableSpec = z
  .object({
    id: z.string(), // 命名空间:路径
    type: z.enum(['block', 'entity', 'chest', 'generic', 'empty']).default('generic'),
    pools: z
      .array(
        z.object({
          rolls: z.number().int().min(1).default(1),
          entries: z
            .array(
              z.object({
                item: z.string(),
                weight: z.number().int().min(1).default(1),
                countMin: z.number().int().min(0).default(1),
                countMax: z.number().int().min(0).default(1),
              }),
            )
            .default([]),
        }),
      )
      .default([]),
  })
  .default({ id: '', type: 'generic', pools: [] });

/** 进度/成就条目（简化版，ModSpec 专用） */
export const ModAdvancementSpec = z
  .object({
    id: z.string(),
    parent: z.string().optional(),
    display: z
      .object({
        title: z.string(),
        description: z.string(),
        icon: z.string(), // 物品 id
        frame: z.enum(['task', 'challenge', 'goal']).default('task'),
        showToast: z.boolean().default(true),
        announceToChat: z.boolean().default(true),
      })
      .optional(),
    criteria: z
      .array(
        z.object({
          name: z.string(),
          trigger: z.string(), // 如 'minecraft:inventory_changed'
          conditions: z.record(z.unknown()).default({}),
        }),
      )
      .default([]),
  })
  .default({ id: '', criteria: [] });

/** ModSpec：loader 无关的结构化规格 */
export const ModSpec = z.object({
  modId: z.string().regex(/^[a-z0-9_]+$/),
  version: z.string().default('1.0.0'),
  name: z.string(),
  description: z.string().default(''),
  items: z.array(ItemSpec).default([]),
  blocks: z.array(BlockSpec).default([]),
  // 顶层属性
  license: z.string().default('MIT'),
  authors: z.array(z.string()).default([]),
  credits: z.string().default(''),
  dependencies: z.array(ModDependencySpec).default([]),
  website: z.string().default(''),
  // 新增：战利品表
  lootTables: z.array(ModLootTableSpec).default([]),
  // 新增：进度/成就
  advancements: z.array(ModAdvancementSpec).default([]),
  // 新增：自定义标签
  tags: z
    .array(
      z.object({
        id: z.string(), // 如 'minecraft:planks'
        replace: z.boolean().default(false),
        values: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  // 新增：自定义函数（mcfunction）
  functions: z
    .array(
      z.object({
        id: z.string(), // 如 'teleport_home'
        commands: z.array(z.string()).default([]), // 每行一条命令
      }),
    )
    .default([]),
});

export type ModSpec = z.infer<typeof ModSpec>;
export type ItemSpec = z.infer<typeof ItemSpec>;
export type BlockSpec = z.infer<typeof BlockSpec>;
export type FoodSpec = z.infer<typeof FoodSpec>;
export type ModDependencySpec = z.infer<typeof ModDependencySpec>;
export type AttributeModifierSpec = z.infer<typeof AttributeModifierSpec>;
export type EnchantmentSpec = z.infer<typeof EnchantmentSpec>;
export type BlockStatePropertySpec = z.infer<typeof BlockStatePropertySpec>;
export type AABBShapeSpec = z.infer<typeof AABBShapeSpec>;
export type ModLootTableSpec = z.infer<typeof ModLootTableSpec>;
export type ModAdvancementSpec = z.infer<typeof ModAdvancementSpec>;
