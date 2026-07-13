import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from './registry.js';
import type { Generator } from './types.js';

const modGen = (loaders: any[], versions: any[]): Generator => ({
  type: 'mod',
  loaders,
  versions,
  generate: async () => ({ files: [], warnings: [], buildCmd: '' }),
});

describe('GeneratorRegistry', () => {
  it('注册后可按 type 取', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.get('mod')?.type).toBe('mod');
  });

  it('find 匹配 loader+版本', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric', 'neoforge'], ['1.21.11']));
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeUndefined();
  });

  it('list 返回全部', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.list()).toHaveLength(1);
  });
});
