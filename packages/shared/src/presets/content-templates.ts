/**
 * MC 内容模板：一键生成完整的 MC 内容套件。
 * 如"添加一种新矿石"→ 矿石+矿锭+矿粒+存储方块+工具+盔甲+全套配方+标签+语言文件
 */

import type {
  DatapackSpec,
  RecipeSpec,
  SimpleTagSpec,
  DatapackEnchantmentSpec,
  StatusEffectSpec,
  StructureSpec,
} from '../schemas/datapack-spec.js';

/** 模板参数 */
export interface TemplateParams {
  /** Mod ID（如 my_mod） */
  modId: string;
  /** 材料名（如 ruby, sapphire, copper） */
  materialName: string;
  /** 材料名中文翻译 */
  materialNameZh: string;
  /** packFormat */
  packFormat?: number;
}

/** 新矿石模板：矿石 → 原矿 → 矿锭 → 矿粒 → 存储方块 + 全套工具 + 全套盔甲 */
export function newOreTemplate(params: TemplateParams): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;

  const recipes: Partial<RecipeSpec>[] = [];
  const itemTags: Partial<SimpleTagSpec>[] = [];
  const blockTags: Partial<SimpleTagSpec>[] = [];

  // === 配方 ===

  // 矿石→矿锭（熔炼）
  recipes.push({
    id: `${mn}_ore_smelting`,
    type: 'smelting',
    ingredient: `${ns}:${mn}_ore`,
    result: `${ns}:${mn}_ingot`,
    experience: 1.0,
    cookingTime: 200,
  });
  // 矿石→矿锭（高炉）
  recipes.push({
    id: `${mn}_ore_blasting`,
    type: 'blasting',
    ingredient: `${ns}:${mn}_ore`,
    result: `${ns}:${mn}_ingot`,
    experience: 1.0,
    cookingTime: 100,
  });
  // 原矿→矿锭（熔炼）
  recipes.push({
    id: `raw_${mn}_smelting`,
    type: 'smelting',
    ingredient: `${ns}:raw_${mn}`,
    result: `${ns}:${mn}_ingot`,
    experience: 0.7,
    cookingTime: 200,
  });

  // 9 矿锭→存储方块（有序合成）
  recipes.push({
    id: `${mn}_block_from_ingots`,
    type: 'crafting_shaped',
    pattern: ['III', 'III', 'III'],
    key: { I: [`${ns}:${mn}_ingot`] },
    result: `${ns}:${mn}_block`,
    count: 1,
  });
  // 存储方块→9 矿锭（无形合成）
  recipes.push({
    id: `${mn}_ingots_from_block`,
    type: 'crafting_shapeless',
    ingredients: [`${ns}:${mn}_block`],
    result: `${ns}:${mn}_ingot`,
    count: 9,
  });

  // 9 矿粒→矿锭
  recipes.push({
    id: `${mn}_ingot_from_nuggets`,
    type: 'crafting_shaped',
    pattern: ['NNN', 'NNN', 'NNN'],
    key: { N: [`${ns}:${mn}_nugget`] },
    result: `${ns}:${mn}_ingot`,
    count: 1,
  });
  // 矿锭→9 矿粒
  recipes.push({
    id: `${mn}_nuggets_from_ingot`,
    type: 'crafting_shapeless',
    ingredients: [`${ns}:${mn}_ingot`],
    result: `${ns}:${mn}_nugget`,
    count: 9,
  });

  // === 工具配方 ===
  const toolPatterns: {
    name: string;
    pattern: string[];
    key: Record<string, string[]>;
    result: string;
  }[] = [
    {
      name: 'pickaxe',
      pattern: ['III', ' S ', ' S '],
      key: { I: [`${ns}:${mn}_ingot`], S: ['minecraft:stick'] },
      result: `${ns}:${mn}_pickaxe`,
    },
    {
      name: 'axe',
      pattern: ['II', 'IS', ' S'],
      key: { I: [`${ns}:${mn}_ingot`], S: ['minecraft:stick'] },
      result: `${ns}:${mn}_axe`,
    },
    {
      name: 'shovel',
      pattern: ['I', 'S', 'S'],
      key: { I: [`${ns}:${mn}_ingot`], S: ['minecraft:stick'] },
      result: `${ns}:${mn}_shovel`,
    },
    {
      name: 'hoe',
      pattern: ['II', ' S', ' S'],
      key: { I: [`${ns}:${mn}_ingot`], S: ['minecraft:stick'] },
      result: `${ns}:${mn}_hoe`,
    },
    {
      name: 'sword',
      pattern: ['I', 'I', 'S'],
      key: { I: [`${ns}:${mn}_ingot`], S: ['minecraft:stick'] },
      result: `${ns}:${mn}_sword`,
    },
  ];

  for (const tool of toolPatterns) {
    recipes.push({
      id: `${mn}_${tool.name}`,
      type: 'crafting_shaped',
      pattern: tool.pattern,
      key: tool.key,
      result: tool.result,
      count: 1,
    });
  }

  // === 盔甲配方 ===
  const armorPatterns: {
    name: string;
    pattern: string[];
    key: Record<string, string[]>;
    result: string;
  }[] = [
    {
      name: 'helmet',
      pattern: ['III', 'I I'],
      key: { I: [`${ns}:${mn}_ingot`] },
      result: `${ns}:${mn}_helmet`,
    },
    {
      name: 'chestplate',
      pattern: ['I I', 'III', 'III'],
      key: { I: [`${ns}:${mn}_ingot`] },
      result: `${ns}:${mn}_chestplate`,
    },
    {
      name: 'leggings',
      pattern: ['III', 'I I', 'I I'],
      key: { I: [`${ns}:${mn}_ingot`] },
      result: `${ns}:${mn}_leggings`,
    },
    {
      name: 'boots',
      pattern: ['I I', 'I I'],
      key: { I: [`${ns}:${mn}_ingot`] },
      result: `${ns}:${mn}_boots`,
    },
  ];

  for (const armor of armorPatterns) {
    recipes.push({
      id: `${mn}_${armor.name}`,
      type: 'crafting_shaped',
      pattern: armor.pattern,
      key: armor.key,
      result: armor.result,
      count: 1,
    });
  }

  // === 标签 ===
  // S-3 修复：tag 为短名（不带命名空间），命名空间由 SimpleTagSpec.namespace 承载
  // 物品标签
  itemTags.push(
    { namespace: ns, tag: `${mn}_ingots`, values: [`${ns}:${mn}_ingot`], replace: false },
    { namespace: ns, tag: `${mn}_nuggets`, values: [`${ns}:${mn}_nugget`], replace: false },
    { namespace: ns, tag: `${mn}_ores`, values: [`${ns}:${mn}_ore`], replace: false },
    { namespace: ns, tag: `raw_${mn}_ores`, values: [`${ns}:raw_${mn}`], replace: false },
  );
  // 方块标签
  blockTags.push({
    namespace: ns,
    tag: `${mn}_storage_blocks`,
    values: [`${ns}:${mn}_block`],
    replace: false,
  });

  // === 语言文件（通过 lang 函数返回） ===

  return {
    packId: ns,
    packName: `${ns} Datapack`,
    packFormat: params.packFormat ?? 48,
    recipes: recipes as RecipeSpec[],
    itemTags: itemTags as SimpleTagSpec[],
    blockTags: blockTags as SimpleTagSpec[],
  };
}

/** 新矿石模板——语言文件键值对 */
export function newOreLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;
  const ns = modId;
  const mn = materialName;

  const en: Record<string, string> = {};
  const zh: Record<string, string> = {};

  const entries: [string, string, string][] = [
    // 方块
    [`block.${ns}.${mn}_ore`, `${materialNameZh} Ore`, `${materialNameZh}矿石`],
    [`block.${ns}.${mn}_block`, `${materialNameZh} Block`, `${materialNameZh}块`],
    [
      `block.${ns}.deepslate_${mn}_ore`,
      `Deepslate ${materialNameZh} Ore`,
      `深板岩${materialNameZh}矿石`,
    ],
    // 物品
    [`item.${ns}.${mn}_ingot`, `${materialNameZh} Ingot`, `${materialNameZh}锭`],
    [`item.${ns}.${mn}_nugget`, `${materialNameZh} Nugget`, `${materialNameZh}粒`],
    [`item.${ns}.raw_${mn}`, `Raw ${materialNameZh}`, `粗${materialNameZh}`],
    // 工具
    [`item.${ns}.${mn}_pickaxe`, `${materialNameZh} Pickaxe`, `${materialNameZh}镐`],
    [`item.${ns}.${mn}_axe`, `${materialNameZh} Axe`, `${materialNameZh}斧`],
    [`item.${ns}.${mn}_shovel`, `${materialNameZh} Shovel`, `${materialNameZh}锹`],
    [`item.${ns}.${mn}_hoe`, `${materialNameZh} Hoe`, `${materialNameZh}锄`],
    [`item.${ns}.${mn}_sword`, `${materialNameZh} Sword`, `${materialNameZh}剑`],
    // 盔甲
    [`item.${ns}.${mn}_helmet`, `${materialNameZh} Helmet`, `${materialNameZh}头盔`],
    [`item.${ns}.${mn}_chestplate`, `${materialNameZh} Chestplate`, `${materialNameZh}胸甲`],
    [`item.${ns}.${mn}_leggings`, `${materialNameZh} Leggings`, `${materialNameZh}护腿`],
    [`item.${ns}.${mn}_boots`, `${materialNameZh} Boots`, `${materialNameZh}靴子`],
  ];

  for (const [key, enVal, zhVal] of entries) {
    en[key] = enVal;
    zh[key] = zhVal;
  }

  return { en, zh };
}

/** 新食物模板：食物 + 炉灶配方 + 狼/鹦鹉标签 */
export function newFoodTemplate(
  params: TemplateParams & { hunger: number; saturation: number },
): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;

  const recipes: Partial<RecipeSpec>[] = [];

  // 生的→熟的（烟熏）
  recipes.push({
    id: `cook_${mn}`,
    type: 'smoking',
    ingredient: `${ns}:raw_${mn}`,
    result: `${ns}:cooked_${mn}`,
    experience: 0.35,
    cookingTime: 100,
  });
  // 生的→熟的（营火）
  recipes.push({
    id: `campfire_cook_${mn}`,
    type: 'campfire_cooking',
    ingredient: `${ns}:raw_${mn}`,
    result: `${ns}:cooked_${mn}`,
    experience: 0.35,
    cookingTime: 600,
  });

  return {
    packId: ns,
    packName: `${ns} Food Pack`,
    packFormat: params.packFormat ?? 48,
    recipes: recipes as RecipeSpec[],
  };
}

/** 新食物模板——语言文件 */
export function newFoodLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;
  const ns = modId;
  const mn = materialName;

  return {
    // S-4 修复：语言 key 用点号分隔（item.<namespace>.<path>），原冒号格式无效
    en: {
      [`item.${ns}.raw_${mn}`]: `Raw ${materialNameZh}`,
      [`item.${ns}.cooked_${mn}`]: `Cooked ${materialNameZh}`,
    },
    zh: {
      [`item.${ns}.raw_${mn}`]: `生${materialNameZh}`,
      [`item.${ns}.cooked_${mn}`]: `熟${materialNameZh}`,
    },
  };
}

/** 新维度模板：维度类型 + 生物群系 + 维度 */
export function newDimensionTemplate(
  params: TemplateParams & {
    fixedTime?: number | null;
    hasSkyLight?: boolean;
    hasCeiling?: boolean;
    coordinateScale?: number;
  },
): Partial<DatapackSpec> {
  const {
    modId,
    materialName,
    fixedTime = null,
    hasSkyLight = true,
    hasCeiling = false,
    coordinateScale = 1.0,
  } = params;
  const ns = modId;
  const mn = materialName;

  return {
    packId: ns,
    packName: `${ns} Dimension Pack`,
    packFormat: params.packFormat ?? 48,
    dimensionTypes: [
      {
        id: `${mn}_dim_type`,
        fixedTime,
        hasSkyLight,
        hasCeiling,
        ultraWarm: false,
        natural: true,
        coordinateScale,
        bedWorks: true,
        respawnAnchorWorks: false,
        minY: -64,
        height: 384,
        logicalHeight: 384,
        infiniburn: '#minecraft:infiniburn_overworld',
        effects: 'overworld',
        ambientLight: 0,
        piglinSafe: false,
      },
    ],
    biomes: [
      {
        id: `${mn}_plains`,
        precipitation: 'rain',
        temperature: 0.5,
        temperatureModifier: 'none',
        downfall: 0.4,
        skyColor: 0x78a7ff,
        waterColor: 0x3f76e4,
        waterFogColor: 0x050533,
        fogColor: 0xc0d8ff,
        surfaceBuilder: 'minecraft:grass',
      },
    ],
    dimensions: [
      {
        id: `${mn}_dimension`,
        dimensionType: `${ns}:${mn}_dim_type`,
        generatorType: 'noise',
        biomeSource: 'multi_noise',
        biomes: [`${ns}:${mn}_plains`],
        noiseSettings: 'minecraft:overworld',
        flatLayers: [],
      },
    ],
  };
}

/** 新维度模板——语言文件 */
export function newDimensionLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;
  const ns = modId;
  const mn = materialName;

  return {
    // S-4 修复：语言 key 用点号分隔（dimension.<namespace>.<path> / biome.<namespace>.<path>）
    en: {
      [`dimension.${ns}.${mn}_dimension`]: `${materialNameZh} Dimension`,
      [`biome.${ns}.${mn}_plains`]: `${materialNameZh} Plains`,
    },
    zh: {
      [`dimension.${ns}.${mn}_dimension`]: `${materialNameZh}维度`,
      [`biome.${ns}.${mn}_plains`]: `${materialNameZh}平原`,
    },
  };
}

// ===== 新增模板：附魔 / 效果 / 结构 / 生物群系 =====

/** 附魔模板参数 */
export interface EnchantmentTemplateParams extends TemplateParams {
  /** 最大等级（默认 3） */
  maxLevel?: number;
  /** 附魔权重/稀有度（默认 10，越低越稀有） */
  weight?: number;
  /** 支持的物品标签（默认 #minecraft:enchantable/sword） */
  supportedItems?: string;
  /** 附魔槽位（默认 ['any']） */
  slots?: string[];
}

/** 新附魔模板：生成自定义附魔 + 语言文件 */
export function newEnchantmentTemplate(params: EnchantmentTemplateParams): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;
  const maxLevel = params.maxLevel ?? 3;
  const weight = params.weight ?? 10;
  const supportedItems = params.supportedItems ?? '#minecraft:enchantable/sword';
  const slots = params.slots ?? ['any'];

  const enchantments: Partial<DatapackEnchantmentSpec>[] = [
    {
      id: mn,
      description: `enchantment.${ns}.${mn}`,
      minLevel: 1,
      maxLevel,
      anvilCost: 1,
      maxCost: maxLevel * 2,
      weight,
      supportedItems,
      slots: slots as DatapackEnchantmentSpec['slots'],
      isCurse: false,
      isTreasure: false,
    },
  ];

  return {
    packId: ns,
    packName: `${ns} Enchantment Pack`,
    packFormat: params.packFormat ?? 48,
    enchantments: enchantments as DatapackEnchantmentSpec[],
  };
}

/** 新附魔模板——语言文件 */
export function newEnchantmentLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;
  const ns = modId;
  const mn = materialName;

  return {
    en: { [`enchantment.${ns}.${mn}`]: `${materialNameZh}` },
    zh: { [`enchantment.${ns}.${mn}`]: `${materialNameZh}` },
  };
}

/** 效果模板参数 */
export interface EffectTemplateParams extends TemplateParams {
  /** 颜色（0xRRGGBB，默认 0xFFFFFF 白色） */
  color?: number;
  /** 是否即时效果（默认 false） */
  instant?: boolean;
  /** 是否有益效果（默认 true） */
  beneficial?: boolean;
}

/** 新状态效果模板：生成自定义效果 + 语言文件 */
export function newEffectTemplate(params: EffectTemplateParams): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;

  const effects: Partial<StatusEffectSpec>[] = [
    {
      id: mn,
      description: `effect.${ns}.${mn}`,
      color: params.color ?? 0xffffff,
      instant: params.instant ?? false,
      beneficial: params.beneficial ?? true,
    },
  ];

  return {
    packId: ns,
    packName: `${ns} Effect Pack`,
    packFormat: params.packFormat ?? 48,
    effects: effects as StatusEffectSpec[],
  };
}

/** 新状态效果模板——语言文件 */
export function newEffectLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;
  const ns = modId;
  const mn = materialName;

  return {
    en: { [`effect.${ns}.${mn}`]: `${materialNameZh}` },
    zh: { [`effect.${ns}.${mn}`]: `${materialNameZh}` },
  };
}

/** 结构模板参数 */
export interface StructureTemplateParams extends TemplateParams {
  /** 模板池 ID（jigsaw 用，默认 minecraft:empty） */
  templatePool?: string;
  /** 放置类型（默认 jigsaw） */
  placementType?: 'jigsaw' | 'random_spread' | 'concentric_rings';
  /** 最大距离（默认 7） */
  maxDistance?: number;
  /** 生成范围/大小（默认 7） */
  size?: number;
  /** 生物群系标签（默认 #minecraft:is_overworld） */
  biomes?: string;
}

/** 新结构模板：生成自定义结构定义 + 语言文件 */
export function newStructureTemplate(params: StructureTemplateParams): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;

  const structures: Partial<StructureSpec>[] = [
    {
      id: mn,
      templatePool: params.templatePool ?? 'minecraft:empty',
      placementType: params.placementType ?? 'jigsaw',
      maxDistance: params.maxDistance ?? 7,
      size: params.size ?? 7,
      startHeight: '{"type":"minecraft:uniform","min":{"absolute":0},"max":{"absolute":63}}',
      biomes: params.biomes ?? '#minecraft:is_overworld',
      step: 'none',
      useExpansionHack: false,
    },
  ];

  return {
    packId: ns,
    packName: `${ns} Structure Pack`,
    packFormat: params.packFormat ?? 48,
    structures: structures as StructureSpec[],
  };
}

/** 新结构模板——语言文件 */
export function newStructureLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;

  return {
    en: { [`structure.${modId}.${materialName}`]: `${materialNameZh} Structure` },
    zh: { [`structure.${modId}.${materialName}`]: `${materialNameZh}结构` },
  };
}

/** 生物群系模板参数 */
export interface BiomeTemplateParams extends TemplateParams {
  /** 降水类型（默认 rain） */
  precipitation?: 'none' | 'rain' | 'snow';
  /** 温度（默认 0.5） */
  temperature?: number;
  /** 降雨量（默认 0.4） */
  downfall?: number;
  /** 天空颜色（默认 0x78A7FF） */
  skyColor?: number;
  /** 水颜色（默认 0x3F76E4） */
  waterColor?: number;
  /** 雾颜色（默认 0xC0D8FF） */
  fogColor?: number;
}

/** 新生物群系模板：生成自定义生物群系 + 语言文件 */
export function newBiomeTemplate(params: BiomeTemplateParams): Partial<DatapackSpec> {
  const { modId, materialName } = params;
  const ns = modId;
  const mn = materialName;

  return {
    packId: ns,
    packName: `${ns} Biome Pack`,
    packFormat: params.packFormat ?? 48,
    biomes: [
      {
        id: mn,
        precipitation: params.precipitation ?? 'rain',
        temperature: params.temperature ?? 0.5,
        temperatureModifier: 'none',
        downfall: params.downfall ?? 0.4,
        skyColor: params.skyColor ?? 0x78a7ff,
        waterColor: params.waterColor ?? 0x3f76e4,
        waterFogColor: 0x050533,
        fogColor: params.fogColor ?? 0xc0d8ff,
        surfaceBuilder: 'minecraft:grass',
      },
    ],
  };
}

/** 新生物群系模板——语言文件 */
export function newBiomeLangKeys(params: TemplateParams): {
  en: Record<string, string>;
  zh: Record<string, string>;
} {
  const { modId, materialName, materialNameZh } = params;

  return {
    en: { [`biome.${modId}.${materialName}`]: `${materialNameZh} Biome` },
    zh: { [`biome.${modId}.${materialName}`]: `${materialNameZh}生物群系` },
  };
}
