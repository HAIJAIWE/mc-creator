/**
 * devkit 单元测试（设计文档 §8 开发内核）。
 * 纯函数为主；gradle 超时用“假 gradlew 脚本”做慢进程/成功进程夹具，
 * 不依赖真实 JDK/Gradle，不触网。
 */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { detectJavaVersion, javaVersionFor, resolveJavaHome } from './jdk.js';
import { findBuiltJar, findJarInLog, runGradleBuild, verifyDistribution } from './gradle.js';
import { assertWithinRoot, buildSandboxOptions } from './sandbox.js';
import { makeArtifactRef, sha256File } from './artifact.js';

const IS_WIN = process.platform === 'win32';

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** 写一个假 gradlew：win=bat，posix=sh；返回工程目录。 */
async function makeFakeProject(script: string): Promise<string> {
  const dir = await makeTempDir('devkit-gradle-');
  if (IS_WIN) {
    await writeFile(path.join(dir, 'gradlew.bat'), script, 'utf8');
  } else {
    const p = path.join(dir, 'gradlew');
    await writeFile(p, script, { encoding: 'utf8', mode: 0o755 });
    await chmod(p, 0o755);
  }
  return dir;
}

describe('jdk.ts 版本映射（§5：1.20.x→17，1.21.x→21，26.x→25）', () => {
  it('1.20.x → 17', () => {
    expect(javaVersionFor('1.20.1')).toBe(17);
    expect(javaVersionFor('1.20')).toBe(17);
  });

  it('1.21.x → 21', () => {
    expect(javaVersionFor('1.21')).toBe(21);
    expect(javaVersionFor('1.21.4')).toBe(21);
  });

  it('26.x → 25（§8.4 年份体系）', () => {
    expect(javaVersionFor('26.1')).toBe(25);
    expect(javaVersionFor('26.1.2')).toBe(25);
  });

  it('远古版 → 8', () => {
    expect(javaVersionFor('1.16.5')).toBe(8);
    expect(javaVersionFor('1.12.2')).toBe(8);
  });

  it('resolveJavaHome：未配置/空白 → null，正常 → 去空白路径', () => {
    expect(resolveJavaHome({})).toBeNull();
    expect(resolveJavaHome({ JAVA_HOME: '   ' })).toBeNull();
    expect(resolveJavaHome({ JAVA_HOME: ' C:\\jdk-21 ' })).toBe('C:\\jdk-21');
  });

  it('detectJavaVersion：保留 core 正则逻辑（21.0.3 与裸 25 均命中）', async () => {
    await expect(
      detectJavaVersion(async () => 'openjdk version "21.0.3" 2024-04-16'),
    ).resolves.toBe(21);
    await expect(detectJavaVersion(async () => 'openjdk version "25" 2025-09-16')).resolves.toBe(
      25,
    );
  });

  it('detectJavaVersion：无匹配/抛错 → null', async () => {
    await expect(detectJavaVersion(async () => 'no java here')).resolves.toBeNull();
    await expect(
      detectJavaVersion(async () => {
        throw new Error('ENOENT');
      }),
    ).resolves.toBeNull();
  });
});

describe('sandbox.ts 路径监狱（§13.1 zip-slip 防护）', () => {
  it('目录内路径放行并返回绝对路径', () => {
    const root = IS_WIN ? 'D:\\srv\\sandbox' : '/srv/sandbox';
    const got = assertWithinRoot(root, path.join('build', 'libs', 'a.jar'));
    expect(path.isAbsolute(got)).toBe(true);
    expect(got.startsWith(path.resolve(root))).toBe(true);
  });

  it('../ 越界拒绝', () => {
    const root = IS_WIN ? 'D:\\srv\\sandbox' : '/srv/sandbox';
    expect(() => assertWithinRoot(root, path.join('..', 'evil.jar'))).toThrow(/escapes root/);
  });

  it('绝对路径逃逸拒绝', () => {
    const root = IS_WIN ? 'D:\\srv\\sandbox' : '/srv/sandbox';
    const outside = IS_WIN ? 'D:\\srv\\other\\x.jar' : '/srv/other/x.jar';
    expect(() => assertWithinRoot(root, outside)).toThrow(/escapes root/);
  });

  it('buildSandboxOptions：默认无网络 + cwd=root + 要求产物哈希（§8.3）', () => {
    const o = buildSandboxOptions(IS_WIN ? 'D:\\srv\\s1' : '/srv/s1');
    expect(o.allowNetwork).toBe(false);
    expect(o.cwd).toBe(o.root);
    expect(o.requireArtifactHash).toBe(true);
    expect(o.limits.timeoutMs).toBeGreaterThan(0);
  });

  it('buildSandboxOptions：cwd 越界同样拒绝', () => {
    expect(() => buildSandboxOptions(IS_WIN ? 'D:\\srv\\s1' : '/srv/s1', { cwd: '..' })).toThrow(
      /escapes root/,
    );
  });
});

describe('artifact.ts 产物哈希（§0.5#5 对外可见）', () => {
  it('sha256File 已知向量（"abc"）', async () => {
    const dir = await makeTempDir('devkit-hash-');
    try {
      const f = path.join(dir, 'a.txt');
      await writeFile(f, 'abc', 'utf8');
      await expect(sha256File(f)).resolves.toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('makeArtifactRef：kind 透传 + 哈希一致', async () => {
    const dir = await makeTempDir('devkit-artifact-');
    try {
      const f = path.join(dir, 'mod.jar');
      await writeFile(f, 'fake-jar-bytes', 'utf8');
      const ref = await makeArtifactRef(f, 'build-artifact');
      expect(ref.kind).toBe('build-artifact');
      expect(ref.path).toBe(f);
      expect(ref.sha256).toBe(await sha256File(f));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('gradle.ts 改进版（相对 core 反面教材：超时+磁盘扫描）', () => {
  it('verifyDistribution：一致 → match=true', async () => {
    const dir = await makeTempDir('devkit-dist-');
    try {
      const f = path.join(dir, 'gradle-8.14.3-bin.zip');
      await writeFile(f, 'dist-bytes', 'utf8');
      const expected = await sha256File(f);
      await expect(verifyDistribution(f, expected)).resolves.toEqual({
        actual: expected,
        match: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('verifyDistribution：不一致/未提供期望 → match=false（占位行为）', async () => {
    const dir = await makeTempDir('devkit-dist2-');
    try {
      const f = path.join(dir, 'x.zip');
      await writeFile(f, 'dist-bytes', 'utf8');
      const bad = await verifyDistribution(f, '0'.repeat(64));
      expect(bad.match).toBe(false);
      expect(bad.actual).toHaveLength(64);
      const empty = await verifyDistribution(f, '');
      expect(empty.match).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('findJarInLog：日志正则仅回退（排除 -sources/-javadoc）', () => {
    const root = IS_WIN ? 'D:\\proj' : '/proj';
    const log = 'wrote build/libs/my-mod-1.0-sources.jar\nwrote build/libs/my-mod-1.0.jar\n';
    expect(findJarInLog(root, log)?.endsWith('my-mod-1.0.jar')).toBe(true);
    expect(findJarInLog(root, 'nothing here')).toBeNull();
  });

  it('runGradleBuild：成功后磁盘扫描找到 jar', async () => {
    const script = IS_WIN
      ? '@echo off\r\nmkdir build\\libs 2>nul\r\necho fake> build\\libs\\demo-1.0.jar\r\nexit /b 0\r\n'
      : '#!/bin/sh\nmkdir -p build/libs\necho fake > build/libs/demo-1.0.jar\n';
    const dir = await makeFakeProject(script);
    try {
      const r = await runGradleBuild(dir, { timeoutMs: 15_000 });
      expect(r.success).toBe(true);
      expect(r.timedOut).toBe(false);
      expect(r.jarPath?.endsWith('demo-1.0.jar')).toBe(true);
      // 磁盘扫描优先：直接用 findBuiltJar 复核同一结论
      expect(await findBuiltJar(dir)).toBe(r.jarPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runGradleBuild：超时杀死慢进程（timedOut=true）', async () => {
    // 注：不用 timeout.exe——其 stdin 被管道重定向时直接报错退出；
    // ping -n 倒数是无 stdin 依赖的经典 sleep 替代。
    const script = IS_WIN ? '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n' : '#!/bin/sh\nsleep 30\n';
    const dir = await makeFakeProject(script);
    try {
      const started = Date.now();
      const r = await runGradleBuild(dir, { timeoutMs: 800 });
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(r.success).toBe(false);
      expect(r.timedOut).toBe(true);
      expect(r.jarPath).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runGradleBuild：用户 signal 取消（timedOut=false）', async () => {
    const script = IS_WIN ? '@echo off\r\nping -n 30 127.0.0.1 >nul\r\n' : '#!/bin/sh\nsleep 30\n';
    const dir = await makeFakeProject(script);
    try {
      const c = new AbortController();
      setTimeout(() => c.abort(), 500);
      const r = await runGradleBuild(dir, { timeoutMs: 15_000, signal: c.signal });
      expect(r.success).toBe(false);
      expect(r.timedOut).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // §8.2 daemon pin + offline 开关：假 gradlew 把收到的参数原样写进 args.txt，
  // 断言读的是“子进程实际收到的”，不是拼 args 数组的中间变量。
  async function runAndReadArgs(extraOpts: Record<string, unknown> = {}): Promise<string[]> {
    const script = IS_WIN
      ? '@echo off\r\necho %* > args.txt\r\nexit /b 0\r\n'
      : '#!/bin/sh\necho "$@" > args.txt\n';
    const dir = await makeTempDir('devkit-args-');
    try {
      if (IS_WIN) {
        await writeFile(path.join(dir, 'gradlew.bat'), script, 'utf8');
      } else {
        const p = path.join(dir, 'gradlew');
        await writeFile(p, script, { encoding: 'utf8', mode: 0o755 });
        await chmod(p, 0o755);
      }
      const r = await runGradleBuild(dir, { timeoutMs: 15_000, ...extraOpts });
      expect(r.success).toBe(true);
      const { readFile } = await import('node:fs/promises');
      return (await readFile(path.join(dir, 'args.txt'), 'utf8')).trim().split(/\s+/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('runGradleBuild：默认追加 --daemon（§8.2 常驻，不默认 offline）', async () => {
    const argv = await runAndReadArgs();
    expect(argv).toContain('build');
    expect(argv).toContain('--quiet');
    expect(argv).toContain('--daemon');
    expect(argv).not.toContain('--offline');
    expect(argv).not.toContain('--no-daemon');
  });

  it('runGradleBuild：offline=true 追加 --offline', async () => {
    const argv = await runAndReadArgs({ offline: true });
    expect(argv).toContain('--offline');
    expect(argv).toContain('--daemon');
  });

  it('runGradleBuild：调用方显式 --no-daemon 时不覆盖', async () => {
    const argv = await runAndReadArgs({ args: ['build', '--no-daemon'] });
    expect(argv).toContain('--no-daemon');
    expect(argv).not.toContain('--daemon');
  });
});
