/** Mod 加载器（规格 §1.2：Fabric + NeoForge + Quilt 同时支持；P27 新增 Legacy Fabric；launcher 支持全部含 vanilla） */
export const LOADERS = ['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla'] as const;
export type Loader = (typeof LOADERS)[number];

/** MC 版本（规格 §1.2：1.21.11 为主，预留 26.1） */
export const MC_VERSIONS = ['1.21.11', '1.21.1', '26.1'] as const;
export type McVersion = (typeof MC_VERSIONS)[number];

/** 默认目标版本 */
export const DEFAULT_MC_VERSION: McVersion = '1.21.11';

/** 每个 loader+版本 对应的 Java 版本（规格 §5 错误处理） */
export function javaVersionFor(_loader: Loader, mc: McVersion): number {
  if (mc === '26.1') return 25;
  return 21; // 1.21.x 需 Java 21
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
  '1.21.11': {
    fabricLoaderVersion: '0.16.9',
    fabricApiVersion: '0.110.5+1.21',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.1.1',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.1,)',
  },
  '1.21.1': {
    fabricLoaderVersion: '0.16.9',
    fabricApiVersion: '0.110.5+1.21',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.1.1',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.1,)',
  },
  '26.1': {
    fabricLoaderVersion: '0.16.9',
    fabricApiVersion: '0.110.5+1.21',
    fabricLoomVersion: '1.7-SNAPSHOT',
    fabricLoaderMinVersion: '>=0.16.0',
    neoforgeVersion: '21.1.1',
    neoforgeModdevVersion: '1.0.21',
    neoforgeLoaderVersionRange: '[4,)',
    neoforgeVersionRange: '[21.1,)',
    isPlaceholder: true,
  },
};

/**
 * 获取指定 MC 版本的 Loader 版本配置。
 * MC 版本不在映射表中时回退到 DEFAULT_MC_VERSION 的配置。
 *
 * Major 修复：26.1 是未来版本，尚未有真实 loader 版本号。
 * 此前 26.1 条目复用了 1.21.x 的版本号（fabricApi '+1.21'、NeoForge '21.1.1'），
 * 与 Java 25 要求矛盾，会导致生成的构建配置必然失败。
 * 现在 26.1 条目标记为 placeholder，调用方应检查并提示用户。
 */
export function getLoaderVersions(mcVersion: string): LoaderVersionConfig {
  if (mcVersion === '26.1') {
    // 26.1 尚未发布真实 loader 版本，回退到最新已知配置但发出警告
    // 调用方可在 warnings 中提示用户手动确认版本号
    console.warn(
      `[mc-creator] MC 26.1 的 loader 版本配置为占位值，` +
        `生成的构建文件可能需要手动调整版本号。`,
    );
  }
  if (mcVersion in LOADER_VERSIONS) {
    return LOADER_VERSIONS[mcVersion as McVersion];
  }
  // 未知版本：回退到默认版本配置（向后兼容）
  return LOADER_VERSIONS[DEFAULT_MC_VERSION];
}
