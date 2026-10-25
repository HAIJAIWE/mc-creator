import { describe, expect, it } from 'vitest';
import { compareMcVersionsDesc } from './mc-version-compare.js';

describe('compareMcVersionsDesc', () => {
  it('按数字段比较，1.21.11 排在 1.21.9 前面', () => {
    expect(['1.21.9', '1.21.11', '1.21.10'].sort(compareMcVersionsDesc)).toEqual([
      '1.21.11',
      '1.21.10',
      '1.21.9',
    ]);
  });

  it('正式版排在 RC 前面，RC 之间按编号倒序', () => {
    expect(['26.2-rc-1', '26.2', '26.2-rc-2'].sort(compareMcVersionsDesc)).toEqual([
      '26.2',
      '26.2-rc-2',
      '26.2-rc-1',
    ]);
  });

  it('snapshot 也参与排序，不会因为后缀是 NaN 停在原地', () => {
    expect(
      ['26.3', '26.4-snapshot-3', '26.4-snapshot-4', '26.1'].sort(compareMcVersionsDesc),
    ).toEqual(['26.4-snapshot-4', '26.4-snapshot-3', '26.3', '26.1']);
  });

  it('不同长度的核心版本按缺省 0 补齐', () => {
    expect(['1.21', '1.21.1', '1.20.6'].sort(compareMcVersionsDesc)).toEqual([
      '1.21.1',
      '1.21',
      '1.20.6',
    ]);
  });
});
