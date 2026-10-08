import { describe, it, expect } from 'vitest';
import { LEGACY_GENERATOR_TO_KIND } from '@mc-creator/contract/capabilities.js';
import {
  BehaviorPackGenerator,
  BehaviorItemGenerator,
  BehaviorEntityGenerator,
  SkinPackGenerator,
  GENERATOR_NAMES,
  GENERATOR_KINDS,
} from './index.js';

// 注：本包只做映射 + 注册级断言，不做重型 generate。
// 不依赖 @mc-creator/core（§18 阶段 8 后实现已迁入本包，core 仅留 shim 反向依赖本包）。

describe('generator-bedrock facade', () => {
  it('kinds 与 contract 映射一致（前三个为 addon，skinpack 为独立 kind）', () => {
    expect([...GENERATOR_NAMES]).toEqual([
      'behavior_pack',
      'behavior_item',
      'behavior_entity',
      'skinpack',
    ]);
    for (const name of GENERATOR_NAMES) {
      expect(GENERATOR_KINDS[name]).toBe(LEGACY_GENERATOR_TO_KIND[name]);
    }
    // 皮肤包的 manifest 模块类型是 skin_pack（不是 resources/data），
    // 所以 kind 必须是 'skinpack' 而不是并进 'addon'。
    expect(LEGACY_GENERATOR_TO_KIND.behavior_pack).toBe('addon');
    expect(LEGACY_GENERATOR_TO_KIND.behavior_item).toBe('addon');
    expect(LEGACY_GENERATOR_TO_KIND.behavior_entity).toBe('addon');
    expect(LEGACY_GENERATOR_TO_KIND.skinpack).toBe('skinpack');
  });

  it('本包全部生成器可注册（按 type 路由）', () => {
    const registry = new Map<string, { type: string }>();
    for (const g of [
      new BehaviorPackGenerator(),
      new BehaviorItemGenerator(),
      new BehaviorEntityGenerator(),
      new SkinPackGenerator(),
    ]) {
      registry.set(g.type, g);
    }
    for (const name of GENERATOR_NAMES) {
      expect(registry.get(name)?.type, name).toBe(name);
    }
    // 反向：注册表里不能有 GENERATOR_NAMES 之外的条目（防止加了类忘了登记）
    expect([...registry.keys()].sort()).toEqual([...GENERATOR_NAMES].sort());
  });
});
