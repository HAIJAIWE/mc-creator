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
    expect((await detectJavaVersion(run).catch(() => null)) ?? (await detectJavaVersion(run))).toBe(
      25,
    );
  });

  it('java 不存在返回 null', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not found'));
    expect(await detectJavaVersion(run)).toBeNull();
  });
});

describe('parseGradleErrors', () => {
  it('解析 java 编译错误', () => {
    const log = "/proj/src/Item.java:12: error: ';' expected\nother line";
    const errs = parseGradleErrors(log);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({
      file: '/proj/src/Item.java',
      line: 12,
      message: "';' expected",
    });
  });
});

describe('runGradleBuild', () => {
  // 主代理说明：这两条既有用例**断言一字未改**，只补第三个参数（wrapper 自举注入点）。
  // 原因：不注入的话默认实现会对假路径 `/proj` 真的去下载 130MB Gradle 发行版，
  // 单测就变成联网测试。新增的自举行为另有专门用例覆盖（下方）。
  const okWrapper = async (): Promise<{ ok: boolean }> => ({ ok: true });

  it('成功时返回 jarPath', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: 'BUILD SUCCESSFUL\nbuild/libs/demo-1.0.0.jar',
      stderr: '',
      exitCode: 0,
    });
    const r = await runGradleBuild('/proj', run as any, okWrapper);
    expect(r.success).toBe(true);
    expect(r.jarPath).toContain('demo-1.0.0.jar');
  });

  it('失败时 success=false 且 log 含错误', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'BUILD FAILED', stderr: 'error', exitCode: 1 });
    const r = await runGradleBuild('/proj', run as any, okWrapper);
    expect(r.success).toBe(false);
    expect(r.jarPath).toBeNull();
  });

  it('wrapper 自举失败时不 spawn，并把原因写进 log', async () => {
    const run = vi.fn();
    const r = await runGradleBuild('/proj', run as any, async () => ({
      ok: false,
      error: 'Gradle 8.12 不支持 JDK 26',
    }));
    expect(r.success).toBe(false);
    expect(r.jarPath).toBeNull();
    expect(r.log).toContain('Gradle wrapper 准备失败');
    expect(r.log).toContain('不支持 JDK 26');
    // 关键：自举失败绝不能还去 spawn —— 那只会得到一个更难懂的 ENOENT。
    expect(run).not.toHaveBeenCalled();
  });

  it('自举先于 spawn 发生（顺序断言）', async () => {
    const order: string[] = [];
    await runGradleBuild(
      '/proj',
      (async () => {
        order.push('spawn');
        return { stdout: 'ok', stderr: '', exitCode: 0 };
      }) as any,
      async () => {
        order.push('ensure');
        return { ok: true };
      },
    );
    expect(order).toEqual(['ensure', 'spawn']);
  });
});
