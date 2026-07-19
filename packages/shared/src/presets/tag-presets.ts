/**
 * MC 常用标签预设：vanilla / fabric / forge 常用标签模板。
 * 用于快速添加 Mod 物品/方块到正确标签，确保与原版/其他 Mod 兼容。
 */

export interface TagPreset {
  /** 标签 ID（如 minecraft:enchantable/sword） */
  tagId: string;
  /** 标签类型 */
  kind: 'item' | 'block' | 'fluid' | 'entity_type' | 'game_event' | 'biome';
  /** 描述 */
  description: string;
  /** 默认值（原版条目） */
  values: string[];
  /** 来源平台 */
  platform: 'vanilla' | 'fabric' | 'forge' | 'neoforge';
}

/** 原版物品标签预设（1.21.x） */
export const VANILLA_ITEM_TAG_PRESETS: TagPreset[] = [
  // 附魔相关
  {
    tagId: 'minecraft:enchantable/sword',
    kind: 'item',
    description: '剑可附魔',
    values: [
      'minecraft:wooden_sword',
      'minecraft:stone_sword',
      'minecraft:iron_sword',
      'minecraft:golden_sword',
      'minecraft:diamond_sword',
      'minecraft:netherite_sword',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/bow',
    kind: 'item',
    description: '弓可附魔',
    values: ['minecraft:bow'],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/crossbow',
    kind: 'item',
    description: '弩可附魔',
    values: ['minecraft:crossbow'],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/trident',
    kind: 'item',
    description: '三叉戟可附魔',
    values: ['minecraft:trident'],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/mining',
    kind: 'item',
    description: '采矿工具可附魔',
    values: [
      'minecraft:wooden_pickaxe',
      'minecraft:stone_pickaxe',
      'minecraft:iron_pickaxe',
      'minecraft:golden_pickaxe',
      'minecraft:diamond_pickaxe',
      'minecraft:netherite_pickaxe',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/mining_loot',
    kind: 'item',
    description: '时运/精准采集可附魔',
    values: [
      'minecraft:wooden_pickaxe',
      'minecraft:stone_pickaxe',
      'minecraft:iron_pickaxe',
      'minecraft:golden_pickaxe',
      'minecraft:diamond_pickaxe',
      'minecraft:netherite_pickaxe',
      'minecraft:wooden_shovel',
      'minecraft:stone_shovel',
      'minecraft:iron_shovel',
      'minecraft:golden_shovel',
      'minecraft:diamond_shovel',
      'minecraft:netherite_shovel',
      'minecraft:wooden_hoe',
      'minecraft:stone_hoe',
      'minecraft:iron_hoe',
      'minecraft:golden_hoe',
      'minecraft:diamond_hoe',
      'minecraft:netherite_hoe',
      'minecraft:wooden_axe',
      'minecraft:stone_axe',
      'minecraft:iron_axe',
      'minecraft:golden_axe',
      'minecraft:diamond_axe',
      'minecraft:netherite_axe',
      'minecraft:shears',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/fishing',
    kind: 'item',
    description: '钓竿可附魔',
    values: ['minecraft:fishing_rod'],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/durability',
    kind: 'item',
    description: '耐久可附魔',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/armor',
    kind: 'item',
    description: '盔甲可附魔',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:enchantable/mace',
    kind: 'item',
    description: '锤可附魔',
    values: ['minecraft:mace'],
    platform: 'vanilla',
  },

  // 工具分类
  {
    tagId: 'minecraft:pickaxes',
    kind: 'item',
    description: '镐',
    values: [
      'minecraft:wooden_pickaxe',
      'minecraft:stone_pickaxe',
      'minecraft:iron_pickaxe',
      'minecraft:golden_pickaxe',
      'minecraft:diamond_pickaxe',
      'minecraft:netherite_pickaxe',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:axes',
    kind: 'item',
    description: '斧',
    values: [
      'minecraft:wooden_axe',
      'minecraft:stone_axe',
      'minecraft:iron_axe',
      'minecraft:golden_axe',
      'minecraft:diamond_axe',
      'minecraft:netherite_axe',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:shovels',
    kind: 'item',
    description: '锹',
    values: [
      'minecraft:wooden_shovel',
      'minecraft:stone_shovel',
      'minecraft:iron_shovel',
      'minecraft:golden_shovel',
      'minecraft:diamond_shovel',
      'minecraft:netherite_shovel',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:hoes',
    kind: 'item',
    description: '锄',
    values: [
      'minecraft:wooden_hoe',
      'minecraft:stone_hoe',
      'minecraft:iron_hoe',
      'minecraft:golden_hoe',
      'minecraft:diamond_hoe',
      'minecraft:netherite_hoe',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:swords',
    kind: 'item',
    description: '剑',
    values: [
      'minecraft:wooden_sword',
      'minecraft:stone_sword',
      'minecraft:iron_sword',
      'minecraft:golden_sword',
      'minecraft:diamond_sword',
      'minecraft:netherite_sword',
    ],
    platform: 'vanilla',
  },

  // 盔甲
  {
    tagId: 'minecraft:head_armor',
    kind: 'item',
    description: '头盔',
    values: [
      'minecraft:leather_helmet',
      'minecraft:chainmail_helmet',
      'minecraft:iron_helmet',
      'minecraft:golden_helmet',
      'minecraft:diamond_helmet',
      'minecraft:netherite_helmet',
      'minecraft:turtle_helmet',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:chest_armor',
    kind: 'item',
    description: '胸甲',
    values: [
      'minecraft:leather_chestplate',
      'minecraft:chainmail_chestplate',
      'minecraft:iron_chestplate',
      'minecraft:golden_chestplate',
      'minecraft:diamond_chestplate',
      'minecraft:netherite_chestplate',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:leg_armor',
    kind: 'item',
    description: '护腿',
    values: [
      'minecraft:leather_leggings',
      'minecraft:chainmail_leggings',
      'minecraft:iron_leggings',
      'minecraft:golden_leggings',
      'minecraft:diamond_leggings',
      'minecraft:netherite_leggings',
    ],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:foot_armor',
    kind: 'item',
    description: '靴子',
    values: [
      'minecraft:leather_boots',
      'minecraft:chainmail_boots',
      'minecraft:iron_boots',
      'minecraft:golden_boots',
      'minecraft:diamond_boots',
      'minecraft:netherite_boots',
    ],
    platform: 'vanilla',
  },

  // 燃料
  {
    tagId: 'minecraft:non_flammable_wood',
    kind: 'item',
    description: '不可燃木材',
    values: [
      'minecraft:warped_stem',
      'minecraft:warped_hyphae',
      'minecraft:warped_planks',
      'minecraft:warped_slab',
      'minecraft:warped_stairs',
      'minecraft:warped_fence',
      'minecraft:warped_fence_gate',
      'minecraft:warped_door',
      'minecraft:warped_sign',
      'minecraft:warped_hanging_sign',
      'minecraft:warped_button',
      'minecraft:warped_pressure_plate',
      'minecraft:crimson_stem',
      'minecraft:crimson_hyphae',
      'minecraft:crimson_planks',
      'minecraft:crimson_slab',
      'minecraft:crimson_stairs',
      'minecraft:crimson_fence',
      'minecraft:crimson_fence_gate',
      'minecraft:crimson_door',
      'minecraft:crimson_sign',
      'minecraft:crimson_hanging_sign',
      'minecraft:crimson_button',
      'minecraft:crimson_pressure_plate',
    ],
    platform: 'vanilla',
  },

  // 食物
  { tagId: 'minecraft:food', kind: 'item', description: '食物', values: [], platform: 'vanilla' },
];

/** 原版方块标签预设（1.21.x） */
export const VANILLA_BLOCK_TAG_PRESETS: TagPreset[] = [
  {
    tagId: 'minecraft:mineable/pickaxe',
    kind: 'block',
    description: '镐可挖掘',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:mineable/axe',
    kind: 'block',
    description: '斧可挖掘',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:mineable/shovel',
    kind: 'block',
    description: '锹可挖掘',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:mineable/hoe',
    kind: 'block',
    description: '锄可挖掘',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:needs_stone_tool',
    kind: 'block',
    description: '需石质工具',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:needs_iron_tool',
    kind: 'block',
    description: '需铁质工具',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:needs_diamond_tool',
    kind: 'block',
    description: '需钻石工具',
    values: [],
    platform: 'vanilla',
  },
  { tagId: 'minecraft:logs', kind: 'block', description: '原木', values: [], platform: 'vanilla' },
  {
    tagId: 'minecraft:planks',
    kind: 'block',
    description: '木板',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:stairs',
    kind: 'block',
    description: '楼梯',
    values: [],
    platform: 'vanilla',
  },
  { tagId: 'minecraft:slabs', kind: 'block', description: '台阶', values: [], platform: 'vanilla' },
  {
    tagId: 'minecraft:fences',
    kind: 'block',
    description: '栅栏',
    values: [],
    platform: 'vanilla',
  },
  { tagId: 'minecraft:doors', kind: 'block', description: '门', values: [], platform: 'vanilla' },
  {
    tagId: 'minecraft:trapdoors',
    kind: 'block',
    description: '活板门',
    values: [],
    platform: 'vanilla',
  },
  {
    tagId: 'minecraft:immobile',
    kind: 'block',
    description: '不可移动（活塞）',
    values: [],
    platform: 'vanilla',
  },
];

/** Fabric 常用标签预设 */
export const FABRIC_TAG_PRESETS: TagPreset[] = [
  {
    tagId: 'fabric:pickaxes',
    kind: 'item',
    description: 'Fabric 镐',
    values: [],
    platform: 'fabric',
  },
  { tagId: 'fabric:axes', kind: 'item', description: 'Fabric 斧', values: [], platform: 'fabric' },
  {
    tagId: 'fabric:shovels',
    kind: 'item',
    description: 'Fabric 锹',
    values: [],
    platform: 'fabric',
  },
  { tagId: 'fabric:hoes', kind: 'item', description: 'Fabric 锄', values: [], platform: 'fabric' },
  {
    tagId: 'fabric:swords',
    kind: 'item',
    description: 'Fabric 剑',
    values: [],
    platform: 'fabric',
  },
  {
    tagId: 'fabric:tools',
    kind: 'item',
    description: 'Fabric 所有工具',
    values: [],
    platform: 'fabric',
  },
  {
    tagId: 'fabric:armor',
    kind: 'item',
    description: 'Fabric 盔甲',
    values: [],
    platform: 'fabric',
  },
  {
    tagId: 'fabric:mining_level/1',
    kind: 'item',
    description: 'Fabric 采矿等级 1（铁）',
    values: [],
    platform: 'fabric',
  },
  {
    tagId: 'fabric:mining_level/2',
    kind: 'item',
    description: 'Fabric 采矿等级 2（钻石）',
    values: [],
    platform: 'fabric',
  },
  {
    tagId: 'fabric:mining_level/3',
    kind: 'item',
    description: 'Fabric 采矿等级 3（下界合金）',
    values: [],
    platform: 'fabric',
  },
  { tagId: 'c:ingots', kind: 'item', description: 'Common ingots', values: [], platform: 'fabric' },
  {
    tagId: 'c:nuggets',
    kind: 'item',
    description: 'Common nuggets',
    values: [],
    platform: 'fabric',
  },
  { tagId: 'c:gems', kind: 'item', description: 'Common gems', values: [], platform: 'fabric' },
  { tagId: 'c:ores', kind: 'item', description: 'Common ores', values: [], platform: 'fabric' },
  {
    tagId: 'c:storage_blocks',
    kind: 'block',
    description: 'Common storage blocks',
    values: [],
    platform: 'fabric',
  },
];

/** Forge/NeoForge 常用标签预设 */
export const FORGE_TAG_PRESETS: TagPreset[] = [
  {
    tagId: 'forge:ingots',
    kind: 'item',
    description: 'Forge ingots',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:nuggets',
    kind: 'item',
    description: 'Forge nuggets',
    values: [],
    platform: 'forge',
  },
  { tagId: 'forge:gems', kind: 'item', description: 'Forge gems', values: [], platform: 'forge' },
  { tagId: 'forge:ores', kind: 'item', description: 'Forge ores', values: [], platform: 'forge' },
  {
    tagId: 'forge:storage_blocks',
    kind: 'block',
    description: 'Forge storage blocks',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:tools/pickaxes',
    kind: 'item',
    description: 'Forge pickaxes',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:tools/axes',
    kind: 'item',
    description: 'Forge axes',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:tools/shovels',
    kind: 'item',
    description: 'Forge shovels',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:tools/swords',
    kind: 'item',
    description: 'Forge swords',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:armor/helmets',
    kind: 'item',
    description: 'Forge helmets',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:armor/chestplates',
    kind: 'item',
    description: 'Forge chestplates',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:armor/leggings',
    kind: 'item',
    description: 'Forge leggings',
    values: [],
    platform: 'forge',
  },
  {
    tagId: 'forge:armor/boots',
    kind: 'item',
    description: 'Forge boots',
    values: [],
    platform: 'forge',
  },
];

/** 所有标签预设 */
export const ALL_TAG_PRESETS: TagPreset[] = [
  ...VANILLA_ITEM_TAG_PRESETS,
  ...VANILLA_BLOCK_TAG_PRESETS,
  ...FABRIC_TAG_PRESETS,
  ...FORGE_TAG_PRESETS,
];
