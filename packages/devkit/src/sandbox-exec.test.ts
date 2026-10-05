/**
 * sandbox-exec 单元测试（设计文档 §8.3 进程级隔离的实施者）。
 *
 * 覆盖三件事：
 *  1. `filterEnv` 真的按白名单筛（这是 gradle.ts 曾缺失的强制项）
 *  2. 隔离不可用时**降级但不假装**——enforced 字段必须据实标注
 *  3. 隔离可用时走 launcher，且退出码/超时语义正确
 *
 * 真实 Job Object 的强制能力由 @mc-creator/jobobject 自己的测试覆盖
 * （内存上限、整树终止），这里不重复造进程。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filterEnv, runSandboxed, type JobObjectModule } from './sandbox-exec.js';
import { buildSandboxOptions } from './sandbox.js';

/** 假的 jobobject 模块（不碰真二进制）。 */
function fakeJob(available: boolean, reason: string | null = null): JobObjectModule {
  return { available, reason };
}

/**
 * 真实的临时沙箱根。
 *
 * 不能用 'D:\\sandbox-root' 这种假路径：spawn 在 cwd 不存在时直接 ENOENT，
 * 会被误读成「隔离降级导致命令失败」（第一版就踩了这个坑，症状是
 * exitCode=null / success=false）。
 */
const REAL_ROOT = mkdtempSync(path.join(tmpdir(), 'sandbox-exec-'));

function sandbox(overrides: { limits?: { timeoutMs: number } } = {}) {
  return buildSandboxOptions(REAL_ROOT, {
    ...(overrides.limits === undefined ? {} : { limits: overrides.limits }),
  });
}

describe('runGradleBuild 的调用方：env 白名单含 GRADLE_USER_HOME', () => {
  // 不是测 runGradleBuild 本身（devkit.test.ts 已覆盖），而是钉住
  // 「内核传下来的白名单」这一层：GRADLE_USER_HOME 决定 Gradle 的依赖缓存
  // 位置，少了它每次构建都要重下依赖；但它也是路径，必须受 assertWithinRoot
  // 与 sandbox cwd 约束，不能由构建脚本随意指向别处。
  it('白名单是显式列表而非全量继承', () => {
    const src = {
      PATH: '/bin',
      JAVA_HOME: '/jdk',
      GRADLE_USER_HOME: '/cache/gradle',
      GRADLE_OPTS: '-Xmx1g',
      // 以下都**不该**进白名单
      AWS_SECRET_ACCESS_KEY: 'leak',
      GITHUB_TOKEN: 'leak',
    };
    const allowlist = ['PATH', 'JAVA_HOME', 'GRADLE_USER_HOME', 'GRADLE_OPTS'];
    const got = filterEnv(allowlist, src);
    expect(Object.keys(got).sort()).toEqual(
      ['GRADLE_OPTS', 'GRADLE_USER_HOME', 'JAVA_HOME', 'PATH'].sort(),
    );
    expect(got).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
    expect(got).not.toHaveProperty('GITHUB_TOKEN');
  });
});

describe('filterEnv：按 envAllowlist 过滤（§8.3 实际强制项）', () => {
  it('只保留白名单内的变量（凭据类变量被剔除）', () => {
    const got = filterEnv(['PATH', 'JAVA_HOME'], {
      PATH: '/bin',
      SECRET_TOKEN: 'leak',
      JAVA_HOME: '/jdk',
    });
    expect(got.PATH).toBe('/bin');
    expect(got.JAVA_HOME).toBe('/jdk');
    // 这是 gradle.ts:84 `env = { ...process.env }` 从未做到的事。
    expect(got).not.toHaveProperty('SECRET_TOKEN');
  });

  it('白名单里存在但源里没有的变量被跳过（不写入 undefined）', () => {
    const got = filterEnv(['PATH', 'NOT_SET'], { PATH: '/bin' });
    expect(got.PATH).toBe('/bin');
    expect(Object.prototype.hasOwnProperty.call(got, 'NOT_SET')).toBe(false);
  });

  it('隐式保留 SystemRoot/TEMP：缺了它们 Windows 上子进程根本起不来', () => {
    // 这条是「为什么 filterEnv 不是纯白名单」的证据。Windows 的 CreateProcess
    // 依赖 SystemRoot 解析 DLL 搜索路径，删掉它子进程会以 ENOENT/134 失败 ——
    // 也就是说，收紧 env 本身会变成故障源。
    const src = { PATH: '/bin', SystemRoot: 'C:\\WINDOWS', TEMP: 'C:\\Temp' };
    const got = filterEnv(['PATH'], src);
    expect(got.SystemRoot).toBe('C:\\WINDOWS');
    expect(got.TEMP).toBe('C:\\Temp');
  });

  it('源里没有隐式项时不写入 undefined（不制造 SystemRoot: undefined）', () => {
    const got = filterEnv(['PATH'], { PATH: '/bin' });
    // 若写成 out[key] = undefined，Windows 上会把子进程的环境变量变成字符串
    // "undefined"，比缺变量更难排查。
    expect(Object.prototype.hasOwnProperty.call(got, 'SystemRoot')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(got, 'TEMP')).toBe(false);
  });

  it('空 env 与空白名单不会回退成继承父进程环境', () => {
    expect(filterEnv([], {})).toEqual({});
    // 关键：没有白名单 ≠ 变成全量继承。
    expect(Object.keys(filterEnv([], { PATH: '/bin', SECRET_TOKEN: 'leak' }))).not.toContain(
      'SECRET_TOKEN',
    );
  });
});

describe('runSandboxed：隔离不可用时降级且据实标注', () => {
  const realNode = process.execPath;

  it('jobobject 不可用 → source=unisolated 且带中文 reason', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 20000 } }),
        file: realNode,
        args: ['-e', 'process.exit(0)'],
        env: ENV,
      },
      { loadJobObject: () => fakeJob(false, '未找到已编译的 jobobject.node') },
    );
    expect(r.enforced.source).toBe('unisolated');
    expect(r.enforced.memory).toBe(false);
    expect(r.enforced.cpu).toBe(false);
    expect(r.enforced.treeKill).toBe(false);
    expect(r.enforced.reason).toContain('未找到已编译');
    // 关键：不能因为降级就把命令判成失败 —— 功能仍要可用。
    expect(r.success).toBe(true);
  });

  it('network 恒为 false，即使声称禁网（Job Object 管不到网络）', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 20000 } }),
        file: realNode,
        args: ['-e', 'process.exit(0)'],
        env: ENV,
      },
      { loadJobObject: () => fakeJob(false, 'x') },
    );
    // 类型上就是字面量 false；这里钉住它不被悄悄改成 true。
    expect(r.enforced.network).toBe(false);
  });

  it('jobobject 模块整个 require 失败（抛错）也降级，不把异常抛给调用方', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 20000 } }),
        file: realNode,
        args: ['-e', 'process.exit(0)'],
        env: ENV,
      },
      {
        loadJobObject: () => {
          throw new Error('Cannot find module @mc-creator/jobobject');
        },
      },
    );
    expect(r.enforced.source).toBe('unisolated');
    expect(r.success).toBe(true);
  });

  it('隔离路径下退出码透传（构建失败不能被误报成成功）', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 20000 } }),
        file: realNode,
        args: ['-e', 'process.exit(7)'],
        env: ENV,
      },
      { loadJobObject: () => fakeJob(false, 'x') },
    );
    expect(r.exitCode).toBe(7);
    expect(r.success).toBe(false);
  });

  it('超时被如实标记 timedOut 且不误报成功', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 300 } }),
        file: realNode,
        args: ['-e', 'setTimeout(()=>{},60000)'],
        env: ENV,
      },
      { loadJobObject: () => fakeJob(false, 'x') },
    );
    expect(r.timedOut).toBe(true);
    expect(r.success).toBe(false);
  });
});

/** Windows 上必须有 SystemRoot，否则子进程 ENOENT（见 filterEnv 的说明）。 */
const ENV = {
  PATH: process.env['PATH'] ?? '',
  ...(process.env['SystemRoot'] === undefined ? {} : { SystemRoot: process.env['SystemRoot'] }),
  ...(process.env['TEMP'] === undefined ? {} : { TEMP: process.env['TEMP'] }),
};

describe('runSandboxed：隔离不可用时降级且据实标注', () => {
  const realNode = process.execPath;
  // 真的 launcher 脚本路径（不伪造 —— 伪造就测不到协议是否真对上）。
  // 注意用 fileURLToPath 而不是 import.meta.url.pathname：仓库路径含空格
  // （"D:\MC mod"），pathname 会是 "D:\MC%20mod\..."，直接 spawn 会
  // 报 Cannot find module 'D:\MC%20mod\...'。
  const launcher = fileURLToPath(new URL('../../jobobject/launcher.js', import.meta.url));

  it('launcher 不可解析 → 降级并说明原因', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 20000 } }),
        file: realNode,
        args: ['-e', 'process.exit(0)'],
        env: ENV,
      },
      {
        loadJobObject: () => fakeJob(true),
        resolveLauncher: () => {
          throw new Error('Cannot find launcher');
        },
      },
    );
    expect(r.enforced.source).toBe('unisolated');
    expect(r.enforced.reason).toContain('launcher');
  });

  it('真实 launcher：退出码透传 + 日志可收 + enforced 报 job-object', async () => {
    const r = await runSandboxed(
      {
        sandbox: sandbox({ limits: { timeoutMs: 30000 } }),
        file: realNode,
        args: ['-e', 'console.log("SANDBOX-LOG-OK");process.exit(3)'],
        env: ENV,
      },
      { loadJobObject: () => fakeJob(true), resolveLauncher: () => launcher },
    );
    // 若 launcher 协议对不上，这里会是 78（不可用）而不是 3。
    expect(r.log).toContain('SANDBOX-LOG-OK');
    expect(r.exitCode).toBe(3);
    expect(r.enforced.source).toBe('job-object');
    expect(r.enforced.network).toBe(false);
  }, 40000);
});
