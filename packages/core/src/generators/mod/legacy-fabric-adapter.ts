import type { FileNode, GeneratorContext, Loader, ModSpec } from '@mc-creator/shared';
import { FabricAdapter } from './fabric-adapter.js';

/**
 * Legacy Fabric Loader Adapter（P27，规格 §3.2 衍生）。
 *
 * Legacy Fabric 面向 Minecraft 1.14-1.16 的旧版本，用旧版 fabric-loom（0.5-SNAPSHOT）
 * + Yarn mappings（旧 loom 不支持 officialMojangMappings）+ Java 8。
 *
 * 注意：当前项目默认 MC 版本为 1.21.11，但 Legacy Fabric 仅支持 1.14-1.16。
 * 用户使用 legacy_fabric 时，应自行把 gradle.properties 的 minecraft_version
 * 改为 1.16.5 等旧版本（同时确认 yarn_version / fabric_version 与之匹配）。
 *
 * 实现：extends FabricAdapter，复用其全部产物（fabric.mod.json 与 Fabric 完全一致，
 * schemaVersion 仍是 1，schema 没变；Java 代码 / lang / models / metaJson / settingsGradle
 * 也都一致），只 override translate() 按路径替换 2 个 loader 特异文件：
 *   - build.gradle      → 用 fabric-loom 0.5-SNAPSHOT + Yarn mappings + Java 1.8
 *   - gradle.properties → 用旧版本号 loader_version=0.12.12、yarn_version=1.16.5+build.1
 *
 * 不替换 fabric.mod.json（与 Fabric 完全一致）。
 */
export class LegacyFabricAdapter extends FabricAdapter {
  readonly loader: Loader = 'legacy_fabric';

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;

    // 复用 Fabric 的全部产物，再按路径替换 2 个 loader 特异文件
    return super.translate(ctx).map((f) => {
      if (f.path === 'build.gradle') {
        return this.legacyBuildGradle(spec, mcVersion);
      }
      if (f.path === 'gradle.properties') {
        return this.legacyGradleProperties(spec, mcVersion);
      }
      return f;
    });
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

# Minecraft / Legacy Fabric（面向 MC 1.14-1.16；默认 minecraft_version 为 1.21.11，请改为 1.16.5 等旧版本）
minecraft_version=${mcVersion}
loader_version=0.12.12
yarn_version=1.16.5+build.1
fabric_version=0.42.0+1.16
`;
    return { path: 'gradle.properties', content };
  }
}
