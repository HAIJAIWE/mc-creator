/**
 * NeoForge Adapter 的构建脚本生成域。
 *
 * 从 neoforge-adapter.ts 提取：mods.toml / build.gradle / settings.gradle /
 * gradle.properties / gradle-wrapper.properties。保持与重构前完全一致的行为。
 */
import type { FileNode } from '@mc-creator/shared';
import {
  gradleVersionFor,
  javaVersionFor,
  type LoaderVersionConfig,
  type McVersion,
} from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

/** TOML 字符串转义（mods.toml 用） */
export function tomlEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

export function neoforgeModsToml(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
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

export function neoforgeBuildGradle(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  // 版本感知：1.20.x → Java 17，1.21.x → Java 21，26.x → Java 25
  const javaVersion = javaVersionFor('neoforge', mcVersion as McVersion);
  // ModDevGradle DSL 分支：1.0.x（1.20.x / 1.21.1）用 moddev { } 包装，2.0（1.21.5+/26.x）用顶层 neoForge { }
  const isLegacyMdg = mcVersion.startsWith('1.20.') || mcVersion === '1.21.1';
  const neoForgeBlock = `neoForge {
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
}`;
  const dslBlock = isLegacyMdg
    ? `moddev {\n    ${neoForgeBlock.replace(/\n/g, '\n    ')}\n}`
    : neoForgeBlock;
  const content = `plugins {
    id 'net.neoforged.moddev' version '${versions.neoforgeModdevVersion}'
}

version = '${spec.version}'
group = 'com.example.${spec.modId}'

base { archivesName = '${spec.modId}' }

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVersion})

${dslBlock}

repositories {
    mavenCentral()
}
`;
  return { path: 'build.gradle', content };
}

export function neoforgeSettingsGradle(): FileNode {
  return {
    path: 'settings.gradle',
    content: `rootProject.name = 'mc-mod'\n`,
  };
}

export function neoforgeGradleProperties(
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

/** gradle/wrapper/gradle-wrapper.properties（按 MC 版本选择 Gradle；jar 由 gradle wrapper 命令生成） */
export function neoforgeWrapperProperties(mcVersion: string): FileNode {
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
