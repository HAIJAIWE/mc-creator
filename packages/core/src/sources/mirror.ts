/**
 * 国内镜像（MCIM）↔ 官方源的地址映射。
 *
 * ## 为什么要有这个文件
 *
 * Modrinth / CurseForge 的接口和 CDN 在国内经常慢或连不上。PCL 的做法是把
 * 主机名整段换掉（`ModDownload.vb` L1307-1316 `DlSourceModGet`）：
 *
 * ```
 * api.modrinth.com   → mod.mcimirror.top/modrinth
 * cdn.modrinth.com   → mod.mcimirror.top
 * api.curseforge.com → mod.mcimirror.top/curseforge
 * edge.forgecdn.net  → mod.mcimirror.top
 * ```
 *
 * 我们照做，但**不写死**：这里只负责「同一份数据的两个地址」这一个事实，
 * 选哪个由应用层的偏好决定（`apps/desktop/src/main/download-sources.ts`）。
 *
 * ## 实测（2026-10，本仓开发机）
 *
 * - `GET https://mod.mcimirror.top/modrinth/v2/search?query=sodium` → 200，结果与官方一致
 * - `GET https://mod.mcimirror.top/curseforge/v1/mods/238222` → 200，**不带 key 也通**
 *   （镜像自己带了 key —— 这正是 PCL 从头到尾没跟用户要过 CF key 的原因）
 * - `GET https://mod.mcimirror.top/data/AANobbMI/versions/ygf8cVZg/sodium-fabric-0.5.11%2Bmc1.20.1.jar`
 *   （`Range: bytes=0-2047`）→ 206，与 `cdn.modrinth.com` 同字节数
 * - `GET https://mod.mcimirror.top/files/9206/523/jei-26.3-neoforge-31.13.0.71.jar`
 *   （`Range: bytes=0-2047`）→ 206
 * - 它的接口清单就是官方那份（`https://mod.mcimirror.top/openapi.json`，title=MCIM API），
 *   路径一一对应，所以换前缀不会漏掉任何端点
 *
 * ## 为什么不直接用官方的两个域名换来换去
 *
 * 镜像**能看到你下了什么**（它在中间）。所以：
 * - 文件下载一律带清单给的 sha1/sha512 校验（镜像改了内容就校验不过）
 * - 顺序由用户决定，官方源永远留在候选列表里，不是「镜像挂了才想起来」
 * - 镜像只碰「平台元数据 + 平台 CDN 文件」，不碰账号、不碰 Mojang 认证
 */

/** 下载源偏好。应用层负责持久化，core 只消费。 */
export interface SourcePreference {
  /** true = 官方源优先（国内镜像排后面兜底）；false = 国内镜像优先。 */
  preferOfficial: boolean;
}

/** MCIM：国内对 Modrinth / CurseForge 接口与 CDN 的镜像（PCL 同款）。 */
export const MCIM_ORIGIN = 'https://mod.mcimirror.top';

/** 官方 Modrinth API 根（所有端点都挂在这下面）。 */
export const OFFICIAL_MODRINTH_API = 'https://api.modrinth.com/v2';
/** 镜像上的 Modrinth API 根。 */
export const MIRROR_MODRINTH_API = `${MCIM_ORIGIN}/modrinth/v2`;

/** 官方 CurseForge API 根。 */
export const OFFICIAL_CURSEFORGE_API = 'https://api.curseforge.com/v1';
/** 镜像上的 CurseForge API 根（**不需 key**）。 */
export const MIRROR_CURSEFORGE_API = `${MCIM_ORIGIN}/curseforge/v1`;

/**
 * 官方前缀 → 镜像前缀。
 *
 * 顺序无关（都是 `https://` 开头的整段前缀，`staging-api` 不会被
 * `api.modrinth.com` 误匹配）。
 */
const MIRRORED_PREFIXES: ReadonlyArray<readonly [official: string, mirror: string]> = [
  ['https://staging-api.modrinth.com', `${MCIM_ORIGIN}/modrinth`],
  ['https://api.modrinth.com', `${MCIM_ORIGIN}/modrinth`],
  ['https://cdn.modrinth.com', MCIM_ORIGIN],
  ['https://api.curseforge.com', `${MCIM_ORIGIN}/curseforge`],
  ['https://edge.forgecdn.net', MCIM_ORIGIN],
  ['https://mediafilez.forgecdn.net', MCIM_ORIGIN],
  ['https://media.forgecdn.net', MCIM_ORIGIN],
];

/**
 * 这个地址在镜像上对应的地址；没有对应（不是 Modrinth/CF 的资源）返回 null。
 *
 * 只认**整段前缀**：`https://api.modrinth.com` 换成镜像时，官方那串必须是
 * URL 开头。用 `replace` 全串替换（PCL 的写法）在「URL 里带了个同名字符串」
 * 时会改错地方。
 */
export function mirrorUrlOf(url: string): string | null {
  for (const [official, mirror] of MIRRORED_PREFIXES) {
    if (url.startsWith(official)) return mirror + url.slice(official.length);
  }
  return null;
}

/**
 * 一个地址的候选列表，**按偏好排序**。
 *
 * 官方源永远在列表里（镜像只是候选之一）—— 这跟 `download-sources.ts` 里
 * 原版下载的 BMCLAPI 是同一套约定。没有镜像的地址返回单元素列表。
 */
export function urlsWithMirror(url: string, prefer: SourcePreference): string[] {
  const mirrored = mirrorUrlOf(url);
  if (mirrored === null || mirrored === url) return [url];
  return prefer.preferOfficial ? [url, mirrored] : [mirrored, url];
}

/**
 * API 根地址的候选（给两个 API 客户端构造用）。
 *
 * `kind` 不是字符串自由值：这里只有 mod 内容平台两家，写错编译不过。
 */
export function apiBases(kind: 'modrinth' | 'curseforge', prefer: SourcePreference): string[] {
  const [official, mirror] =
    kind === 'modrinth'
      ? [OFFICIAL_MODRINTH_API, MIRROR_MODRINTH_API]
      : [OFFICIAL_CURSEFORGE_API, MIRROR_CURSEFORGE_API];
  return prefer.preferOfficial ? [official, mirror] : [mirror, official];
}

/**
 * 把 `url` 里的 `from` 前缀换成 `to`。换不了（不是以 `from` 开头）返回 null。
 *
 * 给 API 客户端用：方法内部先按候选里的第一个根拼出完整 URL，失败后再
 * 换根重试 —— 这样每个端点只需要写一次路径。
 */
export function swapBase(url: string, from: string, to: string): string | null {
  if (from === to) return url;
  if (!url.startsWith(from)) return null;
  return to + url.slice(from.length);
}

/** 是不是官方 CurseForge 根（需要用 key 的那个）。 */
export function isOfficialCurseForgeBase(base: string): boolean {
  return base.startsWith('https://api.curseforge.com');
}
