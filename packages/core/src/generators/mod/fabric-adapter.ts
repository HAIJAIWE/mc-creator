import type { FileNode, GeneratorContext, Loader } from '@mc-creator/shared';
import { getLoaderVersions, type LoaderVersionConfig } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath, javaEscape } from './templates.js';
import { BuildCache, hashCategory, type IncrementalResult } from '../../builder/BuildCache.js';

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
      hashInputs: (s, mcVersion) => [s.modId, s.name, s.description, s.version, mcVersion],
      generate: (s, pkg, mainCls, mcVersion, versions) => [
        this.fabricModJson(s, pkg, mainCls, mcVersion, versions),
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
      name: 'recipes',
      hashInputs: (s) => s.recipes ?? [],
      generate: (s, pkg) => (s.recipes?.length ? [this.modRecipesJava(s, pkg)] : []),
    },
    {
      name: 'entities',
      hashInputs: (s) => s.entities ?? [],
      generate: (s, pkg) => (s.entities?.length ? [this.modEntitiesJava(s, pkg)] : []),
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
  ): FileNode {
    const content = {
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
        java: '>=21',
        'fabric-api': '*',
      },
    };
    return {
      path: 'src/main/resources/fabric.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  private buildGradle(
    _spec: ModSpecLike,
    _mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    const content = `plugins {
    id 'fabric-loom' version '${versions.fabricLoomVersion}'
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
    mappings loom.officialMojangMappings()
    modImplementation "net.fabricmc:fabric-loader:\${project.loader_version}"
    modImplementation "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
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

  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    // 条件性生成子模块初始化调用（仅当 spec 中对应字段非空时）
    const initCalls: string[] = ['ModItems.initialize();', 'ModBlocks.initialize();'];
    if (spec.recipes?.length) initCalls.push('ModRecipes.initialize();');
    if (spec.entities?.length) initCalls.push('ModEntities.initialize();');
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

  // === P1.3/P1.4 新增：消费 recipes/entities/machines/customCode/multiblocks/events ===

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
        return `    // TODO: 替换为实际的 ${pascal}BlockEntity 实现
    public static class ${pascal}BlockEntity extends BlockEntity {
        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE, pos, state);
        }
    }

    // TODO: 替换为实际的 ${pascal}Menu 实现
    public static class ${pascal}Menu extends AbstractContainerMenu {
        public ${pascal}Menu(int id, Inventory inv) {
            super(${id}_MENU, id);
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
    const buildBody = (
      conditionIds: string[],
      actionIds: string[],
      procCallIds: string[],
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

      // 把过程调用 id 列表解析为 procedure_<name>(event); 调用语句（缩进由调用方决定）
      const resolveProcCalls = (indent: string): string =>
        procCallIds.length
          ? procCallIds
              .map((pid) => {
                const name = procedureNameMap.get(pid);
                if (!name) return `${indent}// (未知过程: ${pid})`;
                return `${indent}procedure_${this.sanitizeIdent(name)}(event);`;
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
            return `${invert ? '!' : ''}check_${this.sanitizeIdent(cid)}(event)`;
          })
          .join(' && ');
        const actionCalls = validActionIds.length
          ? validActionIds
              .map((aid) => `            execute_${this.sanitizeIdent(aid)}(event);`)
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
  ...validActionIds.map((aid) => `        execute_${this.sanitizeIdent(aid)}(event);`),
  ...resolveProcCalls('        ').split('\n').filter(Boolean),
].join('\n')}`;
      }

      return '        // (无关联 condition 与 action)';
    };

    // 每个事件处理器的 handle_<handlerId> 方法
    const handlerMethods = handlers
      .map((h) => {
        const handlerName = `handle_${this.sanitizeIdent(h.handlerId)}`;
        const body = buildBody(h.conditionIds ?? [], h.actionIds ?? [], h.procedureCallIds ?? []);
        return `    // 事件处理器: ${h.handlerId} (eventType: ${h.eventType})
    // eventArgs: ${JSON.stringify(h.eventArgs)}
    private static void ${handlerName}(Object event) {
${body}
    }`;
      })
      .join('\n\n');

    // P1-3：过程方法（命名的可复用逻辑单元，可被 event/procedure 调用）
    const procedureMethods = procedures
      .map((p) => {
        const methodName = `procedure_${this.sanitizeIdent(p.procedureName)}`;
        const body = buildBody(p.conditionIds, p.actionIds, p.procedureCallIds);
        return `    // 过程: ${p.procedureId} (name: ${p.procedureName})
    // 可被 event/procedure 调用，复用此方法
    private static void ${methodName}(Object event) {
${body}
    }`;
      })
      .join('\n\n');

    // 条件检查方法（遍历 spec.conditions 全量生成，含未被 handler 引用的）
    const conditionMethods = conditions
      .map((c) => {
        const methodName = `check_${this.sanitizeIdent(c.conditionId)}`;
        return `    // 条件: ${c.conditionId} (invert: ${c.invert})
    // conditionType: ${c.conditionType}
    // args: ${JSON.stringify(c.args)}
    private static boolean ${methodName}(Object event) {
        // TODO: 实现 ${c.conditionType} 检查逻辑
        return true;
    }`;
      })
      .join('\n\n');

    // 动作执行方法（遍历 spec.actions 全量生成，含未被 handler 引用的）
    const actionMethods = actions
      .map((a) => {
        const methodName = `execute_${this.sanitizeIdent(a.actionId)}`;
        return `    // 动作: ${a.actionId}
    // actionType: ${a.actionType}
    // args: ${JSON.stringify(a.args)}
    private static void ${methodName}(Object event) {
        // TODO: 实现 ${a.actionType} 执行逻辑
    }`;
      })
      .join('\n\n');

    const allMethods = [handlerMethods, procedureMethods, conditionMethods, actionMethods]
      .filter(Boolean)
      .join('\n\n');

    const content = `package ${pkg};

public class ModEvents {
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
   * 根据 eventType 生成 Fabric 事件注册调用（用全限定名避免 import 错误）。
   * 使用 Mojang 映射（与 officialMojangMappings 一致）：
   * - ServerPlayer（而非 Yarn 的 ServerPlayerEntity）
   * - ServerLevel（而非 Yarn 的 ServerWorld）
   *
   * P1 dogfood 修复：ServerPlayerEvents.JOIN/LEAVE 回调签名含 ServerPlayer + MinecraftServer。
   */
  private fabricEventRegistration(eventType: string, handlerMethod: string): string {
    switch (eventType) {
      case 'tick':
        return `        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            ${handlerMethod}(server);
        });`;
      case 'player_join':
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents.JOIN.register((player, server) -> {
            ${handlerMethod}(player);
        });`;
      case 'player_quit':
        return `        net.fabricmc.fabric.api.entity.event.v1.ServerPlayerEvents.LEAVE.register((player, server) -> {
            ${handlerMethod}(player);
        });`;
      case 'block_break':
        return `        net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {
            ${handlerMethod}(player);
        });`;
      default:
        return `        // TODO: 注册 ${eventType} 事件（Fabric API 未映射）
        // ${handlerMethod}(event);`;
    }
  }

  /**
   * 把任意字符串转为合法 Java 标识符片段（用于 check_<id>/execute_<id>/handle_<id> 方法名后缀）。
   * 保留原大小写与下划线，仅把非法字符替换为下划线；首字符为数字时加 _ 前缀。
   *
   * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"（而非空标识符导致编译错误）。
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
    conditionIds: string[];
    actionIds: string[];
    /** 嵌套调用的过程节点 id 列表 */
    procedureCallIds: string[];
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
