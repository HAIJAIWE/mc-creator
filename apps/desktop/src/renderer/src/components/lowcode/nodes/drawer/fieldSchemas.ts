import type { NodeData, NodeKind } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';

/** 公共字段：所有节点都有 label/note */
const COMMON_FIELDS: FieldSchema[] = [
  { key: 'label', label: '标签', type: 'text', required: true },
  { key: 'note', label: '备注', type: 'text' },
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
      'stonecutting',
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
    condition: { field: 'recipeType', in: ['smelting', 'blasting', 'smoking'] },
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

/** 按 kind 获取字段 schema 列表 */
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
  };
  return [...COMMON_FIELDS, ...(specific[kind] ?? [])];
}
