import { z } from 'zod';

/** 配方类型（扩展版：覆盖所有原版配方类型） */
export const RecipeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  type: z.enum([
    'crafting_shaped',
    'crafting_shapeless', // 合成台
    'smelting',
    'blasting',
    'smoking',
    'campfire_cooking', // 熔炉/高炉/烟熏炉/营火
    'stonecutting', // 切石机
    'smithing_transform',
    'smithing_trim', // 锻造台（1.20+）
    'brewing', // 酿造台
  ]),
  result: z.string(), // 产物物品 ID，如 minecraft:diamond
  count: z.number().int().min(1).default(1),
  // shaped 配方用
  pattern: z.array(z.string()).optional(),
  key: z.record(z.string(), z.array(z.string())).optional(),
  // shapeless 配方用
  ingredients: z.array(z.string()).optional(),
  // 热处理配方通用字段（smelting/blasting/smoking/campfire_cooking）
  ingredient: z.string().optional(), // 输入物品 ID
  experience: z.number().min(0).default(0), // 经验值
  cookingTime: z.number().int().min(1).default(200), // 烹饪时间（tick）
  // stonecutting 用
  source: z.string().optional(), // 切石机输入
  // smithing_transform 用
  template: z.string().optional(), // 锻造模板 ID
  base: z.string().optional(), // 基础物品 ID
  addition: z.string().optional(), // 添加物品 ID
  // brewing 用
  inputPotion: z.string().optional(), // 酿造输入药水
  ingredientItem: z.string().optional(), // 酿造材料物品
  outputPotion: z.string().optional(), // 酿造输出药水
  // 条件配方 + 配方书
  condition: z.string().optional(), // 条件 JSON（如 {"type":"minecraft:recipe_unlocked","recipe":"my_mod:has_recipe"}），配方需满足此条件才生效
  group: z.string().optional(), // 配方书分组（同组配方在配方书中合并显示，如 "minecraft:wooden_tools"）
  showNotification: z.boolean().default(true), // 解锁时是否显示通知弹窗
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
  icon: z.string(), // 物品 ID
  trigger: z.string(), // 触发器，如 minecraft:inventory_changed
  conditions: z.string().optional(), // 条件 JSON 字符串
  /** P1 dogfood：父进度路径（如 "minecraft:story/root"），用于进度树 */
  parent: z.string().optional(),
  /** P1 dogfood：进度框架类型（task/challenge/goal） */
  frame: z.enum(['task', 'challenge', 'goal']).default('task').optional(),
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

// ===== 世界生成（维度/维度类型/生物群系/噪声设置）=====

/** 维度类型：定义维度的物理属性 */
export const DimensionTypeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 固定时间（如 1000 永昼，0 永夜）,-1 表示跟随太阳 */
  fixedTime: z.number().nullable().default(null),
  /** 是否有天空光 */
  hasSkyLight: z.boolean().default(true),
  /** 是否有天花板（如地狱） */
  hasCeiling: z.boolean().default(false),
  /** 是否超薄（如末地） */
  ultraWarm: z.boolean().default(false),
  /** 是否自然加载（村庄/要塞等） */
  natural: z.boolean().default(true),
  /** 坐标缩放（如地狱 8.0） */
  coordinateScale: z.number().default(1.0),
  /** 床是否可使用（地狱/末地不可） */
  bedWorks: z.boolean().default(true),
  /** 重生锚是否可用 */
  respawnAnchorWorks: z.boolean().default(false),
  /** 最小 Y 坐标 */
  minY: z.number().int().default(-64),
  /** 高度 */
  height: z.number().int().default(384),
  /** 逻辑高度（活塞/传送限制） */
  logicalHeight: z.number().int().default(384),
  /** 是否生成侵染石 */
  infiniburn: z.string().default('#minecraft:infiniburn_overworld'),
  /** 水蒸发效果 */
  effects: z.enum(['overworld', 'the_nether', 'the_end', 'none']).default('overworld'),
  /** 传颂光（ambient_light）0-1 */
  ambientLight: z.number().min(0).max(1).default(0),
  /** 按猪灵交易规则 */
  piglinSafe: z.boolean().default(false),
});

/** 生物群系定义 */
export const BiomeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 降雪/降雨 */
  precipitation: z.enum(['none', 'rain', 'snow']).default('rain'),
  /** 温度（0-2，>0.15 有降雨，<=0.15 有降雪） */
  temperature: z.number().default(0.5),
  /** 温度修改器 */
  temperatureModifier: z.enum(['none', 'frozen']).default('none'),
  /** 降雨概率 0-1 */
  downfall: z.number().min(0).max(1).default(0.5),
  /** 天空颜色（0xRRGGBB） */
  skyColor: z.number().int().default(7907327),
  /** 水颜色 */
  waterColor: z.number().int().default(4159204),
  /** 水雾颜色 */
  waterFogColor: z.number().int().default(329011),
  /** 草颜色 */
  grassColor: z.number().int().optional(),
  /** 树叶颜色 */
  foliageColor: z.number().int().optional(),
  /** 雾颜色 */
  fogColor: z.number().int().default(12638463),
  /** 表面建筑者类型 */
  surfaceBuilder: z.string().default('minecraft:grass'),
});

/** 噪声设置（世界生成参数） */
export const NoiseSettingsSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 最小 Y */
  minY: z.number().int().default(-64),
  /** 高度 */
  height: z.number().int().default(384),
  /** 噪声大小水平 */
  noiseSizeHorizontal: z.number().int().min(1).default(1),
  /** 噪声大小垂直 */
  noiseSizeVertical: z.number().int().min(1).default(2),
  /** 密度函数（JSON 字符串） */
  densityFunction: z.string().default('minecraft:overworld'),
  /** 起源点偏移 */
  noiseRouter: z.string().optional(),
});

/** 维度定义：指定维度类型+生成器+生物群系 */
export const DimensionSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 维度类型 ID（引用 DimensionTypeSpec.id 或原版） */
  dimensionType: z.string().default('minecraft:overworld'),
  /** 生成器类型 */
  generatorType: z.enum(['noise', 'flat', 'debug', 'void']).default('noise'),
  /** 生成器生物群系源类型 */
  biomeSource: z.enum(['fixed', 'multi_noise', 'checkerboard', 'the_end']).default('multi_noise'),
  /** 生物群系列表（用于 biomeSource） */
  biomes: z.array(z.string()).default(['minecraft:plains']),
  /** 噪声设置 ID（noise 生成器用） */
  noiseSettings: z.string().default('minecraft:overworld'),
  /** 扁平世界层（flat 生成器用） */
  flatLayers: z
    .array(
      z.object({
        /** 方块 ID */
        block: z.string(),
        /** 层高度 */
        height: z.number().int().min(1).default(1),
      }),
    )
    .default([]),
  /** 多噪声生物群系参数（multi_noise 用，定义每个生物群系的温度/湿度/大陆度/侵蚀噪声点） */
  multiNoiseParams: z
    .array(
      z.object({
        /** 生物群系 ID */
        biome: z.string(),
        /** 温度偏移 */
        temperature: z.number().default(0),
        /** 湿度偏移 */
        humidity: z.number().default(0),
        /** 大陆度偏移 */
        continentalness: z.number().default(0),
        /** 侵蚀偏移 */
        erosion: z.number().default(0),
        /** 奇异性（weirdness）偏移 */
        weirdness: z.number().default(0),
        /** 偏移量（距离权重） */
        offset: z.number().default(0),
      }),
    )
    .optional(),
});

// ===== 自定义附魔（data/<namespace>/enchantment/<id>.json，1.21+） =====

export const DatapackEnchantmentSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 附魔描述 */
  description: z.string(),
  /** 最小等级 */
  minLevel: z.number().int().min(1).default(1),
  /** 最大等级 */
  maxLevel: z.number().int().min(1).default(3),
  /** 最小消耗（anvil_cost） */
  anvilCost: z.number().int().min(0).default(1),
  /** 附魔槽位 */
  slots: z
    .array(
      z.enum([
        'any',
        'mainhand',
        'offhand',
        'hand',
        'feet',
        'legs',
        'chest',
        'head',
        'armor',
        'body',
      ]),
    )
    .default(['any']),
  /** 支持的物品标签（如 #minecraft:enchantable/sword） */
  supportedItems: z.string().default('#minecraft:enchantable/sword'),
  /** 附魔权重（稀有度越低权重越低） */
  weight: z.number().int().min(1).default(10),
  /** 最大消耗（max_cost = min_cost * maxLevel 近似） */
  maxCost: z.number().int().min(0).default(5),
  /** 是否为诅咒附魔 */
  isCurse: z.boolean().default(false),
  /** 是否为宝藏附魔（无法从附魔台获得） */
  isTreasure: z.boolean().default(false),
});

// ===== 自定义状态效果（data/<namespace>/effect/<id>.json，1.21+） =====

export const StatusEffectSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 效果描述 */
  description: z.string(),
  /** 颜色（0xRRGGBB） */
  color: z.number().int().default(0xffffff),
  /** 是否为即时效果 */
  instant: z.boolean().default(false),
  /** 是否为有益效果 */
  beneficial: z.boolean().default(true),
});

// ===== 自定义损伤类型（data/<namespace>/damage_type/<id>.json，1.19.4+） =====

export const DamageTypeSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 消息类型：控制死亡消息格式 */
  messageType: z
    .enum([
      'default', // "<player> died"
      'player', // "<player> was slain by <entity>"
      'player_attack', // "<player> was slain by <entity> using <item>"
      'fall', // 变体：高度差显示
      'intentional_game_design', // "intentional game design"（虚空）
    ])
    .default('default'),
  /** 缩放因子（饥饿=0, 普通=1.0, 困难=1.0 等） */
  scaling: z
    .enum(['never', 'when_caused_by_living_non_player', 'always'])
    .default('when_caused_by_living_non_player'),
  /** 疲劳影响（是否消耗玩家饥饿值） */
  exhaustion: z.number().min(0).default(0),
});

// ===== 自定义结构（data/<namespace>/worldgen/structure/<id>.json） =====

export const StructureSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 结构集 ID（引用 worldgen/structure_set） */
  structureSet: z.string().optional(),
  /** 模板池 ID（jigsaw 用） */
  templatePool: z.string().default('minecraft:empty'),
  /** 放置类型 */
  placementType: z.enum(['jigsaw', 'random_spread', 'concentric_rings']).default('jigsaw'),
  /** 最大距离（jigsaw） */
  maxDistance: z.number().int().min(1).default(7),
  /** 生成范围 */
  size: z.number().int().min(1).default(7),
  /** 开始高度（JSON 字符串，如 {"type":"minecraft:uniform","min":{"absolute":0},"max":{"absolute":63}}） */
  startHeight: z
    .string()
    .default('{"type":"minecraft:uniform","min":{"absolute":0},"max":{"absolute":63}}'),
  /** 生物群系标签 */
  biomes: z.string().default('#minecraft:is_overworld'),
  /** 步长（terrain_adaptation） */
  step: z.enum(['none', 'beard', 'beard_thin', 'encapsulate']).default('none'),
  /** 使用扩展距离 */
  useExpansionHack: z.boolean().default(false),
});

// ===== 自定义粒子（data/<namespace>/particle/<id>.json） =====

export const ParticleSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 粒子描述（用于翻译 key） */
  description: z.string(),
  /** 是否覆盖原版粒子 */
  override: z.boolean().default(false),
});

// ===== 盔甲纹饰（data/<namespace>/trim_pattern/<id>.json + trim_material/<id>.json，1.20+） =====

export const TrimPatternSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 模板物品 ID（如 minecraft:coast_armor_trim_smithing_template） */
  templateItem: z.string(),
  /** 纹饰描述 key */
  description: z.string(),
  /** 是否解码（资源包中是否有对应纹理） */
  decal: z.boolean().default(false),
});

export const TrimMaterialSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 材质物品 ID（如 minecraft:amethyst_shard） */
  materialItem: z.string(),
  /** 材质颜色（0xRRGGBB） */
  color: z.string().default('#9B5BEC'),
  /** 材质描述 key */
  description: z.string(),
});

// ===== 乐器定义（data/<namespace>/instrument/<id>.json，1.19+山羊角） =====

export const InstrumentSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 音效事件 */
  soundEvent: z.string().default('minecraft:block.note_block.horn'),
  /** 使用持续时间（tick） */
  useDuration: z.number().int().min(1).default(100),
  /** 范围（方块距离） */
  range: z.number().min(1).default(256),
  /** 描述 */
  description: z.string().default(''),
});

// ===== 结构集（data/<namespace>/worldgen/structure_set/<id>.json）=====

/** 结构集放置类型 */
export const StructureSetPlacementSpec = z.object({
  /** 放置类型 */
  type: z
    .enum(['minecraft:random_spread', 'minecraft:concentric_rings', 'minecraft:gaussian'])
    .default('minecraft:random_spread'),
  /** 间距（方块） */
  spacing: z.number().int().min(1).default(32),
  /** 分离度（方块） */
  separation: z.number().int().min(0).default(8),
  /** 盐值（随机种子偏移） */
  salt: z.number().int().min(0).default(0),
  /** 频率（0–1，结构出现的概率，1.21.5+） */
  frequency: z.number().min(0).max(1).optional(),
  /** 频率修改器（1.21.5+） */
  frequencyModifier: z.enum(['minecraft:beards', 'minecraft:buried', 'minecraft:rigid']).optional(),
});

/** 结构集引用 */
export const StructureSetEntrySpec = z.object({
  /** 结构 ID（引用 worldgen/structure） */
  structure: z.string(),
  /** 权重（多结构时决定选取概率） */
  weight: z.number().int().min(1).default(1),
});

/** 结构集：定义结构在世界中的放置规则 */
export const StructureSetSpec = z.object({
  id: z.string().regex(/^[a-z0-9_/]+$/),
  /** 结构引用列表 */
  structures: z.array(StructureSetEntrySpec).default([]),
  /** 放置规则 */
  placement: StructureSetPlacementSpec,
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
  // 世界生成
  dimensions: z.array(DimensionSpec).default([]),
  dimensionTypes: z.array(DimensionTypeSpec).default([]),
  biomes: z.array(BiomeSpec).default([]),
  noiseSettings: z.array(NoiseSettingsSpec).default([]),
  // 自定义附魔（1.21+）
  enchantments: z.array(DatapackEnchantmentSpec).default([]),
  // 自定义状态效果（1.21+）
  effects: z.array(StatusEffectSpec).default([]),
  // 自定义损伤类型（1.19.4+）
  damageTypes: z.array(DamageTypeSpec).default([]),
  // 自定义结构（worldgen/structure）
  structures: z.array(StructureSpec).default([]),
  // 自定义粒子
  particles: z.array(ParticleSpec).default([]),
  // 盔甲纹饰（1.20+）
  trimPatterns: z.array(TrimPatternSpec).default([]),
  trimMaterials: z.array(TrimMaterialSpec).default([]),
  // 乐器定义（1.19+）
  instruments: z.array(InstrumentSpec).default([]),
  // 结构集（1.16.2+）
  structureSets: z.array(StructureSetSpec).default([]),
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
export type DimensionTypeSpec = z.infer<typeof DimensionTypeSpec>;
export type BiomeSpec = z.infer<typeof BiomeSpec>;
export type NoiseSettingsSpec = z.infer<typeof NoiseSettingsSpec>;
export type DimensionSpec = z.infer<typeof DimensionSpec>;
export type DatapackEnchantmentSpec = z.infer<typeof DatapackEnchantmentSpec>;
export type StatusEffectSpec = z.infer<typeof StatusEffectSpec>;
export type DamageTypeSpec = z.infer<typeof DamageTypeSpec>;
export type StructureSpec = z.infer<typeof StructureSpec>;
export type ParticleSpec = z.infer<typeof ParticleSpec>;
export type TrimPatternSpec = z.infer<typeof TrimPatternSpec>;
export type TrimMaterialSpec = z.infer<typeof TrimMaterialSpec>;
export type InstrumentSpec = z.infer<typeof InstrumentSpec>;
export type StructureSetSpec = z.infer<typeof StructureSetSpec>;
export type StructureSetPlacementSpec = z.infer<typeof StructureSetPlacementSpec>;
export type StructureSetEntrySpec = z.infer<typeof StructureSetEntrySpec>;
