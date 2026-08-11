import type { FileNode, GeneratorContext, Loader, ModSpec } from '@mc-creator/shared';
import { FabricAdapter } from './fabric-adapter.js';
import { BuildCache, type IncrementalResult } from '../../builder/BuildCache.js';
import { mainClassName, packagePath } from './templates.js';

/**
 * Legacy Fabric Loader Adapter（P27，规格 §3.2 衍生）。
 *
 * Legacy Fabric 面向 Minecraft 1.14-1.16 的旧版本，用旧版 fabric-loom（0.5-SNAPSHOT）
 * + Yarn mappings（旧 loom 不支持 officialMojangMappings）+ Java 8。
 *
 * Critical 修复：父类 FabricAdapter 生成的 Java 代码使用 Mojang 官方映射
 * （net.minecraft.world.item.Item、BuiltInRegistries、ResourceLocation.fromNamespaceAndPath、
 * 文本块 """ 等），与 Yarn mappings + Java 8 不兼容。
 * 本类 override translateWithCache 时替换 ModItems/ModBlocks/ModEntities 三个 Java 文件
 * 为 Yarn 1.16 兼容版本（net.minecraft.item.Item、Registry、Identifier、无文本块）。
 *
 * 注意：当前项目默认 MC 版本为 1.21.11，但 Legacy Fabric 仅支持 1.14-1.16。
 * 用户使用 legacy_fabric 时，应自行把 gradle.properties 的 minecraft_version
 * 改为 1.16.5 等旧版本（同时确认 yarn_version / fabric_version 与之匹配）。
 */
export class LegacyFabricAdapter extends FabricAdapter {
  readonly loader: Loader = 'legacy_fabric';

  translate(ctx: GeneratorContext): FileNode[] {
    return this.translateWithCache(ctx, new BuildCache()).files;
  }

  /**
   * P1-1 dogfood 修复：覆写 translateWithCache，复用 Fabric 增量逻辑后替换 Legacy 特异文件。
   * Critical 修复：同时替换 ModItems/ModBlocks/ModEntities 为 Yarn 兼容版本。
   */
  translateWithCache(ctx: GeneratorContext, cache: BuildCache): IncrementalResult {
    const { spec, mcVersion } = ctx;

    // 复用 Fabric 的增量构建逻辑
    const fabricResult = super.translateWithCache(ctx, cache);

    const pkg = `${packagePath(spec.modId)}`;
    const mainCls = mainClassName(spec.modId);

    // 替换 Legacy 特异文件
    const legacyFiles = fabricResult.files.map((f) => {
      if (f.path === 'build.gradle') {
        return this.legacyBuildGradle(spec, mcVersion);
      }
      if (f.path === 'gradle.properties') {
        return this.legacyGradleProperties(spec, mcVersion);
      }
      // Critical 修复：替换 Mojang 映射 Java 文件为 Yarn 兼容版本
      if (f.path === `src/main/java/${pkg}/ModItems.java`) {
        return this.legacyModItemsJava(spec, pkg, mainCls);
      }
      if (f.path === `src/main/java/${pkg}/ModBlocks.java`) {
        return this.legacyModBlocksJava(spec, pkg, mainCls);
      }
      if (f.path === `src/main/java/${pkg}/ModEntities.java`) {
        return this.legacyModEntitiesJava(spec, pkg, mainCls);
      }
      return f;
    });

    return {
      files: legacyFiles,
      stats: fabricResult.stats,
      cacheSnapshot: fabricResult.cacheSnapshot,
    };
  }

  /** 生成 build.gradle（旧版 fabric-loom 0.5-SNAPSHOT + Yarn mappings + Java 1.8） */
  private legacyBuildGradle(_spec: ModSpec, _mcVersion: string): FileNode {
    const content = `plugins {
    id 'fabric-loom' version '0.5-SNAPSHOT'
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
    mappings "net.fabricmc:yarn:\${project.yarn_version}:v2"
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
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
    withSourcesJar()
}
`;
    return { path: 'build.gradle', content };
  }

  /** 生成 gradle.properties（旧版本号：loader 0.12.12 + Yarn 1.16.5+build.1） */
  private legacyGradleProperties(spec: ModSpec, mcVersion: string): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Legacy Fabric（仅支持 MC 1.14-1.16；当前版本列表不含该范围，构建前请将 minecraft_version 改为 1.16.5 等旧版本）
minecraft_version=${mcVersion}
loader_version=0.12.12
yarn_version=1.16.5+build.1
fabric_version=0.42.0+1.16
`;
    return { path: 'gradle.properties', content };
  }

  /**
   * Critical 修复：Yarn 1.16 兼容的 ModItems.java。
   * 差异：net.minecraft.item.Item（非 world.item）、Registry（非 BuiltInRegistries）、
   * Identifier（非 ResourceLocation）、new Item.Settings()（非 Item.Properties）。
   */
  private legacyModItemsJava(spec: ModSpec, pkg: string, mainCls: string): FileNode {
    const fields = spec.items
      .map((it) => `    public static Item ${it.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.items
      .map(
        (it) =>
          `        ${it.id.toUpperCase()} = Registry.register(Registry.ITEM, new Identifier(${mainCls}.MOD_ID, "${it.id}"), new Item(new Item.Settings()));`,
      )
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.util.Identifier;
import net.minecraft.util.registry.Registry;

public class ModItems {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return { path: `src/main/java/${pkg}/ModItems.java`, content };
  }

  /**
   * Critical 修复：Yarn 1.16 兼容的 ModBlocks.java。
   * 差异：net.minecraft.block.Block、AbstractBlock.Settings.of()（非 Block.Properties.of()）。
   */
  private legacyModBlocksJava(spec: ModSpec, pkg: string, mainCls: string): FileNode {
    const fields = spec.blocks
      .map((b) => `    public static Block ${b.id.toUpperCase()};`)
      .join('\n');
    const regs = spec.blocks
      .map((b) => {
        const settings = `AbstractBlock.Settings.of().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
        return `        ${b.id.toUpperCase()} = Registry.register(Registry.BLOCK, new Identifier(${mainCls}.MOD_ID, "${b.id}"), new Block(${settings}));`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.block.AbstractBlock;
import net.minecraft.block.Block;
import net.minecraft.util.Identifier;
import net.minecraft.util.registry.Registry;

public class ModBlocks {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return { path: `src/main/java/${pkg}/ModBlocks.java`, content };
  }

  /**
   * Critical 修复：Yarn 1.16 兼容的 ModEntities.java。
   * 差异：net.minecraft.entity.EntityType、EntityType.Builder.create()（非 of()）、
   * .setDimensions()（非 .sized()）、.build()（非 .build(String)）、
   * 无文本块（Java 8）。
   */
  private legacyModEntitiesJava(spec: ModSpec, pkg: string, mainCls: string): FileNode {
    const entities = spec.entities ?? [];
    const fields = entities
      .map(
        (e) =>
          `    public static EntityType<${this.legacyEntityBaseClass(e.modelType)}> ${e.entityId.toUpperCase()};`,
      )
      .join('\n');
    const regs = entities
      .map((e) => {
        const category = this.legacyMobCategory(e.classification);
        return `        ${e.entityId.toUpperCase()} = Registry.register(Registry.ENTITY_TYPE, new Identifier(${mainCls}.MOD_ID, "${e.entityId}"), EntityType.Builder.create(${this.legacyEntityFactory(e.modelType)}, ${category}).setDimensions(0.6f, 1.8f).build());`;
      })
      .join('\n');
    const content = `package ${pkg};

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
import net.minecraft.util.Identifier;
import net.minecraft.util.registry.Registry;

public class ModEntities {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
    return { path: `src/main/java/${pkg}/ModEntities.java`, content };
  }

  /** Yarn 1.16 实体基类名（完整包名，因不 import 具体实体类；Yarn 类名带 Entity 后缀） */
  private legacyEntityBaseClass(modelType: string): string {
    switch (modelType) {
      case 'zombie':
        return 'net.minecraft.entity.mob.ZombieEntity';
      case 'skeleton':
        return 'net.minecraft.entity.mob.SkeletonEntity';
      case 'creeper':
        return 'net.minecraft.entity.mob.CreeperEntity';
      case 'pig':
        return 'net.minecraft.entity.passive.PigEntity';
      case 'cow':
        return 'net.minecraft.entity.passive.CowEntity';
      default:
        return 'net.minecraft.entity.Entity';
    }
  }

  /** Yarn 1.16 实体工厂引用（需完整包名，因不 import 具体实体类） */
  private legacyEntityFactory(modelType: string): string {
    switch (modelType) {
      case 'zombie':
        return 'net.minecraft.entity.mob.ZombieEntity::new';
      case 'skeleton':
        return 'net.minecraft.entity.mob.SkeletonEntity::new';
      case 'creeper':
        return 'net.minecraft.entity.mob.CreeperEntity::new';
      case 'pig':
        return 'net.minecraft.entity.passive.PigEntity::new';
      case 'cow':
        return 'net.minecraft.entity.passive.CowEntity::new';
      default:
        return 'net.minecraft.entity.Entity::new';
    }
  }

  /** Yarn 1.16 classification → SpawnGroup 映射（Yarn 用 SpawnGroup 非 MobCategory） */
  private legacyMobCategory(classification: string): string {
    switch (classification) {
      case 'monster':
        return 'SpawnGroup.MONSTER';
      case 'animal':
        return 'SpawnGroup.CREATURE';
      case 'ambient':
        return 'SpawnGroup.AMBIENT';
      case 'water_creature':
        return 'SpawnGroup.WATER_CREATURE';
      case 'misc':
        return 'SpawnGroup.MISC';
      default:
        return 'SpawnGroup.CREATURE';
    }
  }
}
