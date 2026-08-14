import { z } from 'zod';

/** 实体 AI 行为目标（对应 minecraft:behavior.<type> 组件） */
export const BpGoalSpec = z.object({
  type: z.enum([
    'melee', // 近战攻击（minecraft:behavior.melee_attack）
    'ranged', // 远程射箭（minecraft:behavior.ranged_attack + shooter）
    'idle_wander', // 随机游荡（random_stroll）
    'look_at_player', // 注视玩家（look_at_player）
    'flee_sun', // 逃离太阳（flee_sun）
    'swim', // 浮水/游泳（float）
    'follow_owner', // 跟随主人（follow_owner）
    'panic', // 恐慌逃跑（panic）
  ]),
  /** 行为优先级（0-10，数值越大越晚执行） */
  priority: z.number().int().min(0).max(10).default(3),
  /** 速度倍率 */
  speedMultiplier: z.number().default(1),
  /** 远程攻击射程（ranged 用） */
  attackRange: z.number().optional(),
  /** 攻击间隔（秒，ranged 用） */
  attackInterval: z.number().optional(),
  /** 透传原始字段（合并进行为组件） */
  extra: z.record(z.unknown()).optional(),
});

/** 实体掉落物 */
export const BpDropSpec = z.object({
  /** 物品 ID（如 minecraft:bone） */
  item: z.string(),
  /** 掉落数量 */
  count: z.number().int().min(1).default(1),
  /** 掉落概率（0-1） */
  chance: z.number().min(0).max(1).default(1),
});

/** 行为包自定义实体定义 */
export const BpCustomEntitySpec = z.object({
  /** 实体 ID（小写，不含命名空间） */
  id: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名称（自动生成语言条目） */
  name: z.string(),
  /** 生命值 */
  health: z.number().min(1).default(20),
  /** 攻击伤害（0 表示不攻击） */
  attackDamage: z.number().min(0).default(3),
  /** 移动速度 */
  movementSpeed: z.number().default(0.25),
  /** 击退抗性（0-1） */
  knockbackResistance: z.number().min(0).max(1).default(0),
  /** 是否免疫火焰 */
  fireImmune: z.boolean().default(false),
  /** 体型缩放（1 = 原版尺寸） */
  scale: z.number().default(1),
  /** 击杀经验 */
  xp: z.number().int().min(0).default(5),
  /** 远离玩家后是否自动消失 */
  despawn: z.boolean().default(true),
  /** 是否敌对（影响目标寻找与攻击行为） */
  hostile: z.boolean().default(true),
  /** 实体模型（client_entity 指向的基岩版内置几何） */
  geometry: z.enum(['creeper', 'zombie', 'skeleton', 'spider', 'blaze', 'slime']).default('zombie'),
  /** 贴图基色（自动生成 64x64 实体纹理 PNG） */
  mainColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#6f7a4f'),
  /** 贴图辅色（眼部/高光） */
  accentColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#d4ff00'),
  /** 生成蛋颜色（默认取主/辅色） */
  eggColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  /** AI 行为列表 */
  goals: z.array(BpGoalSpec).default([]),
  /** 敌对目标（基岩版 family 名称，如 player / villager） */
  targetTypes: z.array(z.string()).default(['player']),
  /** 掉落物 */
  drops: z.array(BpDropSpec).default([]),
  /** 原始组件 JSON，追加到行为实体 components */
  customComponents: z.array(z.record(z.unknown())).default([]),
  /** 原始事件 JSON，合并到行为实体 events */
  customEvents: z.record(z.unknown()).default({}),
});

/** BehaviorEntitySpec：基岩版行为包自定义实体（怪物 AI）规格 */
export const BehaviorEntitySpec = z.object({
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
  entities: z.array(BpCustomEntitySpec).default([]),
  lang: z.record(z.string(), z.record(z.string(), z.string())).default({}),
});

export type BehaviorEntitySpec = z.infer<typeof BehaviorEntitySpec>;
export type BpCustomEntitySpec = z.infer<typeof BpCustomEntitySpec>;
export type BpGoalSpec = z.infer<typeof BpGoalSpec>;
export type BpDropSpec = z.infer<typeof BpDropSpec>;
