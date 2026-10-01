import { describe, it, expect } from 'vitest';
import type { SpecType } from '@mc-creator/core/browser.js';
import type { GeneratorType as SharedGeneratorType } from '@mc-creator/shared';
import { GENERATOR_TYPES, type GeneratorType } from './ipc-channels.js';
import {
  GENERATOR_DESCRIPTORS,
  getGeneratorDescriptor,
  pickLocalized,
} from './generator-descriptors.js';

/** 严格类型相等断言：两侧不一致时 `Equal` 为 false，下面的赋值即编译失败 */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('generator-descriptors：单一数据源', () => {
  it('描述符键集合与 GENERATOR_TYPES 完全一致（不多不少）', () => {
    expect(Object.keys(GENERATOR_DESCRIPTORS).sort()).toEqual([...GENERATOR_TYPES].sort());
  });

  it('core 的 SpecType 与 desktop 的 GeneratorType 保持一致', () => {
    // 编译期断言：若 packages/core 的 SpecType 与 GENERATOR_TYPES 漂移，此处编译失败
    const aligned: Equal<GeneratorType, SpecType> = true;
    expect(aligned).toBe(true);
  });

  it('shared 的模板 GeneratorType 与 desktop 的 GeneratorType 保持一致', () => {
    // 编译期断言：若 packages/shared 的模板类型与 GENERATOR_TYPES 漂移，此处编译失败
    const aligned: Equal<GeneratorType, SharedGeneratorType> = true;
    expect(aligned).toBe(true);
  });

  it('每项 descriptor.type 与其键一致', () => {
    for (const type of GENERATOR_TYPES) {
      expect(GENERATOR_DESCRIPTORS[type].type).toBe(type);
    }
  });

  it('每项都提供非空的中英双语文案与图标', () => {
    for (const type of GENERATOR_TYPES) {
      const d = GENERATOR_DESCRIPTORS[type];
      expect(d.label.zh.length).toBeGreaterThan(0);
      expect(d.label.en.length).toBeGreaterThan(0);
      expect(d.description.zh.length).toBeGreaterThan(0);
      expect(d.description.en.length).toBeGreaterThan(0);
      expect(d.promptPlaceholder.zh.length).toBeGreaterThan(0);
      expect(d.promptPlaceholder.en.length).toBeGreaterThan(0);
      expect(d.icon.name.length).toBeGreaterThan(0);
      expect(typeof d.needsLoader).toBe('boolean');
    }
  });

  it('needsLoader 仅 mod 为 true（只有 ModGenerator 读取 ctx.loader）', () => {
    const withLoader = GENERATOR_TYPES.filter((type) => GENERATOR_DESCRIPTORS[type].needsLoader);
    expect(withLoader).toEqual(['mod']);
  });

  it('getGeneratorDescriptor：已知类型返回描述符，未知类型返回 undefined', () => {
    expect(getGeneratorDescriptor('mod')?.label.zh).toBe('模组');
    expect(getGeneratorDescriptor('behavior_entity')?.label.zh).toBe('行为包实体');
    expect(getGeneratorDescriptor('custom_xyz')).toBeUndefined();
    // 不应命中原型链上的键
    expect(getGeneratorDescriptor('toString')).toBeUndefined();
  });

  it('pickLocalized：zh 前缀取中文，其余取英文', () => {
    const text = { zh: '模组', en: 'Mod' };
    expect(pickLocalized(text, 'zh')).toBe('模组');
    expect(pickLocalized(text, 'en-US')).toBe('Mod');
  });
});
