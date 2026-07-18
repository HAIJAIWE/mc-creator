import { describe, it, expect, vi } from 'vitest';
import { fs as memfs } from 'memfs';
import { Filesystem } from '../filesystem/index.js';
import { BuildFixer } from './build-fixer.js';
import { MockProvider } from '../model-provider/mock-provider.js';

vi.mock('./gradle.js', () => ({
  runGradleBuild: vi.fn(),
}));

import { runGradleBuild } from './gradle.js';

describe('BuildFixer', () => {
  function makeFixer(response: string) {
    const dfs = new Filesystem(memfs as any);
    const provider = new MockProvider(response);
    return new BuildFixer(dfs, provider);
  }

  it('首次构建成功直接返回', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: true,
      jarPath: 'build/libs/mod.jar',
      log: 'BUILD SUCCESSFUL',
    });
    const fixer = makeFixer('');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(0);
  });

  it('构建失败 + AI 修复后成功', async () => {
    vi.mocked(runGradleBuild)
      .mockResolvedValueOnce({
        success: false,
        jarPath: null,
        log: "/proj/src/main/java/ModItems.java:10: error: ';' expected",
      })
      .mockResolvedValueOnce({ success: true, jarPath: 'build/libs/mod.jar', log: 'ok' });

    const fixer = makeFixer('=== FILE: src/main/java/ModItems.java ===\npublic class ModItems {}');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.fixLog.length).toBe(1);
  });

  it('3 次修复仍失败返回 false', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: false,
      jarPath: null,
      log: '/proj/src/ModItems.java:1: error: cannot find symbol',
    });
    const fixer = makeFixer('=== FILE: src/ModItems.java ===\nclass X {}');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('无法解析错误时直接返回', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: false,
      jarPath: null,
      log: 'Some unknown error without file:line format',
    });
    const fixer = makeFixer('');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
  });
});
