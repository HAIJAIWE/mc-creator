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
import { parchmentModDevGradleBlock } from './parchment.js';

/**
 * Foojay Toolchain Resolver 约定插件版本（Gradle 官方，解析缺失的 Java toolchain）。
 *
 * 为什么必须有它（不是保险起见，是实测踩过的坑）：
 * build.gradle 里 `java.toolchain.languageVersion = JavaLanguageVersion.of(17/21/25)`
 * 要求构建机上找得到对应 JDK。本机没装时 Gradle 不会自动去下载 —— 它需要一个
 * 「toolchain 下载源」，而这个源只能由 settings.gradle 里的这个约定插件注册。
 *
 * 不加这行的失败模式（干净机器 + 真实构建实测）：
 *   > No locally installed toolchains match and toolchain download repositories have not been configured.
 *   > BUILD FAILED in 1m 57s
 * 极具误导性：它是在 ModDevGradle 依赖解析之后才炸的，控制台往前翻全是依赖下载日志，
 * 看起来像「maven 拉不到 / 依赖装不上」，真实原因却是「这台机器没装 JDK」。
 * 用户会去查仓库配置、改 moddev 版本、换 NeoForge 版本 —— 全都白费。
 *
 * 版本号实测：0.10.0 + Gradle 8.12 可用。加上后同一工程 BUILD SUCCESSFUL in 3m 14s，
 * Gradle 真的下载了 JDK 17（~/.gradle/jdks/eclipse_adoptium-17-amd64-windows.2，
 * JAVA_VERSION=17.0.20.1+1），javac 真编译了源码，产物 jar 311 → 1458 字节。
 */
export const FOOJAY_RESOLVER_VERSION = '0.10.0';

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
  // ModDevGradle 的扩展名**恒为顶层 neoForge {}**（2026-10 实测，两个大版本都一样）。
  //
  // 这里原先有一个版本分支：1.0.x（1.20.x / 1.21.1）包一层 `moddev { neoForge { } }`，
  // 2.0（1.21.5+/26.x）用顶层 `neoForge { }`。**那个分支是错的**，而且它让
  // NeoForge 模组生成的工程从来构建不了 —— 实测原文：
  //   > Could not find method moddev() for arguments [...] on root project 'mc-mod'
  //   > BUILD FAILED in 17s
  //
  // 判定方式不是查文档记忆，是把插件真实注册的扩展名打出来（应用插件后枚举 extensions）：
  //   ModDevGradle 1.0.21  → EXTNAMES 含 neoForge，HAS_MODDEV=false，HAS_NEOFORGE=true
  //   ModDevGradle 2.0.143 → EXTNAMES 含 neoForge，HAS_MODDEV=false，HAS_NEOFORGE=true
  // 去掉那层包装后，同一工程配置阶段通过、一路走到 :compileClasspath（真实构建日志）。
  //
  // 顺带记一笔：这个 bug 之所以长期没被发现，是因为它被**更早的一个 bug**挡住了 ——
  // 生成的工程没有 gradlew/gradlew.bat，构建会先 ENOENT，根本走不到 DSL 求值。
  // 两个 bug 叠在一起时，先修掉外层那个才会暴露内层；所以「跑一次真机构建」不能省。
  //
  // Parchment（§8.4）：仅当 PARCHMENT_VERSIONS 有该 MC 版本条目时拼接；
  // 缺条目（外部版本号待核实，宁缺毋错）时 parchmentPart 为空字符串，输出与原来逐字一致。
  const parchment = parchmentModDevGradleBlock(mcVersion);
  const parchmentPart = parchment === null ? '' : `${parchment}\n`;
  const neoForgeBlock = `neoForge {
    version = "${versions.neoforgeVersion}"
${parchmentPart}    runs {
        client { client() }
        server { server() }
    }
    mods {
        "${spec.modId}" {
            sourceSet sourceSets.main
        }
    }
}`;
  const dslBlock = neoForgeBlock;
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
  // plugins { } 放在最前：Gradle 规定 settings 脚本的 plugins 块只能出现在 pluginManagement
  // 之前（NeoForge 这边 moddev 插件在 Gradle Portal 上，不需要额外 pluginManagement 仓库声明）。
  // 这块插件不能删 —— 见 FOOJAY_RESOLVER_VERSION 注释：它是 toolchain 下载源，
  // 不带 = 干净机器上 toolchain 解析失败，且报错长得像依赖问题而非 JDK 缺失。
  return {
    path: 'settings.gradle',
    content: `plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_RESOLVER_VERSION}'
}

rootProject.name = 'mc-mod'
`,
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
