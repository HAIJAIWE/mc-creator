import type {
  FileNode,
  GeneratorContext,
  GenerationResult,
  Loader,
  McVersion,
} from '@mc-creator/shared';
import type { Generator } from '../types.js';
import type {
  DatapackSpec,
  RecipeSpec,
  TagSpec,
  FunctionSpec,
  AdvancementSpec,
  LootTableSpec,
  PredicateSpec,
  SimpleTagSpec,
  DimensionSpec,
  DimensionTypeSpec,
  BiomeSpec,
  NoiseSettingsSpec,
  DatapackEnchantmentSpec,
  StatusEffectSpec,
  DamageTypeSpec,
  StructureSpec,
  ParticleSpec,
  TrimPatternSpec,
  TrimMaterialSpec,
  InstrumentSpec,
  StructureSetSpec,
} from '@mc-creator/shared';

/**
 * 数据包生成器（路线图第 3 阶段）。
 * 生成 pack.mcmeta + data/<namespace>/ 下的 JSON/mcfunction 文件。
 * 数据包是原版功能，不需 loader adapter。
 */
export class DatapackGenerator implements Generator {
  readonly type = 'datapack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as DatapackSpec;
    const files: FileNode[] = [];

    // pack.mcmeta
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          pack: {
            pack_format: spec.packFormat,
            description: spec.description || spec.packName,
          },
        },
        null,
        2,
      ),
    });

    // 配方
    for (const recipe of spec.recipes ?? []) {
      files.push(this.generateRecipe(spec.packId, recipe));
    }

    // 标签
    for (const tag of spec.tags ?? []) {
      files.push(this.generateTag(spec.packId, tag));
    }

    // 函数
    for (const func of spec.functions ?? []) {
      files.push(this.generateFunction(spec.packId, func));
    }

    // 进度
    for (const adv of spec.advancements ?? []) {
      files.push(this.generateAdvancement(spec.packId, adv));
    }

    // P10 新增：战利品表
    for (const loot of spec.lootTables ?? []) {
      files.push(this.generateLootTable(loot));
    }

    // P10 新增：谓词
    for (const pred of spec.predicates ?? []) {
      files.push(this.generatePredicate(pred));
    }

    // P10 新增：itemTags
    for (const tag of spec.itemTags ?? []) {
      files.push(this.generateSimpleTag('item', tag));
    }

    // P10 新增：blockTags
    for (const tag of spec.blockTags ?? []) {
      files.push(this.generateSimpleTag('block', tag));
    }

    // 世界生成：维度类型
    for (const dt of spec.dimensionTypes ?? []) {
      files.push(this.generateDimensionType(spec.packId, dt));
    }

    // 世界生成：噪声设置
    for (const ns of spec.noiseSettings ?? []) {
      files.push(this.generateNoiseSettings(spec.packId, ns));
    }

    // 世界生成：生物群系
    for (const biome of spec.biomes ?? []) {
      files.push(this.generateBiome(spec.packId, biome));
    }

    // 世界生成：维度
    for (const dim of spec.dimensions ?? []) {
      files.push(this.generateDimension(spec.packId, dim));
    }

    // 自定义附魔
    for (const ench of spec.enchantments ?? []) {
      files.push(this.generateEnchantment(spec.packId, ench));
    }
    // 自定义状态效果
    for (const eff of spec.effects ?? []) {
      files.push(this.generateStatusEffect(spec.packId, eff));
    }
    // 自定义损伤类型
    for (const dt of spec.damageTypes ?? []) {
      files.push(this.generateDamageType(spec.packId, dt));
    }
    // 自定义结构
    for (const st of spec.structures ?? []) {
      files.push(this.generateStructure(spec.packId, st));
    }
    // 自定义粒子
    for (const p of spec.particles ?? []) {
      files.push(this.generateParticle(spec.packId, p));
    }
    // 盔甲纹饰
    for (const tp of spec.trimPatterns ?? []) {
      files.push(this.generateTrimPattern(spec.packId, tp));
    }
    for (const tm of spec.trimMaterials ?? []) {
      files.push(this.generateTrimMaterial(spec.packId, tm));
    }
    // 乐器
    for (const inst of spec.instruments ?? []) {
      files.push(this.generateInstrument(spec.packId, inst));
    }
    // 结构集
    for (const ss of spec.structureSets ?? []) {
      files.push(this.generateStructureSet(spec.packId, ss));
    }

    return {
      files,
      warnings: [],
      buildCmd: '', // 数据包不需要编译
    };
  }

  private generateRecipe(namespace: string, r: RecipeSpec): FileNode {
    let recipeObj: Record<string, unknown>;

    switch (r.type) {
      case 'crafting_shaped':
        recipeObj = {
          type: 'minecraft:crafting_shaped',
          pattern: r.pattern ?? [],
          key: r.key ?? {},
          result: { id: r.result, count: r.count },
        };
        break;
      case 'crafting_shapeless':
        recipeObj = {
          type: 'minecraft:crafting_shapeless',
          ingredients: (r.ingredients ?? []).map((i) => ({ id: i })),
          result: { id: r.result, count: r.count },
        };
        break;
      case 'smelting':
        recipeObj = {
          type: 'minecraft:smelting',
          ingredient: { id: r.ingredient ?? r.ingredients?.[0] ?? '' },
          result: r.result,
          experience: r.experience || 0.1,
          cookingtime: r.cookingTime,
        };
        break;
      case 'blasting':
        recipeObj = {
          type: 'minecraft:blasting',
          ingredient: { id: r.ingredient ?? r.ingredients?.[0] ?? '' },
          result: r.result,
          experience: r.experience || 0.1,
          cookingtime: r.cookingTime || 100,
        };
        break;
      case 'smoking':
        recipeObj = {
          type: 'minecraft:smoking',
          ingredient: { id: r.ingredient ?? r.ingredients?.[0] ?? '' },
          result: r.result,
          experience: r.experience || 0.1,
          cookingtime: r.cookingTime || 100,
        };
        break;
      case 'campfire_cooking':
        recipeObj = {
          type: 'minecraft:campfire_cooking',
          ingredient: { id: r.ingredient ?? r.ingredients?.[0] ?? '' },
          result: r.result,
          experience: r.experience || 0.1,
          cookingtime: r.cookingTime || 600,
        };
        break;
      case 'stonecutting':
        recipeObj = {
          type: 'minecraft:stonecutting',
          ingredient: { id: r.source ?? r.ingredients?.[0] ?? '' },
          result: r.result,
          count: r.count,
        };
        break;
      case 'smithing_transform':
        recipeObj = {
          type: 'minecraft:smithing_transform',
          template: { id: r.template ?? 'minecraft:netherite_upgrade_smithing_template' },
          base: { id: r.base ?? '' },
          addition: { id: r.addition ?? '' },
          result: { id: r.result },
        };
        break;
      case 'smithing_trim':
        recipeObj = {
          type: 'minecraft:smithing_trim',
          template: { id: r.template ?? '' },
          base: { id: r.base ?? '' },
          addition: { id: r.addition ?? '' },
        };
        break;
      case 'brewing':
        recipeObj = {
          type: 'minecraft:brewing',
          input: { potion: r.inputPotion ?? 'minecraft:water' },
          ingredient: { item: r.ingredientItem ?? '' },
          result: { potion: r.outputPotion ?? '' },
        };
        break;
      default:
        // 未知配方类型：生成基本结构
        recipeObj = {
          type: `minecraft:${r.type}`,
          result: { id: r.result, count: r.count },
        };
        break;
    }

    // 条件配方：添加 condition 字段
    if (r.condition) {
      try {
        recipeObj.condition = JSON.parse(r.condition);
      } catch {
        recipeObj.condition = r.condition;
      }
    }

    // 配方书分组
    if (r.group) {
      recipeObj.group = r.group;
    }

    // 解锁通知控制
    if (!r.showNotification) {
      recipeObj.show_notification = false;
    }

    return {
      path: `data/${namespace}/recipe/${r.id}.json`,
      content: JSON.stringify(recipeObj, null, 2),
    };
  }

  private generateTag(namespace: string, t: TagSpec): FileNode {
    return {
      path: `data/${namespace}/tags/${t.type}/${t.id}.json`,
      content: JSON.stringify({ replace: t.replace, values: t.values }, null, 2),
    };
  }

  private generateFunction(namespace: string, f: FunctionSpec): FileNode {
    return {
      path: `data/${namespace}/function/${f.id}.mcfunction`,
      content: f.commands.join('\n') + '\n',
    };
  }

  private generateAdvancement(namespace: string, a: AdvancementSpec): FileNode {
    const advObj = {
      display: {
        icon: { id: a.icon },
        title: a.title,
        description: a.description,
      },
      criteria: {
        trigger: {
          trigger: a.trigger,
          conditions: a.conditions ? JSON.parse(a.conditions) : {},
        },
      },
    };
    return {
      path: `data/${namespace}/advancement/${a.id}.json`,
      content: JSON.stringify(advObj, null, 2),
    };
  }

  /** P10：生成战利品表 → data/<namespace>/loot_tables/<type>/<path>.json */
  private generateLootTable(l: LootTableSpec): FileNode {
    const lootObj = {
      type: `minecraft:${l.type}`,
      pools: l.pools.map((p) => ({
        rolls: p.rolls,
        entries: p.entries.map((e) => ({
          type: 'minecraft:item',
          name: e.name,
          weight: e.weight,
          count: e.count,
        })),
      })),
    };
    return {
      path: `data/${l.namespace}/loot_tables/${l.type}/${l.path}.json`,
      content: JSON.stringify(lootObj, null, 2),
    };
  }

  /** P10：生成谓词 → data/<namespace>/predicates/<path>.json */
  private generatePredicate(p: PredicateSpec): FileNode {
    const predObj = {
      condition: JSON.parse(p.condition) as unknown,
    };
    return {
      path: `data/${p.namespace}/predicates/${p.path}.json`,
      content: JSON.stringify(predObj, null, 2),
    };
  }

  /** P10：生成 itemTag / blockTag → data/<namespace>/tags/<kind>/<tag>.json */
  private generateSimpleTag(kind: 'item' | 'block', t: SimpleTagSpec): FileNode {
    const tagObj = {
      replace: t.replace,
      values: t.values,
    };
    return {
      path: `data/${t.namespace}/tags/${kind}/${t.tag}.json`,
      content: JSON.stringify(tagObj, null, 2),
    };
  }

  /** 世界生成：维度类型 → data/<namespace>/dimension_type/<id>.json */
  private generateDimensionType(namespace: string, dt: DimensionTypeSpec): FileNode {
    const obj: Record<string, unknown> = {
      fixed_time: dt.fixedTime,
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
    return {
      path: `data/${namespace}/dimension_type/${dt.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 世界生成：噪声设置 → data/<namespace>/worldgen/noise_settings/<id>.json */
  private generateNoiseSettings(namespace: string, ns: NoiseSettingsSpec): FileNode {
    const obj: Record<string, unknown> = {
      noise: {
        min_y: ns.minY,
        height: ns.height,
        size_horizontal: ns.noiseSizeHorizontal,
        size_vertical: ns.noiseSizeVertical,
      },
      density_function: ns.densityFunction,
    };
    if (ns.noiseRouter) {
      obj.noise_router = ns.noiseRouter;
    }
    return {
      path: `data/${namespace}/worldgen/noise_settings/${ns.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 世界生成：生物群系 → data/<namespace>/worldgen/biome/<id>.json */
  private generateBiome(namespace: string, b: BiomeSpec): FileNode {
    const effectsObj: Record<string, unknown> = {
      sky_color: b.skyColor,
      water_color: b.waterColor,
      water_fog_color: b.waterFogColor,
      fog_color: b.fogColor,
    };
    if (b.grassColor !== undefined) effectsObj.grass_color = b.grassColor;
    if (b.foliageColor !== undefined) effectsObj.foliage_color = b.foliageColor;

    const obj = {
      precipitation: b.precipitation,
      temperature: b.temperature,
      temperature_modifier: b.temperatureModifier === 'frozen' ? 'frozen' : 'none',
      downfall: b.downfall,
      effects: effectsObj,
      surface_builder: { type: b.surfaceBuilder },
    };
    return {
      path: `data/${namespace}/worldgen/biome/${b.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 世界生成：维度 → data/<namespace>/dimension/<id>.json */
  private generateDimension(namespace: string, d: DimensionSpec): FileNode {
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
      path: `data/${namespace}/dimension/${d.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义附魔 → data/<namespace>/enchantment/<id>.json（1.21+） */
  private generateEnchantment(namespace: string, e: DatapackEnchantmentSpec): FileNode {
    const obj = {
      description: { translate: e.description },
      supported_items: e.supportedItems,
      weight: e.weight,
      anvil_cost: e.anvilCost,
      max_cost: e.maxCost,
      min_level: e.minLevel,
      max_level: e.maxLevel,
      slots: e.slots,
      ...(e.isCurse ? { is_curse: true } : {}),
      ...(e.isTreasure ? { is_treasure: true } : {}),
    };
    return {
      path: `data/${namespace}/enchantment/${e.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义状态效果 → data/<namespace>/effect/<id>.json（1.21+） */
  private generateStatusEffect(namespace: string, e: StatusEffectSpec): FileNode {
    const obj = {
      description: { translate: e.description },
      color: e.color,
      ...(e.instant ? { instant: true } : {}),
      ...(e.beneficial ? {} : { beneficial: false }),
    };
    return {
      path: `data/${namespace}/effect/${e.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义损伤类型 → data/<namespace>/damage_type/<id>.json（1.19.4+） */
  private generateDamageType(namespace: string, d: DamageTypeSpec): FileNode {
    const obj = {
      message_type: `minecraft:${d.messageType}`,
      scaling: `minecraft:${d.scaling}`,
      exhaustion: d.exhaustion,
    };
    return {
      path: `data/${namespace}/damage_type/${d.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义结构 → data/<namespace>/worldgen/structure/<id>.json */
  private generateStructure(namespace: string, s: StructureSpec): FileNode {
    const obj: Record<string, unknown> = {
      type: `minecraft:${s.placementType}`,
      biomes: s.biomes,
      size: s.size,
      start_height: JSON.parse(s.startHeight),
      step: s.step,
      use_expansion_hack: s.useExpansionHack,
    };
    if (s.placementType === 'jigsaw') {
      obj.template_pools = [s.templatePool];
      obj.max_distance_from_center = s.maxDistance;
    }
    return {
      path: `data/${namespace}/worldgen/structure/${s.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义粒子 → data/<namespace>/particle/<id>.json */
  private generateParticle(namespace: string, p: ParticleSpec): FileNode {
    const obj = {
      description: { translate: p.description },
      ...(p.override ? { override: true } : {}),
    };
    return {
      path: `data/${namespace}/particle/${p.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 盔甲纹饰 → data/<namespace>/trim_pattern/<id>.json（1.20+） */
  private generateTrimPattern(namespace: string, t: TrimPatternSpec): FileNode {
    const obj = {
      template_item: t.templateItem,
      description: { translate: t.description },
      decal: t.decal,
    };
    return {
      path: `data/${namespace}/trim_pattern/${t.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 盔甲材质 → data/<namespace>/trim_material/<id>.json（1.20+） */
  private generateTrimMaterial(namespace: string, t: TrimMaterialSpec): FileNode {
    const obj = {
      material_item: t.materialItem,
      color: t.color,
      description: { translate: t.description },
    };
    return {
      path: `data/${namespace}/trim_material/${t.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 乐器 → data/<namespace>/instrument/<id>.json（1.19+） */
  private generateInstrument(namespace: string, i: InstrumentSpec): FileNode {
    const obj: Record<string, unknown> = {
      sound_event: i.soundEvent,
      use_duration: i.useDuration,
      range: i.range,
    };
    if (i.description) obj.description = { translate: i.description };
    return {
      path: `data/${namespace}/instrument/${i.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 结构集 → data/<namespace>/worldgen/structure_set/<id>.json（1.16.2+） */
  private generateStructureSet(namespace: string, ss: StructureSetSpec): FileNode {
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
      path: `data/${namespace}/worldgen/structure_set/${ss.id}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }
}
