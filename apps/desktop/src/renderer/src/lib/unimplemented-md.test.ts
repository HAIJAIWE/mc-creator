import { describe, it, expect } from 'vitest';
import { buildUnimplementedMd, withUnimplementedMd } from './unimplemented-md.js';

describe('unimplemented-md', () => {
  it('空清单返回 null / 原样返回文件', () => {
    expect(buildUnimplementedMd([])).toBeNull();
    const files = [{ path: 'a.txt', content: 'x' }];
    expect(withUnimplementedMd(files, [])).toBe(files);
  });

  it('有条目时生成 UNIMPLEMENTED.md', () => {
    const files = [{ path: 'a.txt', content: 'x' }];
    const out = withUnimplementedMd(files, [
      { kind: 'event', type: 'custom', id: 'h1', reason: 'R' },
    ]);
    expect(out.length).toBe(2);
    expect(out[1].path).toBe('UNIMPLEMENTED.md');
    expect(out[1].content).toContain('event = custom');
    expect(out[1].content).toContain('docs/unsupported.md');
  });
});
