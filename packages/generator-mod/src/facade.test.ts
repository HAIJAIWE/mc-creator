import { describe, it, expect } from 'vitest';
import { LEGACY_GENERATOR_TO_KIND } from '@mc-creator/contract/capabilities.js';
import { GeneratorRegistry } from '@mc-creator/core/generators/registry.js';
import { createDefaultRegistry } from '@mc-creator/core/generators/index.js';
import { ModGenerator, GENERATOR_NAMES, GENERATOR_KINDS } from './index.js';

// 注：本包只做映射 + 注册级断言，不做重型 generate（mod 生成需 Gradle 工具链）。

describe('generator-mod facade', () => {
  it('kinds 与 contract 映射一致（mod → mod）', () => {
    expect([...GENERATOR_NAMES]).toEqual(['mod']);
    for (const name of GENERATOR_NAMES) {
      expect(LEGACY_GENERATOR_TO_KIND[name]).toBe('mod');
      expect(GENERATOR_KINDS[name]).toBe(LEGACY_GENERATOR_TO_KIND[name]);
    }
  });

  it('registry 含本包全部生成器名', () => {
    // 外观重导出的类可直接注册进 GeneratorRegistry
    const registry = new GeneratorRegistry();
    registry.register(new ModGenerator());
    for (const name of GENERATOR_NAMES) {
      expect(registry.get(name)?.type).toBe(name);
    }
    // 默认注册表（core 路由）同样包含本包全部生成器名
    const defaults = createDefaultRegistry();
    for (const name of GENERATOR_NAMES) {
      expect(defaults.get(name)?.type).toBe(name);
    }
  });
});
