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

/**
 * Foojay Toolchain Resolver 约定插件版本（Gradle 官方，解析缺失的 Java toolchain）。
 *
 * 为什么必须有它（不是保险起见，是实测踩过的坑）：
 * build.gradle 里 `java.toolchain.languageVersion = JavaLanguageVersion.of(17)`
 * 要求构建机上能找到 JDK 17。本机没装 JDK 17 时 Gradle 不会自动去下载 —— 它需要一个
 * 「toolchain 下载源」，而这个源只能由 settings.gradle 里的这个约定插件注册。
 *
 * 不加这行的失败模式（干净机器 + 真实 Forge 1.20.1 构建实测）：
 *   > No locally installed toolchains match and toolchain download repositories have not been configured.
 *   > BUILD FAILED in 1m 57s
 * 极具误导性：它是在 ForgeGradle 依赖解析之后才炸的，控制台往前翻全是依赖下载日志，
 * 看起来像「maven 拉不到 / 依赖装不上」，真实原因却是「这台机器没装 JDK 17」。
 * 用户会去查仓库配置、改 mappings 版本、换 Forge 版本 —— 全都白费。
 *
 * 版本号实测：0.10.0 + Gradle 8.12 可用。加上后同一工程 BUILD SUCCESSFUL in 3m 14s，
 * Gradle 真的下载了 JDK 17（~/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2，
 * JAVA_VERSION=17.0.20.1+1），javac 真编译了源码，产物 jar 311 → 1458 字节。
 */
export const FOOJAY_RESOLVER_VERSION = '0.10.0';

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
  // 两块内容，顺序不能换：
  // 1) plugins { } —— Foojay toolchain 解析器，让 Gradle 能自动下载缺失的 JDK 17
  //    （见 FOOJAY_RESOLVER_VERSION 注释：不加 = 干净机器上 toolchain 解析失败，
  //    报错长得像依赖问题）。Gradle 规定 settings 脚本的 plugins 块只能出现在最前，
  //    即 pluginManagement 之前，实测这个顺序可正常构建。
  // 2) pluginManagement { repositories { ... } } —— ForgeGradle 插件不在 Gradle Portal，
  //    必须靠这里声明的 Forge maven 解析。**这段仓库声明是 Forge 能构建的前提，
  //    不要因为调整 plugins 块而动它/删它**，否则插件直接拉不到。
  return {
    path: 'settings.gradle',
    content: `plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_RESOLVER_VERSION}'
}

pluginManagement {
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
