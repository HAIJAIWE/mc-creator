/**
 * ForgeGradle 按需预热（把「第一次构建的 3 分钟」挪到用户点按钮的那一刻）。
 *
 * ── 为什么是「按需预热用户选的那一个 MC 版本」，而不是后台把组合全铺一遍 ──
 * 主代理用本仓生成器产出真实 Forge 1.20.1 工程，跑通了两次真机构建：
 *   冷启  BUILD SUCCESSFUL in 3m 14s
 *   缓存热后 BUILD SUCCESSFUL in 17s（走 gradlew.bat 再验一次是 21s）
 * 同一台机器上的磁盘构成决定了形态：
 *   ~/.gradle 合计              1212 MB
 *     caches/forge_gradle       385 MB  ← 反编译/映射缓存，冷启的大头
 *     jdks                      485 MB  ← foojay 下载的 JDK
 *     wrapper/dists             144 MB  ← Gradle 发行版（gradle-bootstrap 已覆盖）
 *     caches/modules-2           99 MB  ← 真正的 Maven 依赖
 * 本机复测 forge_gradle 内部构成（2026-10-06，只预热过 1.20.1 一个版本）：
 *   mcp_repo 172.4MB（de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/ 里的
 *     反编译产物，45.6MB+22.0MB+15.4MB+14.0MB+12.2MB…）
 *   + minecraft_user_repo 70.1MB + minecraft_repo 52.7MB + maven_downloader 89.4MB
 *   = 384.6MB，与上面那个 385MB 对得上。
 * 结论（**别改这个结论**）：冷启的大头是 ForgeGradle 对 Minecraft 的反编译，
 * 每个 MC 版本约 385MB、约 3 分钟；依赖下载只有 99MB。8 个 MC 版本全预热
 * ≈ 3GB 磁盘 + 二十多分钟后台任务，不现实。所以形态是**用户主动预热他选的那一个
 * MC 版本**，而不是启动时铺满后台。
 *
 * ── 六条设计要求（主代理拍板，逐条给出处）──
 * ① **绝不用用户的工程做预热**：预热工程建在**临时目录**里，跑完立刻删。
 *    出处（用用户工程预热的三重危害，均为本仓既有事实）：
 *    - 会污染他的 `build/` 并触发他自己的构建（devkit 的 build 就是 spawn
 *      `gradlew.bat build`，见 gradle.ts:97-115）；
 *    - 产物哈希会被算进去 —— `get_context_pack` 展示 lastBuildHash
 *      （core 的 context pack 把预热产物当成他的产物，上下文直接是错的）；
 *    - 半截预热产物留在工程里，下次真构建还要先清，排查时更难分辨是谁写的。
 *    这里再加一道**拒绝式**保护：预热临时目录一旦落在传入的 projectPath 之内，
 *    直接返回 TEMP_DIR_UNSAFE 而不跑（防止调用方把临时根目录配到工程里）。
 * ② **复用既有能力，不重造**：Gradle 发行版由 ./gradle-bootstrap.ts 负责
 *    （`ensureGradleWrapper` 已有发行版缓存 + JVM 上限预检，见其文件头②⑤），
 *    本模块**不接受**发行版下载，只要求调用方把 `ensureGradleWrapper` 返回的
 *    `distributionHome` 传进来（gradleHome），复用它的 `runGradleTask` 进程执行器。
 *    另外预热工程**故意不生成 wrapper**：直接跑发行版里的 bin/gradle，
 *    省掉 gradle-bootstrap.ts 文件头⑦记录的那次重复下载。
 *    唯一「自己动手」的部分就是要求②真正要补的那一步：**让 forge_gradle 缓存被填充**
 *    —— 在一个最小 Forge 工程上真跑一次 build（FG 的反编译发生在 minecraft 依赖
 *    解析阶段，所以哪怕工程只有一个空类也会把 385MB 走完，与生成器的真工程同一条路径）。
 * ③ **可中断**：接受 `signal`。进入时已中断 → 立刻返回 ABORTED 且不建临时目录；
 *    构建中被中断 → 返回 ABORTED。两条路径都在 finally 里删掉自建的临时目录，
 *    不留半截目录（fs 操作也可能抛，所以删除本身要吞掉错误：清理失败不该把
 *    一个成功的结果变成异常）。
 * ④ **结构化结果，不抛裸异常**：返回 `{ ok, warmed, aborted, code?, error?, log,
 *    elapsedMs, tempProjectDir }`。任一步失败都带**可直接展示的中文原因**
 *    （这是给用户看的进度文本，不是给日志看的）。与 gradle-bootstrap.ts 的
 *    `GradleWrapperResult` 同一套 discriminated union 风格，不新造异常体系。
 * ⑤ **进度可流**：接受 `onProgress?(msg: string)`，在「准备工程 → 写好文件 →
 *    下载依赖/反编译 → 完成」等阶段回调。这一步**几分钟不吐一个字**，
 *    不给进度用户一定以为卡死（Gradle 的输出全在最后的 log 里）。
 *    已知限制（不做的事）：阶段粒度是粗的，因为 gradle-bootstrap 的
 *    `GradleTaskRunner` 只在**进程结束**时回传合并日志、中途不可流式读；
 *    要真正的逐行进度得改那个执行器的签名，那属于动 W2 已合入的文件，超出本模块范围。
 * ⑥ **幂等**：目标 MC 版本已在 forge_gradle 缓存里 → 直接返回 `warmed:false`，
 *    **零 spawn、零临时目录、连 gradleHome 都不要求**（用户点第二次的热路径）。
 *    判据两条，优先用调用方给的 `alreadyWarm`（它可能来自别处的持久化记录），
 *    没给才自己探测 `<GRADLE_USER_HOME>/caches/forge_gradle/minecraft_repo/versions/<mc>`
 *    —— 这个目录名形状是本机实测的（见探测函数注释）。
 *
 * ── 适用范围（不做的事，写明以免后人当 bug 报）──
 * 本模块只覆盖 **Forge / ForgeGradle 6**。NeoForge 与 Fabric Loom 的缓存布局不同
 * （NeoForge 走 `neoformruntime`、Loom 的大部分缓存在工程内 `.gradle/loom-cache`，
 * 与「预热必须完全不碰工程」这条直接冲突），要支持得单开分支，不能顺手套用这里的判据。
 *
 * 依赖纪律：零第三方（同 gradle-bootstrap）。**不 import shared** —— devkit 的
 * dependencies 只有 contract + jobobject，mcVersion→forgeVersion 的映射
 * （shared/src/types/loader.ts:106-107）由调用方解析后经参数传入。
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  classFileMajorToJavaMajor,
  runGradleTask,
  type GradleTaskOutcome,
  type GradleTaskRunner,
} from './gradle-bootstrap.js';

/* ------------------------------------------------------------------ *
 * 常量与默认值（出处见文件头）
 * ------------------------------------------------------------------ */

/** ForgeGradle 插件版本：与生成器 pin 死的值一致（shared/src/types/loader.ts:107 的
 *  forgeGradleVersion='6.0.54'，被 forge-gradle.ts:84 读进 build.gradle）。
 *  loader.ts 那里写明「FG6 最新（滚动 [6.0,) 会误装 FG7，需 Gradle 9.3+，故 pin 死）」——
 *  预热工程若改成滚动线，热出来的缓存会和用户工程用的 FG 版本对不上号。 */
export const DEFAULT_FORGEGRADLE_VERSION = '6.0.54';

/** 预热工程的 toolchain 主版本：Forge 1.20.1 的 javaVersionFor 同样是 17
 *  （generator-mod/src/forge-gradle.ts:94 用它拼 toolchain）。 */
export const DEFAULT_WARMUP_JAVA_VERSION = 17;

/**
 * 预热任务的默认参数，逐个都有理由（不是随手堆的开关）：
 * - `build`               —— 生成器的真工程跑的就是 build（gradle.ts:103 默认 args ['build']）；
 *                            预热必须走**同一条**任务链，否则热出来的缓存对不上号。
 * - `--daemon`            —— 与 gradle.ts:105-108 强制 pin 的 --daemon 一致：
 *                            daemon 跨工程复用，顺手把 JVM 启动也预热了。
 * - `--console=plain`     —— 预热期间人盯着呢，rich console 的 ANSI 进度条
 *                            在读回的 log 里是噪声（Windows 终端还会吃掉 \r）。
 * - `--stacktrace`        —— 失败时多给一层栈，④ 的中文原因是从这份 log 里改写出来的。
 * 刻意**不加** `--quiet`：预热失败是需要排障的场景，日志越全越好。
 */
export const DEFAULT_WARMUP_TASKS: readonly string[] = [
  'build',
  '--daemon',
  '--console=plain',
  '--stacktrace',
];

/** 预热超时默认 20 分钟：实测冷启 3m14s 留足余量（1.20.1-Forge 是 8 个版本里最便宜的）。 */
export const DEFAULT_WARMUP_TIMEOUT_MS = 20 * 60 * 1000;

/* ------------------------------------------------------------------ *
 * 纯函数区：探测缓存 + 渲染预热工程（都能单测，不触网不起进程）
 * ------------------------------------------------------------------ */

/** MC 版本形状：'1.20.1' / '1.21' / '1.7.10'。校验它不是洁癖 ——
 *  mcVersion 会被拼进探测路径（forgeGradleCacheVersionDir），`../../x` 能越出缓存目录。 */
export function isValidMcVersion(mcVersion: string): boolean {
  return typeof mcVersion === 'string' && /^\d+\.\d+(?:\.\d+)*$/.test(mcVersion.trim());
}

/** Forge 版本形状：'47.4.23' / '1.7.10-10.13.4.1614-1.12.2'。同样进 build.gradle 文本，
 *  含引号/换行会把预热工程写坏。 */
export function isValidForgeVersion(forgeVersion: string): boolean {
  return (
    typeof forgeVersion === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(forgeVersion.trim())
  );
}

/** child 是否在 parent 之内（含相等）。两边都先 resolve，容忍 '..' 与相对路径。 */
export function isPathInside(child: string, parent: string): boolean {
  const c = resolve(child);
  const p = resolve(parent);
  if (c === p) return true;
  const rel = relative(p, c);
  if (rel === '' || isAbsolute(rel)) return false;
  // 只认路径段意义上的 '..'：直接 startsWith('..') 会把同级目录 `..foo` 误判成越界
  // （Windows 上合法存在，误判方向是「本该允许却拒绝」，会白白拦下一次预热）。
  return rel !== '..' && !rel.startsWith(`..${sep}`);
}

/**
 * 缺省 GRADLE_USER_HOME：`~/.gradle`。
 * 刻意**不**引入 jdk-download 的 cacheDir 约定：forge_gradle 缓存是 Gradle 自己
 * 的目录结构，本模块只读它判断「热没热」，不接管它（gradle.ts 文件头也说明了
 * 「本模块不改 GRADLE_USER_HOME，Gradle 自己的缺省即共享缓存」）。
 */
export function defaultGradleUserHome(home: string = homedir()): string {
  return join(home, '.gradle');
}

/**
 * 目标 MC 版本在 forge_gradle 缓存里的落点（本机 1.20.1 实测目录树）：
 *   ~/.gradle/caches/forge_gradle/minecraft_repo/versions/1.20.1/
 *     client.jar / client_mappings.txt / mcp_mappings.tsrg / *.sha1
 *   ~/.gradle/caches/forge_gradle/mcp_repo/net/minecraft/joined/1.20.1-20230612.114412/
 *   ~/.gradle/caches/forge_gradle/mcp_repo/de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/
 * 判据取 minecraft_repo/versions/<mc>（**目录存在即视为已热**）：它是「这个 MC 版本
 * 被 ForgeGradle 处理过」的最小、最便宜的证据（一次 existsSync），而 mcp_repo 下那两棵
 * 树的目录名带 MCP 时间戳（<mc>-20230612.114412），没法只靠 MC 版本拼出来。
 * 385MB 的反编译产物在 mcp_repo 里，但只要 versions/<mc> 在，FG 就是已经跑过一轮的，
 * 后面 build 会直接命中缓存 —— 判据与热路径的目标一致，够了。
 */
export function forgeGradleCacheVersionDir(gradleUserHome: string, mcVersion: string): string {
  return join(gradleUserHome, 'caches', 'forge_gradle', 'minecraft_repo', 'versions', mcVersion);
}

/** 探测结果：warm=true 时 probePath 是命中的那个目录（供日志）。 */
export interface ForgeGradleCacheProbe {
  warm: boolean;
  probePath: string;
}

/**
 * 探测「这个 MC 版本是不是已经热了」。existsSyncImpl 可注入。
 * **只判存在不判大小**：不递归统计 385MB（热路径要毫秒级，别做几万个 stat）。
 */
export function probeForgeGradleCache(opts: {
  gradleUserHome?: string;
  mcVersion: string;
  existsSyncImpl?: (p: string) => boolean;
}): ForgeGradleCacheProbe {
  const gradleUserHome = opts.gradleUserHome ?? defaultGradleUserHome();
  const probePath = forgeGradleCacheVersionDir(gradleUserHome, opts.mcVersion);
  const exists = opts.existsSyncImpl ?? existsSync;
  return { warm: exists(probePath), probePath };
}

/** 预热工程的一个文件（相对路径用 posix 分隔，避免 Windows 上写进 '\'）。 */
export interface WarmupFile {
  path: string;
  content: string;
}

export interface WarmupProjectSpec {
  mcVersion: string;
  forgeVersion: string;
  forgeGradleVersion?: string;
  javaVersion?: number;
}

/**
 * 渲染最小 Forge 工程（4 个文件）。逐条与生成器对齐，理由写在这里：
 *
 * - `settings.gradle` 里的 **foojay toolchain 解析器**必须带：build.gradle 声明了
 *   `java.toolchain.languageVersion`，本机没有对应 JDK 时 Gradle 不会自己去下载，
 *   缺这行的失败形态极具误导性（forge-gradle.ts:26-35 实测原文）：
 *     > No locally installed toolchains match and toolchain download repositories have not been configured.
 *   > BUILD FAILED in 1m 57s
 *   报在依赖解析之后，控制台往前翻全是下载日志，用户会去查 maven 配置 —— 全白费。
 *   带着它，JDK 17（占冷启 485MB 的大头）也在预热阶段被下载掉。
 * - `pluginManagement` 里的 **`maven { url "https://maven.minecraftforge.net/" }`
 *   同样不能省**：ForgeGradle 插件不在 Gradle Portal，只能靠它解析
 *   （forge-gradle.ts:120-134 原话：「这段仓库声明是 Forge 能构建的前提」）。
 * - `minecraft { mappings channel: 'official', version: <mc> }` —— 映射就是
 *   385MB 反编译缓存的入口，与生成器同写法（forge-gradle.ts:96-97）。
 * - `dependencies { minecraft 'net.minecraftforge:forge:<mc>-<forge>' }` ——
 *   **这一行才是预热目标**：FG 的反编译挂在 minecraft 依赖的解析上。
 * - **不放** `runs { client/server }`（预热不启动游戏）、**不放** parchment 块
 *   （可选参数，少一个失败源）、**不放** wrapper properties（直接跑发行版，
 *   见文件头②）。
 * - 一个空的 `src/main/java` 源文件：不是为了产物，是为了让 `build` 真的去解析
 *   compileClasspath 并触/toolchain 解析 —— 没有源码时 compileJava 可能是 NO-SOURCE，
 *   少一段预热就白跑一次几分钟。
 */
export function renderWarmupProjectFiles(spec: WarmupProjectSpec): WarmupFile[] {
  const fg = spec.forgeGradleVersion ?? DEFAULT_FORGEGRADLE_VERSION;
  const javaVersion = spec.javaVersion ?? DEFAULT_WARMUP_JAVA_VERSION;
  const { mcVersion, forgeVersion } = spec;
  return [
    {
      path: 'settings.gradle',
      content: `// 由 mc-creator 的 ForgeGradle 预热生成（一次性目录，跑完即删）
plugins {
    id 'org.gradle.toolchains.foojay-resolver-convention' version '0.10.0'
}

pluginManagement {
    repositories {
        gradlePluginPortal()
        maven { url "https://maven.minecraftforge.net/" }
    }
}

rootProject.name = 'mc-creator-warmup'
`,
    },
    {
      path: 'build.gradle',
      content: `plugins {
    id 'java'
    id 'net.minecraftforge.gradle' version '${fg}'
}

base {
    archivesName = 'mc-creator-warmup'
}

java.toolchain.languageVersion = JavaLanguageVersion.of(${javaVersion})

minecraft {
    mappings channel: 'official', version: '${mcVersion}'
}

dependencies {
    minecraft 'net.minecraftforge:forge:${mcVersion}-${forgeVersion}'
}

repositories {
    mavenCentral()
}
`,
    },
    {
      path: 'gradle.properties',
      content: `# 与生成器 forgeGradleProperties 同一组键（ForgeGradle 自己会读 mc_version）
mod_version=0.0.0
maven_group=com.mc-creator.warmup
archives_base_name=mc-creator-warmup

# Minecraft / Forge
mc_version=${mcVersion}
forge_version=${forgeVersion}
`,
    },
    {
      path: 'src/main/java/com/mccreator/warmup/Warmup.java',
      content: `package com.mccreator.warmup;

/**
 * 占位类：只为让 \`build\` 走完整的依赖解析 + toolchain 解析。
 * 预热目标在 ForgeGradle 的反编译缓存里，这个类编译完就被删掉了。
 */
public final class Warmup {
    private Warmup() {}

    public static void main(String[] args) {
        // no-op
    }
}
`,
    },
  ];
}

/** 日志尾部（错误信息里只放尾部，别让几千行下载日志糊住界面）—— 同 gradle-bootstrap.ts。 */
function tail(log: string, maxLines = 12): string {
  const lines = log.trimEnd().split(/\r?\n/);
  return lines.length <= maxLines ? lines.join('\n') : lines.slice(-maxLines).join('\n');
}

/* ------------------------------------------------------------------ *
 * fs 注入点（要求③的清理、要求①的建临时工程都走这里；默认真 fs）
 * ------------------------------------------------------------------ */

export interface WarmupFs {
  /** 在系统临时目录里造一个**新的**独立目录。 */
  mkdtemp(prefix: string): Promise<string>;
  mkdir(dir: string): Promise<void>;
  writeFile(path: string, content: string): Promise<void>;
  rm(path: string): Promise<void>;
}

/** 默认实现：真 fs。返回值收敛成 void，接口才好被测试整体替换。 */
export const nodeWarmupFs: WarmupFs = {
  async mkdtemp(prefix) {
    return mkdtemp(prefix);
  },
  async mkdir(dir) {
    await mkdir(dir, { recursive: true });
  },
  async writeFile(path, content) {
    await writeFile(path, content, 'utf8');
  },
  async rm(path) {
    await rm(path, { recursive: true, force: true });
  },
};

/* ------------------------------------------------------------------ *
 * 结构化结果（要求④）
 * ------------------------------------------------------------------ */

export type GradleWarmupErrorCode =
  /** mcVersion 缺失或形状非法（会进文件路径，必须先挡住 '..'）。 */
  | 'MC_VERSION_INVALID'
  /** forgeVersion 缺失或形状非法。 */
  | 'FORGE_VERSION_INVALID'
  /** 没给 gradleHome（要求②：本模块不下发行版，请传 ensureGradleWrapper 的 distributionHome）。 */
  | 'GRADLE_HOME_MISSING'
  /** 临时目录建不出来 / 建在了用户工程里。 */
  | 'TEMP_DIR_CREATE'
  /** 预热工程写盘失败。 */
  | 'PROJECT_WRITE'
  /** 预热构建失败（含超时、工具链缺失等，error 里是人话改写）。 */
  | 'BUILD_FAILED'
  /** 被调用方中断（不是失败）。 */
  | 'ABORTED';

export interface GradleWarmupSucceeded {
  ok: true;
  /** true = 本次真的把 forge_gradle 缓存跑热了；false = 进来时就已热，什么都没做。 */
  warmed: boolean;
  aborted: false;
  /** 进程日志（构建输出全文）。热路径为 ''。 */
  log: string;
  elapsedMs: number;
  /** 预热用的一次性工程目录（跑完已删除，留个线索便于排障）；热路径与早退为 ''。 */
  tempProjectDir: string;
}

export interface GradleWarmupFailed {
  ok: false;
  warmed: false;
  /** true = 被 signal 中断（调用方通常不该当错误展示，只是「取消」）。 */
  aborted: boolean;
  code: GradleWarmupErrorCode;
  /** 可直接展示给用户的中文原因。 */
  error: string;
  log: string;
  elapsedMs: number;
  /** 若临时目录已建出来，这里是它的路径（**已被清理**）；早退为 ''。 */
  tempProjectDir: string;
}

export type GradleWarmupResult = GradleWarmupSucceeded | GradleWarmupFailed;

/* ------------------------------------------------------------------ *
 * 主入口
 * ------------------------------------------------------------------ */

export interface WarmForgeGradleOptions {
  /** 目标 Minecraft 版本，如 '1.20.1'。 */
  mcVersion: string;
  /** 目标 Forge 版本，如 '47.4.23'（由调用方从 LoaderVersionConfig 解析后传入）。 */
  forgeVersion: string;
  /** ForgeGradle 插件版本，缺省 6.0.54（与生成器一致）。 */
  forgeGradleVersion?: string;
  /** toolchain 主版本，缺省 17。 */
  javaVersion?: number;
  /**
   * 用户的工程目录。**只用于安全校验**（要求①）：预热临时目录一旦落在它之内就拒绝。
   * 本模块不会读它、更不会写它、更不会删它。
   */
  projectPath?: string;
  /**
   * 预热用的一次性工程的父目录。缺省 `mkdtemp(os.tmpdir())`。
   * 调用方可以指定（如 <cacheDir>/warmup），但绝不能指向用户的工程目录。
   */
  tmpRoot?: string;
  /**
   * Gradle 发行版根目录（含 bin/gradle(.bat)），即 `ensureGradleWrapper` 返回的
   * `distributionHome`（要求②：发行版由 gradle-bootstrap 负责，本模块不下）。
   */
  gradleHome?: string;
  /** 给发行版里的 gradle 指定 JAVA_HOME（同 gradle.ts 的 javaHome 语义，可选）。 */
  javaHome?: string;
  /** 预热任务与参数，缺省 DEFAULT_WARMUP_TASKS。 */
  tasks?: readonly string[];
  /** 超时毫秒，缺省 20 分钟。 */
  timeoutMs?: number;
  /** 调用方取消信号（要求③）。 */
  signal?: AbortSignal;
  /** 进度回调（要求⑤）：这一步几分钟不吐字，必须让界面有话说。 */
  onProgress?: (msg: string) => void;
  /** 覆盖目标平台（单测用；默认本机），决定 bin/gradle 还是 bin/gradle.bat。 */
  platform?: NodeJS.Platform;
  /**
   * 调用方给的幂等判据（要求⑥）：已热就不要再跑。给了 true 则**完全不碰磁盘探测**。
   */
  alreadyWarm?: boolean;
  /** 探测用的 GRADLE_USER_HOME，缺省 ~/.gradle。 */
  gradleUserHome?: string;

  /* —— 注入点：单测全 mock，不触网、不真跑 Gradle —— */
  runGradle?: GradleTaskRunner;
  fs?: WarmupFs;
  existsSyncImpl?: (p: string) => boolean;
  /** 毫钟时钟（elapsedMs 可确定断言）。 */
  now?: () => number;
}

function fail(
  code: GradleWarmupErrorCode,
  error: string,
  opts: { elapsedMs: number; log?: string; tempProjectDir?: string; aborted?: boolean },
): GradleWarmupFailed {
  return {
    ok: false,
    warmed: false,
    aborted: opts.aborted === true,
    code,
    error,
    log: opts.log ?? '',
    elapsedMs: opts.elapsedMs,
    tempProjectDir: opts.tempProjectDir ?? '',
  };
}

export async function warmForgeGradleCache(
  opts: WarmForgeGradleOptions,
): Promise<GradleWarmupResult> {
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const elapsed = (): number => Math.max(0, now() - startedAt);
  const fsOps = opts.fs ?? nodeWarmupFs;
  const exists = opts.existsSyncImpl ?? existsSync;
  const platform = opts.platform ?? process.platform;
  const binName = platform === 'win32' ? 'gradle.bat' : 'gradle';
  const onProgress = (msg: string): void => {
    try {
      opts.onProgress?.(msg);
    } catch {
      /* 回调抛错不许影响预热本身（调用方的 UI 崩了不是预热的错） */
    }
  };

  /* 参数校验：mcVersion/forgeVersion 会进文件路径与文本，必须先挡。 */
  const mcVersion = typeof opts.mcVersion === 'string' ? opts.mcVersion.trim() : '';
  if (!isValidMcVersion(mcVersion)) {
    return fail(
      'MC_VERSION_INVALID',
      `Minecraft 版本非法（需形如 1.20.1 / 1.21）: ${JSON.stringify(opts.mcVersion)}`,
      { elapsedMs: elapsed() },
    );
  }
  const forgeVersion = typeof opts.forgeVersion === 'string' ? opts.forgeVersion.trim() : '';
  if (!isValidForgeVersion(forgeVersion)) {
    return fail(
      'FORGE_VERSION_INVALID',
      `Forge 版本非法（需形如 47.4.23）: ${JSON.stringify(opts.forgeVersion)}`,
      { elapsedMs: elapsed() },
    );
  }

  /* ⑥ 幂等热路径：已热就返回，零 spawn、零临时目录、连 gradleHome 都不要求。
     放在所有校验之后、gradleHome 校验之前 —— 用户点第二次不该被任何参数挡住。 */
  if (opts.alreadyWarm === true) {
    onProgress(`Minecraft ${mcVersion} 的 ForgeGradle 缓存已就绪，无需预热`);
    return {
      ok: true,
      warmed: false,
      aborted: false,
      log: `[mc-creator] Minecraft ${mcVersion} 的 ForgeGradle 缓存已就绪（调用方判定），跳过预热\n`,
      elapsedMs: elapsed(),
      tempProjectDir: '',
    };
  }
  const probe = probeForgeGradleCache({
    mcVersion,
    ...(opts.gradleUserHome === undefined ? {} : { gradleUserHome: opts.gradleUserHome }),
    existsSyncImpl: exists,
  });
  if (probe.warm) {
    onProgress(`Minecraft ${mcVersion} 的 ForgeGradle 缓存已就绪，无需预热`);
    return {
      ok: true,
      warmed: false,
      aborted: false,
      log: `[mc-creator] Minecraft ${mcVersion} 的 ForgeGradle 缓存已就绪（${probe.probePath}），跳过预热\n`,
      elapsedMs: elapsed(),
      tempProjectDir: '',
    };
  }

  /* ② 发行版由 gradle-bootstrap 负责，这里只校验「你给我一个发行版」。 */
  if (opts.gradleHome === undefined || opts.gradleHome.trim() === '') {
    return fail(
      'GRADLE_HOME_MISSING',
      '缺少 Gradle 发行版目录（gradleHome）。请先走 ensureGradleWrapper 并把它的 ' +
        'distributionHome 传进来 —— 本模块不负责下载发行版，避免和它抢缓存。',
      { elapsedMs: elapsed() },
    );
  }
  // 取成本地常量：下面 execute 是闭包，读属性会丢掉这里的收窄。
  const gradleHome = opts.gradleHome;

  /* ③ 进入即已中断：连临时目录都不建。 */
  if (opts.signal?.aborted === true) {
    return fail('ABORTED', '预热已被取消', { elapsedMs: elapsed(), aborted: true });
  }

  /* ① 准备一次性工程：mkdtemp 造独立目录，绝不复用调用方给的路径。 */
  onProgress(`准备预热工程（Minecraft ${mcVersion} + Forge ${forgeVersion}，不碰你的工程）…`);
  const tmpRoot = opts.tmpRoot === undefined ? undefined : resolve(opts.tmpRoot);
  const prefix =
    tmpRoot === undefined
      ? join(tmpdir(), 'mc-creator-warmup-')
      : join(tmpRoot, 'mc-creator-warmup-');
  let tempProjectDir: string;
  try {
    if (tmpRoot !== undefined) await fsOps.mkdir(tmpRoot);
    tempProjectDir = await fsOps.mkdtemp(prefix);
  } catch (err) {
    return fail('TEMP_DIR_CREATE', `创建预热临时目录失败: ${(err as Error).message}`, {
      elapsedMs: elapsed(),
    });
  }
  // 拒绝式保护：临时目录绝不能落在用户工程里（要求①）。调用方把 tmpRoot 配错时
  // 宁可失败也不能去预热用户的 build/ —— 那正是本条要防的事。
  if (opts.projectPath !== undefined && isPathInside(tempProjectDir, opts.projectPath)) {
    try {
      await fsOps.rm(tempProjectDir);
    } catch {
      /* 清理失败也不能抛：下面已经有一条失败结果了 */
    }
    return fail(
      'TEMP_DIR_CREATE',
      `拒绝在用户工程目录内预热（预热目录 ${tempProjectDir} 位于 ${opts.projectPath} 内）。` +
        '请把 tmpRoot 指到工程外的临时目录。',
      { elapsedMs: elapsed(), tempProjectDir },
    );
  }

  /* 预热主体：自己收敛所有异常（要求④），保证外层 finally 一定能拿到一个结果。 */
  const execute = async (): Promise<GradleWarmupResult> => {
    /* ① 写最小工程（4 个文件，见 renderWarmupProjectFiles 的逐条理由）。 */
    const files = renderWarmupProjectFiles({
      mcVersion,
      forgeVersion,
      ...(opts.forgeGradleVersion === undefined
        ? {}
        : { forgeGradleVersion: opts.forgeGradleVersion }),
      ...(opts.javaVersion === undefined ? {} : { javaVersion: opts.javaVersion }),
    });
    try {
      for (const f of files) {
        const abs = join(tempProjectDir, ...f.path.split('/'));
        await fsOps.mkdir(dirname(abs));
        await fsOps.writeFile(abs, f.content);
      }
    } catch (err) {
      return fail('PROJECT_WRITE', `写预热工程失败: ${(err as Error).message}`, {
        elapsedMs: elapsed(),
        log: `[mc-creator] 预热工程目录: ${tempProjectDir}\n`,
        tempProjectDir,
      });
    }

    /* ⑤ 进度：这是「用户以为卡死」的那几分钟，先把话说清楚。 */
    onProgress(
      `开始下载依赖并反编译 Minecraft ${mcVersion}` +
        '（最慢的一步，实测冷启约 3 分钟，请勿关闭窗口）…',
    );

    /* ② + ④：复用 gradle-bootstrap 的执行器与进程语义；失败收敛成结构化结果。 */
    const tasks = [...(opts.tasks ?? DEFAULT_WARMUP_TASKS)];
    const runner = opts.runGradle ?? runGradleTask;
    const head =
      `[mc-creator] 预热 Minecraft ${mcVersion} 的 ForgeGradle 缓存（Forge ${forgeVersion}，` +
      `一次性工程 ${tempProjectDir}，约 385MB / 数分钟）`;
    let outcome: GradleTaskOutcome;
    try {
      outcome = await runner({
        command: join(gradleHome, 'bin', binName),
        args: tasks,
        cwd: tempProjectDir,
        timeoutMs: opts.timeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS,
        platform,
        ...(opts.javaHome === undefined ? {} : { javaHome: opts.javaHome }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
    } catch (err) {
      // 注入的执行器也可能抛 —— 同样收敛成结构化结果（要求④）。
      outcome = {
        ok: false,
        exitCode: null,
        log: `预热构建执行异常: ${(err as Error).message}`,
      };
    }
    const fullLog = `${head}\n> ${tasks.join(' ')}\n${outcome.log}`;

    /* ③ 构建期间被中断：报「取消」而不是「构建失败」。 */
    if (opts.signal?.aborted === true) {
      onProgress('预热已取消');
      return fail('ABORTED', '预热已被取消', {
        elapsedMs: elapsed(),
        log: fullLog,
        tempProjectDir,
        aborted: true,
      });
    }
    if (outcome.ok !== true) {
      /* ④ 人话改写：三种实测踩过的失败形态，别把原生堆栈直接甩给用户。 */
      const hints: string[] = [];
      const sfm = fullLog.match(/Unsupported class file major version (\d+)/);
      if (sfm !== null) {
        // 与 gradle-bootstrap.ts 文件头⑧同一处理：class 文件版本 = JVM 主版本 + 44。
        const javaMajor = classFileMajorToJavaMajor(Number(sfm[1]));
        hints.push(
          `看起来是 JDK 过新（当前 JVM 主版本 ${javaMajor}）：` +
            `请换 JDK ${javaMajor - 1} 或更低后重试`,
        );
      }
      if (
        /No locally installed toolchains match|toolchain download repositories have not been configured/.test(
          fullLog,
        )
      ) {
        // forge-gradle.ts:26-28 实测原文：这行报错长得很像依赖问题，实际是缺 JDK。
        hints.push(
          `缺 Java ${opts.javaVersion ?? DEFAULT_WARMUP_JAVA_VERSION} 工具链且自动下载源不可用：` +
            '请确认网络可访问，或手动安装对应 JDK 后重试',
        );
      }
      if (
        /forgegradle|ForgeGradle/.test(fullLog) &&
        /Could not (?:find|resolve|GET|HEAD)/i.test(fullLog)
      ) {
        hints.push('看起来是 ForgeGradle 插件/Minecraft 依赖拉不下来，请检查网络或代理设置');
      }
      const suffix = hints.length === 0 ? '' : `\n提示：${hints.join('；')}`;
      return fail(
        'BUILD_FAILED',
        `预热构建失败（exit=${outcome.exitCode ?? '无退出码'}）${suffix}\n${tail(fullLog)}`,
        {
          elapsedMs: elapsed(),
          log: fullLog,
          tempProjectDir,
        },
      );
    }

    const ms = elapsed();
    onProgress(
      `预热完成：Minecraft ${mcVersion} 的 ForgeGradle 缓存已就绪（用时 ${(ms / 1000).toFixed(1)}s）`,
    );
    return {
      ok: true,
      warmed: true,
      aborted: false,
      log: `${fullLog}\n[mc-creator] 预热完成（${(ms / 1000).toFixed(1)}s）\n`,
      elapsedMs: ms,
      tempProjectDir,
    };
  };

  /* 兜底：execute 内部已收敛所有已知异常；万一将来有人加了 throw，也不许把裸异常
     甩给调用方（要求④），更不能连带把上面的清理跳过 —— 所以包一层。 */
  const safeExecute = async (): Promise<GradleWarmupResult> => {
    try {
      return await execute();
    } catch (err) {
      return fail('BUILD_FAILED', `预热过程中出现未预期的错误: ${(err as Error).message}`, {
        elapsedMs: elapsed(),
        tempProjectDir,
        log: err instanceof Error ? (err.stack ?? '') : String(err),
      });
    }
  };

  /* ③ 无条件清理：成功、失败、中断都删。删不掉只把提示追加进日志（清理失败不该把
     一个成功结果变成异常，用户能手动删这个一次性目录）。 */
  const result = await safeExecute();
  try {
    await fsOps.rm(tempProjectDir);
  } catch (err) {
    const note =
      `\n[mc-creator] 清理预热临时目录 ${tempProjectDir} 失败（可手动删除）: ` +
      `${(err as Error).message}\n`;
    return { ...result, log: result.log + note };
  }
  return result;
}
