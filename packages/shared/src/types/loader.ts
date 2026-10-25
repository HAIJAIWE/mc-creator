/** Mod 加载器（规格 §1.2：Fabric + NeoForge + Quilt 同时支持；P27 新增 Legacy Fabric；launcher 支持全部含 vanilla） */
export const LOADERS = [
  'fabric',
  'neoforge',
  'quilt',
  'legacy_fabric',
  'forge',
  'vanilla',
] as const;
export type Loader = (typeof LOADERS)[number];

/** MC 版本（规格 §1.2：1.21.11 为主，26.x 为年度版；1.20.x/1.21.5 为生态常用旧版本） */
export const MC_VERSIONS = [
  '1.20.1',
  '1.20.4',
  '1.20.6',
  '1.21.1',
  '1.21.5',
  '1.21.11',
  '26.1',
  '26.2',
] as const;
export type McVersion = (typeof MC_VERSIONS)[number];

/** 默认目标版本 */
export const DEFAULT_MC_VERSION: McVersion = '1.21.11';

/** 每个 loader+版本 对应的 Java 版本（规格 §5 错误处理） */
export function javaVersionFor(_loader: Loader, mc: McVersion): number {
  if (mc === '26.1' || mc === '26.2') return 25; // 26.x 需 Java 25
  if (mc === '1.20.1' || mc === '1.20.4') return 17; // 1.20.4 及更早需 Java 17
  return 21; // 1.20.6+ 与 1.21.x 需 Java 21
}

// === Loader 版本配置（对标 MCreator GradleCache 版本映射） ===

/**
 * 单个 loader 在特定 MC 版本下的版本依赖配置。
 *
 * 用途：替换各 adapter 中硬编码的版本号，使其可配置、可升级。
 * Fabric/NeoForge 适配器的 gradleProperties / buildGradle / modsToml
 * 从此映射表读取版本，而非写死字符串。
 */
export interface LoaderVersionConfig {
  /** Fabric Loader 版本（如 '0.16.9'） */
  fabricLoaderVersion: string;
  /** Fabric API 版本（如 '0.110.5+1.21'） */
  fabricApiVersion: string;
  /** Fabric Loom Gradle 插件版本（如 '1.7-SNAPSHOT'） */
  fabricLoomVersion: string;
  /** Fabric Loader 最低兼容版本（用于 fabric.mod.json depends，如 '>=0.16.0'） */
  fabricLoaderMinVersion: string;
  /** NeoForge 版本（如 '21.1.1'） */
  neoforgeVersion: string;
  /** NeoForge ModDev Gradle 插件版本（如 '1.0.21'） */
  neoforgeModdevVersion: string;
  /** NeoForge loader 版本范围（用于 mods.toml loaderVersion，如 '[4,)'） */
  neoforgeLoaderVersionRange: string;
  /** NeoForge 最低版本范围（用于 mods.toml dependency versionRange，如 '[21.1,)'） */
  neoforgeVersionRange: string;
  /** Quilt Loader 版本（如 '0.30.1'，quilt 元数据以该仓库实测为准） */
  quiltLoaderVersion: string;
  /** Quilt Loom Gradle 插件版本（如 '1.15.1'） */
  quiltLoomVersion: string;
  /** Quilted Fabric API 版本（按 MC 版本，如 '7.7.0+0.92.2-1.20.1'；未知留空） */
  quiltApiVersion: string;
  /** Forge 版本（1.20.1，如 '47.4.23'；Forge 适配器仅支持 1.20.1，其余留空） */
  forgeVersion: string;
  /** ForgeGradle 插件版本（文档约定滚动线，如 '[6.0,)'） */
  forgeGradleVersion: string;
  /** Forge loader 版本范围（用于 mods.toml loaderVersion，如 '[47,)'） */
  forgeLoaderVersionRange: string;
  /** Forge 版本范围（用于 mods.toml dependency versionRange，如 '[47,)'） */
  forgeVersionRange: string;
  /**
   * 该版本配置是否为占位值（true 表示 loader 版本号是临时复用的，构建配置可能失败）。
   * 调用方应检查此标志并在 UI/警告中提示用户手动确认版本号。
   */
  isPlaceholder?: boolean;
}

/**
 * MC 版本 → Loader 版本映射表。
 *
 * 每个支持的 MC 版本对应一组 loader 版本号，便于一键升级。
 * 新增 MC 版本时只需在此映射表添加条目，各 adapter 自动使用新版本。
 *
 * 对标 MCreator 的 GradleCache：MCreator 在每个版本发布时更新
 * gradle.properties 模板中的版本号，我们用代码化映射表替代手动维护。
 */
export const LOADER_VERSIONS: Record<McVersion, LoaderVersionConfig> = {
  '1.20.1': {
    // NeoForge 官方已弃用 1.20.1（公共下载移除，推荐 Forge）；neoforgeVersion 为旧分支末版，构建需人工确认
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.92.11+1.20.1',
    // loom 经真构建验证：1.7-SNAPSHOT 与 Gradle 8.14 不兼容（Problems.forNamespace），改用已验证的 1.9.2
    fabricLoomVersion: '1.9.2',
    fabricLoaderMinVersion: '>=0.14.0',
    neoforgeVersion: '20.1.110',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[20.1,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '7.7.0+0.92.2-1.20.1',
    forgeVersion: '47.4.23',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
    isPlaceholder: true,
  },
  '1.20.4': {
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.97.3+1.20.4',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.14.0',
    neoforgeVersion: '20.4.251',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[20.4,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '9.0.0-alpha.8+0.97.0-1.20.4',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '1.20.6': {
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.100.8+1.20.6',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.14.0',
    neoforgeVersion: '20.6.139',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[20.6,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '10.0.0-alpha.3+0.100.4-1.20.6',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '1.21.1': {
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.116.15+1.21.1',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.1.1',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.1,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '11.0.0-alpha.3+0.102.0-1.21',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '1.21.5': {
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.128.2+1.21.5',
    fabricLoomVersion: '1.10-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.5.81',
    neoforgeModdevVersion: '2.0.143',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.5,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '1.21.11': {
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.141.6+1.21.11',
    fabricLoomVersion: '1.17.17',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.11.42',
    neoforgeModdevVersion: '2.0.143',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.11,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '26.1': {
    // 实测版本（2026-07 在线核验）：26.1 已于 2026-03-24 正式发布
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.155.2+26.1.2',
    fabricLoomVersion: '1.17.17',
    fabricLoaderMinVersion: '>=0.19.0',
    neoforgeVersion: '26.1.2.94',
    neoforgeModdevVersion: '2.0.143',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[26.1,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
  },
  '26.2': {
    // 26.2 已于 2026-06-16 发布；NeoForge 26.2 尚在 beta，标注实验性
    fabricLoaderVersion: '0.19.3',
    fabricApiVersion: '0.157.0+26.2',
    fabricLoomVersion: '1.17.17',
    fabricLoaderMinVersion: '>=0.19.0',
    neoforgeVersion: '26.2.0.41-beta',
    neoforgeModdevVersion: '2.0.143',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[26.2,)',
    quiltLoaderVersion: '0.30.1',
    quiltLoomVersion: '1.15.1',
    quiltApiVersion: '',
    forgeVersion: '',
    forgeGradleVersion: '6.0.54', // FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）,
    forgeLoaderVersionRange: '[47,)',
    forgeVersionRange: '[47,)',
    isPlaceholder: true,
  },
};

/**
 * 获取指定 MC 版本的 Loader 版本配置。
 * MC 版本不在映射表中时回退到 DEFAULT_MC_VERSION 的配置。
 *
 * 26.1 已于 2026-03-24 发布，loader 版本号为真实值；
 * 26.2（2026-06-16 发布）的 NeoForge 尚在 beta（26.2.0.41-beta），标记占位并警告。
 */
export function getLoaderVersions(mcVersion: string): LoaderVersionConfig {
  if (mcVersion === '26.2') {
    // 26.2 的 NeoForge 版本尚为 beta，提示用户确认
    console.warn(
      `[mc-creator] MC 26.2 的 NeoForge 版本为 beta（26.2.0.41-beta），` +
        `正式版发布后可升级 neoforgeVersion。`,
    );
  }
  if (mcVersion in LOADER_VERSIONS) {
    return LOADER_VERSIONS[mcVersion as McVersion];
  }
  // 未知版本：回退到默认版本配置（向后兼容）
  return LOADER_VERSIONS[DEFAULT_MC_VERSION];
}

/**
 * **钉住的** Fabric installer 发行版版本号，供**生成离线部署脚本**的场景使用。
 *
 * 为什么不动态解析：生成的 install.sh / install.bat 是在**用户的远程服务器**上跑的，
 * 那台机器不保证能访问 maven.fabricmc.net，更不该指望它会解析 XML。
 * 所以生成侧只能烘进一个具体版本号。
 *
 * 防陈旧靠 `packages/core/src/ci/verify-loader-versions.test.ts`
 * （`VERIFY_VERSIONS=1` 联网门控）比对 maven-metadata 的最新 `<release>`，
 * 与 LOADER_VERSIONS 用的是同一套机制。
 *
 * 钉 `1.1.2`（2026-10 实测 `<release>` 值；实测该版本 jar HTTP 200 / 212123 字节）。
 * **注意：这里必须是字面量，不能写成 `<latest>`** —— 那个路径实测 404。
 *
 * 放在 shared 而非 core：内核层（kernel-java）生成安装脚本时也要用它，
 * 按 §15 分层内核只允许依赖 contract/shared/devkit 这类底层包，不能反向依赖 core。
 */
export const FABRIC_INSTALLER_PINNED_VERSION = '1.1.2';

/**
 * 各 MC 版本建议的 Gradle 版本（gradle-wrapper.properties distributionUrl 用）。
 *
 * 约束来源（2026-07 在线核验）：
 * - 1.20.x / 1.21.1：Fabric Loom 1.7 需 Gradle 8.11+，ModDevGradle 1.0 需 Gradle 8.8+ → 8.12
 * - 1.21.5：Loom 1.10 需 Gradle 8.12+ → 8.13
 * - 1.21.11：Loom 1.17 需 Gradle 9.2+ → 9.5.1
 * - 26.x：Loom 1.17 需 Gradle 9.2+，Fabric 官方推荐 9.4+ → 9.5.1
 */
const MC_VERSION_TO_GRADLE: Record<string, string> = {
  '1.20.1': '8.12',
  '1.20.4': '8.12',
  '1.20.6': '8.12',
  '1.21.1': '8.12',
  '1.21.5': '8.13',
  '1.21.11': '9.5.1',
  '26.1': '9.5.1',
  '26.2': '9.5.1',
};

/** 按 MC 版本获取建议 Gradle 版本；未知版本回退默认版本的 Gradle */
export function gradleVersionFor(mcVersion: string): string {
  return MC_VERSION_TO_GRADLE[mcVersion] ?? MC_VERSION_TO_GRADLE[DEFAULT_MC_VERSION];
}
