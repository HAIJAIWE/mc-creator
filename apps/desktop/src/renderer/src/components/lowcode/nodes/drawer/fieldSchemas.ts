import type { NodeData, NodeKind } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';

/**
 * 公共字段：所有节点都有 label/note。
 *
 * codeLocked / lockedCode 对标 MCreator 的 codeLock 机制：
 * - codeLocked=true 时编译器跳过常规代码生成，直接使用 lockedCode
 * - lockedCode 仅在 codeLocked=true 时显示（condition）
 * - 排除 comment 节点（不参与编译，codeLock 无意义）
 */
const COMMON_FIELDS: FieldSchema[] = [
  { key: 'label', label: '标签', type: 'text', required: true },
  { key: 'note', label: '备注', type: 'text' },
  {
    key: 'codeLocked',
    label: '锁定代码',
    type: 'segmented',
    options: ['false', 'true'],
    excludeKinds: ['comment'],
  },
  {
    key: 'lockedCode',
    label: '锁定代码内容',
    type: 'code',
    language: 'java',
    placeholder:
      '// 锁定后编译器直接使用此代码，跳过常规代码生成\n// 留空时回退到常规编译并产生 warning',
    condition: { field: 'codeLocked', equals: 'true' },
    excludeKinds: ['comment'],
  },
];

/** item 节点字段 */
const ITEM_FIELDS: FieldSchema[] = [
  { key: 'itemId', label: '物品 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  {
    key: 'rarity',
    label: '稀有度',
    type: 'dropdown',
    options: ['common', 'uncommon', 'rare', 'epic'],
  },
  {
    key: 'category',
    label: '类别',
    type: 'dropdown',
    options: ['misc', 'tool', 'weapon', 'armor', 'food', 'material'],
  },
  { key: 'maxStackSize', label: '最大堆叠', type: 'number', min: 1, max: 64, step: 1 },
  { key: 'maxDamage', label: '最大耐久', type: 'number', min: 0, max: 99999, step: 1 },
  { key: 'glow', label: '发光', type: 'segmented', options: ['false', 'true'] },
];

/** block 节点字段 */
const BLOCK_FIELDS: FieldSchema[] = [
  { key: 'blockId', label: '方块 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'hardness', label: '硬度', type: 'number', min: 0, max: 999, step: 0.5 },
  { key: 'blastResistance', label: '抗爆性', type: 'number', min: 0, max: 9999, step: 0.5 },
  { key: 'luminance', label: '发光等级', type: 'number', min: 0, max: 15, step: 1 },
  { key: 'transparent', label: '透明', type: 'segmented', options: ['false', 'true'] },
  { key: 'solid', label: '固体', type: 'segmented', options: ['true', 'false'] },
  {
    key: 'modelType',
    label: '模型类型',
    type: 'dropdown',
    options: ['cube_all', 'cube_column', 'cross', 'door', 'fence', 'stairs'],
  },
  { key: 'isBlockEntity', label: '方块实体', type: 'segmented', options: ['false', 'true'] },
];

/** entity 节点字段 */
const ENTITY_FIELDS: FieldSchema[] = [
  { key: 'entityId', label: '实体 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  {
    key: 'classification',
    label: '分类',
    type: 'dropdown',
    options: ['mob', 'animal', 'monster', 'boss', 'projectile', 'other'],
  },
  { key: 'maxHealth', label: '最大血量', type: 'number', min: 1, max: 9999, step: 1 },
  { key: 'attackDamage', label: '攻击力', type: 'number', min: 0, max: 999, step: 0.5 },
  { key: 'movementSpeed', label: '移动速度', type: 'number', min: 0, max: 10, step: 0.05 },
  { key: 'fireImmune', label: '免疫火焰', type: 'segmented', options: ['false', 'true'] },
];

/** recipe 节点字段 */
const RECIPE_FIELDS: FieldSchema[] = [
  { key: 'recipeId', label: '配方 ID', type: 'resourceId', required: true },
  {
    key: 'recipeType',
    label: '配方类型',
    type: 'dropdown',
    options: [
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
    ],
  },
  { key: 'outputCount', label: '产出数量', type: 'number', min: 1, max: 64, step: 1 },
  {
    key: 'cookTime',
    label: '烧制时间',
    type: 'number',
    min: 1,
    max: 9999,
    step: 1,
    condition: { field: 'recipeType', in: ['smelting', 'blasting', 'smoking'] },
  },
  {
    key: 'experience',
    label: '经验',
    type: 'number',
    min: 0,
    max: 99,
    step: 0.1,
    condition: { field: 'recipeType', in: ['smelting', 'blasting', 'smoking', 'campfire_cooking'] },
  },
  // P41：smithing_transform / smithing_trim 特有字段
  {
    key: 'template',
    label: '升级模板',
    type: 'resourceId',
    condition: { field: 'recipeType', in: ['smithing_transform', 'smithing_trim'] },
  },
  {
    key: 'base',
    label: '合成基座',
    type: 'resourceId',
    condition: { field: 'recipeType', in: ['smithing_transform', 'smithing_trim'] },
  },
  {
    key: 'addition',
    label: '附加物品',
    type: 'resourceId',
    condition: { field: 'recipeType', in: ['smithing_transform', 'smithing_trim'] },
  },
  // P41：brewing 特有字段
  {
    key: 'inputPotion',
    label: '输入药水',
    type: 'resourceId',
    condition: { field: 'recipeType', equals: 'brewing' },
  },
  {
    key: 'ingredientItem',
    label: '酿造材料',
    type: 'resourceId',
    condition: { field: 'recipeType', equals: 'brewing' },
  },
  {
    key: 'outputPotion',
    label: '输出药水',
    type: 'resourceId',
    condition: { field: 'recipeType', equals: 'brewing' },
  },
];

/** machine 节点字段 */
const MACHINE_FIELDS: FieldSchema[] = [
  { key: 'machineId', label: '机器 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'energyCapacity', label: '能源容量', type: 'number', min: 0, max: 999999, step: 100 },
  { key: 'inputSlots', label: '输入槽位数', type: 'number', min: 0, max: 27, step: 1 },
  { key: 'outputSlots', label: '输出槽位数', type: 'number', min: 0, max: 27, step: 1 },
  { key: 'defaultProcessTime', label: '默认处理时间', type: 'number', min: 1, max: 9999, step: 1 },
  {
    key: 'defaultEnergyPerTick',
    label: '每 tick 能耗',
    type: 'number',
    min: 0,
    max: 9999,
    step: 1,
  },
];

/** multiblock 节点字段 */
const MULTIBLOCK_FIELDS: FieldSchema[] = [
  { key: 'structureId', label: '结构 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'width', label: '宽', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'height', label: '高', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'depth', label: '深', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'hollow', label: '空心', type: 'segmented', options: ['false', 'true'] },
];

/** event 节点字段 */
const EVENT_FIELDS: FieldSchema[] = [
  {
    key: 'eventType',
    label: '事件类型',
    type: 'dropdown',
    options: [
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
    ],
  },
  { key: 'eventArgs', label: '事件参数 (JSON)', type: 'nbt' },
];

/** condition 节点字段 */
const CONDITION_FIELDS: FieldSchema[] = [
  {
    key: 'conditionType',
    label: '条件类型',
    type: 'dropdown',
    options: [
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
    ],
  },
  { key: 'conditionArgs', label: '条件参数 (JSON)', type: 'nbt' },
  { key: 'invert', label: '取反', type: 'segmented', options: ['false', 'true'] },
];

/** action 节点字段 */
const ACTION_FIELDS: FieldSchema[] = [
  {
    key: 'actionType',
    label: '动作类型',
    type: 'dropdown',
    options: [
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
    ],
  },
  { key: 'actionArgs', label: '动作参数 (JSON)', type: 'nbt' },
];

/** code 节点字段 */
const CODE_FIELDS: FieldSchema[] = [
  { key: 'methodName', label: '方法名', type: 'text', required: true },
  { key: 'language', label: '语言', type: 'dropdown', options: ['java', 'kotlin', 'javascript'] },
  { key: 'inputSignature', label: '输入签名 (JSON)', type: 'nbt' },
  { key: 'outputSignature', label: '输出签名 (JSON)', type: 'nbt' },
];

/** comment 节点字段 */
const COMMENT_FIELDS: FieldSchema[] = [
  { key: 'text', label: '文本', type: 'text' },
  {
    key: 'color',
    label: '颜色',
    type: 'dropdown',
    options: ['yellow', 'green', 'blue', 'red', 'purple', 'gray'],
  },
];

/** variable 节点字段（阶段 C，P2 dogfood 修复：value 字段根据 varType 动态切换编辑器类型） */
const VARIABLE_FIELDS: FieldSchema[] = [
  { key: 'varName', label: '变量名', type: 'text', required: true },
  {
    key: 'varType',
    label: '变量类型',
    type: 'dropdown',
    required: true,
    options: ['int', 'double', 'string', 'boolean', 'item', 'block'],
  },
  // P2：根据 varType 动态切换 value 编辑器（int/double → number, boolean → segmented, item/block → resourceId, string → text）
  {
    key: 'value',
    label: '初始值',
    type: 'number',
    min: -999999,
    max: 999999,
    step: 1,
    condition: { field: 'varType', in: ['int'] },
  },
  {
    key: 'value',
    label: '初始值',
    type: 'number',
    min: -999999,
    max: 999999,
    step: 0.01,
    condition: { field: 'varType', in: ['double'] },
  },
  {
    key: 'value',
    label: '初始值',
    type: 'text',
    condition: { field: 'varType', in: ['string'] },
  },
  {
    key: 'value',
    label: '初始值',
    type: 'segmented',
    options: ['false', 'true'],
    condition: { field: 'varType', in: ['boolean'] },
  },
  {
    key: 'value',
    label: '初始值',
    type: 'resourceId',
    condition: { field: 'varType', in: ['item'] },
  },
  {
    key: 'value',
    label: '初始值',
    type: 'resourceId',
    condition: { field: 'varType', in: ['block'] },
  },
  { key: 'isConstant', label: '常量', type: 'segmented', options: ['false', 'true'] },
];

/** subgraph 节点字段（阶段 C） */
const SUBGRAPH_FIELDS: FieldSchema[] = [
  { key: 'label', label: '显示名', type: 'text', required: true },
  { key: 'subgraphName', label: '子图名', type: 'text' },
  { key: 'subgraphId', label: '子图 ID', type: 'text' },
];

/** P1-3：procedure 节点字段（对标 MCreator procedure） */
const PROCEDURE_FIELDS: FieldSchema[] = [
  {
    key: 'procedureName',
    label: '过程名',
    type: 'text',
    required: true,
    pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
    patternMessage: '须为合法 Java 标识符：字母/下划线开头，仅含字母/数字/下划线',
  },
  { key: 'displayName', label: '显示名', type: 'text' },
  // P40：输入参数列表（name + type，编译为方法形参；每参数自动生成 in_<name> 数据端口）
  {
    key: 'inputs',
    label: '输入参数',
    type: 'list',
    listItemSchema: [
      {
        key: 'name',
        label: '参数名',
        type: 'text',
        pattern: '^[a-zA-Z_][a-zA-Z0-9_]*$',
        patternMessage: '须为合法 Java 标识符',
      },
      {
        key: 'type',
        label: '类型',
        type: 'dropdown',
        options: [
          'int',
          'float',
          'double',
          'long',
          'boolean',
          'string',
          'item',
          'block',
          'entity',
          'player',
        ],
      },
    ],
  },
];

/** biome 节点字段（世界生成） */
const BIOME_FIELDS: FieldSchema[] = [
  { key: 'biomeId', label: '生物群系 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  {
    key: 'precipitation',
    label: '降水',
    type: 'dropdown',
    options: ['none', 'rain', 'snow'],
  },
  { key: 'temperature', label: '温度', type: 'number', min: -2, max: 2, step: 0.1 },
  {
    key: 'temperatureModifier',
    label: '温度修饰',
    type: 'dropdown',
    options: ['none', 'frozen'],
  },
  { key: 'downfall', label: '降水量', type: 'number', min: 0, max: 1, step: 0.05 },
  { key: 'skyColor', label: '天空颜色', type: 'color' },
  { key: 'waterColor', label: '水面颜色', type: 'color' },
  { key: 'fogColor', label: '雾颜色', type: 'color' },
  { key: 'surfaceBuilder', label: '地表构建器', type: 'text' },
  { key: 'spawnWeight', label: '生成权重', type: 'number', min: 0, max: 100, step: 1 },
];

/** dimension 节点字段（世界生成） */
const DIMENSION_FIELDS: FieldSchema[] = [
  { key: 'dimensionId', label: '维度 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  {
    key: 'baseType',
    label: '类型模板',
    type: 'dropdown',
    options: ['overworld', 'nether', 'end'],
  },
  { key: 'fixedTime', label: '固定时间 (tick)', type: 'number', min: -1, max: 24000, step: 100 },
  {
    key: 'hasSkyLight',
    label: '天空光',
    type: 'segmented',
    options: ['true', 'false'],
  },
  {
    key: 'hasCeiling',
    label: '天花板',
    type: 'segmented',
    options: ['false', 'true'],
  },
  {
    key: 'ultrawarm',
    label: '超热',
    type: 'segmented',
    options: ['false', 'true'],
  },
  { key: 'minY', label: '最小 Y', type: 'number', min: -2048, max: 2047, step: 16 },
  { key: 'height', label: '高度', type: 'number', min: 16, max: 4064, step: 16 },
  {
    key: 'effects',
    label: '效果',
    type: 'dropdown',
    options: ['overworld', 'the_nether', 'the_end', 'none'],
  },
];

/** fluid 节点字段（流体） */
const FLUID_FIELDS: FieldSchema[] = [
  { key: 'fluidId', label: '流体 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'color', label: '颜色', type: 'color' },
  { key: 'temperature', label: '温度 (K)', type: 'number', min: 0, max: 2000, step: 10 },
  { key: 'viscosity', label: '黏度', type: 'number', min: 1, max: 10000, step: 10 },
  { key: 'density', label: '密度', type: 'number', min: 1, max: 10000, step: 10 },
  {
    key: 'luminous',
    label: '发光',
    type: 'segmented',
    options: ['false', 'true'],
  },
];

/** gui 节点字段（容器界面） */
const GUI_FIELDS: FieldSchema[] = [
  { key: 'guiId', label: 'GUI ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'width', label: '宽度', type: 'number', min: 176, max: 256, step: 1 },
  { key: 'height', label: '高度', type: 'number', min: 166, max: 256, step: 1 },
  {
    key: 'slotsJson',
    label: '槽位布局 (JSON)',
    type: 'nbt',
    placeholder: '[{"slotId":"in_0","slotType":"input","x":0,"y":0}]',
  },
  {
    key: 'showEnergyBar',
    label: '能源条',
    type: 'segmented',
    options: ['false', 'true'],
  },
  {
    key: 'showProgressBar',
    label: '进度条',
    type: 'segmented',
    options: ['false', 'true'],
  },
];

/** loop 节点字段（阶段 C） */ const LOOP_FIELDS: FieldSchema[] = [
  {
    key: 'loopType',
    label: '循环类型',
    type: 'segmented',
    required: true,
    options: ['for', 'forEach', 'while'],
  },
  { key: 'loopVarName', label: '循环变量名', type: 'text' },
  {
    key: 'loopVarType',
    label: '循环变量类型',
    type: 'dropdown',
    options: ['int', 'item', 'block', 'string'],
  },
  {
    key: 'init',
    label: '初始化',
    type: 'text',
    condition: { field: 'loopType', equals: 'for' },
  },
  { key: 'condition', label: '条件', type: 'text', required: true },
  {
    key: 'update',
    label: '更新',
    type: 'text',
    condition: { field: 'loopType', equals: 'for' },
  },
  {
    key: 'iterable',
    label: '可迭代对象',
    type: 'text',
    condition: { field: 'loopType', equals: 'forEach' },
  },
  { key: 'bodySubgraphId', label: '循环体子图', type: 'noderef' },
];

/** 按 kind 获取字段 schema 列表（已按 excludeKinds 过滤） */
export function getFieldSchemas(kind: NodeKind): FieldSchema[] {
  const specific: Record<NodeData['kind'], FieldSchema[]> = {
    item: ITEM_FIELDS,
    block: BLOCK_FIELDS,
    entity: ENTITY_FIELDS,
    recipe: RECIPE_FIELDS,
    machine: MACHINE_FIELDS,
    multiblock: MULTIBLOCK_FIELDS,
    event: EVENT_FIELDS,
    condition: CONDITION_FIELDS,
    action: ACTION_FIELDS,
    code: CODE_FIELDS,
    comment: COMMENT_FIELDS,
    variable: VARIABLE_FIELDS,
    subgraph: SUBGRAPH_FIELDS,
    loop: LOOP_FIELDS,
    procedure: PROCEDURE_FIELDS,
    biome: BIOME_FIELDS,
    dimension: DIMENSION_FIELDS,
    fluid: FLUID_FIELDS,
    gui: GUI_FIELDS,
  };
  return [...COMMON_FIELDS, ...(specific[kind] ?? [])].filter(
    (f) => !f.excludeKinds?.includes(kind),
  );
}
