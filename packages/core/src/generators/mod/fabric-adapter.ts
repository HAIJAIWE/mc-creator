import type { FileNode, GeneratorContext, Loader } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath } from './templates.js';

/**
 * Fabric Loader Adapter（规格 §3.2）。
 * 生成 fabric.mod.json + Fabric Loom build.gradle（用 officialMojangMappings，非 Yarn）
 * + ModInitializer 入口 + Registry.register 注册代码 + 资源文件。
 *
 * 关键：用官方 mappings 使 Java 代码用 net.minecraft.world.item.Item 等官方名，
 * 与 NeoForge 一致，26.1 切换无需改 Adapter。
 */
export class FabricAdapter implements LoaderAdapter {
  readonly loader: Loader = 'fabric';

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.fabricModJson(spec, pkg, mainCls),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
      this.mainClass(spec, pkg, mainCls),
      this.modItemsJava(spec, pkg, mainCls),
      this.modBlocksJava(spec, pkg, mainCls),
      this.langJson(spec),
      ...this.itemModels(spec),
      this.metaJson(spec),
    ];
  }

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

  private fabricModJson(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
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
        fabricloader: '>=0.16.0',
        minecraft: `~${spec.mcVersionHint ?? '1.21.11'}`,
        java: '>=21',
        'fabric-api': '*',
      },
    };
    return {
      path: 'src/main/resources/fabric.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  private buildGradle(_spec: ModSpecLike, _mcVersion: string): FileNode {
    const content = `plugins {
    id 'fabric-loom' version '1.7-SNAPSHOT'
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

  protected gradleProperties(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Fabric
minecraft_version=${mcVersion}
loader_version=0.16.9
fabric_version=0.110.5+1.21
`;
    return { path: 'gradle.properties', content };
  }

  private mainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const content = `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${mainCls} implements ModInitializer {
    public static final String MOD_ID = "${spec.modId}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ModItems.initialize();
        ModBlocks.initialize();
        LOGGER.info("Initializing ${spec.name}");
    }
}
`;
    return {
      path: `src/main/java/${packagePath(spec.modId)}/${mainCls}.java`,
      content,
    };
  }

  private modItemsJava(spec: ModSpecLike, pkg: string, _mainCls: string): FileNode {
    const fields = spec.items
      .map((it) => `    public static Item ${it.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.items
      .map(
        (it) =>
          `        ${it.id.toUpperCase()} = Registry.register(Registries.ITEM, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${it.id}"), new Item(new Item.Settings()));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.core.Registry;
import net.minecraft.util.Identifier;

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

  private modBlocksJava(spec: ModSpecLike, pkg: string, _mainCls: string): FileNode {
    const fields = spec.blocks
      .map((b) => `    public static Block ${b.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.blocks
      .map((b) => {
        const settings = `Block.Properties.of().strength(${b.hardness}f)`;
        return `        ${b.id.toUpperCase()} = Registry.register(Registries.BLOCK, ResourceLocation.fromNamespaceAndPath(MOD_ID, "${b.id}"), new Block(${settings}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.core.Registry;
import net.minecraft.util.Identifier;

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
};
