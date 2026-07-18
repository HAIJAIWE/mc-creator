import type { FileNode, GeneratorContext, Loader, ModSpec } from '@mc-creator/shared';
import { mainClassName, packageName } from './templates.js';
import { FabricAdapter } from './fabric-adapter.js';

/**
 * Quilt Loader Adapter（规格 §3.2 衍生）。
 * Quilt 是 Fabric 的衍生 loader，用 quilt.mod.json + quilt-loom（org.quiltmc.loom）。
 *
 * 实现：extends FabricAdapter，复用其 Java 代码 / lang / models / metaJson / settingsGradle
 * （这些与 Fabric 完全一致），只 override translate() 替换 3 个 loader 特异文件：
 *   - fabric.mod.json  → quilt.mod.json（路径不同，内容用 quilt_loader schema）
 *   - build.gradle     → 用 org.quiltmc.loom + quilt-loader / quilted-fabric-api 依赖
 *   - gradle.properties → 用 quilt_loader_version / quilt_version
 */
export class QuiltAdapter extends FabricAdapter {
  readonly loader: Loader = 'quilt';

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);

    // 复用 Fabric 的全部产物，再按路径替换 3 个 loader 特异文件
    return super.translate(ctx).map((f) => {
      if (f.path === 'src/main/resources/fabric.mod.json') {
        return this.quiltModJson(spec, mcVersion, pkg, mainCls);
      }
      if (f.path === 'build.gradle') {
        return this.quiltBuildGradle(spec, mcVersion);
      }
      if (f.path === 'gradle.properties') {
        return this.quiltGradleProperties(spec, mcVersion);
      }
      return f;
    });
  }

  /** 生成 src/main/resources/quilt.mod.json（Quilt 的 mod 元数据，schema_version=1） */
  private quiltModJson(spec: ModSpec, mcVersion: string, pkg: string, mainCls: string): FileNode {
    const content = {
      schema_version: 1,
      quilt_loader: {
        group: `com.example.${spec.modId}`,
        id: spec.modId,
        version: '${version}',
        metadata: {
          name: spec.name,
          description: spec.description,
        },
        intermediate_mappings: 'net.fabricmc:intermediary',
        depends: [
          { id: 'quilt_loader', versions: '>=0.27.0' },
          { id: 'minecraft', versions: `~${mcVersion}` },
          { id: 'quilted_fabric_api', versions: '*' },
        ],
      },
      entrypoints: {
        main: [`${pkg}.${mainCls}`],
      },
    };
    return {
      path: 'src/main/resources/quilt.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  /** 生成 build.gradle（用 org.quiltmc.loom 代替 fabric-loom，依赖改 quilt 系列） */
  private quiltBuildGradle(_spec: ModSpec, _mcVersion: string): FileNode {
    const content = `plugins {
    id 'org.quiltmc.loom' version '1.7-SNAPSHOT'
    id 'java'
}

version = project.mod_version
group = project.maven_group

base { archivesName = project.archives_base_name }

repositories {
    maven { name = "Quilt"; url = 'https://maven.quiltmc.org/release/' }
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings loom.officialMojangMappings()
    modImplementation "org.quiltmc:quilt-loader:\${project.quilt_loader_version}"
    modImplementation "org.quiltmc.quilted-fabric-api:quilted-fabric-api:\${project.quilt_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("quilt.mod.json") {
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

  /** 生成 gradle.properties（用 quilt_loader_version / quilt_version 代替 fabric 字段） */
  private quiltGradleProperties(spec: ModSpec, mcVersion: string): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Quilt
minecraft_version=${mcVersion}
quilt_loader_version=0.27.0
quilt_version=11.0.0-alpha.3+1.21.1
`;
    return { path: 'gradle.properties', content };
  }
}
