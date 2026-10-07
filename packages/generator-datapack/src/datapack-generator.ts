/**
 * 数据包生成器（路线图第 3 阶段）。
 * 生成 pack.mcmeta + data/<namespace>/ 下的 JSON/mcfunction 文件。
 * 数据包是原版功能，不需 loader adapter。
 *
 * 具体的「spec → JSON 内容」writer 已按内容家族外提到 generators/datapack/writers/，
 * 本文件保留 DatapackGenerator 这一公开导出并在 generate() 内调用这些纯函数。
 */
import type {
  DatapackSpec,
  FileNode,
  GenerationResult,
  Generator,
  GeneratorContext,
  Loader,
  McVersion,
  ModRecipeSpec,
  RecipeSpec,
} from '@mc-creator/shared';
import { MC_VERSIONS, getPackFormatForMcVersion, renderPackMcmetaPack } from '@mc-creator/shared';
import { isModRecipe, modRecipeToDatapackRecipe } from './recipe-adapter.js';
import { sanitizePathSegment } from './writers/common.js';
import {
  generateAdvancement,
  generateFunction,
  generateLootTable,
  generatePredicate,
  generateRecipe,
  generateSimpleTag,
  generateTag,
} from './writers/recipes.js';
import {
  generateBiome,
  generateConfiguredFeature,
  generateDensityFunction,
  generateDimension,
  generateDimensionType,
  generateFlatPreset,
  generateNoise,
  generateNoiseSettings,
  generatePlacedFeature,
  generateProcessorList,
  generateStructure,
  generateStructureSet,
  generateTemplatePool,
} from './writers/worldgen.js';
import {
  generateBannerPattern,
  generateChatType,
  generateDamageType,
  generateEnchantment,
  generateInstrument,
  generateJukeboxSong,
  generatePaintingVariant,
  generateParticle,
  generateStatusEffect,
  generateTrimMaterial,
  generateTrimPattern,
  generateWolfVariant,
} from './writers/content.js';

export class DatapackGenerator implements Generator {
  readonly type = 'datapack';
  readonly loaders: Loader[] = ['fabric', 'neoforge'];
  readonly versions: McVersion[] = [...MC_VERSIONS];

  async generate(ctx: GeneratorContext): Promise<GenerationResult> {
    const spec = ctx.spec as unknown as DatapackSpec;
    const files: FileNode[] = [];
    const warnings: string[] = [];

    // P2 dogfood：必填字段校验（生成 warning 而非崩溃，保持向后兼容）
    validateDatapackSpec(spec, warnings);

    // pack.mcmeta（pack_format 按 MC 版本自动映射，避免默认 48 在老版本上不被加载）
    const packFormat = getPackFormatForMcVersion(ctx.mcVersion) ?? spec.packFormat;
    if (packFormat !== spec.packFormat) {
      warnings.push(
        `已按 MC 版本 ${ctx.mcVersion} 将 pack_format 从 ${spec.packFormat} 调整为 ${packFormat}（pack.mcmeta 与目标版本匹配）`,
      );
    }
    files.push({
      path: 'pack.mcmeta',
      content: JSON.stringify(
        {
          // 1.21.9 起官方改用 min_format/max_format 字段（见 shared/pack-format.ts
          // 顶部对官方原文的引用），旧版本仍用 pack_format。
          pack: renderPackMcmetaPack(spec.description ?? spec.packName, packFormat, ctx.mcVersion),
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
      files.push(generateRecipe(ns, datapackRecipe));
    }

    // 标签
    for (const tag of spec.tags ?? []) {
      files.push(generateTag(ns, tag));
    }

    // 函数
    for (const func of spec.functions ?? []) {
      files.push(generateFunction(ns, func));
    }

    // 进度
    for (const adv of spec.advancements ?? []) {
      files.push(generateAdvancement(ns, adv));
    }

    // P10 新增：战利品表
    for (const loot of spec.lootTables ?? []) {
      files.push(generateLootTable(loot));
    }

    // P10 新增：谓词
    for (const pred of spec.predicates ?? []) {
      files.push(generatePredicate(pred));
    }

    // P10 新增：itemTags
    for (const tag of spec.itemTags ?? []) {
      files.push(generateSimpleTag('item', tag));
    }

    // P10 新增：blockTags
    for (const tag of spec.blockTags ?? []) {
      files.push(generateSimpleTag('block', tag));
    }

    // 世界生成：维度类型
    for (const dt of spec.dimensionTypes ?? []) {
      files.push(generateDimensionType(ns, dt));
    }

    // 世界生成：噪声设置
    for (const ns2 of spec.noiseSettings ?? []) {
      files.push(generateNoiseSettings(ns, ns2));
    }

    // 世界生成：生物群系
    for (const biome of spec.biomes ?? []) {
      files.push(generateBiome(ns, biome));
    }

    // 世界生成：维度
    for (const dim of spec.dimensions ?? []) {
      files.push(generateDimension(ns, dim));
    }

    // 自定义附魔
    for (const ench of spec.enchantments ?? []) {
      files.push(generateEnchantment(ns, ench));
    }
    // 自定义状态效果
    for (const eff of spec.effects ?? []) {
      files.push(generateStatusEffect(ns, eff));
    }
    // 自定义损伤类型
    for (const dt of spec.damageTypes ?? []) {
      files.push(generateDamageType(ns, dt));
    }
    // 自定义结构
    for (const st of spec.structures ?? []) {
      files.push(generateStructure(ns, st));
    }
    // 自定义粒子
    for (const p of spec.particles ?? []) {
      files.push(generateParticle(ns, p));
    }
    // 盔甲纹饰
    for (const tp of spec.trimPatterns ?? []) {
      files.push(generateTrimPattern(ns, tp));
    }
    for (const tm of spec.trimMaterials ?? []) {
      files.push(generateTrimMaterial(ns, tm));
    }
    // 乐器
    for (const inst of spec.instruments ?? []) {
      files.push(generateInstrument(ns, inst));
    }
    // 结构集
    for (const ss of spec.structureSets ?? []) {
      files.push(generateStructureSet(ns, ss));
    }
    // 已配置特性（worldgen/configured_feature）
    for (const cf of spec.configuredFeatures ?? []) {
      files.push(generateConfiguredFeature(ns, cf));
    }
    // 已放置特性（worldgen/placed_feature）
    for (const pf of spec.placedFeatures ?? []) {
      files.push(generatePlacedFeature(ns, pf));
    }
    // 模板池（worldgen/template_pool）
    for (const pool of spec.templatePools ?? []) {
      files.push(generateTemplatePool(ns, pool));
    }
    // 处理器列表（worldgen/processor_list）
    for (const pl of spec.processorLists ?? []) {
      files.push(generateProcessorList(ns, pl));
    }
    // 唱片机歌曲（jukebox_song）
    for (const js of spec.jukeboxSongs ?? []) {
      files.push(generateJukeboxSong(ns, js));
    }
    // 画作变体（painting_variant）
    for (const pv of spec.paintingVariants ?? []) {
      files.push(generatePaintingVariant(ns, pv));
    }
    // 狼变体（wolf_variant）
    for (const wv of spec.wolfVariants ?? []) {
      files.push(generateWolfVariant(ns, wv));
    }
    // 旗帜图案（banner_pattern）
    for (const bp of spec.bannerPatterns ?? []) {
      files.push(generateBannerPattern(ns, bp));
    }
    // 聊天类型（chat_type）
    for (const ct of spec.chatTypes ?? []) {
      files.push(generateChatType(ns, ct));
    }
    // 密度函数（worldgen/density_function）
    for (const df of spec.densityFunctions ?? []) {
      files.push(generateDensityFunction(ns, df));
    }
    // 噪声参数（worldgen/noise）
    for (const nz of spec.noises ?? []) {
      files.push(generateNoise(ns, nz));
    }
    // 超平坦预设（worldgen/flat_level_generator_preset）
    for (const fp of spec.flatPresets ?? []) {
      files.push(generateFlatPreset(ns, fp));
    }

    return {
      files,
      warnings,
      buildCmd: '', // 数据包不需要编译
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
