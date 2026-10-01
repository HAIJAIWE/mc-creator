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
] as const;
export type GeneratorType = (typeof GENERATOR_TYPES)[number];
