/**
 * launcher.js 协议测试。
 *
 * launcher 是 §8.3 隔离的「实施者」入口，它有两条不能混的路径：
 *  - 二进制可用：正常跑，且**退出码透传**给上层
 *  - 二进制不可用：退 78，让上层降级并如实标注 enforced=false
 *
 * 退出码透传尤其重要：上层据此判断构建成功与否，如果 launcher 吞掉退出码，
 * 「构建失败」会被误报成「构建成功」。
 */

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LAUNCHER = require.resolve('../launcher.js');
const jobobject = require('../index.js');

/** 上层据此判定「没隔离上」；与真实退出码区分开。 */
const EXIT_UNAVAILABLE = 78;

/**
 * 真实父进程环境：包含 SystemRoot / TEMP，外加一个「不该泄露」的哨兵变量。
 * 哨兵用来证明白名单过滤真的在筛，而不是碰巧什么都没传。
 */
function parentEnv() {
  return {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    MC_CREATOR_SHOULD_NOT_LEAK: 'secret-value',
  };
}

function run(payload, env = parentEnv()) {
  return spawnSync(process.execPath, [LAUNCHER, JSON.stringify(payload)], {
    encoding: 'utf8',
    env,
  });
}

describe('launcher.js 协议', () => {
  it('二进制不可用时退 78 并在 stderr 说明原因（绝不静默假装隔离成功）', () => {
    if (jobobject.available) {
      expect(jobobject.reason).toBeNull();
      return;
    }
    const r = run({ file: process.execPath, args: ['-e', 'process.exit(0)'], env: {} });
    expect(r.status).toBe(EXIT_UNAVAILABLE);
    // 关键：不能返回 0。返回 0 等于告诉上层「跑成功了且已隔离」。
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('隔离不可用');
  });

  it('二进制可用时退出码透传：0 与 7 都必须原样传出', () => {
    if (!jobobject.available) return;

    const ok = run({ file: process.execPath, args: ['-e', 'process.exit(0)'], env: {} });
    expect(ok.status).toBe(0);

    const bad = run({ file: process.execPath, args: ['-e', 'process.exit(7)'], env: {} });
    // 构建失败若被误报成成功，上层会拿着不存在的 jar 继续往下走。
    expect(bad.status).toBe(7);
  });

  it('子进程 stdout 穿透到 launcher 的 stdout（上层靠它收 Gradle 日志）', () => {
    if (!jobobject.available) return;
    const r = run({
      file: process.execPath,
      args: ['-e', 'console.log("LOG-LINE-OK")'],
      env: {},
    });
    expect(r.stdout).toContain('LOG-LINE-OK');
  });

  it('env 白名单生效：未列入的父进程变量不传给子进程', () => {
    if (!jobobject.available) return;
    const r = run({
      file: process.execPath,
      args: ['-e', 'process.stdout.write(String(process.env.MC_CREATOR_SHOULD_NOT_LEAK))'],
      env: {},
    });
    // gradle.ts:84 曾经是 env = { ...process.env } —— 全量透传父进程环境。
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('secret-value');
  });

  it('SystemRoot 缺失时子进程起不来（134）—— 这就是它必须被隐式保留的原因', () => {
    // 成因证明，不是重复断言：把 SystemRoot 从父进程环境里去掉，
    // launcher 就没有可保留的东西，子进程必然以 134 启动失败。
    // 实测逐一保留候选变量时，只有带 SystemRoot 才起得来（退 0），
    // 只带 windir / TEMP / ComSpec / PATHEXT 一律退 134。
    // 解构出 SystemRoot 只为把它从环境里剔除；用 rest 重建排除后的环境。
    const { SystemRoot: _dropped, ...withoutSystemRoot } = parentEnv();
    void _dropped;
    const r = run(
      { file: process.execPath, args: ['-e', 'process.exit(0)'], env: {} },
      withoutSystemRoot,
    );
    expect(r.status).not.toBe(0);
  });

  it('SystemRoot 齐全时同一命令成功（上一条的对照实验）', () => {
    const r = run({ file: process.execPath, args: ['-e', 'process.exit(0)'], env: {} });
    expect(r.status).toBe(0);
  });

  it('白名单内的变量确实传下去了（否则上一步只是「什么都没传」）', () => {
    if (!jobobject.available) return;
    const r = run({
      file: process.execPath,
      args: ['-e', 'process.stdout.write(String(process.env.MC_KEEP))'],
      env: { MC_KEEP: 'kept-value' },
    });
    // 这一条是对上一条的对照：证明过滤是按白名单**选取**，不是无条件清空。
    expect(r.stdout).toContain('kept-value');
  });

  it('cwd 真的生效（子进程在指定目录里执行）', () => {
    if (!jobobject.available) return;
    const r = run({
      file: process.execPath,
      args: ['-e', 'process.stdout.write(process.cwd())'],
      cwd: path.parse(process.cwd()).root,
      env: {},
    });
    expect(r.stdout.trim()).not.toBe(process.cwd());
  });
});
