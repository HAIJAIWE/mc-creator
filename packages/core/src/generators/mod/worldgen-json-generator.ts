/**
 * 世界生成 datapack JSON 生成器（loader 无关：NeoForge/Forge 共用）。
 *
 * 背景：生物群系/维度/结构在 1.20.1 属于动态注册表（数据驱动），正确机制是
 * 数据包 JSON（data/<ns>/worldgen/...），而非 Java 侧 Registry/DeferredRegister。
 * 此处按原版 codec 形状发射最小可用 JSON；Java 侧只保留 ID 常量作引用。
 */
import type { FileNode } from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

/** "ns:path" 拆分为 [ns, path]；无冒号时 ns 取 modId */
function splitId(id: string, modId: string): [string, string] {
  const i = id.indexOf(':');
  if (i < 0) return [modId, id];
  return [id.slice(0, i), id.slice(i + 1)];
}

/** 生物群系 worldgen/biome JSON（1.20.1 codec 形状：effects/temperature/downfall/features/spawners） */
export function worldgenBiomeJson(spec: ModSpecLike): FileNode[] {
  return (spec.biomes ?? []).map((b) => {
    const effects: Record<string, unknown> = {
      fog_color: b.fogColor,
      sky_color: b.skyColor,
      water_color: b.waterColor,
      water_fog_color: b.waterFogColor,
    };
    if (b.grassColor !== undefined) effects['grass_color'] = b.grassColor;
    if (b.foliageColor !== undefined) effects['foliage_color'] = b.foliageColor;
    const json: Record<string, unknown> = {
      carvers: {},
      downfall: b.downfall,
      effects,
      features: [],
      has_precipitation: b.precipitation !== 'none',
      spawn_costs: {},
      spawners: {},
      temperature: b.temperature,
    };
    if (b.temperatureModifier === 'frozen') json['temperature_modifier'] = 'frozen';
    return {
      path: `src/main/resources/data/${spec.modId}/worldgen/biome/${b.biomeId}.json`,
      content: JSON.stringify(json, null, 2),
    };
  });
}

/**
 * 维度 JSON（两份：dimension_type + dimension）。
 * dimension 的 generator 用 flat 占位（可加载；真实地形请替换为 noise 配置）。
 */
export function worldgenDimensionJson(spec: ModSpecLike): FileNode[] {
  const files: FileNode[] = [];
  for (const d of spec.dimensions ?? []) {
    const infiniburn = `minecraft:infiniburn_${d.baseType === 'nether' ? 'nether' : 'overworld'}`;
    const effects = d.effects === 'none' ? 'minecraft:overworld' : `minecraft:${d.effects}`;
    const typeJson: Record<string, unknown> = {
      ambient_light: d.ambientLight,
      bed_works: d.bedWorks,
      coordinate_scale: d.coordinateScale,
      effects,
      has_ceiling: d.hasCeiling,
      has_raids: !d.piglinSafe,
      has_skylight: d.hasSkyLight,
      height: d.height,
      infiniburn,
      logical_height: d.logicalHeight,
      min_y: d.minY,
      monster_spawn_block_light_limit: 0,
      monster_spawn_light_level: {
        type: 'minecraft:uniform',
        value: { max_inclusive: 7, min_inclusive: 0 },
      },
      natural: d.natural,
      piglin_safe: d.piglinSafe,
      respawn_anchor_works: d.respawnAnchorWorks,
      ultrawarm: d.ultrawarm,
    };
    if (d.fixedTime !== null) typeJson['fixed_time'] = d.fixedTime;
    files.push({
      path: `src/main/resources/data/${spec.modId}/dimension_type/${d.dimensionId}.json`,
      content: JSON.stringify(typeJson, null, 2),
    });
    files.push({
      path: `src/main/resources/data/${spec.modId}/dimension/${d.dimensionId}.json`,
      content: JSON.stringify(
        {
          type: `${spec.modId}:${d.dimensionId}`,
          generator: {
            type: 'minecraft:flat',
            settings: {
              biome: 'minecraft:plains',
              layers: [
                { block: 'minecraft:bedrock', height: 1 },
                { block: 'minecraft:dirt', height: 2 },
                { block: 'minecraft:grass_block', height: 1 },
              ],
              structures: { structures: {} },
            },
          },
        },
        null,
        2,
      ),
    });
  }
  return files;
}

/**
 * 结构 JSON（三份：worldgen/structure + structure_set + template_pool）。
 * template_pool 发空元素 + fallback（可加载；实际拼图需用户补 elements）。
 */
export function worldgenStructureJson(spec: ModSpecLike): FileNode[] {
  const files: FileNode[] = [];
  for (const s of spec.structures ?? []) {
    files.push({
      path: `src/main/resources/data/${spec.modId}/worldgen/structure/${s.structureId}.json`,
      content: JSON.stringify(
        {
          type: 'minecraft:jigsaw',
          biomes: s.biomes,
          max_distance_from_center: s.maxDistance,
          project_start_to_heightmap: 'WORLD_SURFACE_WG',
          size: s.size,
          spawn_overrides: {},
          start_pool: s.startPool,
          step: 'surface_structures',
          terrain_adaptation: s.terrainAdaptation,
        },
        null,
        2,
      ),
    });
    files.push({
      path: `src/main/resources/data/${spec.modId}/worldgen/structure_set/${s.structureId}.json`,
      content: JSON.stringify(
        {
          structures: [{ structure: `${spec.modId}:${s.structureId}`, weight: 1 }],
          placement: {
            type: 'minecraft:random_spread',
            salt: s.salt,
            separation: s.separation,
            spacing: s.spacing,
            spread_type: 'triangular',
          },
        },
        null,
        2,
      ),
    });
    const [poolNs, poolPath] = splitId(s.startPool, spec.modId);
    files.push({
      path: `src/main/resources/data/${poolNs}/worldgen/template_pool/${poolPath}.json`,
      content: JSON.stringify({ fallback: 'minecraft:empty', elements: [] }, null, 2),
    });
  }
  return files;
}
