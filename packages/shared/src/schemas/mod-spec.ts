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

// === 配方/实体/机器（P1.3 新增，从节点图编译） ===
// 注意：datapack-spec.ts 已有名为 RecipeSpec 的 schema（vanilla 数据包 JSON 格式），
// 这里采用 ModRecipeSpec / ModRecipeInputSpec 前缀以避免命名冲突。
// 二者用途不同：ModRecipeSpec 是 loader 无关的抽象表示（由节点图编译而来），
// datapack 的 RecipeSpec 是 vanilla 数据包 JSON 输出格式（由 datapack-generator 输出）。

/** 配方输入物品条目（loader 无关） */
export const ModRecipeInputSpec = z.object({
  /** 物品 id（如 'minecraft:iron_ingot'） */
  item: z.string(),
  /** 数量 */
  count: z.number().int().min(1).default(1),
  /** 在 shaped 配方中的格子位置标记（如 'A'、'B'），shapeless 时留空 */
  slot: z.string().default(''),
});

/** 配方条目（loader 无关，由节点图编译而来） */
export const ModRecipeSpec = z.object({
  /** 配方 id（小写下划线） */
  recipeId: z.string().regex(/^[a-z0-9_]+$/),
  /** 配方类型 */
  recipeType: z
    .enum([
      'crafting_shaped',
      'crafting_shapeless',
      'smelting',
      'blasting',
      'smoking',
      'campfire_cooking',
      'stonecutting',
      'smithing_transform',
      'smithing_trim',
      'brewing',
    ])
    .default('crafting_shaped'),
  /** 输入物品列表 */
  inputs: z.array(ModRecipeInputSpec).default([]),
  /** 输出物品 id */
  output: z.string(),
  /** 输出数量 */
  outputCount: z.number().int().min(1).default(1),
  /** 烧炼时间（tick，仅烧炼类） */
  cookTime: z.number().int().min(1).default(200),
  /** 经验值（仅烧炼类） */
  experience: z.number().min(0).default(0),
  /** shaped 配方的形状（如 ['AB', 'BA']，最多 3 行） */
  pattern: z.array(z.string()).max(3).default([]),
  /** P41：smithing_transform 的升级模板物品 ID（如 minecraft:netherite_upgrade_smithing_template） */
  template: z.string().default('minecraft:netherite_upgrade_smithing_template'),
  /** P41：smithing_transform 的合成基座物品 ID（输出物品的原料） */
  base: z.string().default(''),
  /** P41：smithing_transform 的附加物品 ID */
  addition: z.string().default(''),
  /** P41：brewing 的输入药水 ID（如 minecraft:water） */
  inputPotion: z.string().default('minecraft:water'),
  /** P41：brewing 的酿造材料物品 ID */
  ingredientItem: z.string().default(''),
  /** P41：brewing 的输出药水 ID */
  outputPotion: z.string().default(''),
});

/** 实体/生物条目（loader 无关） */
export const EntitySpec = z.object({
  /** 实体 id（小写下划线） */
  entityId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 最大生命值 */
  maxHealth: z.number().min(1).default(20),
  /** 攻击伤害 */
  attackDamage: z.number().min(0).default(0),
  /** 移动速度 */
  movementSpeed: z.number().min(0).default(0.3),
  /** 阵营分类 */
  classification: z
    .enum(['animal', 'monster', 'water_creature', 'ambient', 'misc'])
    .default('misc'),
  /** 模型类型（vanilla 骨架或自定义） */
  modelType: z.enum(['pig', 'zombie', 'skeleton', 'creeper', 'cow', 'custom']).default('pig'),
  /** 生成权重（0 = 不自然生成） */
  spawnWeight: z.number().min(0).default(0),
  /** 生成群系（空数组 = 不限制） */
  spawnBiomes: z.array(z.string()).default([]),
  /** 贴图路径（相对 resources/） */
  texturePath: z.string().optional(),
});

/** 流体条目（loader 无关，水/熔岩风格流体 + 桶物品） */
export const FluidSpec = z.object({
  /** 流体 id（小写下划线） */
  fluidId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 流体颜色（0xRRGGBB，桶/材质用） */
  color: z.number().int().default(0x00aaff),
  /** 温度（水=300，熔岩=1300） */
  temperature: z.number().int().min(0).default(300),
  /** 黏度（水=1000，熔岩=6000） */
  viscosity: z.number().int().min(1).default(1000),
  /** 密度 */
  density: z.number().int().default(1000),
  /** 是否像熔岩一样发光 */
  luminous: z.boolean().default(false),
  /** 贴图路径（相对 resources/） */
  texturePath: z.string().optional(),
});

/** Mod 侧生物群系条目（对标 MCreator 生物群系：基础生成 + 天气 + 颜色 + 地表） */
export const ModBiomeSpec = z.object({
  /** 生物群系 id（小写下划线） */
  biomeId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 降水：none/rain/snow */
  precipitation: z.enum(['none', 'rain', 'snow']).default('rain'),
  /** 温度（-2~2，>0.15 下雨，<=0.15 下雪） */
  temperature: z.number().min(-2).max(2).default(0.5),
  /** 温度修饰：none/frozen */
  temperatureModifier: z.enum(['none', 'frozen']).default('none'),
  /** 降水量 0~1 */
  downfall: z.number().min(0).max(1).default(0.5),
  /** 天空颜色（0xRRGGBB） */
  skyColor: z.number().int().default(0x78a7ff),
  /** 水面颜色 */
  waterColor: z.number().int().default(0x3f76e4),
  /** 水雾颜色 */
  waterFogColor: z.number().int().default(0x050533),
  /** 草颜色（留空用默认） */
  grassColor: z.number().int().optional(),
  /** 树叶颜色（留空用默认） */
  foliageColor: z.number().int().optional(),
  /** 雾颜色 */
  fogColor: z.number().int().default(0xc0d8ff),
  /** 地表构建器（minecraft:grass/minecraft:stone/minecraft:snowy_grass 等） */
  surfaceBuilder: z.string().default('minecraft:grass'),
  /** 生物群系分类（用于 spawn 权重，如 plains/desert 风格） */
  category: z.string().default('plains'),
  /** 生成权重（0 = 不自然生成） */
  spawnWeight: z.number().int().min(0).default(10),
  /** 在哪些维度生成（overworld/the_nether/the_end） */
  spawnDimensions: z.array(z.string()).default(['minecraft:overworld']),
  /** 贴图路径（相对 resources/） */
  texturePath: z.string().optional(),
});

/** Mod 侧结构条目（对标 MCreator 结构：jigsaw 模板池 + 放置配置） */
export const ModStructureSpec = z.object({
  /** 结构 id（小写下划线） */
  structureId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 起始模板池 ID（如 modid:house/start_pool） */
  startPool: z.string(),
  /** 结构规模（jigsaw size） */
  size: z.number().int().min(1).default(7),
  /** 最大距中心距离 */
  maxDistance: z.number().int().min(1).default(80),
  /** 生物群系标签 */
  biomes: z.string().default('#minecraft:is_overworld'),
  /** 地形适应（terrain_adaptation） */
  terrainAdaptation: z.string().default('none'),
  /** 放置间距（chunk） */
  spacing: z.number().int().min(1).default(32),
  /** 放置间隔 */
  separation: z.number().int().min(0).default(8),
  /** 放置盐值 */
  salt: z.number().int().min(0).default(0),
});

/** GUI 槽位（对标 MCreator GUI 槽位） */
export const GuiSlotSpec = z.object({
  /** 槽位 id（小写下划线） */
  slotId: z.string().regex(/^[a-z0-9_]+$/),
  /** 槽位类型：input/output/energy/fuel */
  slotType: z.enum(['input', 'output', 'energy', 'fuel']).default('input'),
  /** 槽位 X 坐标（相对 GUI 左上） */
  x: z.number().int().min(0).default(0),
  /** 槽位 Y 坐标 */
  y: z.number().int().min(0).default(0),
});

/** GUI 界面条目（对标 MCreator GUI：容器 + 槽位布局） */
export const GuiSpec = z.object({
  /** GUI id（小写下划线，对应 menu/screen 类名） */
  guiId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** GUI 宽度（像素） */
  width: z.number().int().min(176).max(256).default(176),
  /** GUI 高度 */
  height: z.number().int().min(166).max(256).default(166),
  /** 槽位列表 */
  slots: z.array(GuiSlotSpec).default([]),
  /** 是否显示能源条 */
  showEnergyBar: z.boolean().default(false),
  /** 是否显示进度条 */
  showProgressBar: z.boolean().default(false),
});

/** Mod 侧维度条目（对标 MCreator 维度：维度类型 + 生成参数） */ export const ModDimensionSpec =
  z.object({
    /** 维度 id（小写下划线） */
    dimensionId: z.string().regex(/^[a-z0-9_]+$/),
    /** 显示名 */
    displayName: z.string(),
    /** 维度类型模板：overworld/nether/end（自定义参数覆盖） */
    baseType: z.enum(['overworld', 'nether', 'end']).default('overworld'),
    /** 固定时间（null = 正常昼夜，1000 = 正午，0 = 午夜，18000 = 黄昏） */
    fixedTime: z.number().nullable().default(null),
    /** 是否有天空光 */
    hasSkyLight: z.boolean().default(true),
    /** 是否有天花板 */
    hasCeiling: z.boolean().default(false),
    /** 超热（末地/下界风格，水蒸发） */
    ultrawarm: z.boolean().default(false),
    /** 自然（可睡/重生锚影响） */
    natural: z.boolean().default(true),
    /** 坐标缩放 */
    coordinateScale: z.number().default(1.0),
    /** 最小 Y */
    minY: z.number().int().default(-64),
    /** 高度 */
    height: z.number().int().default(384),
    /** 逻辑高度 */
    logicalHeight: z.number().int().default(384),
    /** 环境光（0~1） */
    ambientLight: z.number().min(0).max(1).default(0),
    /** 是否猪灵安全 */
    piglinSafe: z.boolean().default(false),
    /** 床是否可用 */
    bedWorks: z.boolean().default(true),
    /** 重生锚是否可用 */
    respawnAnchorWorks: z.boolean().default(false),
    /** 背景/效果（overworld/the_nether/the_end） */
    effects: z.enum(['overworld', 'the_nether', 'the_end', 'none']).default('overworld'),
    /** 维度种子（留空用世界种子） */
    seed: z.number().optional(),
    /** 贴图路径（相对 resources/） */
    texturePath: z.string().optional(),
  });

/** 机器条目（loader 无关，方块实体 + GUI + 能源） */
export const MachineSpec = z.object({
  /** 机器 id（小写下划线） */
  machineId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 能源容量（FE） */
  energyCapacity: z.number().int().min(0).default(10000),
  /** 最大能源传输速率 */
  maxEnergyTransfer: z.number().int().min(0).default(100),
  /** 输入槽数量 */
  inputSlots: z.number().int().min(0).max(9).default(1),
  /** 输出槽数量 */
  outputSlots: z.number().int().min(0).max(9).default(1),
  /** 默认加工时间（tick） */
  defaultProcessTime: z.number().int().min(1).default(200),
  /** 默认能源消耗/tick */
  defaultEnergyPerTick: z.number().int().min(0).default(10),
  /** GUI 宽度 */
  guiWidth: z.number().int().min(176).max(256).default(176),
  /** GUI 高度 */
  guiHeight: z.number().int().min(166).max(256).default(166),
});

// === 自定义代码/多方块/事件链（P1.4 新增，从节点图编译） ===
// 设计说明：
// - code 节点编译为 CustomCodeSnippetSpec（保留用户原始代码 + 端口签名，由 mod-generator 决定嵌入位置）
// - multiblock 节点编译为 MultiBlockSpec（结构尺寸 + 控制器偏移）
// - event/condition/action 节点采用扁平结构编译到独立数组（顶层 conditions/actions），
//   P1.5 通过 control 边在 EventHandlerSpec.conditionIds/actionIds 中建立引用关系：
//   顶层 conditions/actions = 所有节点的扁平列表；
//   eventHandlers[].conditionIds/actionIds = 该事件处理器关联的节点 id 引用。

/** 自定义代码片段（由 CodeNode 编译而来） */
export const CustomCodeSnippetSpec = z.object({
  /** 代码片段 id（使用节点 nodeId，便于调试与回溯） */
  snippetId: z.string(),
  /** 代码语言 */
  language: z.enum(['java', 'javascript', 'kotlin']).default('java'),
  /** 代码内容（原样保留，由 generator 决定如何嵌入） */
  code: z.string().default(''),
  /** 输入端口类型签名（解析自 CodeNodeData.inputSignature JSON：{ portId: PortType }） */
  inputSignature: z.record(z.string()).default({}),
  /** 输出端口类型签名 */
  outputSignature: z.record(z.string()).default({}),
  /** 函数名（生成的 Java 方法名） */
  methodName: z.string().default('process'),
});

/** 多方块结构（由 MultiBlockNode 编译而来） */
export const MultiBlockSpec = z.object({
  /** 结构 id（小写下划线） */
  structureId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 结构尺寸（1-16） */
  width: z.number().int().min(1).max(16),
  height: z.number().int().min(1).max(16),
  depth: z.number().int().min(1).max(16),
  /** 是否为空心结构 */
  hollow: z.boolean().default(true),
  /** 主控制器位置（相对坐标） */
  controllerOffset: z.object({
    x: z.number().int(),
    y: z.number().int(),
    z: z.number().int(),
  }),
});

/** 事件处理器（由 EventNode 编译而来，扁平结构 + P1.5 控制流链引用） */
export const EventHandlerSpec = z.object({
  /** 处理器 id（使用节点 nodeId） */
  handlerId: z.string(),
  /** 事件类型 */
  eventType: z.enum([
    'player_right_click_block',
    'player_right_click_item',
    'player_left_click',
    'block_break',
    'block_place',
    'entity_death',
    'entity_hurt',
    'item_use',
    'item_pickup',
    'player_join',
    'player_quit',
    'tick',
    'custom',
  ]),
  /** 事件参数（解析自 EventNodeData.eventArgs JSON） */
  eventArgs: z.record(z.unknown()).default({}),
  /** 关联的条件节点 id 列表（通过 control 边从 event 可达的 condition 节点） */
  conditionIds: z.array(z.string()).default([]),
  /** 关联的动作节点 id 列表（通过 control 边从 event/condition 可达的 action 节点） */
  actionIds: z.array(z.string()).default([]),
  /**
   * P1-3：关联的过程节点 id 列表（通过 control 边从 event 可达的 procedure 节点）。
   * 事件触发时调用对应的过程方法（procedure_<name>），过程体（condition/action）
   * 归属过程本身（在 ProcedureSpec 中维护），不在此 handler 内联。
   */
  procedureCallIds: z.array(z.string()).default([]),
  /**
   * P40：过程调用的参数（procedureId → 表达式数组，与被调过程的 inputs 顺序对应）。
   * 表达式解析自指向 procedure 节点输入端口的 data 边源节点（如变量名）；
   * 缺省/无绑定时由生成器回退为该参数类型的默认值。
   */
  procedureCallArgs: z.record(z.array(z.string())).default({}),
});

/** 条件（由 ConditionNode 编译而来，扁平结构） */
export const ConditionSpec = z.object({
  /** 条件 id（使用节点 nodeId） */
  conditionId: z.string(),
  /** 条件类型 */
  conditionType: z.enum([
    'has_item',
    'health_below',
    'health_above',
    'distance_less',
    'distance_greater',
    'is_day',
    'is_night',
    'is_raining',
    'biome_is',
    'block_is',
    'custom',
  ]),
  /** 条件参数（解析自 ConditionNodeData.conditionArgs JSON） */
  args: z.record(z.unknown()).default({}),
  /** 是否取反 */
  invert: z.boolean().default(false),
});

/** 动作（由 ActionNode 编译而来，扁平结构） */
export const ActionSpec = z.object({
  /** 动作 id（使用节点 nodeId） */
  actionId: z.string(),
  /** 动作类型 */
  actionType: z.enum([
    'spawn_entity',
    'give_item',
    'take_item',
    'teleport',
    'damage',
    'heal',
    'set_block',
    'remove_block',
    'play_sound',
    'send_message',
    'summon_lightning',
    'give_effect',
    'custom',
  ]),
  /** 动作参数（解析自 ActionNodeData.actionArgs JSON） */
  args: z.record(z.unknown()).default({}),
});

/**
 * 过程（P1-3 由 ProcedureNode 编译而来，对标 MCreator procedure）。
 *
 * 命名的可复用逻辑单元，编译为独立的 Java 方法 `procedure_<procedureName>(Object event)`。
 * - conditionIds/actionIds：过程体（通过 control 边从 procedure 节点 BFS 收集）
 * - procedureCallIds：嵌套调用的其他过程节点 id（过程调用过程）
 * - 同一 procedure 可被多个 event/procedure 引用 → 单一方法定义 + 多处调用
 */
/** procedure 输入参数定义（P40 过程封装：参数化过程） */
export const ProcedureInputSpec = z.object({
  /** 参数名（Java 标识符，生成方法签名参数） */
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/),
  /** 参数类型（Java 类型名：int/float/double/boolean/String 等） */
  type: z.string(),
});

export const ProcedureSpec = z.object({
  /** 过程 id（使用节点 nodeId） */
  procedureId: z.string(),
  /** 过程名（Java 标识符，生成方法名 procedure_<procedureName>） */
  procedureName: z.string(),
  /** 显示名 */
  displayName: z.string().default(''),
  /** P40：输入参数列表（生成方法签名参数，调用处按序传参） */
  inputs: z.array(ProcedureInputSpec).default([]),
  /** 过程体内的条件节点 id 列表（通过 control 边从 procedure 节点可达） */
  conditionIds: z.array(z.string()).default([]),
  /** 过程体内的动作节点 id 列表（通过 control 边从 procedure 节点可达） */
  actionIds: z.array(z.string()).default([]),
  /** 嵌套调用的过程节点 id 列表（过程→过程的 control 边） */
  procedureCallIds: z.array(z.string()).default([]),
  /** P40：嵌套过程调用的参数（procedureId → 表达式数组，与 inputs 顺序对应） */
  procedureCallArgs: z.record(z.array(z.string())).default({}),
});

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
  // 新增：配方（P1.3 从节点图编译，loader 无关抽象表示）
  recipes: z.array(ModRecipeSpec).default([]),
  // 新增：实体/生物（P1.3 从节点图编译）
  entities: z.array(EntitySpec).default([]),
  // 新增：机器（P1.3 从节点图编译）
  machines: z.array(MachineSpec).default([]),
  // 新增：自定义代码片段（P1.4 从 CodeNode 编译）
  customCode: z.array(CustomCodeSnippetSpec).default([]),
  // 新增：多方块结构（P1.4 从 MultiBlockNode 编译）
  multiblocks: z.array(MultiBlockSpec).default([]),
  // 新增：流体（Task D）
  fluids: z.array(FluidSpec).default([]),
  // 新增：Mod 侧生物群系（对标 MCreator）
  biomes: z.array(ModBiomeSpec).default([]),
  // 新增：Mod 侧维度（对标 MCreator）
  dimensions: z.array(ModDimensionSpec).default([]),
  // 新增：GUI 界面（对标 MCreator GUI 编辑器）
  guis: z.array(GuiSpec).default([]),
  // 新增：Mod 侧结构（对标 MCreator 结构）
  structures: z.array(ModStructureSpec).default([]),
  // 新增：事件处理器（P1.4 从 EventNode 编译，扁平结构；P1.5 通过 conditionIds/actionIds 建立控制流链引用）
  eventHandlers: z.array(EventHandlerSpec).default([]),
  // 新增：条件（P1.4 从 ConditionNode 编译，扁平列表，被 eventHandlers[].conditionIds 引用）
  conditions: z.array(ConditionSpec).default([]),
  // 新增：动作（P1.4 从 ActionNode 编译，扁平列表，被 eventHandlers[].actionIds 引用）
  actions: z.array(ActionSpec).default([]),
  // 新增：过程（P1-3 从 ProcedureNode 编译，命名可复用逻辑单元，编译为独立 Java 方法）
  procedures: z.array(ProcedureSpec).default([]),
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
export type ModRecipeSpec = z.infer<typeof ModRecipeSpec>;
export type ModRecipeInputSpec = z.infer<typeof ModRecipeInputSpec>;
export type EntitySpec = z.infer<typeof EntitySpec>;
export type MachineSpec = z.infer<typeof MachineSpec>;
export type FluidSpec = z.infer<typeof FluidSpec>;
export type ModBiomeSpec = z.infer<typeof ModBiomeSpec>;
export type ModDimensionSpec = z.infer<typeof ModDimensionSpec>;
export type GuiSpec = z.infer<typeof GuiSpec>;
export type GuiSlotSpec = z.infer<typeof GuiSlotSpec>;
export type ModStructureSpec = z.infer<typeof ModStructureSpec>;
export type CustomCodeSnippetSpec = z.infer<typeof CustomCodeSnippetSpec>;
export type MultiBlockSpec = z.infer<typeof MultiBlockSpec>;
export type EventHandlerSpec = z.infer<typeof EventHandlerSpec>;
export type ConditionSpec = z.infer<typeof ConditionSpec>;
export type ActionSpec = z.infer<typeof ActionSpec>;
export type ProcedureSpec = z.infer<typeof ProcedureSpec>;
