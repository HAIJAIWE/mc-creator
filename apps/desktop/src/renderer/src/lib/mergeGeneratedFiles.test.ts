import { describe, it, expect } from 'vitest';
import { mergeGeneratedFiles } from './mergeGeneratedFiles.js';

describe('mergeGeneratedFiles（B 桥文件合并保护）', () => {
  it('无手改：全部用生成内容', () => {
    const { files, preserved } = mergeGeneratedFiles(
      [
        { path: 'a.java', content: 'newA' },
        { path: 'b.json', content: 'newB' },
      ],
      [
        { path: 'a.java', content: 'oldA' },
        { path: 'old.java', content: 'old' },
      ],
      new Set(),
    );
    expect(files.map((f) => f.path)).toEqual(['a.java', 'b.json']);
    expect(files[0].content).toBe('newA');
    expect(preserved).toHaveLength(0);
  });

  it('手改文件（dirty）保留旧内容并进入 preserved', () => {
    const { files, preserved } = mergeGeneratedFiles(
      [
        { path: 'a.java', content: 'newA' },
        { path: 'b.json', content: 'newB' },
      ],
      [{ path: 'a.java', content: '手改内容' }],
      new Set(['a.java']),
    );
    const a = files.find((f) => f.path === 'a.java');
    expect(a?.content).toBe('手改内容');
    expect(files.find((f) => f.path === 'b.json')?.content).toBe('newB');
    expect(preserved).toEqual(['a.java']);
  });

  it('手改且不在新产物中的文件被保留（不丢失）', () => {
    const { files, preserved } = mergeGeneratedFiles(
      [{ path: 'a.java', content: 'newA' }],
      [{ path: 'dirty-old.txt', content: '手改存档' }],
      new Set(['dirty-old.txt']),
    );
    expect(files.map((f) => f.path)).toContain('dirty-old.txt');
    expect(files.find((f) => f.path === 'dirty-old.txt')?.content).toBe('手改存档');
    expect(preserved).toEqual(['dirty-old.txt']);
  });
});
