/** 世界生成 → JSON 内容 writer（无实例状态）。 */
import type {
  BiomeSpec,
  ConfiguredFeatureSpec,
  DensityFunctionSpec,
  DimensionSpec,
  DimensionTypeSpec,
  FileNode,
  FlatPresetSpec,
  NoiseSettingsSpec,
  NoiseSpec,
  PlacedFeatureSpec,
  ProcessorListSpec,
  StructureSetSpec,
  StructureSpec,
  TemplatePoolSpec,
} from '@mc-creator/shared';
import { resolveSurfaceRule, safeJsonParse, sanitizePathSegment } from './common.js';

/** 世界生成：维度类型 → data/<namespace>/dimension_type/<id>.json */
export function generateDimensionType(namespace: string, dt: DimensionTypeSpec): FileNode {
  const obj: Record<string, unknown> = {
    has_skylight: dt.hasSkyLight,
    has_ceiling: dt.hasCeiling,
    ultrawarm: dt.ultraWarm,
    natural: dt.natural,
    coordinate_scale: dt.coordinateScale,
    bed_works: dt.bedWorks,
    respawn_anchor_works: dt.respawnAnchorWorks,
    min_y: dt.minY,
    height: dt.height,
    logical_height: dt.logicalHeight,
    infiniburn: dt.infiniburn,
    effects:
      dt.effects === 'overworld'
        ? 'minecraft:overworld'
        : dt.effects === 'the_nether'
          ? 'minecraft:the_nether'
          : dt.effects === 'the_end'
            ? 'minecraft:the_end'
            : 'minecraft:overworld',
    ambient_light: dt.ambientLight,
    piglin_safe: dt.piglinSafe,
  };
  // P2 dogfood 修复：fixedTime 为 null 时省略字段（Minecraft 规范要求省略而非设为 null）
  if (dt.fixedTime !== null && dt.fixedTime !== undefined) {
    obj.fixed_time = dt.fixedTime;
  }
  return {
    path: `data/${namespace}/dimension_type/${sanitizePathSegment(dt.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 世界生成：噪声设置 → data/<namespace>/worldgen/noise_settings/<id>.json */
export function generateNoiseSettings(namespace: string, ns: NoiseSettingsSpec): FileNode {
  const obj: Record<string, unknown> = {
    noise: {
      min_y: ns.minY,
      height: ns.height,
      size_horizontal: ns.noiseSizeHorizontal,
      size_vertical: ns.noiseSizeVertical,
    },
    // P2 dogfood：densityFunction 应为对象（密度函数 JSON），不是字符串 ID
    // 若为 JSON 字符串则解析，否则原样保留（向后兼容）
    density_function:
      typeof ns.densityFunction === 'string'
        ? safeJsonParse(ns.densityFunction, ns.densityFunction)
        : ns.densityFunction,
  };
  if (ns.noiseRouter) {
    obj.noise_router = ns.noiseRouter;
  }
  return {
    path: `data/${namespace}/worldgen/noise_settings/${sanitizePathSegment(ns.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 世界生成：生物群系 → data/<namespace>/worldgen/biome/<id>.json */
export function generateBiome(namespace: string, b: BiomeSpec): FileNode {
  const effectsObj: Record<string, unknown> = {
    sky_color: b.skyColor,
    water_color: b.waterColor,
    water_fog_color: b.waterFogColor,
    fog_color: b.fogColor,
  };
  if (b.grassColor !== undefined) effectsObj.grass_color = b.grassColor;
  if (b.foliageColor !== undefined) effectsObj.foliage_color = b.foliageColor;

  const obj: Record<string, unknown> = {
    precipitation: b.precipitation,
    temperature: b.temperature,
    temperature_modifier: b.temperatureModifier === 'frozen' ? 'frozen' : 'none',
    downfall: b.downfall,
    effects: effectsObj,
  };
  // P2 dogfood：1.18+ 废弃 surface_builder，1.21+ 忽略该字段，改用 surface_rule。
  // 取值优先级：spec.surfaceRule（完整 JSON 对象）> surfaceBuilder 字符串映射 > 无字段。
  const surfaceRule = resolveSurfaceRule(b.surfaceRule, b.surfaceBuilder);
  if (surfaceRule) obj.surface_rule = surfaceRule;
  return {
    path: `data/${namespace}/worldgen/biome/${sanitizePathSegment(b.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 世界生成：维度 → data/<namespace>/dimension/<id>.json */
export function generateDimension(namespace: string, d: DimensionSpec): FileNode {
  let generator: Record<string, unknown>;

  if (d.generatorType === 'flat') {
    generator = {
      type: 'minecraft:flat',
      settings: {
        layers: d.flatLayers.map((l) => ({ block: l.block, height: l.height })),
        biome: d.biomes[0] ?? 'minecraft:plains',
      },
    };
  } else if (d.generatorType === 'debug') {
    generator = { type: 'minecraft:debug' };
  } else if (d.generatorType === 'void') {
    generator = {
      type: 'minecraft:flat',
      settings: { layers: [], biome: d.biomes[0] ?? 'minecraft:the_void' },
    };
  } else {
    // noise（默认）
    let biomeSource: Record<string, unknown>;
    if (d.biomeSource === 'fixed') {
      biomeSource = {
        type: 'minecraft:fixed',
        biome: d.biomes[0] ?? 'minecraft:plains',
      };
    } else if (d.biomeSource === 'checkerboard') {
      biomeSource = {
        type: 'minecraft:checkerboard',
        biomes: d.biomes,
      };
    } else if (d.biomeSource === 'the_end') {
      biomeSource = { type: 'minecraft:the_end' };
    } else {
      // multi_noise
      if (d.multiNoiseParams && d.multiNoiseParams.length > 0) {
        // 详细多噪声参数（含温度/湿度/大陆度/侵蚀噪声点）
        biomeSource = {
          type: 'minecraft:multi_noise',
          biomes: d.multiNoiseParams.map((p) => ({
            biome: p.biome,
            temperature: p.temperature,
            humidity: p.humidity,
            continentalness: p.continentalness,
            erosion: p.erosion,
            weirdness: p.weirdness,
            offset: p.offset,
          })),
        };
      } else {
        // 简易多噪声（仅生物群系 ID）
        biomeSource = {
          type: 'minecraft:multi_noise',
          biomes: d.biomes.map((b) => ({ biome: b })),
        };
      }
    }
    generator = {
      type: 'minecraft:noise',
      settings: d.noiseSettings,
      biome_source: biomeSource,
    };
  }

  const obj = {
    type: d.dimensionType,
    generator,
  };
  return {
    path: `data/${namespace}/dimension/${sanitizePathSegment(d.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 自定义结构 → data/<namespace>/worldgen/structure/<id>.json */
export function generateStructure(namespace: string, s: StructureSpec): FileNode {
  // G-12 修复：structure JSON 的 type 是结构实现类型（jigsaw），
  // 不是 placementType（random_spread/concentric_rings 属于 structure_set 的 placement 字段）。
  // jigsaw 结构用 start_pool 指定起始模板池（原 template_pools 字段不存在，无法加载）。
  const obj: Record<string, unknown> = {
    type: 'minecraft:jigsaw',
    biomes: s.biomes,
    size: s.size,
    start_height: safeJsonParse(s.startHeight, {
      type: 'minecraft:uniform',
      min: { absolute: 0 },
      max: { absolute: 63 },
    }),
    step: s.step,
    use_expansion_hack: s.useExpansionHack,
    start_pool: s.templatePool,
    max_distance_from_center: s.maxDistance,
    // Task E：jigsaw 递归深度
    max_depth: s.maxDepth,
  };
  return {
    path: `data/${namespace}/worldgen/structure/${sanitizePathSegment(s.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 结构集 → data/<namespace>/worldgen/structure_set/<id>.json（1.16.2+） */
export function generateStructureSet(namespace: string, ss: StructureSetSpec): FileNode {
  const placementObj: Record<string, unknown> = {
    type: ss.placement.type,
    spacing: ss.placement.spacing,
    separation: ss.placement.separation,
    salt: ss.placement.salt,
  };
  if (ss.placement.frequency !== undefined) {
    placementObj.frequency = ss.placement.frequency;
  }
  if (ss.placement.frequencyModifier !== undefined) {
    placementObj.frequency_modifier = ss.placement.frequencyModifier;
  }

  const obj = {
    structures: ss.structures.map((s) => ({
      structure: s.structure,
      weight: s.weight,
    })),
    placement: placementObj,
  };
  return {
    path: `data/${namespace}/worldgen/structure_set/${sanitizePathSegment(ss.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 已配置特性 → data/<namespace>/worldgen/configured_feature/<id>.json */
export function generateConfiguredFeature(namespace: string, cf: ConfiguredFeatureSpec): FileNode {
  const obj = {
    type: cf.type.startsWith('minecraft:') ? cf.type : `minecraft:${cf.type}`,
    config: cf.config,
  };
  return {
    path: `data/${namespace}/worldgen/configured_feature/${sanitizePathSegment(cf.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 已放置特性 → data/<namespace>/worldgen/placed_feature/<id>.json */
export function generatePlacedFeature(namespace: string, pf: PlacedFeatureSpec): FileNode {
  const obj = {
    feature: pf.feature,
    placement: pf.placements,
  };
  return {
    path: `data/${namespace}/worldgen/placed_feature/${sanitizePathSegment(pf.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 模板池 → data/<namespace>/worldgen/template_pool/<id>.json */
export function generateTemplatePool(namespace: string, pool: TemplatePoolSpec): FileNode {
  const obj = {
    fallback: pool.fallback,
    elements: pool.entries.map((e) => ({
      weight: e.weight,
      element: {
        element_type: 'minecraft:single_pool_element',
        location: e.template,
        // Task E：自定义处理器列表（留空用 minecraft:empty）
        processors: e.processors || 'minecraft:empty',
        projection: e.projection,
      },
    })),
  };
  return {
    path: `data/${namespace}/worldgen/template_pool/${sanitizePathSegment(pool.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 处理器列表 → data/<namespace>/worldgen/processor_list/<id>.json */
export function generateProcessorList(namespace: string, pl: ProcessorListSpec): FileNode {
  const obj = {
    processors: pl.processors.map((p) => ({
      processor_type: p.type.startsWith('minecraft:') ? p.type : `minecraft:${p.type}`,
      ...p.config,
    })),
  };
  return {
    path: `data/${namespace}/worldgen/processor_list/${sanitizePathSegment(pl.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}

/** 密度函数 → data/<namespace>/worldgen/density_function/<id>.json（1.18+） */
export function generateDensityFunction(namespace: string, df: DensityFunctionSpec): FileNode {
  return {
    path: `data/${namespace}/worldgen/density_function/${sanitizePathSegment(df.id)}.json`,
    content: JSON.stringify(df.function, null, 2),
  };
}

/** 噪声参数 → data/<namespace>/worldgen/noise/<id>.json（1.18+） */
export function generateNoise(namespace: string, nz: NoiseSpec): FileNode {
  return {
    path: `data/${namespace}/worldgen/noise/${sanitizePathSegment(nz.id)}.json`,
    content: JSON.stringify(nz.parameters, null, 2),
  };
}

/** 超平坦预设 → data/<namespace>/worldgen/flat_level_generator_preset/<id>.json（1.18+） */
export function generateFlatPreset(namespace: string, fp: FlatPresetSpec): FileNode {
  const obj: Record<string, unknown> = {
    display_name: fp.displayName,
    settings: {
      biome: fp.biome,
      features: fp.features,
      layers: fp.layers,
    },
  };
  return {
    path: `data/${namespace}/worldgen/flat_level_generator_preset/${sanitizePathSegment(fp.id)}.json`,
    content: JSON.stringify(obj, null, 2),
  };
}
