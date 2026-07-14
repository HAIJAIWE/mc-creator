import { describe, it, expect, beforeEach } from 'vitest';
import { fs } from 'memfs';
import { Filesystem } from './index.js';

describe('Filesystem', () => {
  let dfs: Filesystem;
  beforeEach(() => {
    dfs = new Filesystem(fs as any);
  });

  it('原子写入新文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'hello');
    expect(dfs.readFile('/proj/a.txt')).toBe('hello');
  });

  it('原子写入覆盖既有文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'v1');
    await dfs.writeFile('/proj/a.txt', 'v2');
    expect(dfs.readFile('/proj/a.txt')).toBe('v2');
  });

  it('写入失败不破坏原文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'orig');
    // 模拟写入失败：目标路径中间组件是文件而非目录，mkdir recursive 会失败
    // 注：原计划用 /nope/sub/a.txt，但实现用 mkdir recursive 会自动创建父目录导致不抛错
    await expect(dfs.writeFile('/proj/a.txt/sub/x.txt', 'x')).rejects.toThrow();
    expect(dfs.readFile('/proj/a.txt')).toBe('orig');
  });

  it('生成 diff', async () => {
    await dfs.writeFile('/proj/a.txt', 'line1\nline2\n');
    const diff = dfs.diff('/proj/a.txt', 'line1\nlineX\n');
    expect(diff.added).toContain('lineX');
    expect(diff.removed).toContain('line2');
  });

  it('快照后可回滚到之前状态', async () => {
    await dfs.writeFile('/proj/a.txt', 'v1');
    const snap = await dfs.snapshot('/proj');
    await dfs.writeFile('/proj/a.txt', 'v2');
    expect(dfs.readFile('/proj/a.txt')).toBe('v2');
    await dfs.restore(snap);
    expect(dfs.readFile('/proj/a.txt')).toBe('v1');
  });
});
