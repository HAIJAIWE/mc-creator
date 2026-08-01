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
  ModRecipeSpec,
  ConfiguredFeatureSpec,
  PlacedFeatureSpec,
  TemplatePoolSpec,
  ProcessorListSpec,
  JukeboxSongSpec,
  PaintingVariantSpec,
  WolfVariantSpec,
  BannerPatternSpec,
  ChatTypeSpec,
  DensityFunctionSpec,
  NoiseSpec,
  FlatPresetSpec,
} from '@mc-creator/shared';
import { isModRecipe, modRecipeToDatapackRecipe } from './recipe-adapter.js';

/**
 * 数据包生成器（路线图第 3 阶段）。
 * 生成 pack.mcmeta + data/<namespace>/ 下的 JSON/mcfunction 文件。
 * 数据包是原版功能，不需 loader adapter。
 */

/** 安全解析 JSON 字符串，解析失败时返回 fallback（不抛异常） */
function safeJsonParse(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * 解析 surface_rule 输出（1.21+ 生效，替代废弃的 surface_builder）：
 * - surfaceRule 为对象时直接使用（完整 surface_rule JSON，优先级最高）
 * - 否则按 surfaceBuilder 字符串映射常见类型（minecraft:grass / minecraft:stone）
 * - 字符串为 JSON 对象文本时按原样解析
 * - 无法解析时返回 null（不输出 surface_rule 字段）
 */
function resolveSurfaceRule(
  surfaceRule: Record<string, unknown> | undefined,
  surfaceBuilder: string,
): Record<string, unknown> | null {
  if (surfaceRule && Object.keys(surfaceRule).length > 0) return surfaceRule;
  const trimmed = (surfaceBuilder ?? '').trim();
  if (trimmed === 'minecraft:grass') return { type: 'minecraft:grass' };
  if (trimmed === 'minecraft:stone') return { type: 'minecraft:stone' };
  if (trimmed.startsWith('{')) {
    const parsed = safeJsonParse(trimmed, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * MC 1.20.5+ 配方成分（Ingredient）格式：`{ item: "minecraft:x" }` 或 `{ tag: "minecraft:x" }`。
 * 输入字符串以 `#` 开头表示标签引用，否则为物品 ID（G-3 修复：旧格式 `{ id: ... }` 无法加载）。
 */
function toIngredient(ref: string): Record<string, string> {
  const trimmed = (ref ?? '').trim();
  return trimmed.startsWith('#') ? { tag: trimmed.slice(1) } : { item: trimmed };
}

/**
 * P2 dogfood：路径段消毒，防止路径穿越（如 ../）和特殊字符注入。
 *
 * Minecraft datapack 路径段仅允许小写字母、数字、下划线、点、斜杠、连字符。
 * - 替换非法字符为下划线
 * - 移除路径穿越（.. 和以 / 开头的段）
 * - 空字符串回退为 'unknown'
 *
 * @param segment 原始路径段（如 namespace、recipe id、advancement id）
 * @returns 消毒后的安全路径段
 */
function sanitizePathSegment(segment: string): string {
  if (!segment) return 'unknown';
  // 移除路径穿越：先按 / 拆分，过滤掉 .. 和空段
  const parts = segment.split('/').filter((p) => p && p !== '..' && p !== '.');
  if (parts.length === 0) return 'unknown';
  // 每个段仅保留合法字符（小写字母、数字、下划线、点、连字符）
  const sanitized = parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'))
    .filter(Boolean)
    .join('/');
  return sanitized || 'unknown';
}

export class DatapackGenerator implements Generator {
  readonly type = 'datapack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = ['1.21.11', '1.21.1', '26.1', '26.2'];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as DatapackSpec;
    const files: FileNode[] = [];
    const warnings: string[] = [];

    // P2 dogfood：必填字段校验（生成 warning 而非崩溃，保持向后兼容）
    validateDatapackSpec(spec, warnings);

    // pack.mcmeta
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          pack: {
            pack_format: spec.packFormat,
            description: spec.description ?? spec.packName,
          },
        },
        null,
        2,
      ),
    });

    // 配方
    // spec.recipes 可能包含两种格式（同名不同元素类型）：
    //   1. datapack RecipeSpec（vanilla 数据包格式，字段 id/type/result）
    //   2. ModRecipeSpec（loader 无关抽象格式，由节点图编译而来，字段 recipeId/recipeType/output）
    // 通过 isModRecipe 检测后分别处理：ModRecipeSpec 经 modRecipeToDatapackRecipe 转换后生成 JSON。
    // spec.recipes 为空时无任何输出（保持原有行为）。
    const ns = sanitizePathSegment(spec.packId);
    const recipes = (spec.recipes ?? []) as unknown[];
    for (const recipe of recipes) {
      const datapackRecipe: RecipeSpec = isModRecipe(recipe)
        ? modRecipeToDatapackRecipe(recipe as ModRecipeSpec)
        : (recipe as RecipeSpec);
      files.push(this.generateRecipe(ns, datapackRecipe));
    }

    // 标签
    for (const tag of spec.tags ?? []) {
      files.push(this.generateTag(ns, tag));
    }

    // 函数
    for (const func of spec.functions ?? []) {
      files.push(this.generateFunction(ns, func));
    }

    // 进度
    for (const adv of spec.advancements ?? []) {
      files.push(this.generateAdvancement(ns, adv));
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
      files.push(this.generateDimensionType(ns, dt));
    }

    // 世界生成：噪声设置
    for (const ns2 of spec.noiseSettings ?? []) {
      files.push(this.generateNoiseSettings(ns, ns2));
    }

    // 世界生成：生物群系
    for (const biome of spec.biomes ?? []) {
      files.push(this.generateBiome(ns, biome));
    }

    // 世界生成：维度
    for (const dim of spec.dimensions ?? []) {
      files.push(this.generateDimension(ns, dim));
    }

    // 自定义附魔
    for (const ench of spec.enchantments ?? []) {
      files.push(this.generateEnchantment(ns, ench));
    }
    // 自定义状态效果
    for (const eff of spec.effects ?? []) {
      files.push(this.generateStatusEffect(ns, eff));
    }
    // 自定义损伤类型
    for (const dt of spec.damageTypes ?? []) {
      files.push(this.generateDamageType(ns, dt));
    }
    // 自定义结构
    for (const st of spec.structures ?? []) {
      files.push(this.generateStructure(ns, st));
    }
    // 自定义粒子
    for (const p of spec.particles ?? []) {
      files.push(this.generateParticle(ns, p));
    }
    // 盔甲纹饰
    for (const tp of spec.trimPatterns ?? []) {
      files.push(this.generateTrimPattern(ns, tp));
    }
    for (const tm of spec.trimMaterials ?? []) {
      files.push(this.generateTrimMaterial(ns, tm));
    }
    // 乐器
    for (const inst of spec.instruments ?? []) {
      files.push(this.generateInstrument(ns, inst));
    }
    // 结构集
    for (const ss of spec.structureSets ?? []) {
      files.push(this.generateStructureSet(ns, ss));
    }
    // 已配置特性（worldgen/configured_feature）
    for (const cf of spec.configuredFeatures ?? []) {
      files.push(this.generateConfiguredFeature(ns, cf));
    }
    // 已放置特性（worldgen/placed_feature）
    for (const pf of spec.placedFeatures ?? []) {
      files.push(this.generatePlacedFeature(ns, pf));
    }
    // 模板池（worldgen/template_pool）
    for (const pool of spec.templatePools ?? []) {
      files.push(this.generateTemplatePool(ns, pool));
    }
    // 处理器列表（worldgen/processor_list）
    for (const pl of spec.processorLists ?? []) {
      files.push(this.generateProcessorList(ns, pl));
    }
    // 唱片机歌曲（jukebox_song）
    for (const js of spec.jukeboxSongs ?? []) {
      files.push(this.generateJukeboxSong(ns, js));
    }
    // 画作变体（painting_variant）
    for (const pv of spec.paintingVariants ?? []) {
      files.push(this.generatePaintingVariant(ns, pv));
    }
    // 狼变体（wolf_variant）
    for (const wv of spec.wolfVariants ?? []) {
      files.push(this.generateWolfVariant(ns, wv));
    }
    // 旗帜图案（banner_pattern）
    for (const bp of spec.bannerPatterns ?? []) {
      files.push(this.generateBannerPattern(ns, bp));
    }
    // 聊天类型（chat_type）
    for (const ct of spec.chatTypes ?? []) {
      files.push(this.generateChatType(ns, ct));
    }
    // 密度函数（worldgen/density_function）
    for (const df of spec.densityFunctions ?? []) {
      files.push(this.generateDensityFunction(ns, df));
    }
    // 噪声参数（worldgen/noise）
    for (const nz of spec.noises ?? []) {
      files.push(this.generateNoise(ns, nz));
    }
    // 超平坦预设（worldgen/flat_level_generator_preset）
    for (const fp of spec.flatPresets ?? []) {
      files.push(this.generateFlatPreset(ns, fp));
    }

    return {
      files,
      warnings,
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
          // G-3：key 值（string[]）转换为 {item|tag} 成分对象
          key: Object.fromEntries(
            Object.entries(r.key ?? {}).map(([k, vals]) => [
              k,
              toIngredient((Array.isArray(vals) ? vals[0] : (vals as unknown as string)) ?? ''),
            ]),
          ),
          result: { id: r.result, count: r.count },
        };
        break;
      case 'crafting_shapeless':
        recipeObj = {
          type: 'minecraft:crafting_shapeless',
          ingredients: (r.ingredients ?? []).map((i) => toIngredient(i)),
          result: { id: r.result, count: r.count },
        };
        break;
      case 'smelting':
        recipeObj = {
          type: 'minecraft:smelting',
          ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
          result: r.result,
          experience: r.experience ?? 0.1,
          cookingtime: r.cookingTime,
        };
        break;
      case 'blasting':
        recipeObj = {
          type: 'minecraft:blasting',
          ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
          result: r.result,
          experience: r.experience ?? 0.1,
          cookingtime: r.cookingTime ?? 100,
        };
        break;
      case 'smoking':
        recipeObj = {
          type: 'minecraft:smoking',
          ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
          result: r.result,
          experience: r.experience ?? 0.1,
          cookingtime: r.cookingTime ?? 100,
        };
        break;
      case 'campfire_cooking':
        recipeObj = {
          type: 'minecraft:campfire_cooking',
          ingredient: toIngredient(r.ingredient ?? r.ingredients?.[0] ?? ''),
          result: r.result,
          experience: r.experience ?? 0.1,
          cookingtime: r.cookingTime ?? 600,
        };
        break;
      case 'stonecutting':
        recipeObj = {
          type: 'minecraft:stonecutting',
          ingredient: toIngredient(r.source ?? r.ingredients?.[0] ?? ''),
          result: r.result,
          count: r.count,
        };
        break;
      case 'smithing_transform':
        recipeObj = {
          type: 'minecraft:smithing_transform',
          template: toIngredient(r.template ?? 'minecraft:netherite_upgrade_smithing_template'),
          base: toIngredient(r.base ?? ''),
          addition: toIngredient(r.addition ?? ''),
          result: { id: r.result },
        };
        break;
      case 'smithing_trim':
        recipeObj = {
          type: 'minecraft:smithing_trim',
          template: toIngredient(r.template ?? ''),
          base: toIngredient(r.base ?? ''),
          addition: toIngredient(r.addition ?? ''),
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
      path: `data/${namespace}/recipe/${sanitizePathSegment(r.id)}.json`,
      content: JSON.stringify(recipeObj, null, 2),
    };
  }

  private generateTag(namespace: string, t: TagSpec): FileNode {
    return {
      path: `data/${namespace}/tags/${sanitizePathSegment(t.type)}/${sanitizePathSegment(t.id)}.json`,
      content: JSON.stringify({ replace: t.replace, values: t.values }, null, 2),
    };
  }

  private generateFunction(namespace: string, f: FunctionSpec): FileNode {
    return {
      path: `data/${namespace}/function/${sanitizePathSegment(f.id)}.mcfunction`,
      content: f.commands.join('\n') + '\n',
    };
  }

  private generateAdvancement(namespace: string, a: AdvancementSpec): FileNode {
    // P0 dogfood 修复：JSON.parse 无 try/catch 会导致整个 generate 崩溃
    const parsedConditions = a.conditions ? safeJsonParse(a.conditions, {}) : {};
    // P1 dogfood 修复：criteria 结构应为 { [条件名]: { trigger, conditions } }
    // 而非 { trigger: { trigger, conditions } }，否则 Minecraft 无法加载
    const displayObj: Record<string, unknown> = {
      icon: { id: a.icon },
      title: a.title,
      description: a.description,
    };
    if (a.frame && a.frame !== 'task') displayObj.frame = a.frame;
    const advObj: Record<string, unknown> = {
      display: displayObj,
      // Task E：高级 criteria 配置优先（多条件进度），否则回退简单 trigger 模式
      criteria:
        a.criteria && Object.keys(a.criteria).length > 0
          ? a.criteria
          : {
              [a.id]: {
                trigger: a.trigger,
                conditions: parsedConditions,
              },
            },
    };
    if (a.parent) advObj.parent = a.parent;
    return {
      path: `data/${namespace}/advancement/${sanitizePathSegment(a.id)}.json`,
      content: JSON.stringify(advObj, null, 2),
    };
  }

  /** P10：生成战利品表 → data/<namespace>/loot_table/<type>/<path>.json（目录为单数，G-11 修复） */
  private generateLootTable(l: LootTableSpec): FileNode {
    const lootObj: Record<string, unknown> = {
      type: `minecraft:${l.type}`,
      pools: l.pools.map((p) => {
        const poolObj: Record<string, unknown> = {
          rolls: p.rolls,
          entries: p.entries.map((e) => {
            const entryObj: Record<string, unknown> = {
              type: `minecraft:${e.type}`,
              name: e.name,
              weight: e.weight,
              count: e.count,
            };
            // Task E：条目函数（set_count/enchant_with_levels 等）
            if (e.functions.length > 0) entryObj.functions = e.functions;
            // Task E：条目条件
            if (e.conditions.length > 0) entryObj.conditions = e.conditions;
            return entryObj;
          }),
        };
        // Task E：额外掷骰（附魔幸运）
        if (p.bonusRolls > 0) poolObj.bonus_rolls = p.bonusRolls;
        // Task E：池条件（如方块被正确工具挖掘）
        if (p.conditions.length > 0) poolObj.conditions = p.conditions;
        return poolObj;
      }),
    };
    return {
      path: `data/${sanitizePathSegment(l.namespace)}/loot_table/${sanitizePathSegment(l.type)}/${sanitizePathSegment(l.path)}.json`,
      content: JSON.stringify(lootObj, null, 2),
    };
  }

  /** P10：生成谓词 → data/<namespace>/predicate/<path>.json（目录为单数，G-11 修复） */
  private generatePredicate(p: PredicateSpec): FileNode {
    // P0 dogfood 修复：JSON.parse 无 try/catch 会导致整个 generate 崩溃
    // Major 修复：谓词文件顶层就是条件对象本身，不应再包一层 condition 字段
    // 解析失败时 fallback 为固定无效谓词（minecraft:impossible），避免把原始文本包进 condition
    const predObj = safeJsonParse(p.condition, { condition: 'minecraft:impossible' });
    return {
      path: `data/${sanitizePathSegment(p.namespace)}/predicate/${sanitizePathSegment(p.path)}.json`,
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
      path: `data/${sanitizePathSegment(t.namespace)}/tags/${kind}/${sanitizePathSegment(t.tag)}.json`,
      content: JSON.stringify(tagObj, null, 2),
    };
  }

  /** 世界生成：维度类型 → data/<namespace>/dimension_type/<id>.json */
  private generateDimensionType(namespace: string, dt: DimensionTypeSpec): FileNode {
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
  private generateNoiseSettings(namespace: string, ns: NoiseSettingsSpec): FileNode {
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
  private generateBiome(namespace: string, b: BiomeSpec): FileNode {
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
      path: `data/${namespace}/dimension/${sanitizePathSegment(d.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义附魔 → data/<namespace>/enchantment/<id>.json（1.21+） */
  private generateEnchantment(namespace: string, e: DatapackEnchantmentSpec): FileNode {
    // G-4 修复：1.21+ enchantment JSON 的 min_cost/max_cost 必须是 { base, per_level_above_first } 对象
    //（旧实现直接输出数字，codec 解码失败导致附魔无法加载）；min_level 不是合法字段（移除）。
    // min_cost.base 采用 minLevel，per_level_above_first 由 maxCost/maxLevel 推导。
    const perLevel = Math.max(1, Math.round(e.maxCost / e.maxLevel));
    const obj = {
      description: { translate: e.description },
      supported_items: e.supportedItems,
      weight: e.weight,
      anvil_cost: e.anvilCost,
      min_cost: { base: e.minLevel, per_level_above_first: perLevel },
      max_cost: { base: e.maxCost, per_level_above_first: perLevel },
      max_level: e.maxLevel,
      slots: e.slots,
      ...(e.isCurse ? { is_curse: true } : {}),
      ...(e.isTreasure ? { is_treasure: true } : {}),
    };
    return {
      path: `data/${namespace}/enchantment/${sanitizePathSegment(e.id)}.json`,
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
      path: `data/${namespace}/effect/${sanitizePathSegment(e.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义损伤类型 → data/<namespace>/damage_type/<id>.json（1.19.4+） */
  private generateDamageType(namespace: string, d: DamageTypeSpec): FileNode {
    // G-4 修复：1.20.5+ damage_type 字段名为 message_id（非 message_type），
    // scaling 取值无命名空间前缀（never/when_caused_by_living_non_player/always）。
    const obj = {
      message_id: d.messageType,
      scaling: d.scaling,
      exhaustion: d.exhaustion,
    };
    return {
      path: `data/${namespace}/damage_type/${sanitizePathSegment(d.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 自定义结构 → data/<namespace>/worldgen/structure/<id>.json */
  private generateStructure(namespace: string, s: StructureSpec): FileNode {
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

  /** 自定义粒子 → data/<namespace>/particle/<id>.json */
  private generateParticle(namespace: string, p: ParticleSpec): FileNode {
    const obj = {
      description: { translate: p.description },
      ...(p.override ? { override: true } : {}),
    };
    return {
      path: `data/${namespace}/particle/${sanitizePathSegment(p.id)}.json`,
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
      path: `data/${namespace}/trim_pattern/${sanitizePathSegment(t.id)}.json`,
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
      path: `data/${namespace}/trim_material/${sanitizePathSegment(t.id)}.json`,
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
      path: `data/${namespace}/instrument/${sanitizePathSegment(i.id)}.json`,
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
      path: `data/${namespace}/worldgen/structure_set/${sanitizePathSegment(ss.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 已配置特性 → data/<namespace>/worldgen/configured_feature/<id>.json */
  private generateConfiguredFeature(namespace: string, cf: ConfiguredFeatureSpec): FileNode {
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
  private generatePlacedFeature(namespace: string, pf: PlacedFeatureSpec): FileNode {
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
  private generateTemplatePool(namespace: string, pool: TemplatePoolSpec): FileNode {
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
  private generateProcessorList(namespace: string, pl: ProcessorListSpec): FileNode {
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

  /** 唱片机歌曲 → data/<namespace>/jukebox_song/<id>.json（1.21+） */
  private generateJukeboxSong(namespace: string, js: JukeboxSongSpec): FileNode {
    const obj: Record<string, unknown> = {
      song_item: js.songItem,
      sound_event: js.soundEvent,
      length_in_seconds: js.lengthInSeconds,
      comparator_output: js.comparatorOutput,
    };
    if (js.description) {
      obj.description = js.description;
    }
    return {
      path: `data/${namespace}/jukebox_song/${sanitizePathSegment(js.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 画作变体 → data/<namespace>/painting_variant/<id>.json（1.21+） */
  private generatePaintingVariant(namespace: string, pv: PaintingVariantSpec): FileNode {
    const obj = {
      asset_id: pv.assetId,
      width: pv.width,
      height: pv.height,
    };
    return {
      path: `data/${namespace}/painting_variant/${sanitizePathSegment(pv.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 狼变体 → data/<namespace>/wolf_variant/<id>.json（1.21+） */
  private generateWolfVariant(namespace: string, wv: WolfVariantSpec): FileNode {
    const obj: Record<string, unknown> = {
      wild_texture: wv.wildTexture,
      tame_texture: wv.tameTexture,
      angry_texture: wv.angryTexture,
    };
    if (wv.biomes) {
      obj.biomes = wv.biomes;
    }
    return {
      path: `data/${namespace}/wolf_variant/${sanitizePathSegment(wv.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 旗帜图案 → data/<namespace>/banner_pattern/<id>.json（1.21+） */
  private generateBannerPattern(namespace: string, bp: BannerPatternSpec): FileNode {
    const obj: Record<string, unknown> = {
      asset_id: bp.assetId,
    };
    if (bp.translationKey) {
      obj.translation_key = bp.translationKey;
    }
    return {
      path: `data/${namespace}/banner_pattern/${sanitizePathSegment(bp.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 聊天类型 → data/<namespace>/chat_type/<id>.json（1.20.3+） */
  private generateChatType(namespace: string, ct: ChatTypeSpec): FileNode {
    // schema 用 camelCase（translationKey/parameters），MC JSON 需 snake_case（translation_key）
    const chat = {
      translation_key: ct.chat.translationKey,
      parameters: ct.chat.parameters,
    };
    const narration = {
      translation_key: ct.narration.translationKey,
      parameters: ct.narration.parameters,
    };
    const obj = { chat, narration };
    return {
      path: `data/${namespace}/chat_type/${sanitizePathSegment(ct.id)}.json`,
      content: JSON.stringify(obj, null, 2),
    };
  }

  /** 密度函数 → data/<namespace>/worldgen/density_function/<id>.json（1.18+） */
  private generateDensityFunction(namespace: string, df: DensityFunctionSpec): FileNode {
    return {
      path: `data/${namespace}/worldgen/density_function/${sanitizePathSegment(df.id)}.json`,
      content: JSON.stringify(df.function, null, 2),
    };
  }

  /** 噪声参数 → data/<namespace>/worldgen/noise/<id>.json（1.18+） */
  private generateNoise(namespace: string, nz: NoiseSpec): FileNode {
    return {
      path: `data/${namespace}/worldgen/noise/${sanitizePathSegment(nz.id)}.json`,
      content: JSON.stringify(nz.parameters, null, 2),
    };
  }

  /** 超平坦预设 → data/<namespace>/worldgen/flat_level_generator_preset/<id>.json（1.18+） */
  private generateFlatPreset(namespace: string, fp: FlatPresetSpec): FileNode {
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
}

/**
 * P2 dogfood：校验 DatapackSpec 必填字段，缺失时收集 warning。
 *
 * 校验项：
 * - packId：非空（用于路径构造）
 * - packFormat：正整数（用于 pack.mcmeta）
 * - recipes[].result：非空（Minecraft 配方必须有输出）
 * - advancements[].trigger：非空（Minecraft 进度必须有触发器）
 * - functions[].id：非空（函数路径必需）
 * - tags[].id：非空（标签路径必需）
 * - lootTables[].namespace/path：非空（战利品表路径必需）
 *
 * 不阻断生成（warning 模式），仅提醒用户补全。
 */
function validateDatapackSpec(spec: DatapackSpec, warnings: string[]): void {
  if (!spec.packId) {
    warnings.push('DatapackSpec.packId 为空，路径将回退为 "unknown"');
  }
  if (!spec.packFormat || !Number.isFinite(spec.packFormat) || spec.packFormat < 1) {
    warnings.push(
      `DatapackSpec.packFormat 无效 (${String(spec.packFormat)})，pack.mcmeta 可能不被 Minecraft 加载`,
    );
  }

  const recipes = (spec.recipes ?? []) as unknown[];
  for (let i = 0; i < recipes.length; i++) {
    const r = recipes[i];
    // recipes 支持两种格式：datapack RecipeSpec（用 result）与 ModRecipeSpec（用 output，由 isModRecipe 区分）
    if (isModRecipe(r)) {
      if (!r.output) {
        warnings.push(`recipes[${i}].output 为空，Minecraft 可能无法加载此配方`);
      }
    } else if (!(r as RecipeSpec).result) {
      warnings.push(`recipes[${i}].result 为空，Minecraft 可能无法加载此配方`);
    }
  }

  for (let i = 0; i < (spec.advancements ?? []).length; i++) {
    const a = spec.advancements![i] as unknown as Record<string, unknown>;
    if (!a.trigger) {
      warnings.push(`advancements[${i}].trigger 为空，Minecraft 可能无法加载此进度`);
    }
  }

  for (let i = 0; i < (spec.functions ?? []).length; i++) {
    const f = spec.functions![i] as unknown as Record<string, unknown>;
    if (!f.id) {
      warnings.push(`functions[${i}].id 为空，函数路径将回退为 "unknown"`);
    }
  }

  for (let i = 0; i < (spec.tags ?? []).length; i++) {
    const t = spec.tags![i] as unknown as Record<string, unknown>;
    if (!t.id) {
      warnings.push(`tags[${i}].id 为空，标签路径将回退为 "unknown"`);
    }
  }

  for (let i = 0; i < (spec.lootTables ?? []).length; i++) {
    const l = spec.lootTables![i] as unknown as Record<string, unknown>;
    if (!l.namespace) {
      warnings.push(`lootTables[${i}].namespace 为空，战利品表路径将回退为 "unknown"`);
    }
    if (!l.path) {
      warnings.push(`lootTables[${i}].path 为空，战利品表路径将回退为 "unknown"`);
    }
  }
}
