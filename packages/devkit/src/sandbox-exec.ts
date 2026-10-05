/**
 * 沙箱执行器 —— 设计文档 §8.3「进程级隔离」的**实施者**。
 *
 * ## 背景：这份代码为什么存在
 *
 * `sandbox.ts` 一直只声明沙箱契约，并写明「由进程/容器实施者消费」。在那之前
 * 这个实施者**根本不存在**，于是：
 *
 * 1. `buildSandboxOptions()` 是死代码 —— 全仓只有 sandbox.ts、index.ts 再导出
 *    和 devkit.test.ts 引用它，没有任何生产调用点；
 * 2. `runGradleBuild` 用 `env = { ...process.env }` **全量透传父进程环境**，
 *    `SandboxOptions.envAllowlist` 从未被执行过；
 * 3. 内存/CPU 上限、网络禁用全部只停留在类型定义上。
 *
 * 本模块把契约接到真实的进程级隔离上（Windows Job Object），并把
 * **实际强制了哪些项**如实放进返回值，而不是让调用方以为全都生效了。
 *
 * ## 诚实报告 `enforced` 的理由
 *
 * §8.3 要求「禁用网络出站」。**Job Object 无法禁止网络访问** —— 那需要
 * Windows 防火墙按程序规则（要管理员权限）或容器级隔离。所以：
 *
 *   enforced.network 恒为 false
 *
 * 这不是遗漏，是把「声明了但没强制」显式化。MEMORY §2-④ 的判据：回退路径是
 * 攻击面的组成部分，加固一个入口前必须先确认「失败时会走去哪」。一个悄悄
 * 返回「已隔离」的沙箱比没有沙箱更危险。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildSandboxOptions, type SandboxOptions } from './sandbox.js';

/** launcher 与原生模块的注入点：测试替换，运行时惰性解析。 */
export interface SandboxDeps {
  /**
   * 返回 jobobject 模块；默认惰性 require。
   * `null` 表示「运行时拿不到」（非 Windows / 未编译），走未隔离降级。
   */
  loadJobObject?: () => JobObjectModule | null;
  /** launcher 脚本的绝对路径；默认从 jobobject 包解析。 */
  resolveLauncher?: () => string;
}

export interface JobObjectModule {
  available: boolean;
  reason: string | null;
  supportedPlatform?: boolean;
}

/** 实际被强制执行的约束。字段与「声称」严格区分。 */
export interface EnforcedReport {
  /** 隔离来源：job-object = 真隔离；unisolated = 直接 spawn，无上限。 */
  source: 'job-object' | 'unisolated';
  /** 内存硬上限（JOB_OBJECT_LIMIT_PROCESS_MEMORY）。 */
  memory: boolean;
  /** CPU 配额（JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP）。 */
  cpu: boolean;
  /**
   * 禁用网络出站。**恒为 false** —— Job Object 管不到网络。
   * 需要它就得走防火墙规则（管理员）或容器，见文件头。
   */
  network: false;
  /** 整树终止：job 句柄随进程关闭即杀掉全部后代，强于 taskkill /t /f。 */
  treeKill: boolean;
  /** 降级原因；source='job-object' 时为 null。 */
  reason: string | null;
}

export interface SandboxRunOptions {
  /** 沙箱约束（通常由 buildSandboxOptions 产出）。 */
  sandbox: SandboxOptions;
  /** 要执行的程序。 */
  file: string;
  /** 参数数组（不经过 shell，避免拼接注入）。 */
  args: string[];
  /** 取消信号。 */
  signal?: AbortSignal;
  /** 传给子进程的环境；**必须显式给出**，不会隐式继承父进程环境。 */
  env?: Record<string, string | undefined>;
}

export interface SandboxRunResult {
  success: boolean;
  /** 进程退出码；被信号杀死或 launcher 不可用时为 null。 */
  exitCode: number | null;
  /** stdout + stderr 合并（按到达顺序）。 */
  log: string;
  timedOut: boolean;
  /** 实际强制了哪些约束。调用方应把它透出给用户，而不是当成「已隔离」。 */
  enforced: EnforcedReport;
}

/** launcher 用这个退出码表示「隔离不可用」，与真实退出码区分。 */
const EXIT_UNAVAILABLE = 78;

/**
 * 运行时解析 CJS 模块的 require。
 *
 * 必须用 createRequire 而不是裸 `require`：devkit 是 `"type": "module"`，
 * 裸 require 在 ESM 里**根本不存在**（ReferenceError），会被下面的 catch
 * 吞掉、静默降级成 unisolated —— 隔离形同虚设而所有测试依然全绿。
 * 这个坑真实发生过：实测 `enforced.source` 一直是 'unisolated'，
 * 原因就是这里的 require 抛了 ReferenceError 而非模块缺失。
 *
 * 也不能用静态 import：devkit 会被 rollup 内联进 desktop 主进程，
 * 而 .node 二进制绝不能进 bundle（见 electron.vite.config.ts 的 runtimeOnlyModules）。
 */
const runtimeRequire = createRequire(import.meta.url);

function defaultLoadJobObject(): JobObjectModule | null {
  try {
    // 运行时解析而非静态 import：理由见 runtimeRequire 的注释。
    return runtimeRequire('@mc-creator/jobobject') as JobObjectModule;
  } catch {
    return null;
  }
}

function defaultResolveLauncher(): string {
  return runtimeRequire.resolve('@mc-creator/jobobject/launcher');
}

/**
 * 隐式保留的环境变量。
 *
 * ⚠️ 键名大小写：Windows 环境变量**大小写不敏感**，但 JS 对象的键是敏感的。
 * 本机（中文 Windows）`process.env` 里实际存的是 `Path` 而不是 `PATH` ——
 * `'PATH' in process.env` 为 true 是因为 Node 做了别名，**但 `{...process.env}`
 * 展开后只有 `Path`**，再用 `source['PATH']` 去读就得到 undefined。
 * 实测踩过：filterEnv 拿到展开后的对象，PATH 被静默丢掉，cmd.exe 里的
 * `node` 找不到，build_project 却返回 ok=true（构建静默空转）。
 * 所以下面的读取必须**按不区分大小写的方式**找键。
 *
 * `SystemRoot` 不是「可选加固」而是**硬性必需**，有两条独立的实测证据：
 *  1. 父进程只保留 PATH、其余全删时，子进程一律以 ENOENT / 134 起不来 ——
 *     CreateProcess 解析 DLL 搜索路径依赖 SystemRoot，缺它连启动都做不到。
 *  2. 保留 SystemRoot 但删掉 **PATH** 时，cmd.exe 能起来，可 .bat 里的
 *     `node` 报「'node' 不是内部或外部命令」而静默不执行 —— 构建脚本看起来
 *     「成功」但什么都没做。这比直接失败危险得多，所以 PATH 也必须隐式保留。
 *
 * TEMP/TMP 同理：Gradle 需要可写临时目录。
 *
 * ⚠️ PATH 必须在这里，而**不能**只依赖调用方的 envAllowlist。实测踩过：
 * kernel-server 传的是 ['PATH','JAVA_HOME','GRADLE_USER_HOME','GRADLE_OPTS']，
 * 看着已经含 PATH，但 runSandboxed 的 env 来源是**调用方给的 env 对象**，
 * 里面恰好没有 PATH（内核只塞了 JAVA_HOME 与 process.env 的其余部分），
 * 于是 .bat 里的 `node` 找不到、构建「成功」但什么都没做。
 * 把 PATH 放在隐式层，等于「凡是要跑起来的进程必有其 PATH」。
 *
 * 这些值由 Windows 自己提供，不含任何凭据，保留不构成信息泄露。
 * 实测结论记录在 @mc-creator/jobobject/README.md。
 */
export const IMPLICIT_ENV_ALLOWLIST: readonly string[] = ['PATH', 'SystemRoot', 'TEMP', 'TMP'];

/**
 * 按 envAllowlist 过滤环境变量（并隐式保留 Windows 启动必需项）。
 *
 * 这是 §8.3 的实际落地：`gradle.ts` 曾经是 `{ ...process.env }`，把主进程
 * 全部环境（含 OAuth token 等）传给用户构建脚本。
 */
export function filterEnv(
  allowlist: readonly string[],
  source: NodeJS.ProcessEnv,
): Record<string, string> {
  // Windows 上环境变量名大小写不敏感，但 JS 对象的键敏感。本机 process.env
  // 里存的是 `Path`，`{...process.env}` 展开后也只有 `Path` ——
  // 直接 source['PATH'] 会静默拿到 undefined。必须先建一张小写索引。
  const lowerIndex = new Map<string, string>();
  for (const key of Object.keys(source)) {
    lowerIndex.set(key.toLowerCase(), key);
  }
  const lookup = (key: string): string | undefined => {
    const direct = source[key];
    if (direct !== undefined) return direct;
    const actual = lowerIndex.get(key.toLowerCase());
    return actual === undefined ? undefined : source[actual];
  };

  const out: Record<string, string> = {};
  for (const key of allowlist) {
    const value = lookup(key);
    if (value !== undefined) out[key] = value;
  }
  for (const key of IMPLICIT_ENV_ALLOWLIST) {
    const value = lookup(key);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * 在沙箱约束下执行一个进程。
 *
 * 隔离可用时经 `@mc-creator/jobobject/launcher` 走 Job Object；
 * 不可用时**直接 spawn 并如实标注 enforced**，不抛错、不假装已隔离。
 */
export async function runSandboxed(
  opts: SandboxRunOptions,
  deps: SandboxDeps = {},
): Promise<SandboxRunResult> {
  const load = deps.loadJobObject ?? defaultLoadJobObject;
  const job = safeLoad(load);
  const isolated = job !== null && job.available === true;

  if (!isolated) {
    return runDirect(opts, job?.reason ?? 'jobobject 模块不可解析');
  }

  const resolveLauncher = deps.resolveLauncher ?? defaultResolveLauncher;
  let launcherPath: string;
  try {
    launcherPath = resolveLauncher();
  } catch (err) {
    return runDirect(opts, `无法解析 launcher: ${(err as Error).message}`);
  }

  const limits = opts.sandbox.limits;
  const payload = {
    file: opts.file,
    args: opts.args,
    cwd: opts.sandbox.cwd,
    maxMemoryMb: limits.maxMemoryMb,
    maxCpuCores: limits.maxCpuCores,
    // 只把白名单里的变量交出去。allowNetwork 暂不实施（见文件头），
    // 但仍要求调用方显式声明需要哪些变量。
    env: filterEnv(opts.sandbox.envAllowlist, opts.env ?? {}),
  };

  const result = await spawnAndWait(
    process.execPath,
    [launcherPath, JSON.stringify(payload)],
    {
      cwd: opts.sandbox.cwd,
      // launcher 自己只需要最小环境：它随后会按 payload.env 再过滤一次。
      env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] },
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
    opts.sandbox.limits.timeoutMs,
  );

  const unavailable = result.exitCode === EXIT_UNAVAILABLE;
  if (unavailable) {
    // launcher 自己说隔离没上 —— 以它的说法为准，降级重跑一次。
    return runDirect(opts, 'launcher 报告隔离不可用（退出码 78）');
  }

  return {
    success: result.success && !result.timedOut,
    exitCode: result.exitCode,
    log: result.log,
    timedOut: result.timedOut,
    enforced: {
      source: 'job-object',
      memory: limits.maxMemoryMb > 0,
      cpu: limits.maxCpuCores > 0,
      network: false,
      treeKill: true,
      reason: null,
    },
  };
}

/** 未隔离降级：直接 spawn，但 enforced 全部据实标注。 */
async function runDirect(opts: SandboxRunOptions, reason: string): Promise<SandboxRunResult> {
  const result = await spawnAndWait(
    opts.file,
    opts.args,
    {
      cwd: opts.sandbox.cwd,
      env: filterEnv(opts.sandbox.envAllowlist, opts.env ?? {}),
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    },
    opts.sandbox.limits.timeoutMs,
  );
  return {
    success: result.success && !result.timedOut,
    exitCode: result.exitCode,
    log: result.log,
    timedOut: result.timedOut,
    enforced: {
      source: 'unisolated',
      memory: false,
      cpu: false,
      network: false,
      // 没有 job 就没有整树保证；上层只能靠 taskkill 尽力而为。
      treeKill: false,
      reason,
    },
  };
}

function safeLoad(load: () => JobObjectModule | null): JobObjectModule | null {
  try {
    return load();
  } catch {
    return null;
  }
}

interface WaitOptions {
  cwd: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}

interface WaitResult {
  success: boolean;
  exitCode: number | null;
  log: string;
  timedOut: boolean;
}

/** spawn + 收日志 + 超时强杀。行为与 gradle.ts 原有实现保持一致。 */
function spawnAndWait(
  file: string,
  args: string[],
  opts: WaitOptions,
  timeoutMs: number,
): Promise<WaitResult> {
  return new Promise<WaitResult>((resolve) => {
    let log = '';
    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;
    let child: ChildProcess;

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({ success: exitCode === 0, exitCode, log, timedOut });
    };

    // Windows：杀的是 shell/launcher 本身，必须 /t /f 才能连孙进程一起杀。
    // posix 靠 SIGTERM → SIGKILL。
    const killTree = (): void => {
      try {
        if (process.platform === 'win32' && child.pid !== undefined) {
          const r = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          });
          if (r.status === 0) return;
        }
      } catch {
        /* 回退信号终止 */
      }
      try {
        child.kill('SIGTERM');
      } catch {
        /* 已退出 */
      }
    };

    const onAbort = (): void => {
      killTree();
    };

    try {
      child = spawn(file, args, {
        cwd: opts.cwd,
        env: opts.env,
        shell: false,
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        success: false,
        exitCode: null,
        log: `spawn failed: ${(err as Error).message}`,
        timedOut: false,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killTree();
    }, timeoutMs);
    timer.unref?.();

    child.stdout?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    child.stderr?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    child.on('error', (err: Error) => {
      log += `\nspawn error: ${err.message}`;
      finish();
    });
    child.on('close', (code: number | null) => {
      exitCode = code;
      finish();
    });

    if (opts.signal !== undefined) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export { buildSandboxOptions };
