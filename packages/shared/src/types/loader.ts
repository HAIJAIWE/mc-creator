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
