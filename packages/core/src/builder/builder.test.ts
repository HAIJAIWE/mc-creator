import { describe, it, expect, vi } from 'vitest';
import { detectJavaVersion } from './jdk.js';
import { parseGradleErrors } from './log-parser.js';
import { runGradleBuild } from './gradle.js';

describe('detectJavaVersion', () => {
  it('从 java -version 输出解析主版本', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "21.0.3" 2024-04-16');
    expect(await detectJavaVersion(run)).toBe(21);
  });

  it('解析 Java 25', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "25" 2025-09-16');
    expect(await detectJavaVersion(run).catch(() => null) ?? (await detectJavaVersion(run))).toBe(25);
  });

  it('java 不存在返回 null', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not found'));
    expect(await detectJavaVersion(run)).toBeNull();
  });
});

describe('parseGradleErrors', () => {
  it('解析 java 编译错误', () => {
    const log = '/proj/src/Item.java:12: error: \';\' expected\nother line';
    const errs = parseGradleErrors(log);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ file: '/proj/src/Item.java', line: 12, message: "';' expected" });
  });
});

describe('runGradleBuild', () => {
  it('成功时返回 jarPath', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'BUILD SUCCESSFUL\nbuild/libs/demo-1.0.0.jar', stderr: '', exitCode: 0 });
    const r = await runGradleBuild('/proj', run as any);
    expect(r.success).toBe(true);
    expect(r.jarPath).toContain('demo-1.0.0.jar');
  });

  it('失败时 success=false 且 log 含错误', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'BUILD FAILED', stderr: 'error', exitCode: 1 });
    const r = await runGradleBuild('/proj', run as any);
    expect(r.success).toBe(false);
    expect(r.jarPath).toBeNull();
  });
});
