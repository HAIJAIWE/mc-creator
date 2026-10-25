/**
 * 资源包 pack_format 与 MC 版本对应关系。
 * 注意：资源包格式与数据包格式是两套编号（1.20.5+ 起分家），
 * 数据包映射见 datapack-validator.ts 的 getPackFormatForMcVersion。
 *
 * 来源：minecraft.wiki Pack format（2026-07 在线核验）
 */

/**
 * MC 版本 → 资源包 pack_format。
 *
 * 来源：minecraft.wiki "Pack format" 页 Resource pack format history 的
 * **Releases** 列（2026-10 在线核验）。逐条照抄官方给出的「值 → 版本」对应关系，
 * 不是从相邻版本外推。
 *
 * ⚠️ 1.21.9 起 pack_format 含**次版本**（官方写作 `69.0` / `75.0` / `84.0`），
 * 且 pack.mcmeta **改用 `min_format` / `max_format` 字段**（官方原文：
 * "Since 25w31a, the pack format has been changed to work with min_format and
 * max_format fields instead of the previous pack_format field"），
 * 本表只保留**主版本整数部分**；次版本与字段形态见 pack-format.ts 顶部常量
 * `MIN_FORMAT_MC_VERSION` 与 `renderPackMcmeta`。
 */
const MC_VERSION_TO_RESOURCE_PACK_FORMAT: Record<string, number> = {
  '1.20.1': 15, // 1.20 – 1.20.1
  '1.20.2': 18, // 1.20.2
  '1.20.3': 22, // 1.20.3 – 1.20.4
  '1.20.4': 22,
  '1.20.5': 32, // 1.20.5 – 1.20.6
  '1.20.6': 32,
  '1.21.1': 34, // 1.21 – 1.21.1
  '1.21.2': 42, // 1.21.2 – 1.21.3
  '1.21.3': 42,
  '1.21.4': 46, // 1.21.4
  '1.21.5': 55, // 1.21.5
  '1.21.6': 63, // 1.21.6
  '1.21.7': 64, // 1.21.7 – 1.21.8
  '1.21.8': 64,
  '1.21.9': 69, // 1.21.9 – 1.21.10（官方写作 69.0）
  '1.21.10': 69,
  '1.21.11': 75, // 1.21.11（官方写作 75.0）
  '26.1': 84, // 26.1 – 26.1.2（官方写作 84.0）
  '26.2': 88, // 26.2（官方写作 88.0）
  '26.3': 97, // 26.3（官方写作 97.1）
};

/**
 * 起止版本号比较用的元组（供 min_format/max_format 渲染）。
 * 主版本 + 官方给出的次版本。
 */
const RESOURCE_PACK_MINOR: Record<string, number> = {
  '1.21.9': 0,
  '1.21.10': 0,
  '1.21.11': 0,
  '26.1': 0,
  '26.2': 0,
  '26.3': 1,
};

/**
 * 上面的精确表只到 1.20.1（生成器用的都是新版本）。启动器要支持**任意发布版**，
 * 所以补一份官方的「值 → 发布版区间」表（同样照抄 wiki 的 Releases 列，
 * 2026-10 在线核验，不是从相邻版本外推）：
 *
 * | 值 | 发布版 |
 * |---|---|
 * | 1 | 1.6.1 – 1.8.9 |
 * | 2 | 1.9 – 1.10.2 |
 * | 3 | 1.11 – 1.12.2 |
 * | 4 | 1.13 – 1.14.4 |
 * | 5 | 1.15 – 1.16.1 |
 * | 6 | 1.16.2 – 1.16.5 |
 * | 7 | 1.17 – 1.17.1 |
 * | 8 | 1.18 – 1.18.2 |
 * | 9 | 1.19 – 1.19.2 |
 * | 12 | 1.19.3 |
 * | 13 | 1.19.4 |
 *
 * 只补到 1.19.4：1.20 起精确表已经逐版本覆盖。
 * 1.6.1 之前没有值 —— 资源包是 1.6 才有的（用于判断「这条路走不通」）。
 */
const RESOURCE_PACK_FORMAT_RANGES: ReadonlyArray<{
  from: string;
  to: string;
  format: number;
}> = [
  { from: '1.6.1', to: '1.8.9', format: 1 },
  { from: '1.9', to: '1.10.2', format: 2 },
  { from: '1.11', to: '1.12.2', format: 3 },
  { from: '1.13', to: '1.14.4', format: 4 },
  { from: '1.15', to: '1.16.1', format: 5 },
  { from: '1.16.2', to: '1.16.5', format: 6 },
  { from: '1.17', to: '1.17.1', format: 7 },
  { from: '1.18', to: '1.18.2', format: 8 },
  { from: '1.19', to: '1.19.2', format: 9 },
  { from: '1.19.3', to: '1.19.3', format: 12 },
  { from: '1.19.4', to: '1.19.4', format: 13 },
];

/**
 * pack.mcmeta 改用 `min_format`/`max_format` 的起始 MC 版本。
 *
 * 官方原文（minecraft.wiki "Pack format" Technical details 段）：
 * "Since 25w31a, the pack format has been changed to work with min_format and
 * max_format fields instead of the previous pack_format field.
 * Both data packs and resource packs have this change."
 *
 * 25w31a 对应的发布版是 **1.21.9**（官方 1.21.9 的 pack_format 描述里写了
 * "Pack format now includes minor versions"）。
 */
export const MIN_FORMAT_SINCE_MC_VERSION = '1.21.9';

/** 资源包是否需要用 min_format/max_format 形态（按 MC 版本）。 */
export function usesMinMaxFormat(mcVersion: string): boolean {
  return compareMcVersion(mcVersion, MIN_FORMAT_SINCE_MC_VERSION) >= 0;
}

/**
 * 比较两个 MC 版本号；无法解析的一律返回 -1（视为「早于」），保守起见不误判成新格式。
 */
function compareMcVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10));
  const pb = b.split('.').map((n) => Number.parseInt(n, 10));
  if (pa.some((n) => !Number.isFinite(n)) || pb.some((n) => !Number.isFinite(n))) return -1;
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 该 MC 版本对应的资源包 pack format 值（含次版本，形如 `69.0`）。
 *
 * 1.21.9 之前的版本次版本恒为 0，官方表中写作整数（如 34）；1.21.9 起官方写作
 * 带次版本（`69.0`）。本函数一律返回带次版本的字符串形态，由调用方决定是否裁掉 `.0`。
 */
export function getResourcePackFormatValue(mcVersion: string): string | undefined {
  const major = MC_VERSION_TO_RESOURCE_PACK_FORMAT[mcVersion];
  if (major === undefined) return undefined;
  const minor = RESOURCE_PACK_MINOR[mcVersion] ?? 0;
  return `${major}.${minor}`;
}

/**
 * 按 MC 版本推断资源包 pack_format；未知版本返回 undefined。
 * 生成器用它覆盖 spec 里的默认/占位值，确保 pack.mcmeta 与目标版本匹配。
 */
export function getResourcePackFormatForMcVersion(mcVersion: string): number | undefined {
  return MC_VERSION_TO_RESOURCE_PACK_FORMAT[mcVersion];
}

/**
 * 任意 MC 版本的资源包 pack_format：先查精确表，再按官方区间兜底。
 *
 * 给启动器这类「拿到什么版本就得算」的调用方用；区间内未逐一列出的发布版
 * （如 1.19.3 的快照、1.8.1）落到同一区间值。仍查不到 → undefined
 * （1.6.1 之前根本没有资源包，调用方据此拒绝）。
 */
export function resourcePackFormatForAnyMcVersion(mcVersion: string): number | undefined {
  const exact = MC_VERSION_TO_RESOURCE_PACK_FORMAT[mcVersion];
  if (exact !== undefined) return exact;
  for (const r of RESOURCE_PACK_FORMAT_RANGES) {
    if (compareMcVersion(mcVersion, r.from) >= 0 && compareMcVersion(mcVersion, r.to) <= 0) {
      return r.format;
    }
  }
  return undefined;
}
