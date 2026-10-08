/** 生成器类型联合（mod/datapack/modpack/server/resource_pack/skin/launcher） */
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'resource_pack',
  'skin',
  'launcher',
  'kubejs',
  'crafttweaker',
  'behavior_pack',
  'enchantment',
  'behavior_item',
  'behavior_entity',
  // §6.4 基岩皮肤包：与 'skin'（Java 单张 64×64 PNG）是两回事，
  // 皮肤包是 manifest(skin_pack) + skins.json + textures/*.png + texts/*.lang 的整包。
  'skinpack',
] as const;
export type GeneratorType = (typeof GENERATOR_TYPES)[number];
