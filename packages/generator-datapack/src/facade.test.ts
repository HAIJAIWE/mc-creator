import { describe, it, expect } from 'vitest';
import { LEGACY_GENERATOR_TO_KIND } from '@mc-creator/contract/capabilities.js';
import { GeneratorRegistry } from '@mc-creator/core/generators/registry.js';
import { createDefaultRegistry } from '@mc-creator/core/generators/index.js';
import type { GeneratorContext } from '@mc-creator/shared';
import {
  DatapackGenerator,
  KubejsGenerator,
  CraftTweakerGenerator,
  EnchantmentGenerator,
  GENERATOR_NAMES,
  GENERATOR_KINDS,
} from './index.js';

describe('generator-datapack facade', () => {
  it('kinds 与 contract 映射一致（且全为 datapack）', () => {
    expect([...GENERATOR_NAMES]).toEqual(['datapack', 'kubejs', 'crafttweaker', 'enchantment']);
    for (const name of GENERATOR_NAMES) {
      expect(LEGACY_GENERATOR_TO_KIND[name]).toBe('datapack');
      expect(GENERATOR_KINDS[name]).toBe(LEGACY_GENERATOR_TO_KIND[name]);
    }
  });

  it('registry 含本包全部生成器名', () => {
    // 外观重导出的类可直接注册进 GeneratorRegistry
    const registry = new GeneratorRegistry();
    registry.register(new DatapackGenerator());
    registry.register(new KubejsGenerator());
    registry.register(new CraftTweakerGenerator());
    registry.register(new EnchantmentGenerator());
    for (const name of GENERATOR_NAMES) {
      expect(registry.get(name)?.type).toBe(name);
    }
    // 默认注册表（core 路由）同样包含本包全部生成器名
    const defaults = createDefaultRegistry();
    for (const name of GENERATOR_NAMES) {
      expect(defaults.get(name)?.type).toBe(name);
    }
  });

  it('真实 generate smoke：最小 datapack spec 产出含 pack.mcmeta', async () => {
    const gen = new DatapackGenerator();
    const ctx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'smoke_pack',
      spec: {
        modId: 'smoke_pack',
        version: '1.0.0',
        name: 'Smoke',
        description: '',
        items: [],
        blocks: [],
        packId: 'smoke_pack',
        packName: 'Smoke Pack',
        packFormat: 48,
      } as any,
      projectPath: '',
    };
    const result = await gen.generate(ctx);
    const meta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(meta).toBeDefined();
    expect(JSON.parse(meta!.content).pack).toBeDefined();
  });
});
