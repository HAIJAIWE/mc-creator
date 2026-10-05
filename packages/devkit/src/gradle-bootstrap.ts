/**
 * Gradle wrapper 自举（构建前的硬阻断修复）。
 *
 * 问题（实测）：生成器只写 `gradle/wrapper/gradle-wrapper.properties`，
 * **不写** `gradlew` / `gradlew.bat` / `gradle-wrapper.jar`
 * （generator-mod/src/fabric-gradle.ts:139-152 只产出那一个 properties 文件）；
 * 而构建路径直接 spawn `gradlew.bat`（消费方 gradle.ts:97，Windows 用 gradlew.bat、
 * 其它平台用 ./gradlew）→ 干净机器上必然 ENOENT。
 *
 * 下面是**本机实测过的**设计前提，不是文档记忆：
 *
 * ① 幂等是热路径要求：gradlew(.bat) 已存在 → 直接返回 created:false，
 *    绝不重跑 wrapper 任务、绝不重新下载（每次构建都会走这里）。
 *    判据只看**本平台要用的那个启动脚本**：gradle.ts 在 Windows 上 spawn
 *    gradlew.bat、posix spawn ./gradlew，所以 posix-only 的工程被拷进 Windows
 *    会被正确判为缺 wrapper 并重新生成（反之亦然）。
 *
 * ② 缺失时下载 Gradle 发行版到应用缓存目录，缓存约定**照抄 jdk-download.ts**：
 *    <cacheDir>/gradle/<version>/ + `.ready` 标记 + 只对 5xx/429/网络错重试
 *    （默认 2 次，300ms/600ms 退避）+ 单次超时 30s + 全局 fetch（可注入 fetchImpl）。
 *    多一层 `gradle/` 是刻意的：jdk-download 用 <cacheDir>/<主版本>/，
 *    两者共用同一个 cacheDir 根时不会互相踩。发行版是 zip，解压直接复用
 *    jdk-download 的 extractZip（零第三方、含 ZipSlip 拦截），不另起一套。
 *
 * ③ 跑 `<发行版>/bin/gradle(.bat) wrapper --gradle-version <V> --no-validate-url`，
 *    cwd = 工程目录。`--no-validate-url` **必须加**：wrapper 任务默认联网校验
 *    distribution url，网络一抖就失败，实测原文：
 *      Execution failed for task ':wrapper'. > Test of distribution url
 *      https://services.gradle.org/distributions/gradle-8.12-bin.zip failed.
 *    加了之后同一台机器 BUILD SUCCESSFUL in 5s，产出 gradlew(8763B) /
 *    gradlew.bat(2966B) / gradle-wrapper.jar(43583B)。
 *
 * ④ **不覆盖已存在的 gradle-wrapper.properties**：wrapper 任务会重写它，
 *    实测 509B → 252B（功能等价，但生成器写在文件头的说明注释被冲掉，
 *    validateDistributionUrl 还被翻成 false）。所以流程是：先把原始字节读进内存，
 *    跑完（无论成败）无条件写回，保证调用方看到的 properties 逐字节不变 ——
 *    它是「生成器 ↔ 构建」之间的事实契约，不允许被构建期的副作用改写。
 *
 * ⑤ 宿主 JVM 预检（**先于下载**，见测试④）：Gradle 8.12 在 JDK 26 上**起不来**，
 *    实测 `gradle --version` 都还能打印（Launcher JVM: 26.0.1），但真正跑任务时：
 *      BUG! exception in phase 'semantic analysis' in source unit '_BuildScript_'
 *      Unsupported class file major version 70        → BUILD FAILED
 *    等 5 秒看这么一行报错没有价值，所以先查 JVM 主版本，超过该 Gradle 版本的
 *    支持上限就立刻返回人话错误（"Gradle 8.12 不支持 JDK 26，请用 JDK 23 或更低"）。
 *    上限表来自 Gradle 官方 Compatibility Matrix（2026-10-06 在线取回，非记忆）：
 *      https://docs.gradle.org/8.12/userguide/compatibility.html
 *        → "A JVM version between 8 and 23 is required to execute Gradle.
           JVM 24 and later versions are not yet supported."
 *      https://blog.gradle.org/gradle-is-javamaxxing
 *        → "Java 24 in Gradle 8.14.0, Java 25 in 9.1.0, Java 26 in 9.4.0"
 *    表做成阈值表 + 可注入（maxJavaMajorFor），单测不必真造 JVM。
 *    **查不到就放行（fail-open）**：JVM 主版本取不到（没 java、输出格式不认识）
 *    或 Gradle 版本不在表内时继续跑。两个方向的错判代价不对称 ——
 *    误杀会让本来能构建的工程直接构建不了；漏拦只是退回 Gradle 那句原生报错
 *    （再加上 ⑧ 的兜底改写）。所以宁可尝试也不误杀。
 *
 * ⑥ 任何一步失败都返回结构化 { ok:false, code, error, log }，**不抛裸异常**
 *    （与本仓 devkit 风格一致：调用方 runGradleBuild 走的是既有失败路径，
 *    不需要 try/catch 新异常类型）。
 *
 * ⑦ 已知代价（不做的事，理由写明以免后人当 bug 报）：首次构建会把发行版下两次 ——
 *    一次进本缓存（给 wrapper 任务用），一次由生成的 gradlew 下进
 *    GRADLE_USER_HOME/wrapper/dists。在 ④ 的约束下（不改 properties，
 *    也就不能把 distributionUrl 指到 file://）没有零成本的复用路径。
 *
 * ⑧ 兜底改写：万一预检没拦住（fail-open 的情形），wrapper 任务失败时若日志命中
 *    `Unsupported class file major version N`，把 N 换算成 JVM 主版本
 *    （class 文件版本 = 主版本 + 44：23→67、26→70）并给出同样的可读提示，
 *    避免把 Gradle 的 BUG! 堆栈直接甩给用户。
 *
 * 依赖纪律：零第三方（同 jdk-download）。**不 import shared** —— devkit 的
 * dependencies 只有 contract + jobobject，pnpm 只为直接依赖建软链（package.json
 * 里的 //jobobject 注释记的就是这个坑），mcVersion→gradleVersionFor
 * （shared/src/types/loader.ts:279）由调用方解析后经 gradleVersion 传入，
 * 或干脆由生成器写在 properties 的 distributionUrl 里（本模块就是从那儿读的）。
 */

import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectJavaVersion, resolveJavaHome } from './jdk.js';
import { extractZip } from './jdk-download.js';

/* ------------------------------------------------------------------ *
 * 结构化结果（要求⑥：返回，不抛）
 * ------------------------------------------------------------------ */

export type GradleWrapperErrorCode =
  /** 工程目录参数非法。 */
  | 'PROJECT_PATH_MISSING'
  /** 既没显式传 gradleVersion，也读不出 properties 里的 distributionUrl。 */
  | 'GRADLE_VERSION_UNKNOWN'
  /** 宿主 JVM 比该 Gradle 版本能跑的 JVM 还新（要求⑤，下载前拦截）。 */
  | 'JVM_TOO_NEW'
  /** 发行版下载或解压失败。 */
  | 'DISTRIBUTION_DOWNLOAD'
  /** wrapper 任务非 0 退出 / spawn 失败 / 超时 / 执行器抛错。 */
  | 'WRAPPER_TASK_FAILED'
  /** 任务退出码为 0 但启动脚本仍然不存在（Gradle 行为变了，或落在别的目录）。 */
  | 'WRAPPER_NOT_GENERATED';

export type GradleDistributionSource = 'existing' | 'cache' | 'download';

export interface GradleWrapperReady {
  ok: true;
  /** true = 本次真的生成了 wrapper；false = 热路径命中，什么都没做。 */
  created: boolean;
  /**
   * 本次使用的 Gradle 版本。created=false 的热路径为 '' —— 为了热路径上不读文件，
   * 宁可少给信息（要求①：热路径只有一次 existsSync）。
   */
  gradleVersion: string;
  /** 发行版下载地址（热路径为 ''）。 */
  distributionUrl: string;
  /** 缓存里的发行版根目录（含 bin/gradle(.bat)，热路径为 ''）。 */
  distributionHome: string;
  /** 发行版来自既有 wrapper / 缓存命中 / 本次下载。 */
  source: GradleDistributionSource;
  /** 给人看的过程日志（gradle.ts 会把它透进构建 log）。 */
  log: string;
}

export interface GradleWrapperFailure {
  ok: false;
  code: GradleWrapperErrorCode;
  /** 可直接展示给用户的中文错误。 */
  error: string;
  /** 原始过程日志（wrapper 任务输出等），便于排障。 */
  log: string;
}

export type GradleWrapperResult = GradleWrapperReady | GradleWrapperFailure;

/* ------------------------------------------------------------------ *
 * 纯函数区：版本解析 + JVM 上限表 + URL 解析（都能单测，不触网）
 * ------------------------------------------------------------------ */

/** Gradle 版本号 → [major, minor, patch]：'9.5.1'→[9,5,1]、'8.12'→[8,12,0]。取不到返回 null。 */
export function parseGradleVersion(version: string): [number, number, number] | null {
  if (typeof version !== 'string') return null;
  const m = version.trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), m[3] === undefined ? 0 : Number(m[3])];
}

/**
 * 阈值表：从该 Gradle 版本起最高能跑在哪个 JVM 主版本上（见文件头⑤的出处）。
 * 按 from 降序排列，命中第一条即返回。
 */
export const GRADLE_JAVA_CEILINGS: readonly { readonly from: string; readonly maxJava: number }[] =
  [
    { from: '9.4.0', maxJava: 26 }, // Java 26 支持始于 Gradle 9.4.0
    { from: '9.1.0', maxJava: 25 }, // Java 25 支持始于 Gradle 9.1.0
    { from: '8.14.0', maxJava: 24 }, // Java 24 支持始于 Gradle 8.14.0
    { from: '8.10.0', maxJava: 23 }, // Java 23 支持始于 Gradle 8.10.0（8.12 官方文档：8~23）
    { from: '8.8.0', maxJava: 22 },
    { from: '8.5.0', maxJava: 21 },
    { from: '8.3.0', maxJava: 20 },
    { from: '7.6.0', maxJava: 19 },
    { from: '7.5.0', maxJava: 18 },
    { from: '7.3.0', maxJava: 17 },
  ];

/**
 * 该 Gradle 版本能跑的最高 JVM 主版本；解析不出或低于表底（7.3）返回 null
 * —— null 的语义是「不知道」，调用方据此 fail-open（要求⑤）。
 * 本表只管**上限**：下限（Gradle 9 要 Java 17+）不由这里管，理由是下限不满足时
 * Gradle 自己的报错已经很直白（"Could not determine java version"），不是实测到的痛点。
 */
export function maxJavaMajorForGradle(gradleVersion: string): number | null {
  const v = parseGradleVersion(gradleVersion);
  if (v === null) return null;
  for (const entry of GRADLE_JAVA_CEILINGS) {
    const from = parseGradleVersion(entry.from);
    if (from === null) continue;
    const ge =
      v[0] > from[0] ||
      (v[0] === from[0] && (v[1] > from[1] || (v[1] === from[1] && v[2] >= from[2])));
    if (ge) return entry.maxJava;
  }
  return null;
}

/** class 文件版本 → JVM 主版本（class = major + 44：23→67、26→70，见要求⑧）。 */
export function classFileMajorToJavaMajor(classFileMajor: number): number {
  return classFileMajor - 44;
}

/**
 * 解析 gradle-wrapper.properties 的 distributionUrl。
 * 生成器写的是 java properties 的转义形式 `https\://services.gradle.org/...`
 * （generator-mod/src/fabric-gradle.ts:146），按 java.util.Properties 语义
 * 反斜杠转义下一个字符，所以先 unescape 再用。取不到返回 null。
 */
export function parseDistributionUrl(
  propertiesText: string,
): { url: string; version: string } | null {
  if (typeof propertiesText !== 'string' || propertiesText === '') return null;
  const line = propertiesText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.startsWith('distributionUrl'));
  if (line === undefined) return null;
  const eq = line.indexOf('=');
  if (eq < 0) return null;
  const url = line
    .slice(eq + 1)
    .trim()
    .replace(/\\(.)/g, '$1');
  if (url === '') return null;
  const m = url.match(/gradle-(\d+(?:\.\d+)*)-(?:bin|all)\.zip/);
  return m === null ? { url, version: '' } : { url, version: m[1] as string };
}

/** 官方发行版地址（properties 缺失且调用方也没显式传时的兜底）。 */
export function defaultDistributionUrl(gradleVersion: string): string {
  return `https://services.gradle.org/distributions/gradle-${gradleVersion}-bin.zip`;
}

/** 本平台 gradle.ts 会 spawn 的启动脚本名（要求①：判据必须与消费方一致）。 */
export function wrapperLauncherName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'gradlew.bat' : 'gradlew';
}

/* ------------------------------------------------------------------ *
 * 宿主 JVM 探测
 * ------------------------------------------------------------------ */

export type JavaMajorDetector = () => Promise<number | null>;

/**
 * 宿主 JVM 主版本；显式 javaHome 优先（Gradle 就是优先用 JAVA_HOME 再退 PATH），
 * 其次环境里的 JAVA_HOME，最后 PATH 上的 java。取不到返回 null（fail-open）。
 * 版本号解析复用 jdk.ts 的 detectJavaVersion（那个正则已修过 `"25"` 的坑），
 * 只换掉执行方式：它的 defaultRun 按空格 split 命令行，JDK 装在
 * `C:\Program Files\...` 之类含空格的路径下会被切碎。
 */
export async function detectHostJavaMajor(
  javaHome?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number | null> {
  const home = javaHome ?? resolveJavaHome(env) ?? undefined;
  const exe = home === undefined ? 'java' : join(home, 'bin', 'java');
  return detectJavaVersion(
    async () =>
      new Promise<string>((resolve) => {
        execFile(exe, ['-version'], { windowsHide: true }, (error, stdout, stderr) => {
          void error; // java 不存在时输出为空，detectJavaVersion 的正则自然取不到 → null
          // java -version 打在 stderr
          resolve(`${stderr ?? ''}${stdout ?? ''}`);
        });
      }),
  );
}

/** 缺省工具链缓存根目录：~/.mc-creator/cache（跨平台可写，与 Gradle 自己的 ~/.gradle 分开）。 */
export function defaultToolchainCacheDir(): string {
  return join(homedir(), '.mc-creator', 'cache');
}

/* ------------------------------------------------------------------ *
 * 下载（对齐 jdk-download.ts 的重试/超时风格）
 * ------------------------------------------------------------------ */

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_RETRIES = 2;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** 组合超时信号与调用方取消信号（jdk-download.ts 同款）。 */
function combineSignals(
  timeoutMs: number,
  user?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (user === undefined) return { signal: timeoutSignal, dispose: () => undefined };
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn.call(AbortSignal, [user, timeoutSignal]), dispose: () => undefined };
  }
  const ctrl = new AbortController();
  const forward = (): void => ctrl.abort();
  if (user.aborted || timeoutSignal.aborted) {
    forward();
  } else {
    user.addEventListener('abort', forward, { once: true });
    timeoutSignal.addEventListener('abort', forward, { once: true });
  }
  return {
    signal: ctrl.signal,
    dispose: () => {
      user.removeEventListener('abort', forward);
      timeoutSignal.removeEventListener('abort', forward);
    },
  };
}

interface AttemptResult {
  ok: boolean;
  /** 失败原因（ok=false 时有值）。 */
  error?: string;
  /** 是否值得退避重试。 */
  retryable?: boolean;
}

async function attemptDownload(
  url: string,
  destPath: string,
  fetchImpl: typeof fetch,
  opts: { timeoutMs: number; signal?: AbortSignal },
): Promise<AttemptResult> {
  const { signal, dispose } = combineSignals(opts.timeoutMs, opts.signal);
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { redirect: 'follow', signal });
    } catch (err) {
      return {
        ok: false,
        retryable: opts.signal?.aborted !== true,
        error: `网络错误: ${(err as Error).message}`,
      };
    }
    if (isRetryableStatus(res.status)) {
      return { ok: false, retryable: true, error: `服务器错误（HTTP ${res.status}）` };
    }
    // 200 以外（404/403…）重试没有意义。
    if (res.status !== 200) {
      return { ok: false, retryable: false, error: `下载失败（HTTP ${res.status}）` };
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await res.arrayBuffer();
    } catch (err) {
      return {
        ok: false,
        retryable: opts.signal?.aborted !== true,
        error: `读取响应体失败: ${(err as Error).message}`,
      };
    }
    try {
      await writeFile(destPath, Buffer.from(bytes));
    } catch (err) {
      return { ok: false, retryable: false, error: `落盘失败: ${(err as Error).message}` };
    }
    return { ok: true };
  } finally {
    dispose();
  }
}

/** 下载发行版 zip 到 destPath（重试策略与 jdk-download 对齐）。 */
async function downloadDistribution(
  url: string,
  destPath: string,
  opts: { fetchImpl: typeof fetch; retries: number; timeoutMs: number; signal?: AbortSignal },
): Promise<{ ok: true } | { ok: false; error: string }> {
  let last = '未知错误';
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    const r = await attemptDownload(url, destPath, opts.fetchImpl, {
      timeoutMs: opts.timeoutMs,
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    });
    if (r.ok) return { ok: true };
    last = r.error ?? '未知错误';
    if (r.retryable !== true || attempt >= opts.retries) break;
    await sleep(300 * (attempt + 1)); // 与 jdk-download 同一退避
  }
  return { ok: false, error: `${url}：${last}` };
}

/* ------------------------------------------------------------------ *
 * wrapper 任务的进程执行（可注入）
 * ------------------------------------------------------------------ */

export interface GradleTaskRequest {
  /** 可执行文件绝对路径（<发行版>/bin/gradle.bat）。 */
  command: string;
  args: string[];
  /** 工作目录 = 工程目录（要求③）。 */
  cwd: string;
  javaHome?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  /** 目标平台（默认本机）；决定 .bat 走不走 shell —— 与 ensureGradleWrapper 的 platform 同源。 */
  platform?: NodeJS.Platform;
}

export interface GradleTaskOutcome {
  ok: boolean;
  exitCode: number | null;
  /** stdout + stderr 合并。 */
  log: string;
}

export type GradleTaskRunner = (req: GradleTaskRequest) => Promise<GradleTaskOutcome>;

export const DEFAULT_WRAPPER_TASK_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 默认任务执行器：spawn 发行版里的 gradle。
 * Windows 上只有 gradle.bat，必须 shell:true（同 gradle.ts:153 的处理）。
 * 超时/取消用 taskkill /t /f 杀整棵树 —— shell:true 时被杀的是 cmd.exe，
 * java/gradle 是孙进程，只 kill 直接子进程会留下跑飞的 daemon
 * （gradle.ts:124-150 的注释与 kernel.ts:917-921 的分析同源）。
 *
 * 两个实测踩过的坑（都不是想当然）：
 * 1. shell:true 时 node 只是把 command/args 拼起来交给 cmd.exe（DEP0190），
 *    **不转义**。缓存路径在用户目录下（`C:\Users\<带空格的姓名>\.mc-creator\...`）
 *    含空格时 cmd 会把它截断成第一段，实测报
 *    `'E:\...\my dist\bin\gradle.bat' 不是内部或外部命令` → 退出码 1。
 *    所以 Windows 下自己给 command 加双引号；参数都是 `wrapper` / `--gradle-version`
 *    / 版本号这类无空格串，且 cmd 对 - 前缀参数不能加引号（同 kernel.ts:928-933）。
 * 2. 收尾不能只靠 unref 的宽限 timer：'exit' 之后若事件循环里没别的东西
 *    （只有个已 unref 的 timer），node 会直接退出，Promise 永不 settle
 *    （实测 "Detected unsettled top-level await"）。所以 'close' 立刻结算、
 *    宽限 timer 不 unref。
 */
export const runGradleTask: GradleTaskRunner = async (req) => {
  const isWin = (req.platform ?? process.platform) === 'win32';
  const env = { ...process.env };
  if (req.javaHome !== undefined) env['JAVA_HOME'] = req.javaHome;
  const command = isWin ? `"${req.command}"` : req.command;

  return new Promise<GradleTaskOutcome>((resolve) => {
    let log = '';
    let settled = false;
    let killedByUs = false;
    let exitCode: number | null = null;
    // 初始值写成 undefined 是**有意**的：spawn 抛错那条早退路径会先调 finish()，
    // 而 finish() 里要读 timer（clearTimeout）。如果这里是裸声明 + 后面单次赋值，
    // eslint 的 prefer-const 会建议改成 const —— 但 const 必须在声明处初始化，
    // 初始化就意味着 setTimeout 提前到 finish 定义之前，会把早退路径推进 TDZ
    // （finish 读到尚未初始化的 const → ReferenceError）。给个 undefined 初值，
    // 语义不变，lint 也能看出这是「声明后单次赋值」而非「本可用 const」。
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (grace !== undefined) clearTimeout(grace);
      req.signal?.removeEventListener('abort', onAbort);
      resolve({ ok, exitCode, log });
    };

    const killTree = (child: ChildProcess): void => {
      killedByUs = true;
      try {
        if (isWin && child.pid !== undefined) {
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
        /* 已退出 */
      }
    };

    let child: ChildProcess;
    try {
      child = spawn(command, req.args, { cwd: req.cwd, env, shell: isWin });
    } catch (err) {
      log += `spawn failed: ${(err as Error).message}\n`;
      finish(false);
      return;
    }
    const proc: ChildProcess = child;

    timer = setTimeout(() => {
      log += `\n[mc-creator] wrapper 任务超时（${req.timeoutMs}ms），已终止\n`;
      killTree(proc);
      finish(false);
    }, req.timeoutMs);

    const onAbort = (): void => {
      log += '\n[mc-creator] wrapper 任务被取消\n';
      killTree(proc);
    };
    if (req.signal !== undefined) {
      if (req.signal.aborted) {
        killTree(proc);
      } else {
        req.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    proc.stdout?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    proc.stderr?.on('data', (d: Buffer) => {
      log += d.toString();
    });
    proc.on('error', (err: Error) => {
      log += `spawn error: ${err.message}\n`;
      finish(false);
    });
    proc.on('exit', (code: number | null) => {
      exitCode = code;
      if (killedByUs) {
        finish(false);
        return;
      }
      // 'exit' 只说明进程退了，stdio 可能还被孙进程占着（如 shell:true 的 cmd）：
      // 给 300ms 宽限收尾日志。这个 timer 刻意不 unref（见文件头坑 2）。
      grace = setTimeout(() => finish(exitCode === 0), 300);
    });
    proc.on('close', (code: number | null) => {
      if (exitCode === null) exitCode = code;
      finish(exitCode === 0);
    });
  });
};

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export interface EnsureGradleWrapperOptions {
  /** 工程目录（生成器产物所在）。 */
  projectPath: string;
  /** 工具链缓存根目录；缺省 ~/.mc-creator/cache（发行版落在 <cacheDir>/gradle/<version>/）。 */
  cacheDir?: string;
  /**
   * 显式 Gradle 版本。缺省从 gradle/wrapper/gradle-wrapper.properties 的
   * distributionUrl 里解析（生成器已按 MC 版本写好；shared 的 gradleVersionFor
   * 无需在此重复实现 —— 本模块不能 import shared，理由见文件头）。
   */
  gradleVersion?: string;
  /** 显式发行版地址；缺省用 properties 里的，都没有则按官方地址拼。 */
  distributionUrl?: string;
  /** wrapper 任务超时，默认 10 分钟（与 gradle.ts DEFAULT_GRADLE_TIMEOUT_MS 同值）。 */
  timeoutMs?: number;
  /** 为发行版里的 gradle 指定 JAVA_HOME（同 gradle.ts 的 javaHome 语义）。 */
  javaHome?: string;
  /** 调用方取消信号（下载与任务两段都响应）。 */
  signal?: AbortSignal;
  /** 覆盖目标平台（单测用；默认本机）。 */
  platform?: NodeJS.Platform;
  /** 下载重试次数（不含首次），默认 2；仅 5xx/429/网络错重试。 */
  retries?: number;
  /** 单次下载超时毫秒，默认 30000（与 jdk-download 同值同取舍）。 */
  downloadTimeoutMs?: number;

  /* —— 注入点：单测全 mock，不触网、不真下 Gradle、不起真进程 —— */
  fetchImpl?: typeof fetch;
  /** 发行版解压，默认复用 jdk-download 的 extractZip（仅 zip）。 */
  extract?: (archivePath: string, destDir: string) => Promise<void>;
  /** 跑 wrapper 任务，默认 runGradleTask。 */
  runGradle?: GradleTaskRunner;
  /** 宿主 JVM 主版本探测器，默认 detectHostJavaMajor(javaHome)。 */
  detectJavaMajor?: JavaMajorDetector;
  /** Gradle 版本 → 支持的 JVM 上限，默认 maxJavaMajorForGradle（可注入便于单测）。 */
  maxJavaMajorFor?: (gradleVersion: string) => number | null;
  /** 文件存在判定，默认 node:fs existsSync。 */
  existsSyncImpl?: (p: string) => boolean;
}

function fail(code: GradleWrapperErrorCode, error: string, log = ''): GradleWrapperFailure {
  return { ok: false, code, error, log };
}

/** 日志尾部（错误信息里只放尾部，避免几千行日志糊住界面）。 */
function tail(log: string, maxLines = 12): string {
  const lines = log.trimEnd().split(/\r?\n/);
  return lines.length <= maxLines ? lines.join('\n') : lines.slice(-maxLines).join('\n');
}

export async function ensureGradleWrapper(
  opts: EnsureGradleWrapperOptions,
): Promise<GradleWrapperResult> {
  const projectPath = opts.projectPath;
  if (typeof projectPath !== 'string' || projectPath.trim() === '') {
    return fail('PROJECT_PATH_MISSING', '缺少工程目录（projectPath 不能为空）');
  }
  const platform = opts.platform ?? process.platform;
  const launcher = wrapperLauncherName(platform);
  const exists = opts.existsSyncImpl ?? existsSync;

  // ① 热路径：一次 existsSync，零下载、零 spawn、零 JVM 探测。
  if (exists(join(projectPath, launcher))) {
    return {
      ok: true,
      created: false,
      gradleVersion: '',
      distributionUrl: '',
      distributionHome: '',
      source: 'existing',
      log: '',
    };
  }

  // 版本与发行版地址：显式参数 > properties > 官方地址兜底。
  const cacheDir = opts.cacheDir ?? defaultToolchainCacheDir();
  const propsPath = join(projectPath, 'gradle', 'wrapper', 'gradle-wrapper.properties');
  let propsRaw: Buffer | null = null;
  try {
    propsRaw = await readFile(propsPath);
  } catch {
    propsRaw = null;
  }
  const fromProps = propsRaw === null ? null : parseDistributionUrl(propsRaw.toString('utf8'));
  const gradleVersion = opts.gradleVersion ?? fromProps?.version ?? '';
  if (gradleVersion === '') {
    return fail(
      'GRADLE_VERSION_UNKNOWN',
      `读不到 Gradle 版本：${propsPath} 里没有 distributionUrl，也没有显式传入 gradleVersion`,
    );
  }
  const distributionUrl =
    opts.distributionUrl ?? fromProps?.url ?? defaultDistributionUrl(gradleVersion);

  // ⑤ 宿主 JVM 预检，必须在下载之前（否则就是先下 130MB 再告诉用户用错 JDK）。
  const javaMajor = await (opts.detectJavaMajor ?? (() => detectHostJavaMajor(opts.javaHome)))();
  const ceiling = (opts.maxJavaMajorFor ?? maxJavaMajorForGradle)(gradleVersion);
  if (javaMajor !== null && ceiling !== null && javaMajor > ceiling) {
    return fail(
      'JVM_TOO_NEW',
      `Gradle ${gradleVersion} 不支持 JDK ${javaMajor}（最高支持 JDK ${ceiling}）。` +
        `请改用 JDK ${ceiling} 或更低版本后重试 —— 继续跑只会在 wrapper 任务里报 ` +
        `“Unsupported class file major version ${javaMajor + 44}”。`,
    );
  }

  // ② 发行版：缓存命中直接用，否则下载 → 解压 → 写 .ready。
  const extract = opts.extract ?? extractZip;
  const versionDir = join(cacheDir, 'gradle', gradleVersion);
  const marker = join(versionDir, '.ready');
  const binName = platform === 'win32' ? 'gradle.bat' : 'gradle';
  const homeCandidates = [join(versionDir, `gradle-${gradleVersion}`), versionDir];
  const findHome = (): string | null => {
    for (const c of homeCandidates) if (exists(join(c, 'bin', binName))) return c;
    return null;
  };

  const prepareDistribution = async (): Promise<
    { ok: true; home: string; source: GradleDistributionSource } | { ok: false; error: string }
  > => {
    if (exists(marker)) {
      const home = findHome();
      if (home !== null) return { ok: true, home, source: 'cache' };
    }
    await mkdir(versionDir, { recursive: true });
    const zipPath = join(cacheDir, `.gradle-${gradleVersion}-${process.pid}-${Date.now()}.part`);
    try {
      const dl = await downloadDistribution(distributionUrl, zipPath, {
        fetchImpl: opts.fetchImpl ?? fetch,
        retries: opts.retries ?? DEFAULT_DOWNLOAD_RETRIES,
        timeoutMs: opts.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS,
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      if (!dl.ok) {
        return { ok: false, error: `下载 Gradle ${gradleVersion} 发行版失败: ${dl.error}` };
      }
      try {
        await extract(zipPath, versionDir);
      } catch (err) {
        // 半成品目录没有 .ready，下次会重下；顺手清掉避免残留干扰排障。
        await rm(versionDir, { recursive: true, force: true });
        return {
          ok: false,
          error: `解压 Gradle ${gradleVersion} 发行版失败: ${(err as Error).message}`,
        };
      }
      const home = findHome();
      if (home === null) {
        await rm(versionDir, { recursive: true, force: true });
        return {
          ok: false,
          error: `解压后找不到 bin/${binName}（发行版目录结构与预期不符）: ${versionDir}`,
        };
      }
      await writeFile(marker, `${distributionUrl}\n${new Date().toISOString()}\n`, 'utf8');
      return { ok: true, home, source: 'download' };
    } finally {
      await rm(zipPath, { force: true });
    }
  };

  const dist = await prepareDistribution();
  if (!dist.ok) {
    return fail('DISTRIBUTION_DOWNLOAD', dist.error);
  }

  // ③ 跑 wrapper 任务；④ 无条件把 properties 的原始字节写回。
  const args = ['wrapper', '--gradle-version', gradleVersion, '--no-validate-url'];
  const runner = opts.runGradle ?? runGradleTask;
  let restoreNote: string | null = null;
  const outcome: GradleTaskOutcome = await (async (): Promise<GradleTaskOutcome> => {
    try {
      return await runner({
        command: join(dist.home, 'bin', binName),
        args,
        cwd: projectPath,
        timeoutMs: opts.timeoutMs ?? DEFAULT_WRAPPER_TASK_TIMEOUT_MS,
        platform,
        ...(opts.javaHome === undefined ? {} : { javaHome: opts.javaHome }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
    } catch (err) {
      // 注入的执行器也可能抛 —— 同样收敛成结构化结果（要求⑥）。
      return { ok: false, exitCode: null, log: `wrapper 任务执行异常: ${(err as Error).message}` };
    } finally {
      // wrapper 任务会重写 properties（实测 509B → 252B：注释与 validateDistributionUrl
      // 被冲掉）。无论任务成败都还原：它由生成器拥有，构建期不许改。
      if (propsRaw !== null) {
        try {
          await writeFile(propsPath, propsRaw);
        } catch (err) {
          restoreNote = `还原 ${propsPath} 失败: ${(err as Error).message}`;
        }
      }
    }
  })();

  const head =
    `[mc-creator] 正在生成 Gradle wrapper（Gradle ${gradleVersion}，` +
    `发行版来源：${dist.source === 'download' ? '下载' : '缓存'} → ${dist.home}）`;
  const fullLog =
    restoreNote === null ? outcome.log : `${outcome.log}\n[mc-creator] ${restoreNote}\n`;

  if (!outcome.ok) {
    // ⑧ 兜底改写：预检 fail-open 漏掉的 JVM 过新情形，给同一条可读提示。
    const m = fullLog.match(/Unsupported class file major version (\d+)/);
    const hint =
      m === null
        ? ''
        : `；看起来是 JDK 过新：Gradle ${gradleVersion} 跑不了 JDK ${classFileMajorToJavaMajor(
            Number(m[1]),
          )}，请换更低版本的 JDK`;
    return fail(
      'WRAPPER_TASK_FAILED',
      `Gradle ${gradleVersion} 的 wrapper 任务失败（exit=${
        outcome.exitCode ?? '无退出码'
      }）${hint}\n${tail(fullLog)}`,
      `${head}\n${fullLog}`,
    );
  }
  if (!exists(join(projectPath, launcher))) {
    return fail(
      'WRAPPER_NOT_GENERATED',
      `wrapper 任务成功但 ${launcher} 仍不存在（Gradle 行为变化或输出落在别处）: ${projectPath}`,
      `${head}\n${fullLog}`,
    );
  }
  return {
    ok: true,
    created: true,
    gradleVersion,
    distributionUrl,
    distributionHome: dist.home,
    source: dist.source,
    log: `${head}\n> ${args.join(' ')}\n${fullLog}`,
  };
}
