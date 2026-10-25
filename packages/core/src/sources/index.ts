/**
 * 下载源（官方 / 国内镜像）的地址映射与候选顺序。
 *
 * 与 `apps/desktop/src/main/download-sources.ts` 的分工：
 * - 这里：**同一份数据有哪些地址**（纯函数，不碰磁盘不碰网络）
 * - 那里：**用户偏好存哪、原版 BMCLAPI 怎么排**
 */
export type { SourcePreference } from './mirror.js';
export {
  MCIM_ORIGIN,
  OFFICIAL_MODRINTH_API,
  MIRROR_MODRINTH_API,
  OFFICIAL_CURSEFORGE_API,
  MIRROR_CURSEFORGE_API,
  mirrorUrlOf,
  urlsWithMirror,
  apiBases,
  swapBase,
  isOfficialCurseForgeBase,
} from './mirror.js';
