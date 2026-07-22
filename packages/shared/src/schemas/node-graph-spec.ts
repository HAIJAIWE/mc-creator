import { z } from 'zod';

/**
 * 节点图 Spec：低代码模式的核心数据结构
 *
 * 三段式架构（L1/L2/L3）：
 * - L1 纯节点：用户拖拽预置节点 + 连线表达关系
 * - L2 节点 + 代码节点：复杂逻辑用 CodeNode 内嵌 Java/JS
 * - L3 纯代码：跳过节点图，直接 Monaco + 项目脚手架
 *
 * 节点图最终编译为 ModSpec（已有 schema），由 mod-generator 生成 Java 文件。
 */

// === 节点类型 ===

export const NodeKind = z.enum([
  // 基础内容节点
  'item', // 物品
  'block', // 方块
  'entity', // 生物
  'recipe', // 配方
  'machine', // 机器（方块实体 + GUI + 能源）
  'multiblock', // 多方块结构
  // 逻辑节点
  'event', // 事件触发器
  'condition', // 条件判断
  'action', // 动作执行
  // 高级节点
  'code', // 代码节点（L2 模式核心）
  'comment', // 注释节点（仅文档用途）
]);
export type NodeKind = z.infer<typeof NodeKind>;

// === 端口类型（连线类型校验） ===

export const PortType = z.enum([
  'item_stack', // 物品堆
  'block_state', // 方块状态
  'entity', // 实体
  'fluid', // 流体
  'energy', // 能源（FE/RF）
  'redstone', // 红石信号
  'player', // 玩家
  'world', // 世界
  'boolean', // 布尔
  'integer', // 整数
  'number', // 浮点
  'string', // 字符串
  'nbt', // NBT 数据
  'void', // 无数据（控制流）
  'any', // 任意类型（兼容）
]);
export type PortType = z.infer<typeof PortType>;

// === 端口定义 ===

export const NodePort = z.object({
  id: z.string(), // 端口 ID（节点内唯一）
  label: z.string(), // 显示名
  type: PortType,
  direction: z.enum(['in', 'out']),
  required: z.boolean().default(false),
  /** 多输入端口（如合成配方多材料） */
  multiple: z.boolean().default(false),
  /** 默认值（未连线时使用） */
  defaultValue: z.string().optional(),
});
export type NodePort = z.infer<typeof NodePort>;

// === 连线类型 ===

export const EdgeKind = z.enum([
  'craft', // 合成关系（材料 → 配方 → 产物）
  'structure', // 结构关系（多方块组件）
  'flow', // 物品/能源/流体流（科技网络）
  'control', // 控制流（事件 → 条件 → 动作）
  'depends', // 依赖关系（A 依赖 B 存在）
  'data', // 数据传递（通用）
]);
export type EdgeKind = z.infer<typeof EdgeKind>;

// === 基础节点数据（各类节点共享的元信息） ===

export const BaseNodeData = z.object({
  /** 节点实例 ID（图内唯一） */
  nodeId: z.string(),
  /** 节点显示名 */
  label: z.string(),
  /** 节点备注（用户可编辑） */
  note: z.string().default(''),
  /** 是否禁用（编译时跳过） */
  disabled: z.boolean().default(false),
  /** 是否折叠（UI 状态，序列化到 JSON） */
  collapsed: z.boolean().default(false),
});
export type BaseNodeData = z.infer<typeof BaseNodeData>;

// === 各类节点的特定数据 ===

export const ItemNodeData = BaseNodeData.extend({
  kind: z.literal('item'),
  /** 物品 ID（小写下划线） */
  itemId: z.string().regex(/^[a-z0-9_]+$/),
  /** 显示名 */
  displayName: z.string(),
  /** 物品分类 */
  category: z
    .enum([
      'sword',
      'pickaxe',
      'axe',
      'shovel',
      'hoe',
      'helmet',
      'chestplate',
      'leggings',
      'boots',
      'food',
      'potion',
      'bow',
      'crossbow',
      'shield',
      'fishing_rod',
      'shears',
      'flint_and_steel',
      'material',
      'misc',
    ])
    .default('misc'),
  /** 最大堆叠 */
  maxStackSize: z.number().int().min(1).max(64).default(64),
  /** 最大耐久（0=不可损坏） */
  maxDamage: z.number().int().min(0).default(0),
  /** 稀有度 */
  rarity: z.enum(['common', 'uncommon', 'rare', 'epic']).default('common'),
  /** 发光（附魔光辉） */
  glow: z.boolean().default(false),
  /** 贴图路径（相对 resources/） */
  texturePath: z.string().optional(),
});
export type ItemNodeData = z.infer<typeof ItemNodeData>;

export const BlockNodeData = BaseNodeData.extend({
  kind: z.literal('block'),
  blockId: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string(),
  /** 硬度（挖掘时间） */
  hardness: z.number().min(0).default(1.0),
  /** 爆炸抗性 */
  blastResistance: z.number().min(0).default(3.0),
  /** 发光等级（0-15） */
  luminance: z.number().int().min(0).max(15).default(0),
  /** 透明 */
  transparent: z.boolean().default(false),
  /** 固体（可碰撞） */
  solid: z.boolean().default(true),
  /** 模型类型 */
  modelType: z.enum(['cube_all', 'cube_column', 'cross', 'custom']).default('cube_all'),
  /** 是否为方块实体（如箱子、机器） */
  isBlockEntity: z.boolean().default(false),
  texturePathTop: z.string().optional(),
  texturePathSide: z.string().optional(),
  texturePathBottom: z.string().optional(),
});
export type BlockNodeData = z.infer<typeof BlockNodeData>;

export const EntityNodeData = BaseNodeData.extend({
  kind: z.literal('entity'),
  entityId: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string(),
  /** 基础属性 */
  maxHealth: z.number().min(1).default(20),
  attackDamage: z.number().min(0).default(0),
  movementSpeed: z.number().min(0).default(0.3),
  /** 阵营 */
  classification: z
    .enum(['animal', 'monster', 'water_creature', 'ambient', 'misc'])
    .default('misc'),
  /** 模型（vanilla 骨架 / 自定义） */
  modelType: z.enum(['pig', 'zombie', 'skeleton', 'creeper', 'cow', 'custom']).default('pig'),
  /** 生成条件 */
  spawnWeight: z.number().min(0).default(0),
  spawnBiomes: z.array(z.string()).default([]),
  texturePath: z.string().optional(),
});
export type EntityNodeData = z.infer<typeof EntityNodeData>;

export const RecipeNodeData = BaseNodeData.extend({
  kind: z.literal('recipe'),
  recipeId: z.string().regex(/^[a-z0-9_]+$/),
  /** 配方类型 */
  recipeType: z
    .enum([
      'crafting_shaped',
      'crafting_shapeless',
      'smelting',
      'blasting',
      'smoking',
      'stonecutting',
    ])
    .default('crafting_shaped'),
  /** 产出物品数量 */
  outputCount: z.number().int().min(1).default(1),
  /** 烧炼时间（tick） */
  cookTime: z.number().int().min(1).default(200),
  /** 经验值 */
  experience: z.number().min(0).default(0),
  /** 形状配方模式（仅 shaped 用） */
  pattern: z.array(z.string()).max(3).default([]),
});
export type RecipeNodeData = z.infer<typeof RecipeNodeData>;

export const MachineNodeData = BaseNodeData.extend({
  kind: z.literal('machine'),
  machineId: z.string().regex(/^[a-z0-9_]+$/),
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
export type MachineNodeData = z.infer<typeof MachineNodeData>;

export const MultiBlockNodeData = BaseNodeData.extend({
  kind: z.literal('multiblock'),
  structureId: z.string().regex(/^[a-z0-9_]+$/),
  displayName: z.string(),
  /** 结构尺寸 */
  width: z.number().int().min(1).max(16).default(3),
  height: z.number().int().min(1).max(16).default(3),
  depth: z.number().int().min(1).max(16).default(3),
  /** 是否为空心结构 */
  hollow: z.boolean().default(true),
  /** 主控制器位置（相对坐标） */
  controllerOffset: z
    .object({
      x: z.number().int(),
      y: z.number().int(),
      z: z.number().int(),
    })
    .default({ x: 1, y: 1, z: 0 }),
});
export type MultiBlockNodeData = z.infer<typeof MultiBlockNodeData>;

export const EventNodeData = BaseNodeData.extend({
  kind: z.literal('event'),
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
  /** 事件参数（JSON 字符串，由具体事件决定字段） */
  eventArgs: z.string().default('{}'),
});
export type EventNodeData = z.infer<typeof EventNodeData>;

export const ConditionNodeData = BaseNodeData.extend({
  kind: z.literal('condition'),
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
  /** 条件参数（JSON 字符串） */
  conditionArgs: z.string().default('{}'),
  /** 取反 */
  invert: z.boolean().default(false),
});
export type ConditionNodeData = z.infer<typeof ConditionNodeData>;

export const ActionNodeData = BaseNodeData.extend({
  kind: z.literal('action'),
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
  /** 动作参数（JSON 字符串） */
  actionArgs: z.string().default('{}'),
});
export type ActionNodeData = z.infer<typeof ActionNodeData>;

export const CodeNodeData = BaseNodeData.extend({
  kind: z.literal('code'),
  /** 代码语言 */
  language: z.enum(['java', 'javascript', 'kotlin']).default('java'),
  /** 代码内容 */
  code: z.string().default(''),
  /** 输入端口类型签名（JSON：{ portId: PortType }） */
  inputSignature: z.string().default('{}'),
  /** 输出端口类型签名 */
  outputSignature: z.string().default('{}'),
  /** 函数名（生成的 Java 方法名） */
  methodName: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)
    .default('process'),
});
export type CodeNodeData = z.infer<typeof CodeNodeData>;

export const CommentNodeData = BaseNodeData.extend({
  kind: z.literal('comment'),
  text: z.string().default(''),
  /** 背景色 */
  color: z.enum(['yellow', 'green', 'blue', 'pink', 'gray']).default('yellow'),
});
export type CommentNodeData = z.infer<typeof CommentNodeData>;

// === 节点数据联合类型 ===

export const NodeData = z.discriminatedUnion('kind', [
  ItemNodeData,
  BlockNodeData,
  EntityNodeData,
  RecipeNodeData,
  MachineNodeData,
  MultiBlockNodeData,
  EventNodeData,
  ConditionNodeData,
  ActionNodeData,
  CodeNodeData,
  CommentNodeData,
]);
export type NodeData = z.infer<typeof NodeData>;

// === 节点实例（React Flow Node） ===

export const ModNode = z.object({
  id: z.string(), // React Flow 节点 ID（= nodeId）
  type: NodeKind,
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  data: NodeData,
  /** 节点定义的端口（用于编译时生成连线校验） */
  ports: z.array(NodePort).default([]),
  /** 是否选中 */
  selected: z.boolean().default(false),
});
export type ModNode = z.infer<typeof ModNode>;

// === 连线（React Flow Edge） ===

export const ModEdge = z.object({
  id: z.string(),
  source: z.string(), // 源节点 ID
  target: z.string(), // 目标节点 ID
  sourceHandle: z.string().optional(), // 源端口 ID
  targetHandle: z.string().optional(), // 目标端口 ID
  kind: EdgeKind,
  /** 连线标签（可选，如 "100 FE/t"） */
  label: z.string().optional(),
  /** 是否启用 */
  disabled: z.boolean().default(false),
});
export type ModEdge = z.infer<typeof ModEdge>;

// === 完整节点图 ===

export const NodeGraph = z.object({
  /** 节点图版本（用于迁移） */
  version: z.literal(1).default(1),
  /** 项目 ID（关联 ModSpec.modId） */
  modId: z.string(),
  /** 画布元信息 */
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .default({ x: 0, y: 0, zoom: 1 }),
  nodes: z.array(ModNode),
  edges: z.array(ModEdge),
});
export type NodeGraph = z.infer<typeof NodeGraph>;

// === 视口元信息（React Flow viewport） ===

export const EditorMode = z.enum(['lowcode', 'hybrid', 'purecode']);
export type EditorMode = z.infer<typeof EditorMode>;

/**
 * 三种模式说明：
 * - lowcode（L1）：纯节点图，所有内容用预置节点表达
 * - hybrid（L2）：节点图 + 代码节点，复杂逻辑内嵌 Monaco
 * - purecode（L3）：跳过节点图，直接 Monaco + 项目脚手架
 *
 * 用户可在 ModeSwitcher 中切换，切换时保留各自模式的编辑状态。
 */
