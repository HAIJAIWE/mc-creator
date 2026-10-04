import { describe, it, expect } from 'vitest';
import { LEGACY_GENERATOR_TO_KIND } from '@mc-creator/contract/capabilities.js';
import {
  BehaviorPackGenerator,
  BehaviorItemGenerator,
  BehaviorEntityGenerator,
  GENERATOR_NAMES,
  GENERATOR_KINDS,
} from './index.js';

// 注：本包只做映射 + 注册级断言，不做重型 generate。
// 不依赖 @mc-creator/core（§18 阶段 8 后实现已迁入本包，core 仅留 shim 反向依赖本包）。

describe('generator-bedrock facade', () => {
  it('kinds 与 contract 映射一致（且全为 addon）', () => {
    expect([...GENERATOR_NAMES]).toEqual(['behavior_pack', 'behavior_item', 'behavior_entity']);
    for (const name of GENERATOR_NAMES) {
      expect(LEGACY_GENERATOR_TO_KIND[name]).toBe('addon');
      expect(GENERATOR_KINDS[name]).toBe(LEGACY_GENERATOR_TO_KIND[name]);
    }
  });

  it('本包全部生成器可注册（按 type 路由）', () => {
    const registry = new Map<string, { type: string }>();
    for (const g of [
      new BehaviorPackGenerator(),
      new BehaviorItemGenerator(),
      new BehaviorEntityGenerator(),
    ]) {
      registry.set(g.type, g);
    }
    for (const name of GENERATOR_NAMES) {
      expect(registry.get(name)?.type).toBe(name);
    }
  });
});
