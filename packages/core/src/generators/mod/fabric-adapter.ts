import type { FileNode, GeneratorContext } from '@mc-creator/shared';
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
  readonly loader = 'fabric' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const pkgPath = packagePath(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.fabricModJson(spec, pkg, mainCls),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
      this.mainClass(spec, pkg, mainCls),
      this.modItemsJava(spec, pkg, mainCls),
      this.modBlocksJava(spec, pkg, mainCls),
    ];
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

  private buildGradle(spec: ModSpecLike, mcVersion: string): FileNode {
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

  private gradleProperties(spec: ModSpecLike, mcVersion: string): FileNode {
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

  private modItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.items
      .map((it) => `    public static Item ${it.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.items
      .map(
        (it) =>
          `        ${it.id.toUpperCase()} = Registry.register(Registries.ITEM, Identifier.of(MOD_ID, "${it.id}"), new Item(new Item.Settings()));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
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

  private modBlocksJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    const fields = spec.blocks
      .map((b) => `    public static Block ${b.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.blocks
      .map((b) => {
        const settings = `new Block.Settings().strength(${b.hardness}f)`;
        return `        ${b.id.toUpperCase()} = Registry.register(Registries.BLOCK, Identifier.of(MOD_ID, "${b.id}"), new Block(${settings}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
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
}

/** 内部用的 ModSpec 形状（避免循环导入，从 GeneratorContext 推导） */
type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  mcVersionHint?: string;
  items: Array<{ id: string; name: string; maxStackSize: number }>;
  blocks: Array<{ id: string; name: string; material: string; hardness: number }>;
};
