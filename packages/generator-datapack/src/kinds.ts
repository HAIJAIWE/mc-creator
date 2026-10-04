/**
 * @mc-creator/generator-datapack 覆盖范围（设计文档 §15）。
 *
 * 本包覆盖的 legacy 生成器名及其 ContentKind。映射值全部引自 contract 的
 * LEGACY_GENERATOR_TO_KIND，本文件不复制映射表，仅做转接声明
 * （§2.1：禁止为对称而抽象，不统一业务接口）。
 */
import { LEGACY_GENERATOR_TO_KIND } from '@mc-creator/contract/capabilities.js';

export const GENERATOR_NAMES = ['datapack', 'kubejs', 'crafttweaker', 'enchantment'] as const;

export type FacadeGeneratorName = (typeof GENERATOR_NAMES)[number];

/**
 * 本包各生成器的 ContentKind（值引自 contract 映射）。
 * 类型位置写死为 'datapack' 即编译期断言：若 contract 映射漂移，此处报错。
 */
export const GENERATOR_KINDS: { [K in FacadeGeneratorName]: 'datapack' } = {
  datapack: LEGACY_GENERATOR_TO_KIND.datapack,
  kubejs: LEGACY_GENERATOR_TO_KIND.kubejs,
  crafttweaker: LEGACY_GENERATOR_TO_KIND.crafttweaker,
  enchantment: LEGACY_GENERATOR_TO_KIND.enchantment,
};
