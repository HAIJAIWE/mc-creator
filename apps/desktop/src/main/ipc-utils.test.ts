import { describe, it, expect } from 'vitest';
import { assertWithin, parseGitStatus } from './ipc-utils.js';

describe('assertWithin', () => {
  it('base 内的子路径通过', () => {
    expect(() => assertWithin('/tmp/base', 'sub/file.txt')).not.toThrow();
    expect(() => assertWithin('/tmp/base', './sub/file.txt')).not.toThrow();
  });

  it('base 自身通过（rel 为 "."）', () => {
    expect(() => assertWithin('/tmp/base', '.')).not.toThrow();
    expect(() => assertWithin('/tmp/base', '')).not.toThrow();
  });

  it('.. 穿越父目录抛错', () => {
    expect(() => assertWithin('/tmp/base', '../etc/passwd')).toThrow(/非法路径/);
    expect(() => assertWithin('/tmp/base', '../../etc/passwd')).toThrow(/非法路径/);
  });

  it('绝对路径逃逸出 base 抛错', () => {
    expect(() => assertWithin('/tmp/base', '/etc/passwd')).toThrow(/非法路径/);
  });

  it('伪装的穿越（中间含 ..）抛错', () => {
    expect(() => assertWithin('/tmp/base', 'sub/../../etc/passwd')).toThrow(/非法路径/);
  });

  it('Windows 风格路径（drive letter）', () => {
    expect(() => assertWithin('C:\\Users\\base', 'file.txt')).not.toThrow();
    expect(() => assertWithin('C:\\Users\\base', '..\\..\\Windows')).toThrow(/非法路径/);
  });
});

describe('parseGitStatus', () => {
  it('空输入返回 null 分支、无文件、clean=true', () => {
    const r = parseGitStatus('');
    expect(r).toEqual({
      branch: null,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: [],
      clean: true,
    });
  });

  it('只有分支行（无 upstream、无 ahead/behind）', () => {
    const r = parseGitStatus('## main\n');
    expect(r.branch).toBe('main');
    expect(r.upstream).toBeNull();
    expect(r.ahead).toBe(0);
    expect(r.behind).toBe(0);
    expect(r.files).toEqual([]);
    expect(r.clean).toBe(true);
  });

  it('分支行带 upstream', () => {
    const r = parseGitStatus('## main...origin/main\n');
    expect(r.branch).toBe('main');
    expect(r.upstream).toBe('origin/main');
  });

  it('分支行带 ahead/behind [ahead 2, behind 1]', () => {
    const r = parseGitStatus('## main...origin/main [ahead 2, behind 1]\n');
    expect(r.branch).toBe('main');
    expect(r.upstream).toBe('origin/main');
    expect(r.ahead).toBe(2);
    expect(r.behind).toBe(1);
  });

  it('仅 ahead 无 behind', () => {
    const r = parseGitStatus('## main...origin/main [ahead 3]\n');
    expect(r.ahead).toBe(3);
    expect(r.behind).toBe(0);
  });

  it('分支行带 (no branch) detached HEAD 标记被剥离', () => {
    const r = parseGitStatus('## HEAD (no branch)\n');
    // branchPart = "HEAD"（"(no branch)" 被正则去掉）
    expect(r.branch).toBe('HEAD');
  });

  it('暂存修改（M）文件行', () => {
    const r = parseGitStatus('## main\n M src/index.ts\n');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toEqual({ x: ' ', y: 'M', path: 'src/index.ts', origPath: undefined });
    expect(r.clean).toBe(false);
  });

  it('新增（A）与删除（D）文件行', () => {
    const r = parseGitStatus('## main\nA  new-file.ts\n D deleted-file.ts\n');
    expect(r.files).toHaveLength(2);
    expect(r.files[0]).toEqual({ x: 'A', y: ' ', path: 'new-file.ts', origPath: undefined });
    expect(r.files[1]).toEqual({ x: ' ', y: 'D', path: 'deleted-file.ts', origPath: undefined });
  });

  it('重命名（R）文件行解析 origPath', () => {
    const r = parseGitStatus('## main\nR  old-name.ts -> new-name.ts\n');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toEqual({
      x: 'R',
      y: ' ',
      path: 'new-name.ts',
      origPath: 'old-name.ts',
    });
  });

  it('未跟踪（??）文件行', () => {
    const r = parseGitStatus('## main\n?? untracked.ts\n');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toEqual({ x: '?', y: '?', path: 'untracked.ts', origPath: undefined });
    expect(r.clean).toBe(false);
  });

  it('综合：分支 + ahead/behind + 多文件', () => {
    const raw = [
      '## feature...origin/feature [ahead 1, behind 2]',
      'M  modified.ts',
      ' A added.ts',
      '?? new.ts',
      'R  old.ts -> renamed.ts',
      '',
    ].join('\n');
    const r = parseGitStatus(raw);
    expect(r.branch).toBe('feature');
    expect(r.upstream).toBe('origin/feature');
    expect(r.ahead).toBe(1);
    expect(r.behind).toBe(2);
    expect(r.files).toHaveLength(4);
    expect(r.clean).toBe(false);
    expect(r.files.map((f) => f.path)).toEqual(['modified.ts', 'added.ts', 'new.ts', 'renamed.ts']);
  });

  it('多行文件路径含空格保留', () => {
    const r = parseGitStatus('## main\n M path with spaces/file.ts\n');
    expect(r.files[0].path).toBe('path with spaces/file.ts');
  });
});
