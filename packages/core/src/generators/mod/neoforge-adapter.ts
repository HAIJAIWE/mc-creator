import type { FileNode, GeneratorContext } from '@mc-creator/shared';
import type { LoaderAdapter } from './adapter.js';
import { mainClassName, packageName, packagePath } from './templates.js';

/**
 * NeoForge Loader Adapter（规格 §3.2）。
 * 生成 mods.toml + NeoForge moddev build.gradle + @Mod 入口 + DeferredRegister 注册代码 + 资源。
 * NeoForge 本就用 Mojang 官方名，与 Fabric 的 officialMojangMappings 一致。
 */
export class NeoForgeAdapter implements LoaderAdapter {
  readonly loader = 'neoforge' as const;

  translate(ctx: GeneratorContext): FileNode[] {
    const { spec, mcVersion } = ctx;
    const pkg = packageName(spec.modId);
    const mainCls = mainClassName(spec.modId);

    return [
      this.modsToml(spec, mcVersion),
      this.buildGradle(spec, mcVersion),
      this.settingsGradle(),
      this.gradleProperties(spec, mcVersion),
    ];
  }

  private modsToml(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `modLoader = "javafml"
loaderVersion = "[4,)"
license = "MIT"

[[mods]]
modId = "${spec.modId}"
version = "${spec.version}"
displayName = "${spec.name}"
description = "${spec.description}"

[[dependencies.${spec.modId}]]
    modId = "neoforge"
    type = "required"
    versionRange = "[21.1,)"
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

  private buildGradle(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `plugins {
    id 'net.neoforged.moddev' version '1.0.21'
}

version = '${spec.version}'
group = 'com.example.${spec.modId}'

base { archivesName = '${spec.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(21)

neoForge {
    version = "21.1.1"
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

  private gradleProperties(spec: ModSpecLike, mcVersion: string): FileNode {
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / NeoForge
mc_version=${mcVersion}
neoforge_version=21.1.1
`;
    return { path: 'gradle.properties', content };
  }
}

type ModSpecLike = {
  modId: string;
  version: string;
  name: string;
  description: string;
  items: Array<{ id: string; name: string; maxStackSize: number }>;
  blocks: Array<{ id: string; name: string; material: string; hardness: number }>;
};
