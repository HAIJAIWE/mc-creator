/**
 * Gradle 编排（设计文档 §8.1#2 / §8.2）。
 *
 * 相对 packages/core/src/builder/gradle.ts（反面教材）的改进：
 * 1. core 版无超时、无沙箱：此处强制 timeoutMs（默认 10 分钟），超时杀进程
 *    并返回 timedOut=true，调用方可据此归类为“构建超时”而非无限挂起；
 * 2. core 版只从日志正则提取 build/libs/*.jar：此处成功后先做磁盘扫描
 *    （readdir build/libs，排除 -sources/-javadoc），日志正则仅作回退；
 * 3. 增加 distributionSha256 占位校验 verifyDistribution（node:crypto 实现，
 *    期望哈希的来源——官方 manifest/服务端签名，见 §13.3——由调用方传入）。
 *
 * 说明：真正的“沙箱”（cwd jail / 无网络 / 资源上限）见 ./sandbox.ts，
 * 此处 cwd=projectPath 已是第一道约束；网络隔离需进程/容器级手段，
 * 由调用方按 buildSandboxOptions 组合实施（§8.3）。
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { sha256File } from './artifact.js';

export interface GradleBuildOptions {
  /** 构建超时毫秒数，默认 10 分钟。超时杀进程并置 timedOut。 */
  timeoutMs?: number;
  /** 调用方取消信号；触发时杀进程（非超时，timedOut=false）。 */
  signal?: AbortSignal;
  /** 传给 gradlew 的参数，默认 ['build']。quiet=true 时追加 '--quiet'。 */
  args?: string[];
  /** 是否追加 --quiet，默认 true。 */
  quiet?: boolean;
  /**
   * 离线构建（追加 '--offline'，默认 false）。
   *
   * §8.1#3 要求“首次构建后应能断网工作”：依赖已进本地缓存（默认 ~/.gradle，
   * 本模块不改 GRADLE_USER_HOME，Gradle 自己的缺省即共享缓存）时可用。
   * 默认关闭 —— 首次构建必须联网拉依赖，默认 offline 会让新工程必败。
   */
  offline?: boolean;
  /** 为子进程设置 JAVA_HOME（见 ./jdk.ts resolveJavaHome）。 */
  javaHome?: string;
}

export interface GradleBuildResult {
  success: boolean;
  /** 产物绝对路径；构建成功但未找到 jar 时为 null。 */
  jarPath: string | null;
  /** stdout + stderr 合并（按到达顺序追加）。 */
  log: string;
  /** 进程退出码；被信号杀死时为 null。 */
  exitCode: number | null;
  /** true = 被 timeoutMs 杀死；调用方取消则为 false。 */
  timedOut: boolean;
}

export const DEFAULT_GRADLE_TIMEOUT_MS = 10 * 60 * 1000;

const JAR_EXCLUDE = /-(?:sources|javadoc|plain)\.jar$/;

/** 扫描 build/libs/*.jar（磁盘事实优先于日志文本）。 */
export async function findBuiltJar(projectPath: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(path.join(projectPath, 'build', 'libs'));
  } catch {
    return null;
  }
  const jar = entries.filter((e) => e.endsWith('.jar') && !JAR_EXCLUDE.test(e)).sort()[0];
  return jar === undefined ? null : path.join(projectPath, 'build', 'libs', jar);
}

/** 日志正则仅回退：core 版的老行为（build/libs/<name>.jar，排除附属 jar）。 */
export function findJarInLog(projectPath: string, log: string): string | null {
  const hit = [...log.matchAll(/build[/\\]libs[/\\]([^\s]+\.jar)/g)]
    .map((m) => m[0])
    .find((j) => !JAR_EXCLUDE.test(j));
  return hit === undefined ? null : path.resolve(projectPath, hit);
}

export async function runGradleBuild(
  projectPath: string,
  opts: GradleBuildOptions = {},
): Promise<GradleBuildResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_GRADLE_TIMEOUT_MS;
  const args = [...(opts.args ?? ['build'])];
  if (opts.quiet ?? true) args.push('--quiet');
  if (opts.offline === true) args.push('--offline');
  // §8.2 常驻 daemon：wrapper 缺省即 daemon，但 gradle.properties 里一句
  // org.gradle.daemon=false 就能关掉。显式 pin 住，要求只有一个——调用方
  // 明确传了 --daemon/--no-daemon 时尊重调用方，不覆盖。
  if (!args.includes('--daemon') && !args.includes('--no-daemon')) {
    args.push('--daemon');
  }

  // Windows 下只有 gradlew.bat（core C-2 修复：./gradlew 会 ENOENT）；
  // .bat 必须经由 shell 启动，posix 保持 shell:false。
  const isWin = process.platform === 'win32';
  const gradlew = isWin ? 'gradlew.bat' : './gradlew';

  const env = { ...process.env };
  if (opts.javaHome !== undefined) env['JAVA_HOME'] = opts.javaHome;

  return new Promise<GradleBuildResult>((resolve) => {
    let log = '';
    let timedOut = false;
    let killedByUs = false;
    let exitCode: number | null = null;
    let settled = false;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: GradleBuildResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (graceTimer !== undefined) clearTimeout(graceTimer);
      opts.signal?.removeEventListener('abort', onAbort);
      void (async () => {
        let jarPath: string | null = null;
        if (r.success) {
          jarPath = (await findBuiltJar(projectPath)) ?? findJarInLog(projectPath, r.log);
        }
        resolve({ ...r, jarPath });
      })();
    };

    /**
     * Windows 注意：shell:true 时被杀的是 cmd.exe，直接子进程；
     * .bat 拉起的孙进程（如 java/gradle）会继承 stdio 管道并继续持有，
     * 导致 'close'（等 stdio 全关）迟迟不触发。因此：
     * 1. 超时/取消用 taskkill /t /f 杀整棵树（posix 靠 SIGTERM/SIGKILL）；
     * 2. 以 'exit' 为准完成（被杀时立即；正常退出给 300ms 收尾日志），
     *    'close' 先到则直接完成。
     */
    const killTree = (child: ChildProcess): void => {
      killedByUs = true;
      try {
        if (process.platform === 'win32' && child.pid !== undefined) {
          const r = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          });
          if (r.status === 0) return;
        }
      } catch {
        /* 回退 SIGTERM */
      }
      try {
        child.kill('SIGTERM');
      } catch {
        /* 进程已退出 */
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(gradlew, args, { cwd: projectPath, env, shell: isWin });
    } catch (err) {
      finish({
        success: false,
        jarPath: null,
        log: `spawn failed: ${(err as Error).message}`,
        exitCode: null,
        timedOut: false,
      });
      return;
    }
    const proc: ChildProcess = child;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(proc);
      const killer = setTimeout(() => {
        try {
          proc.kill('SIGKILL');
        } catch {
          /* 进程已退出 */
        }
      }, 2000);
      // 显式 unref，避免测试进程被兜底 timer 拖住
      if (typeof killer === 'object' && 'unref' in killer) killer.unref();
    }, timeoutMs);
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();

    const onAbort = (): void => {
      killTree(proc);
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        onAbort();
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const finishFromExit = (): void => {
      finish({ success: exitCode === 0, jarPath: null, log, exitCode, timedOut });
    };

    proc.stdout?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    proc.on('error', (err: Error) => {
      // 如 gradlew 缺失（ENOENT）：直接失败，不等待 close
      finish({
        success: false,
        jarPath: null,
        log: `spawn error: ${err.message}`,
        exitCode: null,
        timedOut,
      });
    });
    proc.on('exit', (code: number | null) => {
      exitCode = code;
      if (killedByUs) {
        finishFromExit();
      } else {
        // 正常退出：给 stdio 300ms 宽限收尾日志（close 先到则 finish 内取消）
        graceTimer = setTimeout(finishFromExit, 300);
        if (typeof graceTimer === 'object' && 'unref' in graceTimer) graceTimer.unref();
      }
    });
    proc.on('close', (code: number | null) => {
      if (exitCode === null) exitCode = code;
      finishFromExit();
    });
  });
}

export interface DistributionVerification {
  /** 文件实际 sha256（小写十六进制）。 */
  actual: string;
  /** 是否与期望一致；未提供期望哈希时恒为 false（视为未校验通过）。 */
  match: boolean;
}

/**
 * Gradle distribution 校验占位（§13.3 供应链：所有下载物必须校验哈希）。
 * 实现是真实的 sha256 对比；“占位”指期望哈希的权威来源
 * （官方 manifest / 服务端签名 / 本地离线缓存记录）尚未建模，
 * 由调用方按 §16 数据源传入 expectedSha256。
 */
export async function verifyDistribution(
  filePath: string,
  expectedSha256: string,
): Promise<DistributionVerification> {
  const actual = await sha256File(filePath);
  const norm = expectedSha256.trim().toLowerCase();
  if (norm === '') return { actual, match: false };
  return { actual, match: actual === norm };
}
