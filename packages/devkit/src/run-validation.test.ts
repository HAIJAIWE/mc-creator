/**
 * run-validation 单元测试（设计文档 §8.1#5 隔离运行：一次性沙箱加载冒烟）。
 *
 * 只断言四件事：
 *  1. 成功路径 ok:true
 *  2. 超时路径 timedOut:true 且 ok:false
 *  3. enforced.network===false（Job Object 管不到网络，据实为 false）
 *  4. env 白名单生效（凭据变量不外泄）
 *
 * 不启动真实服务端；超时/慢探针经 probe 钩子注入，不碰真实 JDK/Gradle，不触网。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateArtifact } from './run-validation.js';

/** 真实临时 workdir（路径可能含空格，validateArtifact 内部不 cd、不拼接 shell）。 */
function makeWorkdir(): string {
  return mkdtempSync(path.join(tmpdir(), 'run-validation-'));
}

/** 写一个假 jar（内容不重要，探针只查存在且可读）。 */
function makeFakeJar(workdir: string): string {
  const p = path.join(workdir, 'demo-1.0.jar');
  writeFileSync(p, 'fake-jar-bytes', 'utf8');
  return p;
}

/** 子进程启动必需的最小 env 来源（含凭据用于测过滤）。 */
function baseEnv(): NodeJS.ProcessEnv {
  return {
    PATH: process.env['PATH'] ?? '',
    ...(process.env['SystemRoot'] === undefined ? {} : { SystemRoot: process.env['SystemRoot'] }),
    ...(process.env['TEMP'] === undefined ? {} : { TEMP: process.env['TEMP'] }),
    ...(process.env['TMP'] === undefined ? {} : { TMP: process.env['TMP'] }),
  };
}

describe('validateArtifact：一次性沙箱加载冒烟（§8.1#5）', () => {
  it('成功路径 ok:true（jar 存在且可读，不启动真实服务端）', async () => {
    const workdir = makeWorkdir();
    const jar = makeFakeJar(workdir);
    const r = await validateArtifact({ workdir, artifactPath: jar, env: baseEnv() });
    expect(r.ok).toBe(true);
    expect(r.timedOut).toBe(false);
  });

  it('超时路径 timedOut:true 且 ok:false', async () => {
    const workdir = makeWorkdir();
    const jar = makeFakeJar(workdir);
    const r = await validateArtifact({
      workdir,
      artifactPath: jar,
      timeoutMs: 300,
      env: baseEnv(),
      probe: { file: process.execPath, args: ['-e', 'setTimeout(()=>{},60000)'] },
    });
    expect(r.timedOut).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('enforced.network===false（Job Object 管不到网络）', async () => {
    const workdir = makeWorkdir();
    const jar = makeFakeJar(workdir);
    const r = await validateArtifact({ workdir, artifactPath: jar, env: baseEnv() });
    expect(r.enforced.network).toBe(false);
  });

  it('env 白名单生效（凭据变量不外泄）', async () => {
    const workdir = makeWorkdir();
    const jar = makeFakeJar(workdir);
    const secret = 'super-secret-7654321';
    const r = await validateArtifact({
      workdir,
      artifactPath: jar,
      envAllowlist: ['PATH'],
      env: { ...baseEnv(), MY_SECRET_TOKEN: secret },
      probe: {
        file: process.execPath,
        args: [
          '-e',
          'if(process.env.MY_SECRET_TOKEN){console.log("LEAKED:"+process.env.MY_SECRET_TOKEN);}else{console.log("absent");}',
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(r.log).toContain('absent');
    expect(r.log).not.toContain(secret);
    expect(r.log).not.toContain('LEAKED');
  });
});
