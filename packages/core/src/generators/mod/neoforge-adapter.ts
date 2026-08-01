import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import {
  getLoaderVersions,
  javaVersionFor,
  type LoaderVersionConfig,
  type McVersion,
} from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath, javaEscape } from './templates.js';
import { BuildCache, hashCategory, type IncrementalResult } from '../../builder/BuildCache.js';
import { conditionCheckBody, actionExecuteBody } from './event-logic.js';
import type { CategoryDescriptor } from './fabric-adapter.js';

/**
 * P40：按 Java 类型返回默认值表达式（过程调用参数缺省时回退）。
 */
function defaultValueFor(type: string): string {
  switch ((type ?? '').toLowerCase()) {
    case 'int':
    case 'integer':
      return '0';
    case 'float':
      return '0f';
    case 'double':
    case 'number':
      return '0d';
    case 'long':
      return '0L';
    case 'boolean':
    case 'bool':
      return 'false';
    case 'string':
    case 'text':
    case 'item':
    case 'itemstack':
    case 'block':
    case 'blockstate':
    case 'entity':
    case 'player':
    default:
      return '""';
  }
}

/**
 * P40：把低代码类型名映射为 Java 形参类型（spec 可能写 int/string/boolean/item 等）。
 */
function javaTypeFor(type: string): string {
  switch ((type ?? '').toLowerCase()) {
    case 'int':
    case 'integer':
      return 'int';
    case 'float':
      return 'float';
    case 'double':
    case 'number':
      return 'double';
    case 'long':
      return 'long';
    case 'boolean':
    case 'bool':
      return 'boolean';
    case 'string':
    case 'text':
      return 'String';
    case 'item':
    case 'itemstack':
      return 'net.minecraft.world.item.ItemStack';
    case 'block':
    case 'blockstate':
      return 'net.minecraft.world.level.block.state.BlockState';
    case 'entity':
      return 'net.minecraft.world.entity.Entity';
    case 'player':
      return 'net.minecraft.server.level.ServerPlayer';
    default:
      return type;
  }
}

function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

/**
 * NeoForge Loader Adapter（规格 §3.2）。
 * 生成 mods.toml + NeoForge moddev build.gradle + @Mod 入口 + DeferredRegister 注册代码 + 资源。
 * NeoForge 本就用 Mojang 官方名，与 Fabric 的 officialMojangMappings 一致。
 *
 * P1.3/P1.4 扩展：消费 ModSpec 新增字段（recipes/entities/machines/customCode/multiblocks/
 * eventHandlers/conditions/actions/procedures），生成对应的 ModRecipes/ModEntities/ModMachines/
 * ModCodeSnippets/ModMultiblocks/ModEvents Java 类。NeoForge 用 DeferredRegister/RegisterEvent
 * 替代 Fabric 的 Registry.register（实体/方块实体/菜单类型），其余生成模式与 Fabric 类似。
 */
export class NeoForgeAdapter implements LoaderAdapter {
  readonly loader = 'neoforge' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    // P1-4：translate 复用 translateWithCache（传空缓存 = 全量生成），单一数据源避免重复
    return this.translateWithCache(ctx, new BuildCache()).files;
  }

  /**
   * P1-4：增量构建（对标 MCreator BuildCache）。
   *
   * 按"类别"拆分生成逻辑，每个类别独立计算内容哈希：
   * - 哈希相同 → 复用缓存的 FileNode，跳过代码生成
   * - 哈希不同 → 重新生成该类别文件，更新缓存
   *
   * 传入空缓存（new BuildCache()）等价于全量生成（所有类别未命中）。
   * 返回 IncrementalResult，包含文件列表、命中统计、缓存快照。
   */
  translateWithCache(ctx: GeneratorContext, cache: BuildCache): IncrementalResult {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);
    // P2 dogfood：从 GeneratorContext 获取版本配置，未提供时回退到默认映射
    const versions = ctx.loaderVersions ?? getLoaderVersions(mcVersion);
    const files: FileNode[] = [];
    let cached = 0;
    let regenerated = 0;

    // 保存上次的文件内容快照，用于文件级增量统计
    const prevSnapshot = cache.snapshot();
    const prevFiles = new Map<string, string>();
    for (const entry of Object.values(prevSnapshot)) {
      for (const f of entry.files) {
        prevFiles.set(f.path, f.content);
      }
    }

    for (const cat of this.categories) {
      const hash = hashCategory(cat.hashInputs(spec, mcVersion));
      const key = BuildCache.buildKey(spec.modId, this.loader, cat.name);
      const cachedFiles = cache.getCached(key, hash);
      if (cachedFiles) {
        files.push(...cachedFiles);
        cached++;
      } else {
        const newFiles = cat.generate(spec, pkg, mainCls, mcVersion, versions);
        files.push(...newFiles);
        cache.setCache(key, hash, newFiles);
        regenerated++;
      }
    }

    // 文件级增量统计：产物中与上次内容相同的文件数（用于磁盘写入优化）
    const filesUnchanged = files.filter((f) => prevFiles.get(f.path) === f.content).length;

    return {
      files,
      stats: {
        total: this.categories.length,
        cached,
        regenerated,
        filesTotal: files.length,
        filesUnchanged,
      },
      cacheSnapshot: cache.snapshot(),
    };
  }

  /**
   * 类别描述符表：把 translate 的生成逻辑拆分为可独立缓存的类别。
   *
   * 每个类别包含：
   * - name：类别名（缓存键的一部分）
   * - hashInputs：从 spec 提取影响该类别的数据（用于计算哈希）
   * - generate：生成文件（返回空数组表示该类别当前无产物，如 recipes 为空）
   *
   * 顺序与原 translate 的文件输出顺序保持一致（测试不依赖顺序，但保持稳定）。
   */
  private categories: CategoryDescriptor<ModSpecLike>[] = [
    {
      name: 'modsToml',
      hashInputs: (s, mcVersion) => [s.modId, s.name, s.description, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [this.modsToml(s, mcVersion, versions)],
    },
    {
      name: 'buildGradle',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        this.buildGradle(s, mcVersion, versions),
      ],
    },
    {
      name: 'settingsGradle',
      hashInputs: () => [],
      generate: () => [this.settingsGradle()],
    },
    {
      name: 'gradleProperties',
      hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion, versions) => [
        this.gradleProperties(s, mcVersion, versions),
      ],
    },
    {
      // mainClass 依赖 modId/name + 各类别是否非空（决定 registerCalls/initCalls）
      name: 'mainClass',
      hashInputs: (s) => [
        s.modId,
        s.name,
        s.items.length > 0,
        s.blocks.length > 0,
        (s.recipes?.length ?? 0) > 0,
        (s.entities?.length ?? 0) > 0,
        (s.machines?.length ?? 0) > 0,
        (s.customCode?.length ?? 0) > 0,
        (s.multiblocks?.length ?? 0) > 0,
        (s.eventHandlers?.length ?? 0) > 0 ||
          (s.conditions?.length ?? 0) > 0 ||
          (s.actions?.length ?? 0) > 0 ||
          (s.procedures?.length ?? 0) > 0,
      ],
      generate: (s, pkg, mainCls) => [this.mainClass(s, pkg, mainCls)],
    },
    {
      name: 'items',
      hashInputs: (s) => s.items,
      generate: (s, pkg, mainCls) => [this.modItemsJava(s, pkg, mainCls)],
    },
    {
      name: 'blocks',
      hashInputs: (s) => s.blocks,
      generate: (s, pkg, mainCls) => [this.modBlocksJava(s, pkg, mainCls)],
    },
    {
      name: 'fluids',
      hashInputs: (s) => s.fluids ?? [],
      generate: (s, pkg, mainCls) =>
        s.fluids?.length ? [this.modFluidsJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'biomes',
      hashInputs: (s) => s.biomes ?? [],
      generate: (s, pkg, mainCls) =>
        s.biomes?.length ? [this.modBiomesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'dimensions',
      hashInputs: (s) => s.dimensions ?? [],
      generate: (s, pkg) => (s.dimensions?.length ? [this.modDimensionsJava(s, pkg)] : []),
    },
    {
      name: 'recipes',
      hashInputs: (s) => s.recipes ?? [],
      generate: (s, pkg) => (s.recipes?.length ? [this.modRecipesJava(s, pkg)] : []),
    },
    {
      name: 'entities',
      hashInputs: (s) => s.entities ?? [],
      generate: (s, pkg, mainCls) =>
        s.entities?.length ? [this.modEntitiesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'machines',
      hashInputs: (s) => s.machines ?? [],
      generate: (s, pkg, mainCls) =>
        s.machines?.length ? [this.modMachinesJava(s, pkg, mainCls)] : [],
    },
    {
      name: 'customCode',
      hashInputs: (s) => s.customCode ?? [],
      generate: (s, pkg) => (s.customCode?.length ? [this.modCustomCodeJava(s, pkg)] : []),
    },
    {
      name: 'multiblocks',
      hashInputs: (s) => s.multiblocks ?? [],
      generate: (s, pkg) => (s.multiblocks?.length ? [this.modMultiblocksJava(s, pkg)] : []),
    },
    {
      name: 'events',
      hashInputs: (s) => [
        s.eventHandlers ?? [],
        s.conditions ?? [],
        s.actions ?? [],
        s.procedures ?? [],
      ],
      generate: (s, pkg, mainCls) =>
        s.eventHandlers?.length || s.conditions?.length || s.actions?.length || s.procedures?.length
          ? [this.modEventsJava(s, pkg, mainCls)]
          : [],
    },
    {
      name: 'lang',
      hashInputs: (s) => [
        s.modId,
        s.items.map((i) => i.id + i.name),
        s.blocks.map((b) => b.id + b.name),
      ],
      generate: (s) => [this.langJson(s)],
    },
    {
      // P1 dogfood 修复：NeoForge 也需要 item model JSON（与 Fabric 一致）
      name: 'models',
      hashInputs: (s) => [s.modId, s.items.map((i) => i.id)],
      generate: (s) => this.itemModels(s),
    },
    {
      name: 'metaJson',
      hashInputs: (s) => [
        s.modId,
        s.license,
        s.authors,
        s.credits,
        s.website,
        s.dependencies,
        s.items.map((i) => ({
          id: i.id,
          rarity: i.rarity,
          maxDamage: i.maxDamage,
          fuelTick: i.fuelTick,
          food: i.food ?? null,
          lore: i.lore,
        })),
        s.blocks.map((b) => ({
          id: b.id,
          miningLevel: b.miningLevel,
          lightLevel: b.lightLevel,
          resistance: b.resistance,
          soundType: b.soundType,
          dropSelf: b.dropSelf,
          dropItem: b.dropItem,
        })),
      ],
      generate: (s) => [this.metaJson(s)],
    },
  ];

  /**
   * P10：生成 <modId>_meta.json 元数据文件（最小侵入，避免改动 mods.toml）。
   * 汇总所有新增字段（license/authors/credits/dependencies/website + items/blocks 新属性）。
   */
  private metaJson(spec: ModSpecLike): FileNode {
    const meta = {
      modId: spec.modId,
      license: spec.license,
      authors: spec.authors,
      credits: spec.credits,
      website: spec.website,
      dependencies: spec.dependencies,
      items: spec.items.map((it) => ({
        id: it.id,
        rarity: it.rarity,
        maxDamage: it.maxDamage,
        fuelTick: it.fuelTick,
        food: it.food ?? null,
        lore: it.lore,
      })),
      blocks: spec.blocks.map((b) => ({
        id: b.id,
        miningLevel: b.miningLevel,
        lightLevel: b.lightLevel,
        resistance: b.resistance,
        soundType: b.soundType,
        dropSelf: b.dropSelf,
        dropItem: b.dropItem,
      })),
    };
    return {
      path: `src/main/resources/${spec.modId}_meta.json`,
      content: JSON.stringify(meta, null, 2),
    };
  }

  private langJson(spec: ModSpecLike): FileNode {
    const entries: Record<string, string> = {};
    for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
    for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
    return {
      path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }

  /**
   * P1 dogfood 修复：生成 item model JSON（与 Fabric 一致）。
   * NeoForge 的 item 也需要 models/item/<id>.json 才能在游戏中正确显示。
   */
  private itemModels(spec: ModSpecLike): FileNode[] {
    return spec.items.map((it) => ({
      path: `src/main/resources/assets/${spec.modId}/models/item/${it.id}.json`,
      content: JSON.stringify(
        { parent: 'minecraft:item/generated', textures: { layer0: `${spec.modId}:item/${it.id}` } },
        null,
        2,
      ),
    }));
  }

  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    // 条件性生成子模块 register(modEventBus)/initialize() 调用：
    // - 需 DeferredRegister 的模块（items/blocks/entities/machines/events）用 register(modEventBus)
    // - 纯数据/代码片段模块（recipes/customCode/multiblocks）用 initialize()
    const registerCalls: string[] = [
      'ModItems.register(modEventBus);',
      'ModBlocks.register(modEventBus);',
    ];
    if (spec.recipes?.length) registerCalls.push('ModRecipes.initialize();');
    if (spec.entities?.length) registerCalls.push('ModEntities.register(modEventBus);');
    if (spec.fluids?.length) registerCalls.push('ModFluids.register(modEventBus);');
    if (spec.biomes?.length) registerCalls.push('ModBiomes.register(modEventBus);');
    if (spec.dimensions?.length) registerCalls.push('ModDimensions.register(modEventBus);');
    if (spec.machines?.length) registerCalls.push('ModMachines.register(modEventBus);');
    if (spec.customCode?.length) registerCalls.push('ModCustomCode.initialize();');
    if (spec.multiblocks?.length) registerCalls.push('ModMultiblocks.initialize();');
    if (
      spec.eventHandlers?.length ||
      spec.conditions?.length ||
      spec.actions?.length ||
      spec.procedures?.length
    ) {
      registerCalls.push('ModEvents.initialize(modEventBus);');
    }
    const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("${javaEscape(spec.modId)}")
public class ${mainCls} {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public ${mainCls}(IEventBus modEventBus) {
        ${registerCalls.join('\n        ')}
        LOGGER.info("Initializing ${javaEscape(spec.name)}");
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/${mainCls}.java`,
      content,
    };
  }

  private modItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.items
      .map(
        (it) =>
          `    public static final DeferredItem<Item> ${it.id.toUpperCase()} = ITEMS.registerSimpleItem("${it.id}");`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ITEMS.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModItems.java`,
      content,
    };
  }

  private modBlocksJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.blocks
      .map((b) => {
        // 应用 spec 方块属性（与 Fabric 一致：hardness/resistance，其余默认）
        const props = `Block.Properties.of().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
        return `    public static final DeferredBlock<Block> ${b.id.toUpperCase()} = BLOCKS.register("${b.id}", () -> new Block(${props}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.block.Block;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        BLOCKS.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
      content,
    };
  }

  /**
   * Task D：生成 ModFluids.java（NeoForge DeferredRegister 风格）。
   * 流体用 DeferredRegister.Fluids + 自定义 SimpleFluid 子类。
   */
  private modFluidsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = (spec.fluids ?? [])
      .map(
        (f) =>
          `    public static final DeferredFluid<net.minecraft.world.level.material.Fluid> ${f.fluidId.toUpperCase()} = FLUIDS.register("${f.fluidId}", () -> new SimpleFluid());`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.material.SimpleFluid;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredFluid;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModFluids {
    public static final DeferredRegister.Fluids FLUIDS = DeferredRegister.createFluids(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        FLUIDS.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModFluids.java`,
      content,
    };
  }

  // === P1.3/P1.4 新增：消费 recipes/entities/machines/customCode/multiblocks/events ===

  /**
   * Mod 侧生物群系：生成 ModBiomes.java（NeoForge DeferredRegister.Biomes 风格）。
   */
  private modBiomesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = (spec.biomes ?? [])
      .map(
        (b) =>
          `    public static final DeferredBiome<net.minecraft.world.level.biome.Biome> ${b.biomeId.toUpperCase()} = BIOMES.register("${b.biomeId}", () -> new net.minecraft.world.level.biome.Biome.BiomeBuilder()
            .precipitation(net.minecraft.world.level.biome.Biome.Precipitation.${b.precipitation.toUpperCase()})
            .temperature(${b.temperature}f)${b.temperatureModifier === 'frozen' ? '\n            .temperatureAdjustment(net.minecraft.world.level.biome.Biome.TemperatureModifier.FROZEN)' : ''}
            .downfall(${b.downfall}f)
            .specialEffects(new net.minecraft.world.level.biome.BiomeSpecialEffects.Builder()
                .skyColor(${b.skyColor})
                .waterColor(${b.waterColor})
                .waterFogColor(${b.waterFogColor})
                .fogColor(${b.fogColor})${b.grassColor !== undefined ? `\n                .grassColorOverride(${b.grassColor})` : ''}${b.foliageColor !== undefined ? `\n                .foliageColorOverride(${b.foliageColor})` : ''}
                .build())
            .mobSpawnSettings(net.minecraft.world.level.biome.MobSpawnSettings.EMPTY)
            .generationSettings(net.minecraft.world.level.biome.BiomeGenerationSettings.EMPTY)
            .build());`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBiome;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModBiomes {
    public static final DeferredRegister.Biomes BIOMES = DeferredRegister.createBiomes(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        BIOMES.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBiomes.java`,
      content,
    };
  }

  /**
   * Mod 侧维度：生成 ModDimensions.java（NeoForge）。
   * 注册 DimensionType，维度可通过 /execute in <modid>:<dim> 访问。
   */
  private modDimensionsJava(spec: ModSpecLike, pkg: string): FileNode {
    const fields = (spec.dimensions ?? [])
      .map(
        (d) =>
          `    public static final DeferredHolder<DimensionType, DimensionType> ${d.dimensionId.toUpperCase()}_TYPE = DIMENSION_TYPES.register("${d.dimensionId}", () -> new DimensionType(${d.fixedTime !== null ? `OptionalLong.of(${d.fixedTime}L)` : 'OptionalLong.empty()'}, ${d.hasSkyLight}, ${d.hasCeiling}, ${d.ultrawarm}, ${d.natural}, ${d.coordinateScale}, ${d.bedWorks}, ${d.respawnAnchorWorks}, ${d.minY}, ${d.height}, ${d.logicalHeight}, ResourceLocation.parse("minecraft:infiniburn_${d.baseType === 'nether' ? 'nether' : 'overworld'}"), ${d.effects === 'none' ? 'Optional.empty()' : `Optional.of(ResourceLocation.fromNamespaceAndPath("minecraft", "${d.effects}"))`}, ${d.ambientLight}, ${d.piglinSafe}));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.dimension.DimensionType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;
import java.util.Optional;
import java.util.OptionalLong;

public class ModDimensions {
    public static final DeferredRegister<DimensionType> DIMENSION_TYPES = DeferredRegister.create(Registries.DIMENSION_TYPE, "${javaEscape(spec.modId)}");

${fields}

    public static void register(IEventBus modEventBus) {
        DIMENSION_TYPES.register(modEventBus);
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModDimensions.java`,
      content,
    };
  }

  /**
   * 生成 ModRecipes.java：NeoForge 的配方也通过 datapack JSON 加载，
   * Critical 修复：配方通过 datapack JSON 加载，不应在 Java 中 register 一个 String 为 Recipe<?>。
   * Java 类仅保留 ID 常量。
   */
  private modRecipesJava(spec: ModSpecLike, pkg: string): FileNode {
    const recipes = spec.recipes ?? [];
    const fields = recipes
      .map(
        (r) => `    public static final String ${r.recipeId.toUpperCase()}_ID = "${r.recipeId}";`,
      )
      .join('\n');
    const comments = recipes
      .map(
        (r) =>
          `        // ${r.recipeId} (${r.recipeType}) → ${r.output} x${r.outputCount}: 通过 datapack JSON 加载`,
      )
      .join('\n');

    const content = `package ${pkg};

public class ModRecipes {
    public static final String MOD_ID = "${spec.modId}";

${fields}

    public static void initialize() {
${comments}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModRecipes.java`,
      content,
    };
  }

  /**
   * 生成 ModEntities.java：用 DeferredRegister 注册 EntityType。
   * P0 dogfood 修复：使用 Supplier<EntityType<T>> 而非不存在的 DeferredEntity<T>，
   * .sized() 替代 .dimensions()，.build(ResourceKey) 替代 .build()
   */
  private modEntitiesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const entities = spec.entities ?? [];
    const fields = entities
      .map((e) => {
        const baseClass = this.entityBaseClass(e.modelType);
        return `    public static final Supplier<EntityType<${baseClass}>> ${e.entityId.toUpperCase()} = ENTITIES.register("${e.entityId}", () -> EntityType.Builder.<${baseClass}>of(${this.entityFactory(e.modelType)}, ${this.neoforgeMobCategory(e.classification)}).sized(0.6f, 1.8f).build(ResourceKey.create(Registries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${e.entityId}"))));`;
      })
      .join('\n');
    const comments = entities
      .map(
        (e) =>
          `        // ${e.entityId} (${e.displayName}): maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, speed=${e.movementSpeed}, weight=${e.spawnWeight}, biomes=${JSON.stringify(e.spawnBiomes)}`,
      )
      .join('\n');
    const content = `package ${pkg};

import java.util.function.Supplier;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModEntities {
    public static final DeferredRegister.Entities ENTITIES = DeferredRegister.createEntities(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ENTITIES.register(modEventBus);
${comments}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
      content,
    };
  }

  /**
   * 生成 ModMachines.java：用 DeferredRegister 注册 BlockEntityType 和 MenuType。
   *
   * G-2 修复：原实现引用不存在的 ModBlocks.${MACHINE_ID}（方块 id 与 machineId 不一定相同）
   * 和 ${Pascal}BlockEntity / ${Pascal}Menu 顶层类，生成代码无法编译。
   * 现在每个机器生成嵌套占位类（BlockEntity/Menu），注册时用 Blocks.STONE 占位方块，
   * 保证可编译，并注释提示替换为实际实现。
   */
  private modMachinesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const machines = spec.machines ?? [];
    const blockEntityFields = machines
      .map((m) => {
        const pascal = this.toPascal(m.machineId);
        const id = m.machineId.toUpperCase();
        return `    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<?>> ${id}_BE = BLOCK_ENTITIES.register("${m.machineId}", () -> BlockEntityType.Builder.of(${pascal}BlockEntity::new, Blocks.STONE).build(null));`;
      })
      .join('\n');
    const menuFields = machines
      .map((m) => {
        const pascal = this.toPascal(m.machineId);
        const id = m.machineId.toUpperCase();
        return `    public static final DeferredHolder<MenuType<?>, MenuType<?>> ${id}_MENU = MENUS.register("${m.machineId}", () -> IMenuTypeExtension.create(${pascal}Menu::new));`;
      })
      .join('\n');
    const placeholderClasses = machines
      .map((m) => {
        const pascal = this.toPascal(m.machineId);
        const id = m.machineId.toUpperCase();
        return `    // TODO: 替换为实际的 ${pascal}BlockEntity 实现
    public static class ${pascal}BlockEntity extends BlockEntity {
        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE.get(), pos, state);
        }
    }

    // TODO: 替换为实际的 ${pascal}Menu 实现
    public static class ${pascal}Menu extends AbstractContainerMenu {
        public ${pascal}Menu(int id, Inventory inv) {
            super(${id}_MENU.get(), id);
        }
    }`;
      })
      .join('\n\n');
    const comments = machines
      .map(
        (m) =>
          `        // ${m.machineId} (${m.displayName}): energyCap=${m.energyCapacity}, transfer=${m.maxEnergyTransfer}, in=${m.inputSlots}, out=${m.outputSlots}, time=${m.defaultProcessTime}, ept=${m.defaultEnergyPerTick}, gui=${m.guiWidth}x${m.guiHeight}`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModMachines {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(net.minecraft.core.registries.Registries.BLOCK_ENTITY_TYPE, ${mainCls}.MOD_ID);
    public static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(net.minecraft.core.registries.Registries.MENU, ${mainCls}.MOD_ID);

${blockEntityFields}
${menuFields}
${placeholderClasses}

    public static void register(IEventBus modEventBus) {
        BLOCK_ENTITIES.register(modEventBus);
        MENUS.register(modEventBus);
${comments}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModMachines.java`,
      content,
    };
  }

  /**
   * 生成 ModCustomCode.java：与 Fabric 一致，把每个 snippet 嵌入为独立方法。
   * NeoForge 没有 Fabric 的 initialize() 模式，但代码片段是纯 Java 方法，无需 loader 特化。
   */
  private modCustomCodeJava(spec: ModSpecLike, pkg: string): FileNode {
    const snippets = spec.customCode ?? [];
    const methods = snippets
      .map((s) => {
        const methodName = s.methodName || 'process';
        const inputParams = Object.entries(s.inputSignature)
          .map(([k, v]) => `${this.portTypeToJava(v)} ${k}`)
          .join(', ');
        const outputEntries = Object.entries(s.outputSignature);
        const outputType =
          outputEntries.length === 1
            ? this.portTypeToJava(outputEntries[0][1])
            : outputEntries.length > 1
              ? 'Object'
              : 'void';
        const userCode = s.code || '// (empty)';
        const indentedCode = userCode
          .split('\n')
          .map((line) => `        ${line}`)
          .join('\n');
        return `    // snippetId: ${s.snippetId} (language: ${s.language})
    // inputSignature:  ${JSON.stringify(s.inputSignature)}
    // outputSignature: ${JSON.stringify(s.outputSignature)}
    public static ${outputType} ${methodName}(${inputParams}) {
${indentedCode}
    }`;
      })
      .join('\n\n');

    const content = `package ${pkg};

public class ModCustomCode {
    public static final String MOD_ID = "${spec.modId}";

${methods}

    public static void initialize() {
        // Custom code snippets loaded (${snippets.length} snippet(s))
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModCustomCode.java`,
      content,
    };
  }

  /**
   * 生成 ModMultiblocks.java：与 Fabric 一致，生成结构尺寸常量。
   */
  private modMultiblocksJava(spec: ModSpecLike, pkg: string): FileNode {
    const multiblocks = spec.multiblocks ?? [];
    const constants = multiblocks
      .map((m) => {
        const name = m.structureId.toUpperCase();
        return `    // 结构: ${m.structureId} (${m.displayName})
    // 尺寸: ${m.width}x${m.height}x${m.depth}, 空心: ${m.hollow}
    // 控制器偏移: (${m.controllerOffset.x}, ${m.controllerOffset.y}, ${m.controllerOffset.z})
    public static final String ${name}_ID = "${m.structureId}";
    public static final int ${name}_WIDTH = ${m.width};
    public static final int ${name}_HEIGHT = ${m.height};
    public static final int ${name}_DEPTH = ${m.depth};
    public static final boolean ${name}_HOLLOW = ${m.hollow};
    public static final int ${name}_CONTROLLER_X = ${m.controllerOffset.x};
    public static final int ${name}_CONTROLLER_Y = ${m.controllerOffset.y};
    public static final int ${name}_CONTROLLER_Z = ${m.controllerOffset.z};`;
      })
      .join('\n');
    const content = `package ${pkg};

public class ModMultiblocks {
    public static final String MOD_ID = "${spec.modId}";

${constants}

    public static void initialize() {
        // Multiblock structures registered (${multiblocks.length} structure(s))
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModMultiblocks.java`,
      content,
    };
  }

  /**
   * 生成 ModEvents.java：根据 conditionIds/actionIds/procedureCallIds 引用生成事件处理逻辑。
   *
   * 结构与 Fabric 一致：
   *   - initialize()：按 eventType 用注释占位说明 NeoForge 用 IEventBus.addListener 注册
   *     （NeoForge 事件 API 精确映射留待后续完善）
   *   - handle_<handlerId>(Object event)：根据 conditionIds 生成 if 语句（invert 加 !），
   *     块内调用 actionIds 对应的 execute_<actionId>，以及 procedureCallIds 对应的 procedure_<name>
   *   - procedure_<procedureName>(Object event)：P1-3 过程方法（命名的可复用逻辑单元，
   *     含 conditionIds/actionIds/procedureCallIds，结构与 handle_ 同构；可被多个 event/procedure 调用）
   *   - check_<conditionId>(Object event)：条件检查方法（return true 占位）
   *   - execute_<actionId>(Object event)：动作执行方法（空方法体占位）
   *
   * 多条件使用 AND 合取（与 Fabric 同步修复：旧版独立 if → actions 重复执行 N 次）
   */
  private modEventsJava(spec: ModSpecLike, pkg: string, _mainCls: string): FileNode {
    const handlers = spec.eventHandlers ?? [];
    const conditions = spec.conditions ?? [];
    const actions = spec.actions ?? [];
    const procedures = spec.procedures ?? [];

    // 构建 conditionId → ConditionSpec 映射（用于查找 invert 状态 + dangling 检测）
    const conditionMap = new Map(conditions.map((c) => [c.conditionId, c]));
    // 构建 actionId Set（用于 dangling 检测）
    const actionIdSet = new Set(actions.map((a) => a.actionId));
    // P1-3：构建 procedureId → procedureName 映射（用于解析 procedureCallIds → 方法名）
    const procedureNameMap = new Map(procedures.map((p) => [p.procedureId, p.procedureName]));

    // initialize() 中的事件注册调用（NeoForge: 用 IEventBus.addListener 注册）
    // P2 dogfood：从注释占位升级为实际 addListener 调用代码
    // P2.1 事件参数绑定：事件对象 getter 绑定为 EventContext 字段
    const registrations = handlers
      .map((h) => {
        const handlerMethod = `handle_${this.sanitizeIdent(h.handlerId)}`;
        const eventClass = this.neoforgeEventClass(h.eventType);
        return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
        modEventBus.addListener(${eventClass}.class, event -> {
            EventContext ctx = new EventContext();
${this.neoforgeEventBindings(h.eventType)}
            ${handlerMethod}(ctx);
        });`;
      })
      .join('\n');

    // 生成方法体（conditionIds → AND 合取 if 块 + actionIds/procedureCallIds 调用）。
    // handle_ 与 procedure_ 共用此逻辑，区别仅在方法签名与注释。
    // P40：callArgs 为 procedureCallId → 表达式数组（缺省回退参数类型默认值）。
    const buildBody = (
      conditionIds: string[],
      actionIds: string[],
      procCallIds: string[],
      callArgs?: Record<string, string[]>,
    ): string => {
      // 过滤 dangling 引用：conditionId/actionId 必须在对应 spec 中存在
      const validCondIds = conditionIds.filter((cid) => conditionMap.has(cid));
      const validActionIds = actionIds.filter((aid) => actionIdSet.has(aid));

      // 把过程调用 id 列表解析为 procedure_<name>(ctx, args...) 调用语句（缩进由调用方决定）
      const resolveProcCalls = (indent: string): string =>
        procCallIds.length
          ? procCallIds
              .map((pid) => {
                const name = procedureNameMap.get(pid);
                if (!name) return `${indent}// (未知过程: ${pid})`;
                const args = callArgs?.[pid] ?? [];
                const proc = procedures.find((p) => p.procedureId === pid);
                const defaults = (proc?.inputs ?? []).map((inp) => defaultValueFor(inp.type));
                const exprs = (proc?.inputs ?? []).map((inp, i) => args[i] || defaults[i]);
                const argList = exprs?.length ? `, ${exprs.join(', ')}` : '';
                return `${indent}procedure_${this.sanitizeIdent(name)}(ctx${argList});`;
              })
              .join('\n')
          : '';

      // 多条件使用 AND 合取：所有条件都满足时才执行动作
      // 修复：旧版为每个条件独立 if → actions 重复执行 N 次
      if (validCondIds.length > 0) {
        const combinedCheck = validCondIds
          .map((cid) => {
            const cond = conditionMap.get(cid);
            const invert = cond?.invert ?? false;
            return `${invert ? '!' : ''}check_${this.sanitizeIdent(cid)}(ctx)`;
          })
          .join(' && ');
        const actionCalls = validActionIds.length
          ? validActionIds
              .map((aid) => `            execute_${this.sanitizeIdent(aid)}(ctx);`)
              .join('\n')
          : '';
        const innerProcCalls = resolveProcCalls('            ');
        const innerBody =
          [actionCalls, innerProcCalls].filter(Boolean).join('\n') ||
          '            // (无关联 action)';
        return `        if (${combinedCheck}) {
${innerBody}
        }`;
      }

      // 无条件：直接执行
      if (validActionIds.length || procCallIds.length) {
        return `        // (无关联 condition，直接执行)
${[
  ...validActionIds.map((aid) => `        execute_${this.sanitizeIdent(aid)}(ctx);`),
  ...resolveProcCalls('        ').split('\n').filter(Boolean),
].join('\n')}`;
      }

      return '        // (无关联 condition 与 action)';
    };

    // 每个事件处理器的 handle_<handlerId> 方法
    const handlerMethods = handlers
      .map((h) => {
        const handlerName = `handle_${this.sanitizeIdent(h.handlerId)}`;
        const body = buildBody(
          h.conditionIds ?? [],
          h.actionIds ?? [],
          h.procedureCallIds ?? [],
          h.procedureCallArgs,
        );
        return `    // 事件处理器: ${h.handlerId} (eventType: ${h.eventType})
    // eventArgs: ${JSON.stringify(h.eventArgs)}
    private static void ${handlerName}(EventContext ctx) {
${body}
    }`;
      })
      .join('\n\n');

    // P1-3：过程方法（命名的可复用逻辑单元，可被 event/procedure 调用）
    // P40：inputs 参数生成方法签名（procedure_<name>(ctx, type name, ...)）
    const procedureMethods = procedures
      .map((p) => {
        const methodName = `procedure_${this.sanitizeIdent(p.procedureName)}`;
        const body = buildBody(
          p.conditionIds,
          p.actionIds,
          p.procedureCallIds,
          p.procedureCallArgs,
        );
        const paramList = (p.inputs ?? [])
          .map((inp) => `${javaTypeFor(inp.type)} ${inp.name}`)
          .join(', ');
        const signature = paramList ? `EventContext ctx, ${paramList}` : 'EventContext ctx';
        return `    // 过程: ${p.procedureId} (name: ${p.procedureName})
    // inputs: ${JSON.stringify(p.inputs ?? [])}
    // 可被 event/procedure 调用，复用此方法
    private static void ${methodName}(${signature}) {
${body}
    }`;
      })
      .join('\n\n');

    // 条件检查方法（遍历 spec.conditions 全量生成，含未被 handler 引用的）
    const conditionMethods = conditions
      .map((c) => {
        const methodName = `check_${this.sanitizeIdent(c.conditionId)}`;
        // P1-7：常见条件类型生成真实检查逻辑（event-logic.ts），其余保留 TODO
        const body =
          conditionCheckBody(c) ??
          `        // TODO: 实现 ${c.conditionType} 检查逻辑
        return true;`;
        return `    // 条件: ${c.conditionId} (invert: ${c.invert})
    // conditionType: ${c.conditionType}
    // args: ${JSON.stringify(c.args)}
    private static boolean ${methodName}(EventContext ctx) {
${body}
    }`;
      })
      .join('\n\n');

    // 动作执行方法（遍历 spec.actions 全量生成，含未被 handler 引用的）
    const actionMethods = actions
      .map((a) => {
        const methodName = `execute_${this.sanitizeIdent(a.actionId)}`;
        // P1-7：常见动作类型生成真实执行逻辑（event-logic.ts），其余保留 TODO
        const body = actionExecuteBody(a) ?? `        // TODO: 实现 ${a.actionType} 执行逻辑`;
        return `    // 动作: ${a.actionId}
    // actionType: ${a.actionType}
    // args: ${JSON.stringify(a.args)}
    private static void ${methodName}(EventContext ctx) {
${body}
    }`;
      })
      .join('\n\n');

    const allMethods = [handlerMethods, procedureMethods, conditionMethods, actionMethods]
      .filter(Boolean)
      .join('\n\n');

    // 事件上下文：承载回调参数（NeoForge 事件 getter 在此绑定），供条件/动作逻辑读取
    const eventContextClass = `    // 事件上下文：回调参数绑定字段（事件未提供时保持 null，逻辑侧判空保护）
    private static class EventContext {
        net.minecraft.server.level.ServerPlayer player = null;
        net.minecraft.server.level.ServerLevel level = null;
        net.minecraft.core.BlockPos pos = null;
        net.minecraft.world.level.block.state.BlockState state = null;
        net.minecraft.world.item.ItemStack stack = null;
        net.minecraft.world.entity.Entity target = null;
    }`;

    const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;

public class ModEvents {
    public static final String MOD_ID = "${spec.modId}";
${eventContextClass}

${allMethods}

    public static void initialize(IEventBus modEventBus) {
${registrations || '        // (无事件处理器)'}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModEvents.java`,
      content,
    };
  }

  /**
   * 把任意字符串转为合法 Java 标识符片段。
   * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"。
   */
  private sanitizeIdent(s: string): string {
    if (!s) return 'unknown';
    let sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(sanitized)) sanitized = `_${sanitized}`;
    sanitized = sanitized.replace(/_+/g, '_'); // 合并连续下划线
    if (!sanitized || sanitized === '_') return 'unknown';
    return sanitized;
  }

  // === 内部辅助 ===

  /** 把任意字符串转为合法 PascalCase Java 标识符 */
  protected toPascal(s: string): string {
    const sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
    const parts = sanitized.split('_').filter(Boolean);
    if (parts.length === 0) return 'Unknown';
    const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
  }

  /**
   * PortType（节点图端口类型字符串）→ Java 类型映射。
   * 用于 CustomCodeSnippetSpec.inputSignature/outputSignature 的类型转换。
   */
  protected portTypeToJava(portType: string): string {
    const lower = portType.toLowerCase();
    switch (lower) {
      case 'integer':
      case 'int':
      case 'long':
        return 'int';
      case 'number':
      case 'float':
      case 'double':
        return 'double';
      case 'string':
      case 'text':
        return 'String';
      case 'boolean':
      case 'bool':
        return 'boolean';
      case 'void':
      case 'none':
        return 'void';
      case 'item':
      case 'itemstack':
        return 'ItemStack';
      case 'block':
      case 'blockstate':
        return 'BlockState';
      case 'entity':
        return 'Entity';
      case 'player':
        return 'Player';
      case 'vec3':
      case 'vector3':
      case 'pos':
        return 'Vec3'; // P2 dogfood 修复：NeoForge 使用 Mojang 映射（Vec3），而非 Yarn 的 Vec3d
      case 'nbt':
        return 'CompoundTag';
      default:
        return 'Object';
    }
  }

  /** 根据 modelType 返回实体基类名
   * Major 修复：返回具体类名（Zombie/Skeleton/...）而非基类（Mob/Animal），
   * 使 EntityType<T>、Builder.<T>of(factory, ...)、factory 三者泛型一致。
   */
  private entityBaseClass(modelType: string): string {
    switch (modelType) {
      case 'zombie':
        return 'Zombie';
      case 'skeleton':
        return 'Skeleton';
      case 'creeper':
        return 'Creeper';
      case 'pig':
        return 'Pig';
      case 'cow':
        return 'Cow';
      case 'custom':
      default:
        return 'Entity';
    }
  }

  /** 根据 modelType 返回实体工厂引用 */
  private entityFactory(modelType: string): string {
    switch (modelType) {
      case 'zombie':
        return 'Zombie::new';
      case 'skeleton':
        return 'Skeleton::new';
      case 'creeper':
        return 'Creeper::new';
      case 'pig':
        return 'Pig::new';
      case 'cow':
        return 'Cow::new';
      case 'custom':
      default:
        return 'Entity::new';
    }
  }

  /** classification → NeoForge MobCategory 映射 */
  private neoforgeMobCategory(classification: string): string {
    switch (classification) {
      case 'animal':
        return 'MobCategory.CREATURE';
      case 'monster':
        return 'MobCategory.MONSTER';
      case 'water_creature':
        return 'MobCategory.WATER_CREATURE';
      case 'ambient':
        return 'MobCategory.AMBIENT';
      case 'misc':
      default:
        return 'MobCategory.MISC';
    }
  }

  /** eventType → NeoForge 事件类名映射（简化） */
  private neoforgeEventClass(eventType: string): string {
    switch (eventType) {
      case 'player_right_click_block':
        return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickBlock';
      case 'player_right_click_item':
        return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickItem';
      case 'player_left_click':
        return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.LeftClickBlock';
      case 'block_break':
        return 'net.neoforged.neoforge.event.level.BlockEvent.BreakEvent';
      case 'block_place':
        return 'net.neoforged.neoforge.event.level.BlockEvent.EntityPlaceEvent';
      case 'entity_death':
        return 'net.neoforged.neoforge.event.entity.living.LivingDeathEvent';
      case 'entity_hurt':
        return 'net.neoforged.neoforge.event.entity.living.LivingHurtEvent';
      case 'item_use':
        return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickItem';
      case 'item_pickup':
        return 'net.neoforged.neoforge.event.entity.player.EntityItemPickupEvent';
      case 'player_join':
        return 'net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent';
      case 'player_quit':
        return 'net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent';
      case 'tick':
        return 'net.neoforged.neoforge.event.tick.ServerTickEvent';
      case 'custom':
      default:
        return 'net.neoforged.neoforge.event.GenericEvent';
    }
  }

  /**
   * 根据 eventType 生成 NeoForge 事件对象 → EventContext 字段绑定语句（缩进 12 空格）。
   * P2.1 事件参数绑定：事件 getter 绑定到上下文，条件/动作逻辑从中读取。
   */
  private neoforgeEventBindings(eventType: string): string {
    const bind = (assignments: string[]): string =>
      assignments.map((a) => `            ${a}`).join('\n');
    switch (eventType) {
      case 'tick':
        return bind(['ctx.level = event.getServer().overworld();']);
      case 'player_join':
      case 'player_quit':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
        ]);
      case 'player_right_click_block':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
          'ctx.pos = event.getPos();',
        ]);
      case 'player_right_click_item':
      case 'item_use':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
          'ctx.stack = event.getItemStack();',
        ]);
      case 'player_left_click':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
          'ctx.pos = event.getPos();',
        ]);
      case 'block_break':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getPlayer();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
          'ctx.pos = event.getPos();',
          'ctx.state = event.getState();',
        ]);
      case 'block_place':
        return bind([
          'ctx.target = event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
          'ctx.pos = event.getPos();',
          'ctx.state = event.getBlockSnapshot().getReplacedBlock();',
        ]);
      case 'entity_death':
      case 'entity_hurt':
        return bind([
          'ctx.target = event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
        ]);
      case 'item_pickup':
        return bind([
          'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
          'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
          'ctx.stack = event.getItem();',
        ]);
      case 'custom':
      default:
        return '            // (custom 事件无标准绑定)';
    }
  }

  private modsToml(spec: ModSpecLike, mcVersion: string, versions: LoaderVersionConfig): FileNode {
    const content = `modLoader = "javafml"
loaderVersion = "${versions.neoforgeLoaderVersionRange}"
license = "${tomlEscape(spec.license || 'MIT')}"

[[mods]]
modId = "${spec.modId}"
version = "\${version}"
displayName = "${tomlEscape(spec.name)}"
description = "${tomlEscape(spec.description)}"

[[dependencies.${spec.modId}]]
    modId = "neoforge"
    type = "required"
    versionRange = "${versions.neoforgeVersionRange}"
    ordering = "NONE"
    side = "BOTH"

[[dependencies.${spec.modId}]]
    modId = "minecraft"
    type = "required"
    versionRange = "[${mcVersion},)"
    ordering = "NONE"
    side = "BOTH"
`;
    return { path: 'src/main/resources/META-INF/mods.toml', content };
  }

  private buildGradle(
    spec: ModSpecLike,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    // 版本感知：1.21.x → Java 21，26.1 → Java 25
    const javaVersion = javaVersionFor('neoforge', mcVersion as McVersion);
    const content = `plugins {
    id 'net.neoforged.moddev' version '${versions.neoforgeModdevVersion}'
}

version = '${spec.version}'
group = 'com.example.${spec.modId}'

base { archivesName = '${spec.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVersion})

neoForge {
    version = "${versions.neoforgeVersion}"
    runs {
        client { client() }
        server { server() }
    }
    mods {
        "${spec.modId}" {
            sourceSet sourceSets.main
        }
    }
}

repositories {
    mavenCentral()
}
`;
    return { path: 'build.gradle', content };
  }

  private settingsGradle(): FileNode {
    return {
      path: 'settings.gradle',
      content: `rootProject.name = 'mc-mod'\n`,
    };
  }

  private gradleProperties(
    spec: ModSpecLike,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / NeoForge
mc_version=${mcVersion}
neoforge_version=${versions.neoforgeVersion}
`;
    return { path: 'gradle.properties', content };
  }
}

type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  // P10 新增字段（向后兼容：均为可选，由 spec.default 兜底）
  license: string;
  authors: string[];
  credits: string;
  website: string;
  dependencies: Array<{ modId: string; version: string; mandatory: boolean }>;
  items: Array<{
    id: string;
    name: string;
    maxStackSize: number;
    rarity: 'common' | 'uncommon' | 'rare' | 'epic';
    maxDamage: number;
    fuelTick: number;
    food?: { hunger: number; saturation: number };
    lore: string;
  }>;
  blocks: Array<{
    id: string;
    name: string;
    material: string;
    hardness: number;
    miningLevel: number;
    lightLevel: number;
    resistance: number;
    soundType:
      | 'wood'
      | 'stone'
      | 'metal'
      | 'grass'
      | 'sand'
      | 'glass'
      | 'cloth'
      | 'ladder'
      | 'anvil'
      | 'slime';
    dropSelf: boolean;
    dropItem: string;
  }>;
  // === P1.3/P1.4 新增字段（可选，向后兼容） ===
  recipes?: Array<{
    recipeId: string;
    recipeType: string;
    inputs: Array<{ item: string; count: number; slot: string }>;
    output: string;
    outputCount: number;
    cookTime: number;
    experience: number;
    pattern: string[];
  }>;
  entities?: Array<{
    entityId: string;
    displayName: string;
    maxHealth: number;
    attackDamage: number;
    movementSpeed: number;
    classification: string;
    modelType: string;
    spawnWeight: number;
    spawnBiomes: string[];
    texturePath?: string;
  }>;
  machines?: Array<{
    machineId: string;
    displayName: string;
    energyCapacity: number;
    maxEnergyTransfer: number;
    inputSlots: number;
    outputSlots: number;
    defaultProcessTime: number;
    defaultEnergyPerTick: number;
    guiWidth: number;
    guiHeight: number;
  }>;
  customCode?: Array<{
    snippetId: string;
    language: string;
    code: string;
    inputSignature: Record<string, string>;
    outputSignature: Record<string, string>;
    methodName: string;
  }>;
  multiblocks?: Array<{
    structureId: string;
    displayName: string;
    width: number;
    height: number;
    depth: number;
    hollow: boolean;
    controllerOffset: { x: number; y: number; z: number };
  }>;
  fluids?: Array<{
    fluidId: string;
    displayName: string;
    color: number;
    temperature: number;
    viscosity: number;
    density: number;
    luminous: boolean;
    texturePath?: string;
  }>;
  biomes?: Array<{
    biomeId: string;
    displayName: string;
    precipitation: 'none' | 'rain' | 'snow';
    temperature: number;
    temperatureModifier: 'none' | 'frozen';
    downfall: number;
    skyColor: number;
    waterColor: number;
    waterFogColor: number;
    grassColor?: number;
    foliageColor?: number;
    fogColor: number;
    surfaceBuilder: string;
    category: string;
    spawnWeight: number;
    spawnDimensions: string[];
    texturePath?: string;
  }>;
  dimensions?: Array<{
    dimensionId: string;
    displayName: string;
    baseType: 'overworld' | 'nether' | 'end';
    fixedTime: number | null;
    hasSkyLight: boolean;
    hasCeiling: boolean;
    ultrawarm: boolean;
    natural: boolean;
    coordinateScale: number;
    minY: number;
    height: number;
    logicalHeight: number;
    ambientLight: number;
    piglinSafe: boolean;
    bedWorks: boolean;
    respawnAnchorWorks: boolean;
    effects: 'overworld' | 'the_nether' | 'the_end' | 'none';
    seed?: number;
    texturePath?: string;
  }>;
  eventHandlers?: Array<{
    handlerId: string;
    eventType: string;
    eventArgs: Record<string, unknown>;
    /** P1.5：关联的 condition 节点 id 列表（替代旧 conditions 字段） */
    conditionIds?: string[];
    /** P1.5：关联的 action 节点 id 列表（替代旧 actions 字段） */
    actionIds?: string[];
    /** P1-3：关联的 procedure 节点 id 列表（事件调用过程） */
    procedureCallIds?: string[];
    /** P40：过程调用参数（procedureId → 表达式数组，与被调过程 inputs 顺序对应） */
    procedureCallArgs?: Record<string, string[]>;
  }>;
  conditions?: Array<{
    conditionId: string;
    conditionType: string;
    args: Record<string, unknown>;
    invert: boolean;
  }>;
  actions?: Array<{
    actionId: string;
    actionType: string;
    args: Record<string, unknown>;
  }>;
  /** P1-3：过程（命名可复用逻辑单元，编译为独立 Java 方法） */
  procedures?: Array<{
    procedureId: string;
    procedureName: string;
    displayName: string;
    /** P40：输入参数定义（name + Java 类型） */
    inputs?: Array<{ name: string; type: string }>;
    conditionIds: string[];
    actionIds: string[];
    /** 嵌套调用的过程节点 id 列表 */
    procedureCallIds: string[];
    /** P40：嵌套过程调用参数（procedureId → 表达式数组） */
    procedureCallArgs?: Record<string, string[]>;
  }>;
};
