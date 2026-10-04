import type { FileNode, Loader, McVersion } from '@mc-creator/shared';
import { javaVersionFor, type LoaderVersionConfig } from '@mc-creator/shared';
import { FabricAdapter } from './fabric-adapter.js';
import type { CategoryDescriptor, ModSpecLike } from './mod-common.js';
import { fabricMainClass } from './fabric-java.js';

/**
 * Quilt Loader Adapter（规格 §3.2 衍生）。
 * Quilt 是 Fabric 的衍生 loader，用 quilt.mod.json + quilt-loom（org.quiltmc.loom）。
 *
 * 实现：extends FabricAdapter，复用其全部 Java/资源类别（与 Fabric 字节一致，
 * 故 build.gradle 用 Yarn mappings，保证 Yarn 名代码可编译），仅替换 5 个
 * loader 特异类别：quiltModJson / buildGradle / settingsGradle /
 * gradleProperties / mainClass。
 *
 * 关键修正（2026-09 Quilt 审计）：
 * - quilt.mod.json 的 entrypoints 必须在 quilt_loader 内、键为 init、值为字符串，
 *   否则 Quilt Loader 永远不会调用初始化入口；
 * - 主类实现 QSL 的 ModInitializer#onInitialize(ModContainer)
 *  （quilt-loader 自身已无该接口，入口契约由 QFAPI 内的 QSL 提供），
 *   不沿用 Fabric 的 net.fabricmc.api.ModInitializer；
 * - 有 block_place/item_pickup handler 时顶层声明 "mixin" 字段，否则 Mixin
 *   类存在但永不加载，事件静默不触发；
 * - settings.gradle 声明 Quilt 仓库 + quilt-loom 解析，否则插件无法解析；
 * - 版本号全部来自 LoaderVersionConfig（quilt maven 实测：loader 0.30.1、
 *   loom 1.15.1、QFAPI 按 MC 版本），不再硬编码；
 * - 类别级替换（而非旧的 translateWithCache 事后换文件），增量缓存快照
 *   与实际产物一致。
 */
export class QuiltAdapter extends FabricAdapter {
  readonly loader: Loader = 'quilt';

  constructor() {
    super();
    const swap: Record<string, CategoryDescriptor<ModSpecLike>> = {
      quiltModJson: {
        name: 'quiltModJson',
        hashInputs: (s, mcVersion) => [
          s.modId,
          s.name,
          s.description,
          s.version,
          mcVersion,
          (s.eventHandlers ?? []).some(
            (h) => h.eventType === 'block_place' || h.eventType === 'item_pickup',
          ),
        ],
        generate: (s, pkg, mainCls, mcVersion, versions) => [
          this.quiltModJson(s, mcVersion, pkg, mainCls, versions),
        ],
      },
      buildGradle: {
        name: 'buildGradle',
        hashInputs: (_s, mcVersion) => [mcVersion],
        generate: (s, _pkg, _mainCls, mcVersion, versions) => [
          this.quiltBuildGradle(s, mcVersion, versions),
        ],
      },
      settingsGradle: {
        name: 'settingsGradle',
        hashInputs: (_s, mcVersion) => [mcVersion],
        generate: (_s, _pkg, _mainCls, _mcVersion, versions) => [
          this.quiltSettingsGradle(versions),
        ],
      },
      gradleProperties: {
        name: 'gradleProperties',
        hashInputs: (s, mcVersion) => [s.modId, s.version, mcVersion],
        generate: (s, _pkg, _mainCls, mcVersion, versions) => [
          this.quiltGradleProperties(s, mcVersion, versions),
        ],
      },
      mainClass: {
        name: 'mainClass',
        hashInputs: (s) => [
          s.modId,
          s.name,
          s.items.length > 0,
          s.blocks.length > 0,
          (s.recipes?.length ?? 0) > 0,
          (s.entities?.length ?? 0) > 0,
          (s.fluids?.length ?? 0) > 0,
          (s.biomes?.length ?? 0) > 0,
          (s.dimensions?.length ?? 0) > 0,
          (s.guis?.length ?? 0) > 0,
          (s.structures?.length ?? 0) > 0,
          (s.machines?.length ?? 0) > 0,
          (s.customCode?.length ?? 0) > 0,
          (s.multiblocks?.length ?? 0) > 0,
          (s.eventHandlers?.length ?? 0) > 0 ||
            (s.conditions?.length ?? 0) > 0 ||
            (s.actions?.length ?? 0) > 0 ||
            (s.procedures?.length ?? 0) > 0,
        ],
        generate: (s, pkg, mainCls) => [this.quiltMainClass(s, pkg, mainCls)],
      },
    };
    // wrapperProperties：Quilt 走 Gradle 9 系（quilt-loom 1.15.1 要求 plugin api 9.2+），
    // 不复用 Fabric 的 8.12
    const byName = new Map(this.categories.map((c) => [c.name, c]));
    // fabricModJson → quiltModJson：路径与内容都不同，整项替换
    byName.set('quiltModJson', swap['quiltModJson']);
    byName.delete('fabricModJson');
    for (const name of ['buildGradle', 'settingsGradle', 'gradleProperties', 'mainClass']) {
      byName.set(name, swap[name]);
    }
    byName.set('wrapperProperties', {
      name: 'wrapperProperties',
      hashInputs: () => [],
      generate: () => [this.quiltWrapperProperties()],
    });
    // 保持原类别顺序（fabricModJson 的位置放 quiltModJson）
    const order = this.categories.map((c) =>
      c.name === 'fabricModJson' ? 'quiltModJson' : c.name,
    );
    this.categories = order.map((n) => byName.get(n)!);
  }

  /** 生成 src/main/resources/quilt.mod.json（schema_version=1，入口在 quilt_loader 内） */
  private quiltModJson(
    spec: ModSpecLike,
    mcVersion: string,
    pkg: string,
    mainCls: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    const hasMixins = (spec.eventHandlers ?? []).some(
      (h) => h.eventType === 'block_place' || h.eventType === 'item_pickup',
    );
    const content: Record<string, unknown> = {
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
        entrypoints: {
          init: `${pkg}.${mainCls}`,
        },
        depends: [
          { id: 'quilt_loader', versions: `>=${versions.quiltLoaderVersion}` },
          { id: 'minecraft', versions: `~${mcVersion}` },
          { id: 'quilted_fabric_api', versions: '*' },
        ],
      },
    };
    // Mixin 配置需顶层声明才会被加载（无 handler 时不声明，避免悬空引用）
    if (hasMixins) {
      content['mixin'] = `${spec.modId}.mixins.json`;
    }
    return {
      path: 'src/main/resources/quilt.mod.json',
      content: JSON.stringify(content, null, 2),
    };
  }

  /** 生成 Quilt 主类：QSL 的 ModInitializer + onInitialize(ModContainer) */
  private quiltMainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
    // 初始化调用列表与 Fabric 完全一致（同套 ModX.initialize()），仅入口签名不同：
    // quilt-loader 自身已无 ModInitializer（0.30.1 实测），入口契约由 QSL 提供
    //（org.quiltmc.qsl.base.api.entrypoint.ModInitializer，随 QFAPI 引入）。
    // 对 fabricMainClass 产物做确定性替换，任一模式缺失即抛错（防上游改版静默漂移）。
    const fabric = fabricMainClass(spec, pkg, mainCls);
    const fromImport = 'import net.fabricmc.api.ModInitializer;';
    const toImport =
      'import org.quiltmc.loader.api.ModContainer;\nimport org.quiltmc.qsl.base.api.entrypoint.ModInitializer;';
    const fromInit = 'public void onInitialize() {';
    const toInit = 'public void onInitialize(ModContainer mod) {';
    if (!fabric.content.includes(fromImport) || !fabric.content.includes(fromInit)) {
      throw new Error(
        '[quilt] fabricMainClass 模板形状已变化，quiltMainClass 的入口替换模式失效，需同步更新',
      );
    }
    const content = fabric.content.replace(fromImport, toImport).replace(fromInit, toInit);
    if (content.includes('net.fabricmc.api.ModInitializer')) {
      throw new Error('[quilt] 主类仍引用 Fabric ModInitializer，替换不完整');
    }
    return { path: fabric.path, content };
  }

  /** 生成 build.gradle（org.quiltmc.loom + Yarn mappings + quilt 依赖，版本全走配置表） */
  private quiltBuildGradle(
    _spec: ModSpecLike,
    _mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    // javaVersionFor 与 MC 版本绑定（1.20.1/1.20.4→17，其余 21，26.x→25）
    const javaVer = javaVersionFor('quilt', _mcVersion as McVersion);
    const content = `plugins {
    id 'org.quiltmc.loom' version '${versions.quiltLoomVersion}'
    id 'java'
}

version = project.mod_version
group = project.maven_group

base { archivesName = project.archives_base_name }

repositories {
    maven { name = "Quilt"; url = 'https://maven.quiltmc.org/repository/release/' }
    maven { name = "Fabric"; url = 'https://maven.fabricmc.net/' }
}

dependencies {
    minecraft "com.mojang:minecraft:\${project.minecraft_version}"
    mappings "net.fabricmc:yarn:\${project.minecraft_version}+build.1:v2"
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
    sourceCompatibility = JavaVersion.VERSION_${javaVer}
    targetCompatibility = JavaVersion.VERSION_${javaVer}
    withSourcesJar()
}
`;
    return { path: 'build.gradle', content };
  }

  /** 生成 settings.gradle（声明 Quilt 仓库 + quilt-loom 插件解析） */
  private quiltSettingsGradle(versions: LoaderVersionConfig): FileNode {
    return {
      path: 'settings.gradle',
      content: `pluginManagement {
    repositories {
        gradlePluginPortal()
        maven { url "https://maven.quiltmc.org/repository/release/" }
        maven { url "https://maven.fabricmc.net/" }
    }
    resolutionStrategy {
        eachPlugin {
            if (requested.id.id == "org.quiltmc.loom") {
                useModule("org.quiltmc:loom:${versions.quiltLoomVersion}")
            }
        }
    }
}

rootProject.name = 'mc-mod'
`,
    };
  }

  /** 生成 gradle.properties（quilt 版本全走配置表；QFAPI 未知版本留空 + 注释警告） */
  private quiltGradleProperties(
    spec: ModSpecLike,
    mcVersion: string,
    versions: LoaderVersionConfig,
  ): FileNode {
    const apiLine = versions.quiltApiVersion
      ? `quilt_version=${versions.quiltApiVersion}`
      : `# quilt_version=（该 MC 版本的 QFAPI 未确认，请到 https://maven.quiltmc.org 核对后填写）\nquilt_version=`;
    const content = `# Mod
mod_version=${spec.version}
maven_group=com.example.${spec.modId}
archives_base_name=${spec.modId}

# Minecraft / Quilt
minecraft_version=${mcVersion}
quilt_loader_version=${versions.quiltLoaderVersion}
${apiLine}
`;
    return { path: 'gradle.properties', content };
  }

  /** 生成 gradle/wrapper/gradle-wrapper.properties（Quilt 固定 Gradle 9.2.1） */
  private quiltWrapperProperties(): FileNode {
    // quilt-loom 1.15.1 要求 plugin api-version 9.2+，故 wrapper pin 9.2.1（实测存在），
    // 与 Fabric 的 8.12 分开（Gradle 运行 JVM 需 21+，见构建文档）。
    const content = `# Quilt 固定 Gradle 9.2.1（quilt-loom 1.15.1 要求 plugin api-version 9.2+）
# 首次构建前在项目目录运行：gradle wrapper --gradle-version 9.2.1
distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-9.2.1-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists
`;
    return { path: 'gradle/wrapper/gradle-wrapper.properties', content };
  }
}
