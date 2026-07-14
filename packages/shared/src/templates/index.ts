/**
 * Spec 模板库聚合导出。
 *
 * 为每种生成器类型预定义常见模板，用户点击模板后预填描述（description）到输入框，
 * 降低创作门槛。详见规格 §3.4 Spec 模板库。
 */
import type { SpecTemplate, GeneratorType } from './types.js';
import { MOD_TEMPLATES } from './mod-templates.js';
import { DATAPACK_TEMPLATES } from './datapack-templates.js';
import { MODPACK_TEMPLATES } from './modpack-templates.js';
import { SERVER_TEMPLATES } from './server-templates.js';
import { TEXTURE_TEMPLATES } from './texture-templates.js';
import { SKIN_TEMPLATES } from './skin-templates.js';
import { RESOURCE_PACK_TEMPLATES } from './resource-pack-templates.js';

export type { SpecTemplate, GeneratorType } from './types.js';
export * from './mod-templates.js';
export * from './datapack-templates.js';
export * from './modpack-templates.js';
export * from './server-templates.js';
export * from './texture-templates.js';
export * from './skin-templates.js';
export * from './resource-pack-templates.js';

/**
 * 按生成器类型分组的模板映射。
 *
 * 用法：
 * ```ts
 * const templates = TEMPLATES_BY_TYPE[generatorType];
 * ```
 */
export const TEMPLATES_BY_TYPE: Record<GeneratorType, SpecTemplate[]> = {
  mod: MOD_TEMPLATES,
  datapack: DATAPACK_TEMPLATES,
  modpack: MODPACK_TEMPLATES,
  server: SERVER_TEMPLATES,
  texture: TEXTURE_TEMPLATES,
  skin: SKIN_TEMPLATES,
  resource_pack: RESOURCE_PACK_TEMPLATES,
};
