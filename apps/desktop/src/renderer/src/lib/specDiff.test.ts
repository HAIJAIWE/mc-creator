import { describe, it, expect } from 'vitest';
import { diffSpecValues, summarizeDiff, formatDiffValue } from './specDiff.js';

describe('diffSpecValues', () => {
  it('相同对象无差异', () => {
    const a = { modId: 'test', items: [{ id: 'a' }] };
    expect(diffSpecValues(a, structuredClone(a))).toEqual([]);
  });

  it('标量变化 → changed', () => {
    const entries = diffSpecValues({ name: 'A' }, { name: 'B' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: 'name',
      kind: 'changed',
      oldValue: 'A',
      newValue: 'B',
    });
  });

  it('新增字段 → added', () => {
    const entries = diffSpecValues({ name: 'A' }, { name: 'A', version: '1.0.0' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'version', kind: 'added' });
  });

  it('删除字段 → removed', () => {
    const entries = diffSpecValues({ name: 'A', version: '1.0.0' }, { name: 'A' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'version', kind: 'removed' });
  });

  it('嵌套对象路径拼接', () => {
    const entries = diffSpecValues(
      { items: [{ id: 'a', maxStackSize: 64 }] },
      { items: [{ id: 'a', maxStackSize: 32 }] },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe('items[0].maxStackSize');
  });

  it('数组元素新增/删除', () => {
    const entries = diffSpecValues({ items: [{ id: 'a' }] }, { items: [{ id: 'a' }, { id: 'b' }] });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ path: 'items[1]', kind: 'added' });
  });

  it('类型不同视为 changed', () => {
    const entries = diffSpecValues({ count: 1 }, { count: '1' });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('changed');
  });

  it('null 与 undefined 不同', () => {
    const entries = diffSpecValues({ a: null }, { a: undefined });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe('changed');
  });
});

describe('summarizeDiff', () => {
  it('统计三类数量', () => {
    const entries = [
      { path: 'a', oldValue: 1, newValue: 2, kind: 'changed' as const },
      { path: 'b', oldValue: undefined, newValue: 1, kind: 'added' as const },
      { path: 'c', oldValue: 1, newValue: undefined, kind: 'removed' as const },
    ];
    expect(summarizeDiff(entries)).toEqual({ added: 1, removed: 1, changed: 1 });
  });
});

describe('formatDiffValue', () => {
  it('截断超长字符串', () => {
    const long = 'x'.repeat(200);
    const formatted = formatDiffValue(long);
    expect(formatted.length).toBeLessThan(200);
    expect(formatted.endsWith('…')).toBe(true);
  });

  it('undefined 显示缺失', () => {
    expect(formatDiffValue(undefined)).toBe('<缺失>');
  });

  it('对象序列化', () => {
    expect(formatDiffValue({ a: 1 })).toBe('{"a":1}');
  });
});
