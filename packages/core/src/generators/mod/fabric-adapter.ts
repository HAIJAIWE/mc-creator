import type { FileNode, GeneratorContext, Loader } from '@mc-creator/shared';
import {
  getLoaderVersions,
  gradleVersionFor,
  javaVersionFor,
  type LoaderVersionConfig,
  type McVersion,
} from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath, javaEscape } from './templates.js';
import { BuildCache, hashCategory, type IncrementalResult } from '../../builder/BuildCache.js';
import { conditionCheckBody, actionExecuteBody } from './event-logic.js';

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

/**
 * Fabric Loader Adapter（规格 §3.2）。
 * 生成 fabric.mod.json + Fabric Loom build.gradle（用 officialMojangMappings，非 Yarn）
 * + ModInitializer 入口 + Registry.register 注册代码 + 资源文件。
 *
 * 关键：用官方 mappings 使 Java 代码用 net.minecraft.world.item.Item 等官方名，
 * 与 NeoForge 一致，26.1 切换无需改 Adapter。
 *
 * P1.3/P1.4 扩展：消费 ModSpec 新增字段（recipes/entities/machines/customCode/multiblocks/
 * eventHandlers/conditions/actions），生成对应的 ModRecipes/ModEntities/ModMachines/
 * ModCodeSnippets/ModMultiblocks/ModEvents Java 类。Quilt/LegacyFabric 通过继承复用。
 */
export class FabricAdapter implements LoaderAdapter {
  readonly loader: Loader = 'fabric';

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
      name: 'fabricModJson',
      // G-5 修复：用传入的 mcVersion（与 build.gradle/gradle.properties 一致），
      // 而非 spec.mcVersionHint（ModSpec 无此字段，恒为默认值且与 ctx.mcVersion 脱节）
      // P2.2：block_place handler 存在时 fabric.mod.json 需声明 mixins 字段
      hashInputs: (s, mcVersion) => [
        s.modId,
        s.name,
        s.description,
        s.version,
        mcVersion,
        (s.eventHandlers ?? []).some((h) => h.eventType === 'block_place'),
      ],
      generate: (s, pkg, mainCls, mcVersion, versions) => [
        this.fabricModJson(
          s,
          pkg,
          mainCls,
          mcVersion,
          versions,
          (s.eventHandlers ?? []).some((h) => h.eventType === 'block_place'),
        ),
      ],
    },
    {
      name: 'buildGradle',
      hashInputs: (_s, mcVersion) => [mcVersion],
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
      name: 'wrapperProperties',
      hashInputs: (s, mcVersion) => [mcVersion],
      generate: (s, _pkg, _mainCls, mcVersion) => [this.wrapperProperties(mcVersion)],
    },
    {
      // mainClass 依赖 modId/name + 各类别是否非空（决定 initCalls）
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
      generate: (s, pkg) => (s.fluids?.length ? [this.modFluidsJava(s, pkg)] : []),
    },
    {
      name: 'biomes',
      hashInputs: (s) => s.biomes ?? [],
      generate: (s, pkg) => (s.biomes?.length ? [this.modBiomesJava(s, pkg)] : []),
    },
    {
      name: 'dimensions',
      hashInputs: (s) => s.dimensions ?? [],
      generate: (s, pkg) => (s.dimensions?.length ? [this.modDimensionsJava(s, pkg)] : []),
    },
    {
      name: 'guis',
      hashInputs: (s) => s.guis ?? [],
      generate: (s, pkg) => (s.guis?.length ? [this.modGuisJava(s, pkg)] : []),
    },
    {
      name: 'structures',
      hashInputs: (s) => s.structures ?? [],
      generate: (s, pkg) => (s.structures?.length ? [this.modStructuresJava(s, pkg)] : []),
    },
    {
      name: 'recipes',
      hashInputs: (s) => s.recipes ?? [],
      generate: (s, pkg) => (s.recipes?.length ? [this.modRecipesJava(s, pkg)] : []),
    },
    {
      name: 'entities',
      hashInputs: (s) => s.entities ?? [],
      generate: (s, pkg) => {
        const files = s.entities?.length ? [this.modEntitiesJava(s, pkg)] : [];
        // T6: custom 模型实体的模型 JSON 骨架
        files.push(...this.entityModels(s));
        return files;
      },
    },
    {
      name: 'machines',
      hashInputs: (s) => s.machines ?? [],
      generate: (s, pkg) => (s.machines?.length ? [this.modMachinesJava(s, pkg)] : []),
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
      generate: (s, pkg) =>
        s.eventHandlers?.length || s.conditions?.length || s.actions?.length || s.procedures?.length
          ? [this.modEventsJava(s, pkg)]
          : [],
    },
    {
      // P2.2 block_place 需 Mixin（Fabric API 无放置事件）：生成 Mixin 类 + mixins.json
      name: 'blockPlaceMixin',
      hashInputs: (s) => (s.eventHandlers ?? []).filter((h) => h.eventType === 'block_place'),
      generate: (s, pkg) => this.blockPlaceMixinFiles(s, pkg),
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
   * P10：生成 <modId>_meta.json 元数据文件（最小侵入，避免改动 fabric.mod.json）。
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

  private fabricModJson(
    spec: ModSpecLike,
    pkg: string,
    mainCls: string,
    mcVersion: string,
    versions: LoaderVersionConfig,
    hasMixins = false,
  ): FileNode {
    const content: Record<string, unknown> = {
      schemaVersion: 1,
      id: spec.modId,
      version: '${version}',
      name: spec.name,
      description: spec.description,
      authors: ['mc-creator'],
      entrypoints: {
        main: [`${pkg}.${mainCls}`],
      },
      depends: {
        fabricloader: versions.fabricLoaderMinVersion,
        minecraft: `~${mcVersion}`,
        java: `>=${javaVersionFor('fabric', mcVersion as McVersion)}`,
        'fabric-api': '*',
      },
    };
    if (hasMixins) {
      content.mixins = [`${spec.modId}.mixins.json`];
    }
    return {
      path: 'src/main/resources/fabric.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  private buildGradle(
    spec: ModSpecLike,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    // 版本感知：1.20.x → Java 17，1.21.x → Java 21，26.x → Java 25
    const javaVersion = javaVersionFor('fabric', mcVersion as McVersion);
    const javaConstant = javaVersion === 25 ? 'VERSION_25' : `VERSION_${javaVersion}`;
    // 26.x 为非混淆版：插件 net.fabricmc.fabric-loom、无 mappings、依赖用 implementation（官方 26.1 模板）
    const isUnobfuscated = mcVersion.startsWith('26.');
    const loomPluginId = isUnobfuscated ? 'net.fabricmc.fabric-loom' : 'fabric-loom';
    const mappingsLine = isUnobfuscated ? '' : '    mappings loom.officialMojangMappings()\n';
    const depPrefix = isUnobfuscated ? 'implementation' : 'modImplementation';
    const content = `plugins {
    id '${loomPluginId}' version '${versions.fabricLoomVersion}'
    id 'java'
}

version = project.mod_version
group = project.maven_group

base { archivesName = project.archives_base_name }

repositories {
    maven { name = "Fabric"; url = 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
${mappingsLine}    ${depPrefix} "net.fabricmc:fabric-loader:\${project.loader_version}"
    ${depPrefix} "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

java {
    sourceCompatibility = JavaVersion.${javaConstant}
    targetCompatibility = JavaVersion.${javaConstant}
    withSourcesJar()
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

  protected gradleProperties(
    spec: ModSpecLike,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Fabric
minecraft_version=${mcVersion}
loader_version=${versions.fabricLoaderVersion}
fabric_version=${versions.fabricApiVersion}
`;
    return { path: 'gradle.properties', content };
  }

  /** gradle/wrapper/gradle-wrapper.properties（按 MC 版本选择 Gradle；jar 由 gradle wrapper 命令生成） */
  private wrapperProperties(mcVersion: string): FileNode {
    const gradleVersion = gradleVersionFor(mcVersion);
    const content = `# 按 MC 版本 ${mcVersion} 选择的 Gradle 版本（${gradleVersion}）
# 首次构建前在项目目录运行：gradle wrapper --gradle-version ${gradleVersion}
# （本机需安装 Gradle；该命令生成 gradlew、gradlew.bat 与 gradle-wrapper.jar，之后用 ./gradlew 构建）
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
    return { path: 'gradle/wrapper/gradle-wrapper.properties', content };
  }

  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    // 条件性生成子模块初始化调用（仅当 spec 中对应字段非空时）
    const initCalls: string[] = ['ModItems.initialize();', 'ModBlocks.initialize();'];
    if (spec.recipes?.length) initCalls.push('ModRecipes.initialize();');
    if (spec.entities?.length) initCalls.push('ModEntities.initialize();');
    if (spec.fluids?.length) initCalls.push('ModFluids.initialize();');
    if (spec.biomes?.length) initCalls.push('ModBiomes.initialize();');
    if (spec.dimensions?.length) initCalls.push('ModDimensions.initialize();');
    if (spec.guis?.length) initCalls.push('ModGuis.initialize();');
    if (spec.structures?.length) initCalls.push('ModStructures.initialize();');
    if (spec.machines?.length) initCalls.push('ModMachines.initialize();');
    if (spec.customCode?.length) initCalls.push('ModCustomCode.initialize();');
    if (spec.multiblocks?.length) initCalls.push('ModMultiblocks.initialize();');
    if (
      spec.eventHandlers?.length ||
      spec.conditions?.length ||
      spec.actions?.length ||
      spec.procedures?.length
    ) {
      initCalls.push('ModEvents.initialize();');
    }
    const content = `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${mainCls} implements ModInitializer {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ${initCalls.join('\n        ')}
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
      .map((it) => `    public static Item ${it.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.items
      .map(
        (it) =>
          `        ${it.id.toUpperCase()} = Registry.register(BuiltInRegistries.ITEM, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${it.id}"), new Item(new Item.Properties()));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.item.Item;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;

public class ModItems {
${fields}

    public static void initialize() {
${regs}
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
      .map((b) => `    public static Block ${b.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.blocks
      .map((b) => {
        const settings = `Block.Properties.of().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
        return `        ${b.id.toUpperCase()} = Registry.register(BuiltInRegistries.BLOCK, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${b.id}"), new Block(${settings}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.block.Block;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;

public class ModBlocks {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
      content,
    };
  }

  /**
   * Task D：生成 ModFluids.java。
   * 流体注册：Registry.register(BuiltInRegistries.FLUID, ...)，SimpleFluid 为
   * net.minecraft.world.level.material.SimpleFluid 的自定义子类（流经/静止状态）。
   * 同时注册流体桶物品（ModItems.FLUID_BUCKET）。
   */
  private modFluidsJava(spec: ModSpecLike, pkg: string): FileNode {
    const fields = (spec.fluids ?? [])
      .map((f) => {
        const upper = f.fluidId.toUpperCase();
        return `    public static net.minecraft.world.level.material.Fluid ${upper};`;
      })
      .join('\n');
    const regs = (spec.fluids ?? [])
      .map((f) => {
        const upper = f.fluidId.toUpperCase();
        return `        ${upper} = Registry.register(BuiltInRegistries.FLUID, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${f.fluidId}"), new SimpleFluid());`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.material.SimpleFluid;

public class ModFluids {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
${regs}
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
   * Mod 侧生物群系：生成 ModBiomes.java。
   * 用 Biome.biome(...) builder 构建 Biome 并注册到 BuiltInRegistries.BIOME。
   * 注册后可通过 biome_source/multi_noise 参数用于维度生成。
   */
  private modBiomesJava(spec: ModSpecLike, pkg: string): FileNode {
    const fields = (spec.biomes ?? [])
      .map(
        (b) =>
          `    public static net.minecraft.world.level.biome.Biome ${b.biomeId.toUpperCase()};`,
      )
      .join('\n');
    const regs = (spec.biomes ?? [])
      .map((b) => {
        const c = (v?: number) =>
          v !== undefined ? `0x${v.toString(16).padStart(6, '0')}` : 'null';
        const grass = b.grassColor !== undefined ? `, ${c(b.grassColor)}` : '';
        const foliage = b.foliageColor !== undefined ? `, ${c(b.foliageColor)}` : '';
        return `        ${b.biomeId.toUpperCase()} = Registry.register(BuiltInRegistries.BIOME, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${b.biomeId}"), new net.minecraft.world.level.biome.Biome.BiomeBuilder()
            .precipitation(net.minecraft.world.level.biome.Biome.Precipitation.${b.precipitation.toUpperCase()})
            .temperature(${b.temperature}f)${b.temperatureModifier === 'frozen' ? '\n            .temperatureAdjustment(net.minecraft.world.level.biome.Biome.TemperatureModifier.FROZEN)' : ''}
            .downfall(${b.downfall}f)
            .specialEffects(new net.minecraft.world.level.biome.BiomeSpecialEffects.Builder()
                .skyColor(${c(b.skyColor)})
                .waterColor(${c(b.waterColor)})
                .waterFogColor(${c(b.waterFogColor)})
                .fogColor(${c(b.fogColor)})${grass ? `.grassColorOverride(${c(b.grassColor)})` : ''}${foliage ? `.foliageColorOverride(${c(b.foliageColor)})` : ''}
                .build())
            .mobSpawnSettings(net.minecraft.world.level.biome.MobSpawnSettings.EMPTY)
            .generationSettings(net.minecraft.world.level.biome.BiomeGenerationSettings.EMPTY)
            .build());`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;

public class ModBiomes {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModBiomes.java`,
      content,
    };
  }

  /**
   * Mod 侧维度：生成 ModDimensions.java。
   * 注册 DimensionType（dimension_type registry），维度可通过 /execute in <modid>:<dim> 访问。
   * 完整世界生成（LevelStem/ChunkGenerator）需数据包 worldgen 配合，此处注册维度类型为入口。
   */
  private modDimensionsJava(spec: ModSpecLike, pkg: string): FileNode {
    const fields = (spec.dimensions ?? [])
      .map(
        (d) =>
          `    public static net.minecraft.world.level.dimension.DimensionType ${d.dimensionId.toUpperCase()}_TYPE;`,
      )
      .join('\n');
    const regs = (spec.dimensions ?? [])
      .map((d) => {
        const typeId = d.dimensionId.toUpperCase();
        const fixedTime =
          d.fixedTime !== null ? `OptionalLong.of(${d.fixedTime}L)` : 'OptionalLong.empty()';
        const effects =
          d.effects === 'none'
            ? 'Optional.empty()'
            : `Optional.of(ResourceLocation.fromNamespaceAndPath("minecraft", "${d.effects}"))`;
        const infiniburn = `"minecraft:infiniburn_${d.baseType === 'nether' ? 'nether' : 'overworld'}"`;
        return `        ${typeId}_TYPE = Registry.register(BuiltInRegistries.DIMENSION_TYPE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${d.dimensionId}"), new DimensionType(${fixedTime}, ${d.hasSkyLight}, ${d.hasCeiling}, ${d.ultrawarm}, ${d.natural}, ${d.coordinateScale}, ${d.bedWorks}, ${d.respawnAnchorWorks}, ${d.minY}, ${d.height}, ${d.logicalHeight}, ResourceLocation.parse(${infiniburn}), ${effects}, ${d.ambientLight}, ${d.piglinSafe}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.dimension.DimensionType;
import java.util.Optional;
import java.util.OptionalLong;

public class ModDimensions {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModDimensions.java`,
      content,
    };
  }

  /**
   * GUI 界面：生成 ModGuis.java。
   * 每个 GUI 生成 Menu + Screen 两个类：
   * - Menu：槽位布局（按 spec.slots 的 x/y 定位）+ 玩家背包
   * - Screen：渲染背景 + 可选能源/进度条 + 槽位提示
   * 生成可编译的骨架（无资源贴图时用默认背景）。
   */
  private modGuisJava(spec: ModSpecLike, pkg: string): FileNode {
    const guiClasses = (spec.guis ?? [])
      .map((g) => {
        const pascal = this.toPascal(g.guiId);
        const slotCount = g.slots.length;
        const slotAdds = g.slots
          .map(
            (s) =>
              `        this.addSlot(new Slot(machineInv, ${g.slots.indexOf(s)}, ${8 + s.x}, ${18 + s.y}));`,
          )
          .join('\n');
        const energyBar = g.showEnergyBar
          ? `\n            // 能源条（需 textures/gui/energy_bar.png 资源）
            graphics.blit(net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/energy_bar.png"), this.leftPos + 8, this.topPos + 16, 0, 0, 14, 54);`
          : '';
        return `    // ${pascal}Menu：GUI 槽位布局（${slotCount} 槽）
    public static class ${pascal}Menu extends AbstractContainerMenu {
        private final net.minecraft.world.SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${pascal.toUpperCase()}_MENU_TYPE, id);
            this.machineInv = new net.minecraft.world.SimpleContainer(${slotCount});
${slotAdds}
            // 玩家背包
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, ${g.height - 82} + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, ${g.height - 24}));
            }
        }

        @Override
        public net.minecraft.world.item.ItemStack quickMoveStack(net.minecraft.world.entity.player.Player player, int index) {
            return net.minecraft.world.item.ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(net.minecraft.world.entity.player.Player player) {
            return true;
        }
    }

    // ${pascal}Screen：GUI 渲染
    public static class ${pascal}Screen extends net.minecraft.client.gui.screens.inventory.AbstractContainerScreen<${pascal}Menu> {
        public ${pascal}Screen(${pascal}Menu menu, Inventory inv, net.minecraft.network.chat.Component title) {
            super(menu, inv, title);
            this.imageWidth = ${g.width};
            this.imageHeight = ${g.height};
        }

        @Override
        protected void renderBg(net.minecraft.client.gui.GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
            graphics.blit(net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/${g.guiId}.png"), this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);${energyBar}
        }

        @Override
        public void render(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            super.render(graphics, mouseX, mouseY, partialTick);
            this.renderTooltip(graphics, mouseX, mouseY);
        }
    }

    public static final net.minecraft.world.inventory.MenuType<${pascal}Menu> ${pascal.toUpperCase()}_MENU_TYPE = new net.minecraft.world.inventory.MenuType<>((${pascal}Menu::new));`;
      })
      .join('\n\n');
    const regs = (spec.guis ?? [])
      .map((g) => {
        const pascal = this.toPascal(g.guiId);
        return `        Registry.register(BuiltInRegistries.MENU, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${g.guiId}"), ${pascal.toUpperCase()}_MENU_TYPE);`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.entity.player.Inventory;

public class ModGuis {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${guiClasses}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModGuis.java`,
      content,
    };
  }

  /**
   * Mod 侧结构：生成 ModStructures.java。
   * 注册 Structure 与 StructureSet（jigsaw 结构，配套数据包 template_pool）。
   * 结构实际生成需数据包 worldgen 文件配合（structure/structure_set JSON）。
   */
  private modStructuresJava(spec: ModSpecLike, pkg: string): FileNode {
    const fields = (spec.structures ?? [])
      .map(
        (s) =>
          `    public static net.minecraft.world.level.levelgen.structure.Structure ${s.structureId.toUpperCase()};
    public static net.minecraft.world.level.levelgen.structure.StructureSet ${s.structureId.toUpperCase()}_SET;`,
      )
      .join('\n');
    const regs = (spec.structures ?? [])
      .map((s) => {
        const id = s.structureId.toUpperCase();
        return `        // Structure: ${s.structureId} — ${s.displayName}
        // startPool=${s.startPool}, size=${s.size}, maxDistance=${s.maxDistance}
        // biomes=${s.biomes}, terrainAdaptation=${s.terrainAdaptation}
        // spacing=${s.spacing}, separation=${s.separation}, salt=${s.salt}
        ${id} = Registry.register(BuiltInRegistries.STRUCTURE, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${s.structureId}"), new net.minecraft.world.level.levelgen.structure.structures.JigsawStructure(
            net.minecraft.world.level.levelgen.structure.Structure.StructureSettingsHolder.empty(),
            net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(MOD_ID, "${s.startPool}"),
            ${s.size},
            net.minecraft.world.level.levelgen.heightproviders.ConstantHeight.of(net.minecraft.world.level.levelgen.WorldGenContext.EMPTY),
            false,
            net.minecraft.world.level.levelgen.structure.terrainadaptation.TerrainAdjustment.${s.terrainAdaptation.toUpperCase()}
        ));
        ${id}_SET = Registry.register(BuiltInRegistries.STRUCTURE_SET, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${s.structureId}"), new net.minecraft.world.level.levelgen.structure.StructureSet(
            java.util.List.of(new net.minecraft.world.level.levelgen.structure.StructureSetEntry(${id}, 1)),
            new net.minecraft.world.level.levelgen.placement.RandomSpreadStructurePlacement(${s.spacing}, ${s.separation}, ${s.salt}, net.minecraft.core.Direction.HORIZONTAL)
        ));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;

public class ModStructures {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModStructures.java`,
      content,
    };
  }

  /**
   * 生成 ModRecipes.java：仅生成 recipeId 常量定义。
   * Critical 修复：配方通过 datapack JSON 加载（data/<modid>/recipes/<id>.json），
   * 不应在 Java 中 Registry.register 一个 String 文本块为 Recipe<?> 类型（类型不匹配，无法编译）。
   * Java 文件仅保留 ID 常量供其他代码引用。
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
   * 生成 ModEntities.java：用 Registry.register(BuiltInRegistries.ENTITY_TYPE, ...) 注册实体。
   * 使用 Mojang 官方映射（EntityType.Builder.of().sized(w, h).build()），
   * 与 NeoForge 一致，配合 officialMojangMappings 构建。
   */
  private modEntitiesJava(spec: ModSpecLike, pkg: string): FileNode {
    const entities = spec.entities ?? [];
    const mainCls = mainClassName(spec.modId);
    const fields = entities
      .map(
        (e) =>
          `    public static EntityType<${this.entityBaseClass(e.modelType)}> ${e.entityId.toUpperCase()};`,
      )
      .join('\n');
    const regs = entities
      .map((e) => {
        // 简化：根据 modelType 选择 MobCategory，根据 classification 映射
        const category = this.mojangMobCategory(e.classification);
        const width = 0.6;
        const height = 1.8;
        return `        // Entity: ${e.entityId} (${e.modelType}, ${e.classification}) — ${e.displayName}
        // maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, movementSpeed=${e.movementSpeed}
        // spawnWeight=${e.spawnWeight}, spawnBiomes=${JSON.stringify(e.spawnBiomes)}
        ${e.entityId.toUpperCase()} = Registry.register(BuiltInRegistries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${e.entityId}"), EntityType.Builder.<${this.entityBaseClass(e.modelType)}>of(${this.entityFactoryMojang(e.modelType)}, ${category}).sized(${width}f, ${height}f).build("${e.entityId}"));`;
      })
      .join('\n');
    // G-1 修复：实体字段/工厂引用具体实体类（Zombie/Skeleton/...），必须补对应 import，
    // 否则生成代码引用了未导入的类无法编译。
    const usedEntityClasses = [
      ...new Set(entities.map((e) => this.entityBaseClass(e.modelType))),
    ].sort();
    const entityImports = usedEntityClasses
      .map((c) => `import net.minecraft.world.entity.${c};`)
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
${entityImports}
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;

public class ModEntities {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
      content,
    };
  }

  /**
   * 生成 ModMachines.java：注册 BlockEntityType + MenuType（可编译占位骨架）。
   *
   * G-2 修复：原实现引用不存在的 ModBlocks.${MACHINE_ID}（方块 id 与 machineId 不一定相同）
   * 和 ${Pascal}BlockEntity / ${Pascal}Menu 顶层类，生成代码无法编译。
   * 现在每个机器生成嵌套占位类（BlockEntity/Menu），注册时用 Blocks.STONE 占位方块，
   * 保证可编译，并注释提示替换为实际实现。
   */
  private modMachinesJava(spec: ModSpecLike, pkg: string): FileNode {
    const machines = spec.machines ?? [];
    const mainCls = mainClassName(spec.modId);
    const fields = machines
      .map(
        (m) =>
          `    public static BlockEntityType<?> ${m.machineId.toUpperCase()}_BE;\n    public static MenuType<?> ${m.machineId.toUpperCase()}_MENU;`,
      )
      .join('\n');
    const placeholderClasses = machines
      .map((m) => {
        const pascal = this.toPascal(m.machineId);
        const id = m.machineId.toUpperCase();
        const totalSlots = m.inputSlots + m.outputSlots;
        return `    // ${pascal}BlockEntity：能源存储 + 输入/输出槽位 + 简易加工
    public static class ${pascal}BlockEntity extends BlockEntity {
        public static final int ENERGY_CAPACITY = ${m.energyCapacity};
        public static final int ENERGY_PER_TICK = ${m.defaultEnergyPerTick};
        public static final int PROCESS_TIME = ${m.defaultProcessTime};
        private int energy = 0;
        private int progress = 0;
        private final net.minecraft.world.SimpleContainer inventory = new net.minecraft.world.SimpleContainer(${totalSlots});

        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE, pos, state);
        }

        // 能源 API：加/取/查
        public int getEnergy() { return energy; }
        public int getMaxEnergy() { return ENERGY_CAPACITY; }
        public int receiveEnergy(int amount) {
            int accepted = Math.min(amount, ENERGY_CAPACITY - energy);
            energy += accepted;
            return accepted;
        }
        public int extractEnergy(int amount) {
            int taken = Math.min(amount, energy);
            energy -= taken;
            return taken;
        }

        // 槽位访问：输入槽在前，输出槽在后
        public net.minecraft.world.SimpleContainer getInventory() { return inventory; }

        // tick 处理：耗能推进加工进度（输出槽有空间时）
        public void tickServer() {
            if (energy >= ENERGY_PER_TICK && progress < PROCESS_TIME) {
                energy -= ENERGY_PER_TICK;
                progress++;
            } else if (progress >= PROCESS_TIME) {
                progress = 0;
                // 配方映射：输入物品 ID → 输出物品 ID（未匹配时回退原样搬运）
                for (int i = 0; i < ${m.inputSlots}; i++) {
                    var stack = inventory.getItem(i);
                    if (!stack.isEmpty()) {
                        var outStack = inventory.getItem(${m.inputSlots});
                        if (outStack.isEmpty()) {
                            String outId = recipeOutput(stack.getItem().getDescriptionId());
                            if (outId != null) {
                                var output = new net.minecraft.world.item.ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(outId)), 1);
                                inventory.setItem(${m.inputSlots}, output);
                                stack.shrink(1);
                            } else {
                                inventory.setItem(${m.inputSlots}, stack.copyWithCount(1));
                                stack.shrink(1);
                            }
                        }
                        break;
                    }
                }
            }
        }

        // 配方映射查找（从 spec 生成）
        private static String recipeOutput(String inputItemId) {
            String id = inputItemId.replace("item.", "").replace(".", ":");
            switch (id) {
${this.machineRecipeCases(m)}
                default:
                    return null;
            }
        }
    }

    // ${pascal}Menu：输入槽(0..${m.inputSlots - 1}) + 输出槽(${m.inputSlots}..${totalSlots - 1}) + 玩家背包(9×3)
    public static class ${pascal}Menu extends AbstractContainerMenu {
        private final net.minecraft.world.SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${id}_MENU, id);
            this.machineInv = new net.minecraft.world.SimpleContainer(${totalSlots});
            // 机器槽位
            for (int i = 0; i < ${totalSlots}; i++) {
                this.addSlot(new Slot(machineInv, i, 8 + (i % 9) * 18, 18 + (i / 9) * 18));
            }
            // 玩家背包
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            // 快捷栏
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, 142));
            }
        }

        @Override
        public net.minecraft.world.item.ItemStack quickMoveStack(net.minecraft.world.entity.player.Player player, int index) {
            return net.minecraft.world.item.ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(net.minecraft.world.entity.player.Player player) {
            return true;
        }
    }`;
      })
      .join('\n\n');
    const regs = machines
      .map((m) => {
        const pascal = this.toPascal(m.machineId);
        const id = m.machineId.toUpperCase();
        return `        // Machine: ${m.machineId} — ${m.displayName}
        // energyCapacity=${m.energyCapacity}, maxTransfer=${m.maxEnergyTransfer}
        // inputSlots=${m.inputSlots}, outputSlots=${m.outputSlots}
        // processTime=${m.defaultProcessTime}, energyPerTick=${m.defaultEnergyPerTick}
        // guiWidth=${m.guiWidth}, guiHeight=${m.guiHeight}
        ${id}_BE = Registry.register(BuiltInRegistries.BLOCK_ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${m.machineId}"), BlockEntityType.Builder.of(${pascal}BlockEntity::new, Blocks.STONE).build(null));
        ${id}_MENU = Registry.register(BuiltInRegistries.MENU, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${m.machineId}"), new MenuType<>(${pascal}Menu::new));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.Registry;
import net.minecraft.resources.ResourceLocation;

public class ModMachines {
${fields}
${placeholderClasses}

    public static void initialize() {
${regs}
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/ModMachines.java`,
      content,
    };
  }

  /**
   * 生成 ModCustomCode.java：把每个 CustomCodeSnippetSpec 的 code 嵌入为独立方法。
   * 方法名取自 snippet.methodName，签名取自 inputSignature/outputSignature（PortType → Java 类型）。
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
        // 缩进用户代码到方法体内部（8 空格）
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
   * 生成 ModMultiblocks.java：把每个 MultiBlockSpec 编译为常量（结构尺寸 + 控制器偏移）。
   * 简化：仅生成元数据常量，不实际注册结构（多方块注册 API 较复杂，留待后续完善）。
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
   * 结构：
   *   - initialize()：按 eventType 选择 Fabric API 注册事件回调，回调内调用 handle_<handlerId>
   *   - handle_<handlerId>(Object event)：根据 conditionIds 生成 if 语句（invert 加 !），
   *     块内调用 actionIds 对应的 execute_<actionId>，以及 procedureCallIds 对应的 procedure_<name>
   *   - procedure_<procedureName>(Object event)：P1-3 过程方法（命名的可复用逻辑单元，
   *     含 conditionIds/actionIds/procedureCallIds，结构与 handle_ 同构；可被多个 event/procedure 调用）
   *   - check_<conditionId>(Object event)：条件检查方法（含 conditionType/args 注释，return true 占位）
   *   - execute_<actionId>(Object event)：动作执行方法（含 actionType/args 注释，空方法体占位）
   *
   * 简化：每个 conditionId 生成独立 if 块，块内调用所有 actionIds/procedureCallIds（control 边的
   * 精确嵌套关系在扁平结构中已丢失，需 P1.5+ 才能完整还原）。
   */
  private modEventsJava(spec: ModSpecLike, pkg: string): FileNode {
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

    // initialize() 中的事件注册调用（按 eventType 选择 Fabric API，用全限定名避免 import 错误）
    const registrations = handlers
      .map((h) => {
        const handlerMethod = `handle_${this.sanitizeIdent(h.handlerId)}`;
        return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
${this.fabricEventRegistration(h.eventType, handlerMethod)}`;
      })
      .join('\n');

    // 生成方法体（conditionIds → AND 合取 if 块 + actionIds/procedureCallIds 调用）。
    // handle_ 与 procedure_ 共用此逻辑，区别仅在方法签名与注释。
    // P40：callArgs 为 procedureCallId → 表达式数组（与被调过程 inputs 顺序对应），
    // 缺省表达式由 defaultValueFor 回退为该参数类型的默认值。
    const buildBody = (
      conditionIds: string[],
      actionIds: string[],
      procCallIds: string[],
      callArgs?: Record<string, string[]>,
    ): string => {
      // 过滤 dangling 引用：conditionId/actionId 必须在对应 spec 中存在
      const validCondIds = conditionIds.filter((cid) => {
        if (!conditionMap.has(cid)) {
          return false; // dangling：跳过
        }
        return true;
      });
      const validActionIds = actionIds.filter((aid) => {
        if (!actionIdSet.has(aid)) {
          return false; // dangling：跳过
        }
        return true;
      });

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

    // P2.2 block_place：Fabric 无现成放置事件，由 Mixin @Inject 调用的公开通知入口。
    // 构造 EventContext 并逐个调用 block_place 的 handle_ 方法（无 handler 时不生成）。
    const blockPlaceHandlers = handlers.filter((h) => h.eventType === 'block_place');
    const notifyBlockPlaced = blockPlaceHandlers.length
      ? `    // block_place 事件通知入口（由 ModBlockPlaceMixin @Inject 调用，Fabric API 无放置事件）
    public static void notifyBlockPlaced(net.minecraft.world.level.Level level, net.minecraft.core.BlockPos pos, net.minecraft.world.level.block.state.BlockState state, net.minecraft.server.level.ServerPlayer player) {
        EventContext ctx = new EventContext();
        ctx.level = level instanceof net.minecraft.server.level.ServerLevel sl ? sl : null;
        ctx.pos = pos;
        ctx.state = state;
        ctx.player = player;
${blockPlaceHandlers.map((h) => `        handle_${this.sanitizeIdent(h.handlerId)}(ctx);`).join('\n')}
    }`
      : '';

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

    const allMethods = [
      handlerMethods,
      notifyBlockPlaced,
      procedureMethods,
      conditionMethods,
      actionMethods,
    ]
      .filter(Boolean)
      .join('\n\n');

    // 事件上下文：承载回调参数（Fabric 回调多参数在此绑定），供条件/动作逻辑读取
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

public class ModEvents {
${eventContextClass}

${allMethods}

    public static void initialize() {
        // 注册事件处理器（按 eventType 调用对应 Fabric API；用全限定名避免 import 错误）
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
   * P2.2 block_place 的 Mixin 支持（Fabric API 无放置事件）。
   * 生成 ModBlockPlaceMixin.java（@Inject BlockItem.place 的 RETURN 后通知 ModEvents.notifyBlockPlaced）
   * 与 <modId>.mixins.json（fabric.mod.json 通过 mixins 字段引用）。
   * 无 block_place handler 时返回空数组（不生成任何文件）。
   */
  private blockPlaceMixinFiles(spec: ModSpecLike, pkg: string): FileNode[] {
    const hasBlockPlace = (spec.eventHandlers ?? []).some((h) => h.eventType === 'block_place');
    if (!hasBlockPlace) return [];

    const mixinClass = `package ${pkg}.mixin;

import net.minecraft.world.InteractionResult;
import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.context.BlockPlaceContext;
import net.minecraft.world.level.Level;
import net.minecraft.world.level.block.state.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BlockItem.class)
public class ModBlockPlaceMixin {
    // P2.2: 方块放置成功后通知 ModEvents（Fabric API 无现成放置事件）
    @Inject(method = "place", at = @At("RETURN"))
    private void onBlockPlaced(BlockPlaceContext context, CallbackInfoReturnable<InteractionResult> cir) {
        if (cir.getReturnValue().consumesAction()) {
            Level level = context.getLevel();
            net.minecraft.core.BlockPos pos = context.getClickedPos();
            BlockState state = level.getBlockState(pos);
            net.minecraft.world.entity.player.Player player = context.getPlayer();
            net.minecraft.server.level.ServerPlayer sp = player instanceof net.minecraft.server.level.ServerPlayer p ? p : null;
            ${pkg}.ModEvents.notifyBlockPlaced(level, pos, state, sp);
        }
    }
}
`;

    const mixinsJson = JSON.stringify(
      {
        required: true,
        package: `${pkg}.mixin`,
        compatibilityLevel: 'JAVA_21',
        mixins: ['ModBlockPlaceMixin'],
        injectors: { defaultRequire: 1 },
      },
      null,
      2,
    );

    return [
      {
        path: `src/main/java/${packagePath(spec.modId)}/mixin/ModBlockPlaceMixin.java`,
        content: mixinClass,
      },
      {
        path: `src/main/resources/${spec.modId}.mixins.json`,
        content: mixinsJson,
      },
    ];
  }

  /**
   * 根据 eventType 生成 Fabric 事件注册调用（用全限定名避免 import 错误）。
   * 使用 Mojang 映射（与 officialMojangMappings 一致）：
   * - ServerPlayer（而非 Yarn 的 ServerPlayerEntity）
   * - ServerLevel（而非 Yarn 的 ServerWorld）
   *
   * P1 dogfood 修复：ServerPlayerEvents.JOIN/LEAVE 回调签名含 ServerPlayer + MinecraftServer。
   * P2.1 事件参数绑定：回调多参数绑定为 EventContext 字段，不再只传 player。
   */
  private fabricEventRegistration(eventType: string, handlerMethod: string): string {
    switch (eventType) {
      case 'tick':
        return `        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            EventContext ctx = new EventContext();
            ctx.level = server.overworld();
            ${handlerMethod}(ctx);
        });`;
      case 'player_join':
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents.JOIN.register((player, server) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = server.overworld();
            ${handlerMethod}(ctx);
        });`;
      case 'player_quit':
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents.LEAVE.register((player, server) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = server.overworld();
            ${handlerMethod}(ctx);
        });`;
      case 'block_break':
        return `        net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {
            EventContext ctx = new EventContext();
            ctx.level = (net.minecraft.server.level.ServerLevel) world;
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.pos = pos;
            ctx.state = state;
            ${handlerMethod}(ctx);
        });`;
      case 'player_right_click_block':
        return `        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register((player, world, hand, hitResult) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = (net.minecraft.server.level.ServerLevel) world;
            ctx.pos = hitResult.getBlockPos();
            ${handlerMethod}(ctx);
            return net.minecraft.world.InteractionResult.PASS;
        });`;
      case 'player_right_click_item':
      case 'item_use':
        return `        net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT.register((player, world, hand) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = (net.minecraft.server.level.ServerLevel) world;
            ctx.stack = player.getItemInHand(hand);
            ${handlerMethod}(ctx);
            return net.minecraft.util.TypedActionResult.pass(player.getItemInHand(hand));
        });`;
      case 'player_left_click':
        return `        net.fabricmc.fabric.api.event.player.AttackBlockCallback.EVENT.register((player, world, hand, pos, direction) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = (net.minecraft.server.level.ServerLevel) world;
            ctx.pos = pos;
            ${handlerMethod}(ctx);
            return net.minecraft.world.InteractionResult.PASS;
        });`;
      case 'item_pickup':
        return `        net.fabricmc.fabric.api.event.player.PlayerPickupItemCallback.EVENT.register((player, itemEntity) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.level.ServerPlayer) player;
            ctx.level = (net.minecraft.server.level.ServerLevel) player.level();
            ctx.target = itemEntity;
            ctx.stack = itemEntity.getItem();
            ${handlerMethod}(ctx);
            return false;
        });`;
      case 'entity_death':
        // Fabric API ServerLivingEntityEvents.AFTER_DEATH：实体死亡后触发（target 绑定死亡实体）
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register((entity, source) -> {
            EventContext ctx = new EventContext();
            ctx.target = entity;
            ctx.level = (net.minecraft.server.level.ServerLevel) entity.level();
            ${handlerMethod}(ctx);
        });`;
      case 'entity_hurt':
        // Fabric API ServerLivingEntityEvents.AFTER_DAMAGE：实体受伤后触发（target 绑定受伤实体）
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DAMAGE.register((entity, source, baseDamage, damageTaken, blocked) -> {
            EventContext ctx = new EventContext();
            ctx.target = entity;
            ctx.level = (net.minecraft.server.level.ServerLevel) entity.level();
            ${handlerMethod}(ctx);
        });`;
      case 'block_place':
        // Fabric API 无现成放置事件：由 ModBlockPlaceMixin 在 BlockItem.place 后调用 notifyBlockPlaced
        return `        // block_place: Fabric API 无放置事件，由 ModBlockPlaceMixin @Inject 触发
        // ModEvents.notifyBlockPlaced(level, pos, state, player) 已在 Mixin 中调用`;
      default:
        return `        // TODO: 注册 ${eventType} 事件（Fabric API 未映射）
        // ${handlerMethod}(new EventContext());`;
    }
  }

  /**
   * 把任意字符串转为合法 Java 标识符片段（用于 check_<id>/execute_<id>/handle_<id> 方法名后缀）。
   * 保留原大小写与下划线，仅把非法字符替换为下划线；首字符为数字时加 _ 前缀。
   *
   * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"（而非空标识符导致编译错误）。
   */
  /**
   * P40：按 Java 类型返回默认值表达式（过程调用参数缺省时回退）。
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

  /** 把任意字符串转为合法 PascalCase Java 标识符（用于方法名后缀、类名） */
  protected toPascal(s: string): string {
    const sanitized = s.replace(/[^a-zA-Z0-9_]/g, '_');
    const parts = sanitized.split('_').filter(Boolean);
    if (parts.length === 0) return 'Unknown';
    const pascal = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    // 若首字符是数字，前缀下划线
    return /^[0-9]/.test(pascal) ? `_${pascal}` : pascal;
  }

  /**
   * PortType（节点图端口类型字符串）→ Java 类型映射（Mojang 映射）。
   * 用于 CustomCodeSnippetSpec.inputSignature/outputSignature 的类型转换。
   * 与 officialMojangMappings 一致，类名不含 Yarn 后缀（如 Vec3 而非 Vec3d）。
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
        return 'Vec3';
      case 'nbt':
        return 'CompoundTag';
      default:
        return 'Object';
    }
  }

  /** 根据 modelType 返回实体基类名（Mojang 映射）
   * Major 修复：返回具体类名（Zombie/Skeleton/...）而非基类（Mob/Animal），
   * 使 EntityType<T>、Builder.<T>of(factory, ...)、factory 三者泛型一致，
   * 否则 Zombie::new 无法匹配 EntityFactory<Mob>（Mob 不是 Zombie 的子类型方向）。
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

  /** 根据 modelType 返回实体工厂引用（Mojang 映射，类名不带 Entity 后缀） */
  private entityFactoryMojang(modelType: string): string {
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

  /** classification → Mojang MobCategory 映射 */
  private mojangMobCategory(classification: string): string {
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

  private langJson(spec: ModSpecLike): FileNode {
    const entries: Record<string, string> = {};
    for (const it of spec.items) entries[`item.${spec.modId}.${it.id}`] = it.name;
    for (const b of spec.blocks) entries[`block.${spec.modId}.${b.id}`] = b.name;
    return {
      path: `src/main/resources/assets/${spec.modId}/lang/en_us.json`,
      content: JSON.stringify(entries, null, 2),
    };
  }

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

  /** T5: 机器配方映射 → Java switch case（输入物品 ID → 输出物品 ID） */
  private machineRecipeCases(m: { recipeMap?: Record<string, string> }): string {
    const entries = Object.entries(m.recipeMap ?? {});
    if (entries.length === 0) {
      return `                // 未配置配方映射，回退原样搬运`;
    }
    return entries
      .map(
        ([input, output]) =>
          `                case "${input}":\n                    return "${output}";`,
      )
      .join('\n');
  }

  /** T6: 自定义模型实体的模型 JSON 骨架（供 Blockbench 导出替换） */
  private entityModels(spec: ModSpecLike): FileNode[] {
    const customEntities = (spec.entities ?? []).filter((e) => e.modelType === 'custom');
    if (customEntities.length === 0) return [];
    return customEntities.map((e) => ({
      path: `src/main/resources/assets/${spec.modId}/models/entity/${e.entityId}.json`,
      content: JSON.stringify(
        {
          // T6: 自定义模型骨架。用 Blockbench 导出替换此文件：
          // 模型格式参考 https://minecraft.wiki/w/Tutorials/Models
          format_version: '1.12.0',
          description: {
            identifier: `${spec.modId}:${e.entityId}`,
            texture_width: 64,
            texture_height: 32,
          },
          geometry: {
            description: {
              identifier: `geometry.${e.entityId}`,
              texture_width: 64,
              texture_height: 32,
            },
            bones: [
              {
                name: 'body',
                pivot: [0, 0, 0],
                cubes: [
                  {
                    origin: [-4, 0, -4],
                    size: [8, 12, 8],
                    uv: [0, 0],
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ),
    }));
  }
}

/** 内部用的 ModSpec 形状（避免循环导入，从 GeneratorContext 推导） */
type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  mcVersionHint?: string;
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
    recipeMap?: Record<string, string>;
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
  guis?: Array<{
    guiId: string;
    displayName: string;
    width: number;
    height: number;
    slots: Array<{
      slotId: string;
      slotType: 'input' | 'output' | 'energy' | 'fuel';
      x: number;
      y: number;
    }>;
    showEnergyBar: boolean;
    showProgressBar: boolean;
  }>;
  structures?: Array<{
    structureId: string;
    displayName: string;
    startPool: string;
    size: number;
    maxDistance: number;
    biomes: string;
    terrainAdaptation: string;
    spacing: number;
    separation: number;
    salt: number;
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

/**
 * 类别描述符（P1-4 增量构建）：把生成逻辑拆分为可独立缓存的单元。
 *
 * 泛型 S 为 spec 形状（FabricAdapter 用 ModSpecLike，子类可扩展）。
 */
export interface CategoryDescriptor<S = ModSpecLike> {
  /** 类别名（缓存键的一部分：modId::loader::category） */
  name: string;
  /** 从 spec 提取影响该类别的数据（用于计算内容哈希） */
  hashInputs: (spec: S, mcVersion: string) => unknown[];
  /** 生成文件；返回空数组表示该类别当前无产物（如 recipes 为空） */
  generate: (
    spec: S,
    pkg: string,
    mainCls: string,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ) => FileNode[];
}
