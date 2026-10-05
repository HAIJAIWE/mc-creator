/**
 * 产物隔离加载验证（设计文档 §8.1#5）。
 *
 * kernel-server 的 build_project 目前只跑编译、不做加载验证；
 * 本模块是 devkit 侧的验证器：在一次性沙箱目录里起一个短命进程做
 * “加载冒烟”（默认用 node -e 探测 jar 存在且可读，不启动真实服务端）。
 *
 * 约束：
 * - 产物永不自动进正式环境：只读探测，不复制/不安装/不执行 jar；
 * - 验证在一次性进程中跑：经 runSandboxed 起短命进程；
 * - 超时/失败返回结构化结果，不抛裸异常（cwd jail 越界除外，那是调用方 bug）；
 * - env 只给白名单：经 filterEnv 过滤，禁止全量透传父进程环境；
 * - 一次性目录用完保留供审计，由调用方清理（返回 sandboxDir 供清理）。
 */

import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { assertWithinRoot, buildSandboxOptions } from './sandbox.js';
import { filterEnv, runSandboxed, type EnforcedReport, type SandboxDeps } from './sandbox-exec.js';

/** 加载冒烟默认超时 60s（可覆盖）。 */
export const DEFAULT_VALIDATE_TIMEOUT_MS = 60_000;

/** 验证进程的最小环境白名单（实施层经 filterEnv 再补隐式 PATH/SystemRoot/TEMP）。 */
export const DEFAULT_VALIDATE_ENV_ALLOWLIST: readonly string[] = ['PATH', 'JAVA_HOME'];

export interface ValidateProbe {
  /** 要执行的程序（默认 process.execPath）。 */
  file: string;
  /** 参数数组（不经过 shell）。 */
  args: string[];
}

export interface ValidateArtifactOptions {
  /** 调用方传入的父目录；在其下建时间戳+随机子目录做一次性沙箱。 */
  workdir: string;
  /** 待验证的产物绝对路径（只读探测，不复制不执行）。 */
  artifactPath: string;
  /** 墙钟超时毫秒数，默认 60s。 */
  timeoutMs?: number;
  /** 透传给子进程的最小环境白名单，默认 ['PATH','JAVA_HOME']。 */
  envAllowlist?: string[];
  /**
   * 传给子进程的环境来源；经 filterEnv(envAllowlist, source) 过滤后才交出去。
   * 未给出时取 process.env 做来源（仍只交白名单命中的项，不全量透传）。
   */
  env?: NodeJS.ProcessEnv;
  /** 调用方取消信号；触发时杀进程（非超时）。 */
  signal?: AbortSignal;
  /** runSandboxed 的注入点（测试替换 launcher/jobobject）。 */
  deps?: SandboxDeps;
  /** 资源上限覆盖（内存/CPU）；超时走 timeoutMs。 */
  limits?: { maxMemoryMb?: number; maxCpuCores?: number };
  /**
   * 测试/排障钩子：覆盖默认的 node -e 存在可读探测。
   * 生产调用不要传。超时与 env 白名单测试靠它注入慢探针/环境探针。
   */
  probe?: ValidateProbe;
}

export interface ValidateArtifactResult {
  /** true = 探针退出码 0 且未超时。 */
  ok: boolean;
  /** 探针 stdout + stderr 合并。 */
  log: string;
  /** true = 被 timeoutMs 杀死。 */
  timedOut: boolean;
  /** runSandboxed 原样透传（含 network 恒为 false）。 */
  enforced: EnforcedReport;
  /** 一次性沙箱子目录（已创建、验证后保留供审计，由调用方清理）。 */
  sandboxDir: string;
}

/** 兜底 enforced：runSandboxed 自身抛错时用（仍 network=false，不假装已隔离）。 */
function fallbackEnforced(reason: string): EnforcedReport {
  return {
    source: 'unisolated',
    memory: false,
    cpu: false,
    network: false,
    treeKill: false,
    reason,
  };
}

/**
 * 在一次性沙箱中对编译产物做加载冒烟。
 *
 * 默认探针（不启动真实服务端）：
 *   node -e "<accessSync 可读检查>" <artifactPath>
 * 产物缺失/不可读 → 探针 exit!=0 → ok:false；超时 → timedOut:true 且 ok:false。
 */
export async function validateArtifact(
  opts: ValidateArtifactOptions,
): Promise<ValidateArtifactResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_VALIDATE_TIMEOUT_MS;
  const envAllowlist = opts.envAllowlist ?? [...DEFAULT_VALIDATE_ENV_ALLOWLIST];

  // 一次性子目录：时间戳+随机名。先经 assertWithinRoot 做 cwd jail，
  // 再创建；用完保留供审计，由调用方清理。
  const subdirName = `validate-${Date.now()}-${randomBytes(4).toString('hex')}`;
  const sandboxDir = assertWithinRoot(opts.workdir, subdirName);
  mkdirSync(sandboxDir, { recursive: true });

  const sandbox = buildSandboxOptions(sandboxDir, {
    cwd: sandboxDir,
    allowNetwork: false,
    limits: {
      timeoutMs,
      ...(opts.limits?.maxMemoryMb === undefined ? {} : { maxMemoryMb: opts.limits.maxMemoryMb }),
      ...(opts.limits?.maxCpuCores === undefined ? {} : { maxCpuCores: opts.limits.maxCpuCores }),
    },
    envAllowlist,
    requireArtifactHash: true,
  });
  // cwd jail 双保险：buildSandboxOptions 内部已对 cwd 做 assertWithinRoot，
  // 这里再显式断言一次，钉住“产物验证必在 jail 内跑”。
  assertWithinRoot(sandbox.root, sandbox.cwd);
  assertWithinRoot(sandbox.root, path.resolve(sandbox.root, '.'));

  // env 只给白名单：经 filterEnv 过滤后再交给 runSandboxed
  // （runSandboxed 内部还会再滤一次，幂等）。禁止把父进程环境全量透传。
  const filteredEnv = filterEnv(envAllowlist, opts.env ?? process.env);

  const probe: ValidateProbe =
    opts.probe ??
    ({
      file: process.execPath,
      args: [
        '-e',
        'const fs=require("fs");' +
          'try{fs.accessSync(process.argv[1],fs.constants.R_OK);' +
          'console.log("artifact readable: "+process.argv[1]);}' +
          'catch(e){console.error("artifact unreadable: "+(e&&e.message));process.exit(1);}',
        opts.artifactPath,
      ],
    } satisfies ValidateProbe);

  try {
    const r = await runSandboxed(
      {
        sandbox,
        file: probe.file,
        args: probe.args,
        env: filteredEnv,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      },
      opts.deps ?? {},
    );
    return {
      ok: r.success && !r.timedOut,
      log: r.log,
      timedOut: r.timedOut,
      enforced: r.enforced,
      sandboxDir,
    };
  } catch (err) {
    return {
      ok: false,
      log: `validateArtifact failed: ${(err as Error).message}`,
      timedOut: false,
      enforced: fallbackEnforced((err as Error).message),
      sandboxDir,
    };
  }
}
