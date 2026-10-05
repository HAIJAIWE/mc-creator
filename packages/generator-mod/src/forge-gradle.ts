/**
 * Forge Adapter 的构建脚本生成域（ForgeGradle 6 + MC 1.20.1 + Mojang 官方映射）。
 *
 * 版本号全部实测：Forge 1.20.1 最新 47.4.23（Forge maven 元数据，2026-09）；
 * ForgeGradle 用文档约定的 '[6.0,)' 滚动线；Gradle 8.12 + Java 17。
 */
import type { FileNode } from '@mc-creator/shared';
import {
  gradleVersionFor,
  javaVersionFor,
  type LoaderVersionConfig,
  type McVersion,
} from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';
import { tomlEscape } from './neoforge-gradle.js';
import { parchmentForgeBlock } from './parchment.js';

export function forgeModsToml(
  spec: ModSpecLike,
  _mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  // Forge 47 约定 minecraft 范围上闭合 [1.20.1,1.21)，与 NeoForge 的开放区间不同
  const content = `modLoader = "javafml"
loaderVersion = "${versions.forgeLoaderVersionRange}"
license = "${tomlEscape(spec.license || 'MIT')}"

[[mods]]
modId = "${spec.modId}"
version = "\${version}"
displayName = "${tomlEscape(spec.name)}"
description = "${tomlEscape(spec.description)}"

[[dependencies.${spec.modId}]]
    modId = "forge"
    type = "required"
    versionRange = "${versions.forgeVersionRange}"
    ordering = "NONE"
    side = "BOTH"

[[dependencies.${spec.modId}]]
    modId = "minecraft"
    type = "required"
    versionRange = "[1.20.1,1.21)"
    ordering = "NONE"
    side = "BOTH"
`;
  return { path: 'src/main/resources/META-INF/mods.toml', content };
}

export function forgeBuildGradle(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  const javaVersion = javaVersionFor('forge', mcVersion as McVersion);
  // Parchment（§8.4）：仅当 PARCHMENT_VERSIONS 有该 MC 版本条目时拼接；
  // 缺条目（外部版本号待核实，宁缺毋错）时 parchmentPart 为空字符串，输出与原来逐字一致。
  const parchment = parchmentForgeBlock(mcVersion);
  const parchmentPart = parchment === null ? '' : `${parchment}\n`;
  const content = `plugins {
    id 'java'
    id 'net.minecraftforge.gradle' version '${versions.forgeGradleVersion}'
}

version = '${spec.version}'
group = 'com.example.${spec.modId}'

base {
    archivesName = '${spec.modId}'
}

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVersion})

minecraft {
    mappings channel: 'official', version: '1.20.1'
${parchmentPart}    runs {
        client {}
        server {}
    }
}

dependencies {
    minecraft 'net.minecraftforge:forge:1.20.1-${versions.forgeVersion}'
}

repositories {
    mavenCentral()
}
`;
  return { path: 'build.gradle', content };
}

export function forgeSettingsGradle(): FileNode {
  // ForgeGradle 插件不在 Gradle Portal，需声明 Forge maven（否则插件无法解析）
  return {
    path: 'settings.gradle',
    content: `pluginManagement {
    repositories {
        gradlePluginPortal()
        maven { url "https://maven.minecraftforge.net/" }
    }
}

rootProject.name = 'mc-mod'
`,
  };
}

export function forgeGradleProperties(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Forge
mc_version=${mcVersion}
forge_version=${versions.forgeVersion}
`;
  return { path: 'gradle.properties', content };
}

/** gradle/wrapper/gradle-wrapper.properties（按 MC 版本选择 Gradle） */
export function forgeWrapperProperties(mcVersion: string): FileNode {
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
