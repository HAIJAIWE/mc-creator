/** Fabric Adapter 的构建脚本生成域。原样提取,行为不变。 */
import type { FileNode } from '@mc-creator/shared';
import {
  gradleVersionFor,
  javaVersionFor,
  type LoaderVersionConfig,
  type McVersion,
} from '@mc-creator/shared';
import type { ModSpecLike } from './mod-common.js';

export function fabricModJson(
  spec: ModSpecLike,
  pkg: string,
  mainCls: string,
  mcVersion: string,
  versions: LoaderVersionConfig,
  hasMixins = false,
): FileNode {
  const content: Record<string, unknown> = {
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
      fabricloader: versions.fabricLoaderMinVersion,
      minecraft: `~${mcVersion}`,
      java: `>=${javaVersionFor('fabric', mcVersion as McVersion)}`,
      'fabric-api': '*',
    },
  };
  if (hasMixins) {
    content.mixins = [`${spec.modId}.mixins.json`];
  }
  return {
    path: 'src/main/resources/fabric.mod.json',
    content: JSON.stringify(content, null, 2),
  };
}

export function fabricBuildGradle(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  // 版本感知：1.20.x → Java 17，1.21.x → Java 21，26.x → Java 25
  const javaVersion = javaVersionFor('fabric', mcVersion as McVersion);
  const javaConstant = javaVersion === 25 ? 'VERSION_25' : `VERSION_${javaVersion}`;
  // 26.x 为非混淆版：插件 net.fabricmc.fabric-loom、无 mappings、依赖用 implementation（官方 26.1 模板）
  const isUnobfuscated = mcVersion.startsWith('26.');
  const loomPluginId = isUnobfuscated ? 'net.fabricmc.fabric-loom' : 'fabric-loom';
  const mappingsLine = isUnobfuscated ? '' : '    mappings loom.officialMojangMappings()\n';
  const depPrefix = isUnobfuscated ? 'implementation' : 'modImplementation';
  const content = `plugins {
    id '${loomPluginId}' version '${versions.fabricLoomVersion}'
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
${mappingsLine}    ${depPrefix} "net.fabricmc:fabric-loader:\${project.loader_version}"
    ${depPrefix} "net.fabricmc.fabric-api:fabric-api:\${project.fabric_version}"
}

processResources {
    inputs.property "version", project.version
    filesMatching("fabric.mod.json") {
        expand "version": project.version
    }
}

java {
    sourceCompatibility = JavaVersion.${javaConstant}
    targetCompatibility = JavaVersion.${javaConstant}
    withSourcesJar()
}
`;
  return { path: 'build.gradle', content };
}

export function fabricSettingsGradle(): FileNode {
  return {
    path: 'settings.gradle',
    content: `rootProject.name = 'mc-mod'\n`,
  };
}

export function fabricGradleProperties(
  spec: ModSpecLike,
  mcVersion: string,
  versions: LoaderVersionConfig,
): FileNode {
  const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Fabric
minecraft_version=${mcVersion}
loader_version=${versions.fabricLoaderVersion}
fabric_version=${versions.fabricApiVersion}
`;
  return { path: 'gradle.properties', content };
}

/** gradle/wrapper/gradle-wrapper.properties（按 MC 版本选择 Gradle；jar 由 gradle wrapper 命令生成） */

export function fabricWrapperProperties(mcVersion: string): FileNode {
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
