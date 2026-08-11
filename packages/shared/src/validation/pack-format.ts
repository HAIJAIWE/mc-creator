/**
 * 资源包 pack_format 与 MC 版本对应关系。
 * 注意：资源包格式与数据包格式是两套编号（1.20.5+ 起分家），
 * 数据包映射见 datapack-validator.ts 的 getPackFormatForMcVersion。
 *
 * 来源：minecraft.wiki Pack format（2026-07 在线核验）
 */

/** MC 版本 → 资源包 pack_format */
const MC_VERSION_TO_RESOURCE_PACK_FORMAT: Record<string, number> = {
  '1.20.1': 15, // 1.20–1.20.1
  '1.20.2': 18,
  '1.20.3': 22,
  '1.20.4': 22,
  '1.20.5': 32,
  '1.20.6': 32,
  '1.21.1': 34,
  '1.21.2': 42,
  '1.21.3': 42,
  '1.21.4': 46,
  '1.21.5': 55,
  '1.21.6': 63,
  '1.21.7': 64,
  '1.21.8': 64,
  '1.21.9': 69,
  '1.21.10': 69,
  '1.21.11': 75,
  '26.1': 84,
  '26.2': 88,
};

/**
 * 按 MC 版本推断资源包 pack_format；未知版本返回 undefined。
 * 生成器用它覆盖 spec 里的默认/占位值，确保 pack.mcmeta 与目标版本匹配。
 */
export function getResourcePackFormatForMcVersion(mcVersion: string): number | undefined {
  return MC_VERSION_TO_RESOURCE_PACK_FORMAT[mcVersion];
}
