/**
 * MC 常用世界生成预设：维度/生物群系/结构模板。
 * 用于快速创建自定义维度和生物群系。
 */

export interface WorldgenPreset {
  /** 预设名称 */
  name: string;
  /** 描述 */
  description: string;
  /** 预设内容（JSON 可序列化对象） */
  data: Record<string, unknown>;
}

/** 维度类型预设 */
export const DIMENSION_TYPE_PRESETS: WorldgenPreset[] = [
  {
    name: '类主世界',
    description: '正常昼夜、天空光、Y -64~319',
    data: {
      fixedTime: null,
      hasSkyLight: true,
      hasCeiling: false,
      ultraWarm: false,
      natural: true,
      coordinateScale: 1.0,
      bedWorks: true,
      respawnAnchorWorks: false,
      minY: -64,
      height: 384,
      logicalHeight: 384,
      infiniburn: '#minecraft:infiniburn_overworld',
      effects: 'minecraft:overworld',
      ambientLight: 0,
      piglinSafe: false,
    },
  },
  {
    name: '类地狱',
    description: '永昼、无天空光、有天花板、坐标 8x、床爆炸',
    data: {
      fixedTime: 18000,
      hasSkyLight: false,
      hasCeiling: true,
      ultraWarm: true,
      natural: false,
      coordinateScale: 8.0,
      bedWorks: false,
      respawnAnchorWorks: true,
      minY: 0,
      height: 256,
      logicalHeight: 128,
      infiniburn: '#minecraft:infiniburn_nether',
      effects: 'minecraft:the_nether',
      ambientLight: 0.1,
      piglinSafe: true,
    },
  },
  {
    name: '类末地',
    description: '暗、无天空光、无天花板、重生锚不可用',
    data: {
      fixedTime: 6000,
      hasSkyLight: false,
      hasCeiling: false,
      ultraWarm: false,
      natural: false,
      coordinateScale: 1.0,
      bedWorks: false,
      respawnAnchorWorks: false,
      minY: 0,
      height: 256,
      logicalHeight: 256,
      infiniburn: '#minecraft:infiniburn_end',
      effects: 'minecraft:the_end',
      ambientLight: 0,
      piglinSafe: false,
    },
  },
  {
    name: '永昼天堂',
    description: '固定正午、天空光、无怪物',
    data: {
      fixedTime: 6000,
      hasSkyLight: true,
      hasCeiling: false,
      ultraWarm: false,
      natural: true,
      coordinateScale: 1.0,
      bedWorks: true,
      respawnAnchorWorks: false,
      minY: -64,
      height: 384,
      logicalHeight: 384,
      infiniburn: '#minecraft:infiniburn_overworld',
      effects: 'minecraft:overworld',
      ambientLight: 0,
      piglinSafe: false,
    },
  },
  {
    name: '深海虚空',
    description: '永暗、无天花板、水下效果',
    data: {
      fixedTime: 18000,
      hasSkyLight: false,
      hasCeiling: false,
      ultraWarm: false,
      natural: true,
      coordinateScale: 1.0,
      bedWorks: false,
      respawnAnchorWorks: true,
      minY: -64,
      height: 384,
      logicalHeight: 384,
      infiniburn: '#minecraft:infiniburn_overworld',
      effects: 'minecraft:overworld',
      ambientLight: 0,
      piglinSafe: false,
    },
  },
];

/** 生物群系预设 */
export const BIOME_PRESETS: WorldgenPreset[] = [
  {
    name: '平原',
    description: '标准草地、降雨、温度 0.5',
    data: {
      precipitation: 'rain',
      temperature: 0.5,
      temperatureModifier: 'none',
      downfall: 0.4,
      skyColor: 7907327,
      waterColor: 4159204,
      waterFogColor: 329011,
      fogColor: 12638463,
      surfaceBuilder: 'minecraft:grass',
    },
  },
  {
    name: '沙漠',
    description: '无雨、高温、沙地',
    data: {
      precipitation: 'none',
      temperature: 2.0,
      temperatureModifier: 'none',
      downfall: 0,
      skyColor: 7237230,
      waterColor: 4159204,
      waterFogColor: 329011,
      fogColor: 12638463,
      surfaceBuilder: 'minecraft:sand',
    },
  },
  {
    name: '雪原',
    description: '降雪、低温',
    data: {
      precipitation: 'snow',
      temperature: -0.5,
      temperatureModifier: 'none',
      downfall: 0.5,
      skyColor: 8364538,
      waterColor: 4058272,
      waterFogColor: 329011,
      fogColor: 12638463,
      surfaceBuilder: 'minecraft:grass',
    },
  },
  {
    name: '针叶林',
    description: '降雨、低温 0.25、深草',
    data: {
      precipitation: 'rain',
      temperature: 0.25,
      temperatureModifier: 'none',
      downfall: 0.8,
      skyColor: 8233983,
      waterColor: 4159204,
      waterFogColor: 329011,
      fogColor: 12638463,
      surfaceBuilder: 'minecraft:grass',
    },
  },
  {
    name: '水晶荒原',
    description: '自定义：微温、降紫水晶粒、深蓝天空',
    data: {
      precipitation: 'none',
      temperature: 0.3,
      temperatureModifier: 'none',
      downfall: 0,
      skyColor: 0x0a0a2e,
      waterColor: 0x1a1a4e,
      waterFogColor: 0x0a0a2e,
      fogColor: 0x14143c,
      grassColor: 0x6060ff,
      foliageColor: 0x8080ff,
      surfaceBuilder: 'minecraft:stone',
    },
  },
];

/** 维度生成器预设 */
export const DIMENSION_PRESETS: WorldgenPreset[] = [
  {
    name: 'Noise 地表世界',
    description: '类主世界地形，多噪声生物群系',
    data: {
      generatorType: 'noise',
      biomeSource: 'multi_noise',
      noiseSettings: 'minecraft:overworld',
      biomes: ['minecraft:plains', 'minecraft:forest', 'minecraft:desert'],
    },
  },
  {
    name: '平坦世界',
    description: '经典超平坦：基岩+2石+1土+1草',
    data: {
      generatorType: 'flat',
      biomeSource: 'fixed',
      biomes: ['minecraft:plains'],
      flatLayers: [
        { block: 'minecraft:bedrock', height: 1 },
        { block: 'minecraft:stone', height: 2 },
        { block: 'minecraft:dirt', height: 1 },
        { block: 'minecraft:grass_block', height: 1 },
      ],
    },
  },
  {
    name: '虚空世界',
    description: '空岛：仅一个方块',
    data: {
      generatorType: 'void',
      biomeSource: 'fixed',
      biomes: ['minecraft:the_void'],
    },
  },
  {
    name: '末地式',
    description: '末地生物群系源 + 浮岛',
    data: {
      generatorType: 'noise',
      biomeSource: 'the_end',
      noiseSettings: 'minecraft:overworld',
    },
  },
];

/** 所有世界生成预设 */
export const ALL_WORLDGEN_PRESETS: WorldgenPreset[] = [
  ...DIMENSION_TYPE_PRESETS,
  ...BIOME_PRESETS,
  ...DIMENSION_PRESETS,
];
