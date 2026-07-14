import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from '../registry.js';
import { ModGenerator } from './mod-generator.js';

describe('ModGenerator 注册集成', () => {
  it('注册后可通过 find 按 loader+版本定位', () => {
    const r = new GeneratorRegistry();
    r.register(new ModGenerator());
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'neoforge', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeDefined();
    // 未支持的组合
    expect(r.find('other', 'fabric', '1.21.11')).toBeUndefined();
  });
});
