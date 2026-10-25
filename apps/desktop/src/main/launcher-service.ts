/**
 * 游戏启动器服务（迷你版 PCL2/HMCL）。
 *
 * 链路：版本清单 → 下载 client.jar → 下载 assets → 下载 libraries → 启动 Java。
 *
 * 账户（§5.8 / §13.2，2026-10 更新）：
 * - **正版为第一路径**（§1.2 第 1 条）：`launchGame` 支持传入
 *   `LaunchCredentials`（来自 `ms-auth-service.ts` 的微软登录链路）。
 *   正版模式下 `--uuid` 用 **Minecraft profile 的 UUID**（不是随机值）、
 *   `--accessToken` 用真实的 Minecraft access token、`--userType msa`。
 * - **离线模式仅保留用于本地开发/测试**（§1.2 第 2 条）：
 *   不传 `credentials` 时才走离线分支（`accessToken=0`、UUID 随机、
 *   `userType=legacy`）。该分支**不在产品宣传中作为卖点**。
 * - **第三方认证站默认关闭**（§1.2 第 3 条 / §5.8 / §19）：
 *   启用必须经 `ThirdPartyAuthGate`（默认关闭 + 显式确认 + 风险提示全文）。
 *   见 `enableThirdPartyAuth()`。
 *
 * 其余设计：
 * - 纯 Node 原生实现（fetch + fs），无第三方依赖
 * - 目录结构（userData/mc-launcher/）：
 *   - versions/<ver>/<ver>.json + <ver>.jar
 *   - assets/indexes/<ver>.json + objects/<hash前2>/<hash>
 *   - libraries/<groupPath>/<artifact>/<ver>/<artifact>-<ver>.jar
 * - 1.21.x 使用官方 Mojang 映射，无 natives 下载（新库方案）
 */

import { join, dirname, resolve, relative, isAbsolute, sep } from 'node:path';
import { mkdir, writeFile, readFile, access, readdir, stat, rm } from 'node:fs/promises';
import { existsSync, type Dirent } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { parseNbt, nbtGet, nbtCompound, type NbtTag } from './nbt-reader.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import {
  expandDownloadCandidates,
  manifestCandidates,
  SourcePreferenceStore,
  type DownloadSource,
  type SourcePreference,
} from './download-sources.js';
import type { ModInfo, InstanceFileInfo, WorldInfo, ContentKind } from '../shared/ipc/launcher.js';
import { ComplianceDeniedError, type ThirdPartyAuthGate } from './compliance-gate.js';
import { abortError, isAbortError, sleepAbortable, throwIfAborted } from './abort.js';
import { resolveFabricInstallerRelease } from '@mc-creator/core';
import { parseJavaMajorVersion } from '@mc-creator/devkit';
import {
  NEOFORGE_MAVEN_METADATA_URL,
  isNeoForgeVersionString,
  neoforgeInstallerUrl,
  parseMavenVersions,
  pickNeoForgeVersion,
} from './neoforge-version.js';
import {
  parseNeoForgeLaunchSpec,
  substituteProfileArgs,
  type NeoForgeLaunchSpec,
} from './neoforge-launch.js';
import {
  VANILLA_MAIN_CLASS,
  mergeProfileChain,
  parseProfileJson,
  runtimeJarName,
  walkProfileChain,
  type VersionProfileJson,
} from './version-profile.js';

/** 继承链的**链底**（原版档案）。链里最靠后那个。 */
function chainRoot(chain: VersionProfileJson[]): VersionProfileJson {
  return chain[chain.length - 1] ?? {};
}

/** 链底档案的服务端下载信息（`number` 收窄成 `number | null`）。 */
function rootServer(chain: VersionProfileJson[]): FileExpectation | null {
  const s = chainRoot(chain).downloads?.server;
  if (!s?.url) return null;
  return {
    url: s.url,
    sha1: s.sha1 ?? null,
    size: typeof s.size === 'number' ? s.size : null,
  };
}

/**
 * 由**主类**判断这是哪个加载器。
 *
 * 为什么不看档案 id：官方 installer 产出的 id 是 `<mc>-<loaderVer>`
 * （`1.21.1-0.19.5`），从字符串里认不出加载器；主类才是权威事实。
 *
 * 认不出来（`null` / 没给 / 是原版主类）就回 `vanilla` —— 那意味着
 * 「不加任何加载器专属参数」，而不是「猜一个」。
 */
export function inferLoaderFromMainClass(
  mainClass: string | undefined | null,
): 'vanilla' | 'fabric' | 'neoforge' {
  if (!mainClass) return 'vanilla';
  if (mainClass === VANILLA_MAIN_CLASS) return 'vanilla';
  // Fabric：net.fabricmc.…（KnotClient / KnotServer）
  if (mainClass.includes('fabricmc')) return 'fabric';
  // NeoForge：cpw.mods.bootstraplauncher.… / net.neoforged.… / net.minecraftforge.…
  if (
    mainClass.includes('bootstraplauncher') ||
    mainClass.includes('neoforged') ||
    mainClass.includes('minecraftforge') ||
    mainClass.includes('cpw.mods')
  ) {
    return 'neoforge';
  }
  return 'vanilla';
}

/** 请求外部 API 时的 User-Agent（Modrinth 等公共 API 要求标识来源）。 */
const USER_AGENT = 'mc-creator/0.0.0 (https://github.com/mc-creator)';

/** level.dat 的 GameType 取值（MC 的标准枚举） */
const GAME_MODES: Record<number, string> = {
  0: '生存',
  1: '创造',
  2: '冒险',
  3: '旁观',
};

/**
 * 读一份 `level.dat` 并解析。
 *
 * MC 写出的 level.dat 是 **gzip 压缩**的；但世界存档常被第三方工具处理过，
 * 留下**未压缩**的裸 NBT。所以按 gzip magic（0x1f 0x8b）判断，两种都支持。
 */
async function readWorldNbt(path: string): Promise<{ [key: string]: NbtTag } | null> {
  const buf = await readFile(path);
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  const data = isGzip ? gunzipSync(buf) : buf;
  return parseNbt(data);
}

/**
 * 目录总字节数（含子目录）。
 *
 * `level.dat` 本身只有几 KB，真正占地方的是 `region/` 里的 .mca 区块文件，
 * 所以「世界大小」必须递归统计才有意义。
 * 深度与条目数设上限：损坏存档里可能有环或超深目录，不设限会卡死主进程。
 */
async function dirSize(dir: string, depth = 0): Promise<number> {
  if (depth > 8) return 0;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const e of entries) {
    // 不跟随软链：指向实例目录外的软链会把无关文件的大小算进来
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) {
      total += await dirSize(join(dir, e.name), depth + 1);
    } else if (e.isFile()) {
      try {
        total += (await stat(join(dir, e.name))).size;
      } catch {
        /* 列举后被删除 */
      }
    }
  }
  return total;
}

/**
 * 把不可信的相对路径解析到 `root` 之内，越界即抛错。
 *
 * 渲染层传来的 `relPath` 是用户可输入的：只做 `join` 会被 `..` 绕过，
 * 把实例目录之外的整个用户目录暴露给 IPC。调用方须把本函数抛出的错误
 * 转成用户可见的错误信息，不得静默降级为「空列表」。
 */
export function resolveInside(root: string, relPath: string): string {
  const abs = resolve(root, relPath);
  const rel = relative(resolve(root), abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`路径越界: ${relPath}`);
  }
  if (rel.split(/[\\/]/).includes('..')) {
    throw new Error(`路径越界: ${relPath}`);
  }
  // Windows 大小写不敏感：补一层分隔符比较，防 `saves\..\..\x` 形态绕过
  const rootWithSep = resolve(root).endsWith(sep) ? resolve(root) : resolve(root) + sep;
  if (!abs.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    throw new Error(`路径越界: ${relPath}`);
  }
  return abs;
}
/**
 * 断言 `versionId` 是**单个**路径段（渲染层可控）。
 *
 * 只守 `filename` 是不够的：`join(base, 'game', versionId, 'crash-reports')`
 * 里的 `versionId` 同样是用户可输入的，`versionId = '../../..'` 会把
 * **根目录**本身挪到实例目录之外，后面的 `resolveInside` 就再也拦不住
 * （守卫是相对 root 算的，root 已经跑出去了）。
 */
function assertVersionId(versionId: string): void {
  if (
    versionId === '' ||
    isAbsolute(versionId) ||
    /[\\/]/.test(versionId) ||
    versionId.includes('..')
  ) {
    throw new Error(`非法的版本目录名: ${versionId}`);
  }
}

/**
 * 服务端 jar 的形态：bundler（引导器）还是独立包。
 *
 * ## 为什么必须实测，不能按版本号推
 *
 * 真实分界在 **1.18**：1.17.1 及更早的 server.jar 根目录直接是
 * `a.class`、`aa.class`…；1.18 起换成了 `net/minecraft/bundler/Main.class`
 * 加一个根 `version.json`，**首次运行才去下载**服务端本体、依赖库与资源。
 *
 * 曾想用 `javaMajor >= 18` 当判据 —— **错的**：1.18 要求的是 Java 17。
 * 版本号和 javaMajor 在这里只是碰巧同时变，没有因果关系；
 * 拿一个会漂的代理量去断言一件事实，下一个版本就会说错话。
 * 所以直接读 zip 的**本地文件头**看事实。
 */
export type ServerJarKind = 'bundler' | 'standalone' | 'unknown';

/** 本地文件头签名 `PK\x03\x04`。 */
const ZIP_LOCAL_SIG = 0x04034b50;

/** 扫多少字节找条目名。bundler 的标记条目都在最前面，实测 8 KB 足够。 */
const ZIP_SCAN_BYTES = 64 * 1024;

/**
 * 只读 zip 的本地文件头，判断服务端 jar 是 bundler 还是独立包。**不解压**。
 *
 * ## 判据
 *
 * bundler 的标记是**根目录**的 `version.json`（实测：1.18.2 在第 10 个条目，
 * 26.3 在第 1 个；独立包 1.17.1 的前 109 个条目里没有它）。
 * 于是：窗口内见到 → `bundler`；**扫完窗口都没见到** → `standalone`。
 *
 * ## 为什么"扫完窗口"就敢下结论，而不是返回 unknown
 *
 * 头一版把"扫到上限"也判成 `unknown`，那是个真 bug：真实独立包有**几千个**
 * `.class` 条目，64 KB 窗口远远扫不完，于是所有真实独立包都会被误判成"认不出来"。
 * （是被 `server-download.test.ts` 抓到的 —— 合成夹具没有中央目录，
 * 提前暴露了同一个洞。）
 *
 * 兜底的 `unknown` 只留给真正读不懂的情况：**开头就不是 zip**（空文件、
 * 404 的 HTML 页面），或本地文件头自身被截断。那两种情况确实无法判断。
 */
export function detectServerJarKind(buf: Buffer): ServerJarKind {
  if (buf.length < 30) return 'unknown';
  if (buf.readUInt32LE(0) !== ZIP_LOCAL_SIG) return 'unknown';
  let off = 0;
  const cap = Math.min(buf.length, ZIP_SCAN_BYTES);
  while (off + 30 <= cap) {
    if (buf.readUInt32LE(off) !== ZIP_LOCAL_SIG) {
      // 撞上中央目录（PK\x01\x02）或中央目录结束记录 —— 条目列表走完了，
      // 前面没有 version.json，那就是独立包。
      return 'standalone';
    }
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    if (off + 30 + nameLen > buf.length) return 'unknown';
    const name = buf.toString('utf-8', off + 30, off + 30 + nameLen);
    if (name === 'version.json') return 'bundler';
    const compSize = buf.readUInt32LE(off + 18);
    off += 30 + nameLen + extraLen + compSize;
  }
  // 窗口扫完都没见到标记 —— 见上面的说明，这里判独立包是安全的
  return 'standalone';
}

/**
 * 断言内存参数是 JVM 认得的**单个**内存规格。
 *
 * 实测出来的洞（2026-10-11 修复）：此前是裸的 ``-Xmx${opts.memory}``。
 *
 * 严重性要说准：它**不是** RCE —— ``memory`` 落在 argv 数组的**一个元素**里，
 * 塞空格也分裂不成独立的 JVM 选项，``-javaagent:`` 因此无法生效。
 * 真实后果是另一类：值一脏，游戏进程起来了却在 JVM 内部炸掉，
 * 报的是 ``Invalid maximum heap size`` 这种与用户操作毫无关系的错。
 * 但它仍属"渲染层逐字控制 JVM 参数"，与 §10.6 的纪律同源，顺手一起收。
 *
 * 接受 ``2048`` / ``2G`` / ``4096M`` 这几种真实写法，不接受任何其他形态。
 */
function assertMemorySpec(memory: string): void {
  if (!/^\d{1,7}[GgMmKk]?$/.test(memory)) {
    throw new Error(`非法的内存设置: ${memory}（应形如 2G / 4096M）`);
  }
}

/**
 * 解析实例工作目录（传给 JVM 的 `--gameDir`）。
 *
 * 规则：`requested` 为空 → 缺省 `baseDir/game/<versionId>`；
 * 非空时**必须落在 baseDir 内**。
 *
 * 实测出来的洞（2026-10-11 修复）：此前是裸的
 * `opts.gameDir || join(baseDir,'game',id)` 随后 `mkdir -p`。
 * 而 `gameDir` 来自 ``LAUNCHER_LAUNCH`` 请求体（schema 里就是 `z.string()`），
 * 渲染层可以给任意绝对路径 —— 于是主进程会在**应用管不到的地方**建目录，
 * 游戏再把存档、配置、资源包全写进去。
 *
 * 这是用户问「下载和安装是不是都在本文件夹里」时最该被查出来的一条：
 * 客户端 jar / 资源 / 依赖库都天然在 baseDir 下，只有 gameDir 是漏的。
 *
 * 将来要支持"把实例放到别的盘"，正确做法是**设置项持有**允许的根目录，
 * 而不是让渲染层每次请求都递一个路径 —— 后者等于没有守卫。
 */
function resolveGameDir(baseDir: string, requested: string, versionId: string): string {
  /**
   * ⚠️ `versionId` 现在是**实例名**，而且它直接参与路径拼接。
   *
   * 这道断言以前在各个 `xxxDir()` 公共方法的入口，但多实例改造时
   * `gameDir()` 改成了直接调 `resolveGameDir` —— 断言被漏掉了，
   * 结果 `gameDir('../..')` 会得到 `<baseDir>/game/../..`，
   * **完全逃出 baseDir**。下游基于 gameDir 相对计算的 `resolveInside`
   * 全部形同虚设（root 自己已经跑出去了）。
   *
   * 所以断言放在 `resolveGameDir` 内部 —— 它是所有 gameDir 派生路径的
   * **唯一**收口点，放在调用方就会重演这次漏掉的问题。
   */
  assertVersionId(versionId);
  if (!requested) return join(baseDir, 'game', versionId);
  const abs = resolve(requested);
  const root = resolve(baseDir);
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  // 大小写不敏感比较：Windows 上 `D:\MC` 与 `d:\mc` 是同一个目录，
  // 但拼错大小写不该被判成越界（那会让合法用户被拒）。
  if (!abs.toLowerCase().startsWith(rootWithSep.toLowerCase())) {
    throw new Error(`实例目录必须位于启动器数据目录内: ${requested}`);
  }
  return abs;
}

/**
 * 断言 Mod 名是**单个文件名**（渲染层可控）。
 *
 * 实测出来的洞（2026-10-11 修复）：此前 `installMod` 是裸
 * `join(modsDir, name)`，而 `name` 来自 `LAUNCHER_INSTALL_MOD` 的请求体。
 * `name = '../../../escaped.jar'` 会落到 **baseDir 根**（仍在 baseDir 内，
 * 所以更粗的「有没有逃出 baseDir」断言查不出来），但已经逃出了 mods 目录，
 * 能覆盖掉别处的文件。`removeMod` / `toggleMod` 同样受影响。
 *
 * 比 `assertVersionId` 多一条 `startsWith('.')`：隐藏文件与 `.`/`..` 同源，
 * 而 mods 目录里本来就不该有它们。
 */
function assertModName(name: string): void {
  if (
    name === '' ||
    isAbsolute(name) ||
    /[\\/]/.test(name) ||
    name.includes('..') ||
    name.startsWith('.')
  ) {
    throw new Error(`非法的 Mod 文件名: ${name}`);
  }
}

/**
 * 子进程 stdout/stderr 的最小可读流形状。
 *
 * 只用到 `on`/`destroy`，因此测试里塞个 `EventEmitter` 就能驱动，
 * 不必真的起进程（见 launcher-log-ipc.test.ts）。
 */
interface LineSource {
  on(event: string, listener: (...args: never[]) => void): unknown;
  destroy?(): void;
  resume?(): unknown;
}

/**
 * 把一条字节流按 `\n` 拆行并回调（**跨 chunk 的半行会被拼回一行**）。
 *
 * 为什么不能直接 `data.toString().split('\n')`：管道按 64KB 边界切，
 * 一行日志完全可能横跨两个 chunk，直接切会把一行劈成两半。
 * Minecraft 用 `\r\n`，所以切完还要去掉行尾 `\r`。
 *
 * 流读完（`end`）时把残留缓冲作为**最后一行**补发 —— 游戏最后一行常常
 * 没有换行符，丢掉就等于丢掉崩溃前的最后一条信息。
 */
function forwardLines(stream: LineSource | null | undefined, emit: (line: string) => void): void {
  if (!stream || typeof stream.on !== 'function') return;
  let residual = '';
  const push = (raw: string): void => {
    const line = raw.replace(/\r$/, '');
    // 纯空行不进日志面板：Minecraft 的进度输出里有大量 \r 回车刷新，
    // 过滤掉才不会把面板刷爆。
    if (line.trim() !== '') emit(line);
  };
  stream.on('data', ((chunk: Buffer | string) => {
    residual += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
    const parts = residual.split('\n');
    residual = parts.pop() ?? '';
    for (const part of parts) push(part);
  }) as (...args: never[]) => void);
  stream.on('end', (() => {
    push(residual);
    residual = '';
    // 不 destroy 的话父进程会一直攥着管道 fd，退出时被挂住
    stream.destroy?.();
  }) as (...args: never[]) => void);
  stream.on('error', (() => {
    /* 读管道失败（EPIPE 等）：游戏已经起过了，不能因此把启动流程搞崩 */
  }) as (...args: never[]) => void);
  stream.on('close', (() => stream.destroy?.()) as (...args: never[]) => void);
}

/**
 * 不转发日志时**把管道读干净**。
 *
 * `stdio: 'pipe'` 下没人读的管道，缓冲区写满后子进程会**阻塞在 write**，
 * 表现为「游戏卡在启动不动」。哪怕调用方不要日志，也必须 resume 掉。
 */
function drainStream(stream: LineSource | null | undefined): void {
  if (!stream || typeof stream.on !== 'function') return;
  stream.on('error', (() => undefined) as (...args: never[]) => void);
  stream.on('close', (() => stream.destroy?.()) as (...args: never[]) => void);
  // resume：数据流起来后没有 data 监听器 = 直接丢弃，语义上就是「消费」
  stream.resume?.();
}

/**
 * 探测指定 java 可执行文件的主版本（缺省实现）。
 *
 * `java -version` 把版本信息打在 **stderr** 且退出码为 0，
 * 所以不能用「非零退出 = 失败」来判断，只能看有没有匹配到版本号。
 */
async function runJavaVersion(java: string): Promise<number | null> {
  const { execFile } = await import('node:child_process');
  return new Promise<number | null>((resolvePromise) => {
    execFile(java, ['-version'], { timeout: 5000 }, (_err, stdout, stderr) => {
      resolvePromise(parseJavaMajorVersion(`${stderr ?? ''}${stdout ?? ''}`));
    });
  });
}

/**
 * java 主版本探测缓存（key = java 可执行文件路径）。
 *
 * 为什么必须缓存：`java -version` 每次 100~300ms，放在启动热路径上就是
 * 每次点「开始游戏」都白等这么久。而同一路径的 JDK 主版本在进程生命周期内
 * 不会变 —— 装了新 JDK 只需重启应用，与本仓其他缓存（如 model-config）的
 * 取舍一致。
 *
 * 存 Promise 而非结果：并发启动时只探一次。
 */
const javaMajorCache = new Map<string, Promise<number | null>>();

/** 探测 java 主版本，同一可执行文件只探一次 */
export function probeJavaMajor(java: string): Promise<number | null> {
  const hit = javaMajorCache.get(java);
  if (hit) return hit;
  const p = runJavaVersion(java).catch(() => null);
  javaMajorCache.set(java, p);
  return p;
}

/** 仅供测试：清空探测缓存 */
export function __resetJavaProbeCache(): void {
  javaMajorCache.clear();
}

/**
 * 等 ChildProcess 真正起来，否则把失败如实抛出去。
 *
 * ## 为什么必须等
 *
 * Node 的 `spawn` 在**二进制不存在时仍然同步返回**一个对象，`pid` 是 `undefined`，
 * 错误要等下一个 tick 才以 `'error'` 事件形式发出（实测 ENOENT）。
 * 也就是说「不检查就返回」会得到 `pid: 0` —— 一个看起来正常、实则什么都没启动的结果。
 *
 * 后果实测（2026-10-11 修复前）：
 *   1. `launchGame` 以 `{ pid: 0 }` 正常 resolve
 *   2. IPC 把它当**成功**回给前端，前端 `if (res.error) … else if (res.pid > 0) …`
 *      两个分支都不进 → 按钮闪一下恢复原状，**屏幕上没有任何错误提示**
 *   3. 「开始游戏」那条 IPC 恰恰不传 `onExit`，于是没人监听 `'error'`，
 *      EventEmitter 在无 `'error'` 监听者时会抛未捕获异常 —— **掀翻 Electron 主进程**
 *
 * 等 `'spawn'` 把第 1、2 步变成一次正常的 reject，第 3 步由调用方的
 * `'error'` 监听器兜住（见 {@link attachErrorGuard}）。
 */
function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    };
    const failed = (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      rejectPromise(err);
    };
    child.once('spawn', done);
    child.once('error', failed);
  });
}

/**
 * 无条件挂上一个**什么都不做**的 `'error'` 监听器。
 *
 * **它的唯一职责是阻止崩溃** —— EventEmitter 遇 `'error'` 且无监听者时抛未捕获异常，
 * 在 Electron 主进程里就是整个应用退出。此前这个监听器挂在 `if (opts.onExit)` 里面，
 * 而「开始游戏」那条 IPC 恰恰不传 onExit，监听器就不存在了。
 *
 * 为什么**不上报**：spawn 失败后 Node 还会紧接着发一次 `'close'`
 * （实测 ENOENT → `error`，然后 `close(-4058)`）。两处都上报会让 `onExit` 被触发两次，
 * 日志流面板于是收到两条结束标记。上报交给 `'close'` 一处负责。
 */
function attachErrorGuard(child: ChildProcess): void {
  // 走 `on` 而非 `once`：ChildProcess.on 的签名是 `(event: string, listener: (...args: any[]) => void)`，
  // 传具体错误类型的 listener 会命中不上的重载分支 —— 这里接收器抹平成 `(...args: unknown[]) => void`。
  const guard = (() => undefined) as unknown as (...args: unknown[]) => void;
  child.on('error', guard);
}

/** 把 spawn 的原始错误翻译成用户看得懂、且知道怎么修的话 */
function friendlySpawnError(java: string, err: unknown): Error {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    return new Error(
      `找不到 Java 可执行文件（${java}）。请在实例的 Java 路径里指定一个有效的 java.exe。`,
    );
  }
  if (code === 'EACCES') {
    return new Error(`Java 可执行文件无执行权限：${java}`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * 确定性失败（403/404）：重试没有意义，调用方应当立刻看到错误。
 *
 * 单独一类而不是靠消息匹配 —— 让 `download()` 的重试分支能用 `instanceof`
 * 判定，不去解析错误字符串。
 */
class FatalDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalDownloadError';
  }
}

/**
 * 校验下载内容的完整性。
 *
 * `expected` 缺字段时**只校验有的那项** —— 清单里 asset 有 hash+size，
 * library 的 natives classifier 也一样，但别的地方可能只有其一。
 * 「不知道」不等于「不匹配」，别把缺字段当成校验失败。
 */
function verifyBuffer(
  buf: Buffer,
  expected: { sha1?: string | null; size?: number | null } | undefined,
  url: string,
): void {
  if (expected?.size != null && buf.length !== expected.size) {
    throw new Error(
      `文件大小对不上（期望 ${expected.size} 字节，实得 ${buf.length}）：${url}。` +
        `通常是下载被截断，重试仍失败请检查网络或代理。`,
    );
  }
  if (expected?.sha1) {
    const actual = createHash('sha1').update(buf).digest('hex');
    if (actual !== expected.sha1.toLowerCase()) {
      throw new Error(
        `SHA1 校验失败（期望 ${expected.sha1}，实得 ${actual}）：${url}。` +
          `文件内容已损坏，重试仍失败请换源或清缓存后重下。`,
      );
    }
  }
}

/** 下载进度回调 */
export type DownloadProgress = (
  stage: 'versions' | 'client' | 'assets' | 'libraries' | 'server',
  done: number,
  total: number,
) => void;

/** 版本条目 */
export interface GameVersionEntry {
  id: string;
  type: string;
  releaseTime: string;
  url: string;
}

/** 解析后的版本详情（版本 json 的关键字段） */
/** 清单给的一份文件校验信息。缺字段 = 未知，不参与校验（不是"不匹配"）。 */
export interface FileExpectation {
  /** 下载地址 */
  url: string;
  /** Mojang 给的 SHA1；null 表示清单没给，不校验 */
  sha1: string | null;
  /** 字节数；null 表示清单没给，不校验 */
  size: number | null;
}

export interface VersionDetail {
  id: string;
  assets: string; // assetIndex id
  assetsUrl: string;
  clientUrl: string;
  /** library 下载列表（artifact 或 classifier natives），逐个带校验信息 */
  libraryUrls: FileExpectation[];
  /**
   * 该版本要求的 Java 主版本，取自 Mojang 版本清单的 `javaVersion.majorVersion`。
   *
   * 这是**权威来源** —— 它由 Mojang 逐版本给出，比本仓 `javaVersionFor()`
   * 的硬编码映射更准。解析不出来时为 null，表示「不知道」，此时不做预检
   * （宁可放行让游戏自己跑，也不要用错误的假设拦住用户）。
   */
  javaMajor: number | null;
  /** client.jar 的 SHA1；null 表示清单没给，不校验 */
  clientSha1: string | null;
  /** client.jar 的字节数；null 表示清单没给，不校验 */
  clientSize: number | null;

  /**
   * **服务端** jar 的下载地址；null = Mojang 没给这个版本提供服务端。
   *
   * 实测（2026-10-12）：97 个正式版带 `downloads.server`，
   * 最早 1.2.5（1.4 MB），最新 26.3（62 MB）。
   * `b1.7.3` 这类远古版**没有**这个字段 —— 所以这里是 `null` 而不是空串，
   * 「没有」和「地址为空」必须能分开，否则用户点了只会看到一句无意义的报错。
   */
  serverUrl: string | null;
  /** server.jar 的 SHA1；null 表示清单没给，不校验 */
  serverSha1: string | null;
  /** server.jar 的字节数；null 表示清单没给，不校验 */
  serverSize: number | null;

  // ===== 加载器档案（`inheritsFrom`）相关 =====
  //
  // 上面这些字段描述的是**链底**（Mojang 原版）的事实；下面三个描述的是
  // **叶子**（实际被启动的那个档案）。分清两者是 mod 能不能加载的关键：
  // 跑链底的 jar + 链底的主类 = 原版游戏，mod 一个都不生效。

  /**
   * 启动主类。缺省 `VANILLA_MAIN_CLASS`。
   *
   * - 原版：`net.minecraft.client.main.Main`
   * - Fabric：`net.fabricmc.loader.impl.launch.knot.KnotClient`
   * - NeoForge：`cpw.mods.bootstraplauncher.BootstrapLauncher`（旧版）/ 新版本另有其类
   *
   * 之所以做成**可选**：历史上没有这个字段，一堆测试与替身直接构造
   * `VersionDetail`。给默认值比让所有调用方补一个字段更诚实 ——
   * 缺这个字段的事实就是「原版」。
   */
  mainClass?: string;
  /**
   * 运行 jar 的**绝对路径**：加载器档案 = 它自己的 jar（installer 生成、
   * 主类已指向加载器）；原版 = `versions/<id>/<id>.jar`。
   *
   * ⚠️ 必须是**叶子**。用链底就退回到「跑原版 jar」，那正是 mod 不生效的根因。
   */
  jarPath?: string;
  /**
   * 整条继承链，**叶子 → 根**（如 `['neoforge-21.1.209-1.21.1', '1.21.1']`）。
   *
   * 给 UI 用的：告诉用户「这个实例实际跑的是哪一串档案」，
   * 以及排查「mod 不生效」时第一眼要看的东西。
   */
  profileChain?: string[];
  /** 是否有任何加载器档案（false = 纯原版）。UI 用它决定要不要显示「加载器」分组。 */
  hasLoader?: boolean;
  /**
   * 加载器档案自带的启动参数（`arguments.jvm` / `arguments.game`）。
   *
   * 只有 NeoForge 会用到（见 {@link neoforgeLaunch}）；Fabric 那条路已实测
   * 可用，不动它 —— 它的 `-DFabricMcEmu=…` 会改变引导语义，贸然套用有风险。
   */
  profileArgs?: {
    jvm: string[];
    game: string[];
  };
  /**
   * NeoForge 26.x 的生产模式参数。
   *
   * 有它 = 这个实例按 FML 12 的**生产模式**启动：classpath 里**不放**
   * Minecraft 的 jar，由 FML 自己从 `libraryDirectory` 里取 patched jar
   * 与 NeoForge 本体。详见 `neoforge-launch.ts` 的注释。
   */
  neoforgeLaunch?: NeoForgeLaunchSpec;
}

/**
 * 默认的第三方皮肤站（LittleSkin，国内主流）。
 *
 * 仍然**必须**经 `enableThirdPartyAuth()` 的合规闸门才能生效
 * （§1.2 / §5.8 / §19：默认关闭 + 显式确认 + 风险提示）。
 * 写成常量只是为了让默认值的出处可见、可改，不是「默认开启」。
 */
export const DEFAULT_THIRD_PARTY_SKIN_API = 'https://littleskin.cn/api/yggdrasil';

/**
 * 启动游戏用的正版身份（§5.8）。
 *
 * 由 `MicrosoftAuthService.getLaunchIdentity()` 产出。本模块**不关心**
 * 这些值从哪来（token 刷新/加密/多账户都在 `ms-auth-service.ts` 与
 * `mc-account-store.ts`），只负责把它们正确地拼进启动参数。
 */
export interface LaunchCredentials {
  /** Minecraft 玩家名（来自 profile，**不是** XBox 昵称）。 */
  readonly username: string;
  /** 带连字符的 Minecraft profile UUID（**不是**随机值）。 */
  readonly uuid: string;
  /** 真实的 Minecraft access token。 */
  readonly accessToken: string;
  /** `msa` = 正版。 */
  readonly userType: 'msa';
}

/** 文件存在检查 */
async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** 写文件（自动建目录） */
async function writeFileAtomic(p: string, data: Buffer): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data);
}

export interface LauncherServiceDeps {
  /**
   * 第三方认证站的合规闸门（§1.2 / §5.8 / §19）。
   *
   * **刻意不提供默认值**：没注入 `enableThirdPartyAuth()` 就会抛错
   * （fail-closed），而不是「没闸门 = 放行」。要启用必须显式注入一个
   * `new ThirdPartyAuthGate({ enabled: true, confirm: ..., acknowledgedNoticeVersion })`。
   */
  readonly thirdPartyAuth?: ThirdPartyAuthGate;
  /**
   * 注入 `spawn`（默认就是 `node:child_process` 的 spawn）。
   *
   * 存在的理由：断言「启动参数里 UUID 是不是 profile 的真值」必须能观察
   * spawn 的实参，而 `vi.mock('node:child_process')` 在本仓的 vitest 2.1
   * 上不可靠（会静默失效、真的去起 java）。注入依赖比 mock 模块更稳。
   */
  readonly spawn?: typeof spawn;
  /**
   * 探测指定 java 可执行文件的主版本；缺省走真实的 `java -version`。
   *
   * 注入点存在的原因与 `spawn` 一致：探测一次要 100~300ms，
   * 单元测试既慢、也不该依赖本机实际装了哪个 JDK。
   */
  readonly probeJava?: (java: string) => Promise<number | null>;
  /**
   * 下载源偏好存储（官方优先 / 镜像优先）。
   *
   * 注入点：测试不该依赖真实的 `<baseDir>/download-source.json`，
   * 也不该让某个用例的偏好设置漏到另一个用例里。
   */
  readonly sourceStore?: SourcePreferenceStore;
  /** 候选源展开逻辑；缺省用 `expandDownloadCandidates`（可被替身观察调用顺序）。 */
  readonly expandCandidates?: (url: string, prefer: SourcePreference) => DownloadSource[];
  /**
   * 并发下载上限（资源 / 依赖库）。缺省 8。
   *
   * 参照 PCL：线程数是**用户可配**的，不是写死的常量 —— 家用宽带与机房
   * 网络的最优值差好几倍。这里留注入点，让设置页将来能接上；
   * 写死 8 是保守值，够快，也不会把慢线路打爆。
   */
  readonly maxParallelDownloads?: number;
}

/**
 * 启动器服务。baseDir = userData/mc-launcher。
 * 所有方法可独立测试（注入 baseDir + 可选 fetch + 可选 spawn）。
 */
export class LauncherService {
  private readonly thirdPartyAuth: ThirdPartyAuthGate | undefined;
  private readonly spawnImpl: typeof spawn;
  private readonly probeJavaImpl: (java: string) => Promise<number | null>;
  private readonly sourceStore: SourcePreferenceStore;
  private readonly maxParallelImpl: number | undefined;
  private readonly expandCandidatesImpl:
    ((url: string, prefer: SourcePreference) => DownloadSource[]) | undefined;

  constructor(
    readonly baseDir: string,
    private readonly fetchImpl: typeof fetch = fetch,
    deps: LauncherServiceDeps = {},
  ) {
    this.thirdPartyAuth = deps.thirdPartyAuth;
    this.spawnImpl = deps.spawn ?? spawn;
    this.probeJavaImpl = deps.probeJava ?? probeJavaMajor;
    this.sourceStore = deps.sourceStore ?? new SourcePreferenceStore(baseDir);
    this.expandCandidatesImpl = deps.expandCandidates;
    this.maxParallelImpl = deps.maxParallelDownloads;
  }

  /**
   * 下载辅助：带重试的 GET → Buffer，并**校验完整性**。
   *
   * ## 为什么必须校验
   *
   * 「HTTP 200」不等于「文件是对的」。代理截断、CDN 返回错误页、磁盘半写，
   * 都会得到一个 200 + 损坏内容。缺了校验，游戏会在**启动后**炸成一堆天书
   * （NoSuchMethodError / 坏 class），而那时已经很难回溯到"是那次下载坏了"。
   *
   * 参照 PCL（``ModDownload.vb`` 的 ``FileChecker``）：它用清单给的
   * ``size`` 与 ``sha1`` 判定一个文件是否已就位，``size`` 缺失时用 ``-1``
   * 表示"未知"而不是当作 0。
   *
   * ## 重试策略
   *
   * 沿用 PCL ``NetRequestByClientRetry`` 的骨架：
   *  - 第 0 次正常；第 1 次把超时放宽（首次超时不一定是真失败，可能只是慢）
   *  - **403 / 404 立即抛出不重试** —— 确定性失败重试没有意义，只会拖慢
   *  - **429 退避 10s** —— 限流不是"再试一次"能解决的
   *  - 每次重试都重新校验：坏内容必须重下，而不是原样落盘
   *
   * @param expected 清单给的校验信息；缺省则只做 HTTP 层面判断
   */
  private async download(
    url: string,
    expected?: { sha1?: string | null; size?: number | null },
    retries = 3,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    let lastErr: Error | null = null;
    const candidates = this.expandCandidates(url);
    // 逐个候选尝试。**不是**「主源挂了才换镜像」—— 候选顺序由用户设置决定
    // （见 download-sources.ts），原始 URL 永远在列表里。
    for (const candidate of candidates) {
      for (let i = 0; i < retries; i++) {
        throwIfAborted(signal);
        try {
          const res = await this.fetchImpl(candidate.url, {
            redirect: 'follow',
            signal: signal ?? null,
          });
          if (!res.ok) {
            // 403/404 是确定性失败：重试没有意义。但**换源可能有用**
            //（镜像上未必也是 404），所以标记后交给外层换候选，而不是直接抛。
            if (res.status === 403 || res.status === 404) {
              throw new FatalDownloadError(`HTTP ${res.status} for ${candidate.url}`);
            }
            throw new Error(`HTTP ${res.status} for ${candidate.url}`);
          }
          const buf = Buffer.from(await res.arrayBuffer());
          // 取消可能发生在 body 读到一半：别把半截文件交给调用方写盘。
          throwIfAborted(signal);
          verifyBuffer(buf, expected, candidate.url);
          return buf;
        } catch (e) {
          // 取消不是"网络抖动"：不重试、不换源、不退避。
          if (isAbortError(e)) throw e;
          if (signal?.aborted) throw abortError();
          lastErr = e as Error;
          // 确定性失败：不再重试**这个源**，换下一个候选
          if (e instanceof FatalDownloadError) break;
          // 429 退避：限流不是"再试一次"能解决的
          const waitMs = (e as { status?: number }).status === 429 ? 10000 : 500 * (i + 1);
          await sleepAbortable(waitMs, signal);
        }
      }
    }
    throwIfAborted(signal);
    const tried = candidates.map((c) => c.label).join(' → ');
    throw new Error(`${lastErr?.message ?? `下载失败: ${url}`}（已尝试 ${tried}）`);
  }

  /**
   * 展开候选下载源。测试可注入展开逻辑，不必真的构造镜像 URL。
   *
   * 顺序由用户偏好决定（**默认国内镜像优先**）—— 见 {@link expandDownloadCandidates}。
   */
  private expandCandidates(url: string): DownloadSource[] {
    return (this.expandCandidatesImpl ?? expandDownloadCandidates)(url, this.sourceStore.read());
  }

  /**
   * 拉取版本清单，按候选源顺序尝试。
   *
   * 清单 URL 里没有 `maven` 字样，走不到 `expandDownloadCandidates` 的自动替换，
   * 所以候选由 `manifestCandidates()` 单列（见 download-sources.ts）。
   */
  private async downloadManifest(signal?: AbortSignal): Promise<Buffer> {
    const candidates = manifestCandidates(this.sourceStore.read());
    let lastErr: Error | null = null;
    for (const candidate of candidates) {
      throwIfAborted(signal);
      try {
        const res = await this.fetchImpl(candidate.url, {
          redirect: 'follow',
          signal: signal ?? null,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${candidate.url}`);
        const buf = Buffer.from(await res.arrayBuffer());
        throwIfAborted(signal);
        return buf;
      } catch (e) {
        if (isAbortError(e)) throw e;
        if (signal?.aborted) throw abortError();
        lastErr = e as Error;
        // 换下一个候选。不在这里做长退避：清单就几十 KB，
        // 与其卡着退避不如赶紧试下一个源。
      }
    }
    throwIfAborted(signal);
    const tried = candidates.map((c) => c.label).join(' → ');
    throw new Error(`${lastErr?.message ?? '下载失败: 版本清单'}（已尝试 ${tried}）`);
  }

  /**
   * 拉取版本清单（最新在前）。
   *
   * **返回全部类型**，不只是 release。
   *
   * 此前这里硬过滤 `type === 'release'`，于是调用方拿不到快照与远古版本。
   * 参照 PCL 的下载页（正式版 / 预览版 / 远古版 / 愚人节版分组 + 顶部
   * 「最新版本」卡片），那个信息架构需要这三类数据才立得住 ——
   * 只给 release 的话，"最新预览版"这一栏永远空着。
   *
   * 新鲜度：每次调用都重新 `download(MANIFEST_URL)`，**不做缓存**，
   * 所以拿到的永远是 Mojang 此刻的清单（这也是"都是更新的"的前提）。
   */
  async listVersions(): Promise<GameVersionEntry[]> {
    const buf = await this.downloadManifest();
    const manifest = JSON.parse(buf.toString('utf-8'));
    return (manifest.versions as GameVersionEntry[]).sort((a, b) =>
      b.releaseTime.localeCompare(a.releaseTime),
    );
  }

  /**
   * 本地已安装的加载器档案：`versions/<id>/<id>.json`。
   *
   * 加载器 installer（`installLoader` 跑的那个官方 jar）产出的就是这个文件。
   * 没有它，`resolveVersion` 只认 Mojang 清单，加载器档案会直接抛「版本不存在」。
   */
  private async readLocalProfile(id: string): Promise<VersionProfileJson | null> {
    try {
      const p = join(this.baseDir, 'versions', id, `${id}.json`);
      const raw = await readFile(p, 'utf-8');
      return parseProfileJson(JSON.parse(raw));
    } catch {
      // 没有这个文件 = 不是本地安装的档案，不是错误
      return null;
    }
  }

  /**
   * 取一份档案：本地优先（加载器档案只存在于本地），本地没有就下 Mojang 的。
   *
   * 清单是**懒加载的**：加载器档案的叶子在本地，但它 `inheritsFrom` 指向的
   * 原版在网络上。所以「本地命中了就不碰清单」是错的 —— 那样继承链会在叶子
   * 处断掉，链长永远是 1，也就是这次要修的 bug 本身。
   */
  private async lookupProfile(
    id: string,
    signal?: AbortSignal,
  ): Promise<VersionProfileJson | null> {
    throwIfAborted(signal);
    const local = await this.readLocalProfile(id);
    throwIfAborted(signal);
    if (local !== null) return local;
    const manifest = JSON.parse((await this.downloadManifest(signal)).toString('utf-8')) as {
      versions: GameVersionEntry[];
    };
    const entry = manifest.versions.find((v) => v.id === id);
    if (!entry) return null;
    return parseProfileJson(
      JSON.parse((await this.download(entry.url, undefined, 3, signal)).toString('utf-8')),
    );
  }

  /**
   * 解析版本详情（libraries/client/assets）。
   *
   * 两条路径：
   * 1. `versions/<id>/<id>.json` 在本地存在 → **继承链**（加载器档案）
   * 2. 否则走 Mojang 清单（原版）
   *
   * 两种情况最后都用同一个合并器 `mergeProfileChain` 出结果，所以原版的行为
   * 与以前一致（单链合并等价于直接读），而加载器档案第一次真正能被解析。
   */
  async resolveVersion(version: string, signal?: AbortSignal): Promise<VersionDetail> {
    assertVersionId(version);
    throwIfAborted(signal);

    const chain = await walkProfileChain(version, (id) => this.lookupProfile(id, signal));
    throwIfAborted(signal);
    if (chain.length === 0) throw new Error(`版本不存在: ${version}`);
    const merged = mergeProfileChain(chain, version);
    /**
     * NeoForge 26.x 的生产模式参数。
     *
     * 只有档案自带 `--fml.neoForgeVersion` / `--fml.mcVersion` /
     * `--fml.neoFormVersion` 时才算数 —— 那是 FML 12 生产模式的硬要求
     * （少一个就拒绝启动，详见 `neoforge-launch.ts`）。
     */
    const neoforgeLaunch =
      inferLoaderFromMainClass(merged.mainClass) === 'neoforge'
        ? parseNeoForgeLaunchSpec(merged.gameArgs)
        : null;

    /**
     * 运行 jar：**原版客户端 jar**，不是加载器档案目录下的 `<加载器 id>.jar`。
     *
     * Fabric / NeoForge 的 installer（`-noprofile`）只产出
     * `versions/<id>/<id>.json`，**不产出版本 jar**；加载器自己的 jar 在
     * `libraries/` 里，已经由 `merged.libraryUrls` 纳入 classpath。
     *
     * 之前这里无条件取 `versions/<version>/<version>.jar`，对真实 Fabric
     * 安装（目录里只有 JSON）会报「加载器 jar 不存在」。而拿原版 jar 当
     * classpath 末位才是对的：加载器主类需要原版游戏类，Fabric/NeoForge
     * 自己的库则在前面的 `libraries` 里。
     */
    const clientJarId = merged.chain.length > 1 ? merged.baseId : version;
    const jarPath = join(this.baseDir, 'versions', clientJarId, runtimeJarName(clientJarId));

    return {
      id: version,
      assets: merged.assetIndexId ?? merged.baseId,
      assetsUrl: merged.assetIndexUrl ?? '',
      clientUrl: merged.client?.url ?? '',
      libraryUrls: merged.libraryUrls,
      // Mojang 自己给的逐版本 Java 要求。此前这个字段被**下载下来就扔了**，
      // 于是启动路径完全不知道该用哪个 JDK —— 只能碰运气用 PATH 里的 java。
      // 取的是**链底**的值：加载器不会抬高 Java 要求，它自己也是按那个版本编的。
      javaMajor: merged.javaMajor,
      // 完整性校验信息。同 javaMajor：清单里本来就带着 sha1/size，
      // 此前一并丢掉了，于是「下坏了」这件事要到游戏启动后崩溃才暴露。
      clientSha1: merged.client?.sha1 ?? null,
      clientSize: merged.client?.size ?? null,
      // 服务端与客户端是**两个独立的产物**。实测（2026-10-12）：97 个正式版带
      // `downloads.server`（最早 1.2.5 / 1.4MB，最新 26.3 / 62MB），
      // `b1.7.3` 这类远古版**没有**这个字段。PCL 的「下载服务端」按钮读的就是它。
      // ⚠️ 链底才有 —— 加载器档案不给服务端，那本来也不是它该有的东西。
      serverUrl: rootServer(chain)?.url ?? null,
      serverSha1: rootServer(chain)?.sha1 ?? null,
      serverSize: rootServer(chain)?.size ?? null,

      mainClass: merged.mainClass ?? VANILLA_MAIN_CLASS,
      jarPath,
      profileChain: merged.chain,
      // 链长 > 1 才算「有加载器」：单链 = 纯原版档案
      hasLoader: merged.chain.length > 1,
      // 加载器档案自带的参数（NeoForge 26.x 靠它启动，见 neoforge-launch.ts）
      profileArgs: { jvm: merged.jvmArgs, game: merged.gameArgs },
      // NeoForge 26.x 的生产模式参数；不是 NeoForge 档案时**不出现**这个键
      ...(neoforgeLaunch ? { neoforgeLaunch } : {}),
    };
  }

  /** 下载 client.jar（已存在则跳过） */
  async downloadClient(
    detail: VersionDetail,
    onProgress?: DownloadProgress,
    signal?: AbortSignal,
  ): Promise<string> {
    throwIfAborted(signal);
    const jarPath = join(this.baseDir, 'versions', detail.id, `${detail.id}.jar`);
    if (await exists(jarPath)) {
      throwIfAborted(signal);
      onProgress?.('client', 1, 1);
      return jarPath;
    }
    if (!detail.clientUrl) throw new Error('版本详情缺少 client.jar URL');
    onProgress?.('client', 0, 1);
    const buf = await this.download(
      detail.clientUrl,
      {
        sha1: detail.clientSha1,
        size: detail.clientSize,
      },
      3,
      signal,
    );
    throwIfAborted(signal);
    await writeFileAtomic(jarPath, buf);
    onProgress?.('client', 1, 1);
    return jarPath;
  }

  /**
   * 下载**服务端** jar（对标 PCL 版本行上的「下载服务端」按钮）。
   *
   * 落点是 `versions/<id>/<id>-server.jar` —— 与 PCL 的
   * `VersionFolder & Id & "-server.jar"` 同构：服务端 jar 与 client.jar
   * 放在同一个版本目录里，而不是另起一个 `servers/` 树。
   *
   * ## 远古版没有服务端
   *
   * `downloads.server` 不存在时**明确报错**，而不是静默跳过或下载空文件
   * （PCL 的原话是「Mojang 没有给 Minecraft {id} 提供官方服务端下载，没法下」）。
   * 实测：`b1.7.3` 没有，`1.7.10` 有（还多一个 `windows_server`，本仓不用）。
   *
   * ## 下载完 ≠ 能跑
   *
   * 1.18 起的 server.jar 是 **bundler**（见 `detectServerJarKind`），
   * 光有它跑不起来，首次启动还要联网下载服务端本体与依赖。
   * 所以返回值里带上**实测**出来的形态，让 UI 能把这件事说清楚 ——
   * 否则用户看到"下载完成"就启动，然后撞上一个与下载无关的报错。
   *
   * ## 校验
   *
   * 按清单给的 sha1 + size 逐字校验，校验失败不落盘 —— 与 client.jar 同纪律。
   * PCL 额外加了一条 `MinSize = 1024` 的下限防"404 HTML 页面被当成 jar"；
   * 我们按清单**精确**比对 size，最小真实值也有 1.4 MB，那条下限是冗余的，不重复加。
   */
  async downloadServer(
    detail: VersionDetail,
    onProgress?: DownloadProgress,
  ): Promise<{ path: string; kind: ServerJarKind }> {
    assertVersionId(detail.id);
    if (!detail.serverUrl) {
      throw new Error(
        `Mojang 没有给 Minecraft ${detail.id} 提供官方服务端下载` +
          `（远古版本通常没有服务端；可在该版本的 JSON 里查看 downloads.server）。`,
      );
    }
    const jarPath = join(this.baseDir, 'versions', detail.id, `${detail.id}-server.jar`);
    if (await exists(jarPath)) {
      onProgress?.('server', 1, 1);
      // 已下载过也照样实测形态 —— 这是展示给用户的信息，不该靠猜。
      const head = await readFile(jarPath).then((b) => b.subarray(0, ZIP_SCAN_BYTES));
      return { path: jarPath, kind: detectServerJarKind(head) };
    }
    onProgress?.('server', 0, 1);
    const buf = await this.download(detail.serverUrl, {
      sha1: detail.serverSha1,
      size: detail.serverSize,
    });
    const kind = detectServerJarKind(buf.subarray(0, ZIP_SCAN_BYTES));
    await writeFileAtomic(jarPath, buf);
    onProgress?.('server', 1, 1);
    return { path: jarPath, kind };
  }

  /** 该版本有没有官方服务端可下。UI 用它决定按钮是否可用。 */
  hasServer(detail: VersionDetail): boolean {
    return typeof detail.serverUrl === 'string' && detail.serverUrl !== '';
  }

  /** 下载 assets 索引 + 资源文件 */
  async downloadAssets(
    detail: VersionDetail,
    onProgress?: DownloadProgress,
    signal?: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const indexPath = join(this.baseDir, 'assets', 'indexes', `${detail.assets}.json`);
    let index: { objects?: Record<string, { hash: string; size: number }> };
    if (await exists(indexPath)) {
      throwIfAborted(signal);
      index = JSON.parse(await readFile(indexPath, 'utf-8'));
    } else {
      if (!detail.assetsUrl) throw new Error('版本详情缺少 assets index URL');
      const buf = await this.download(detail.assetsUrl, undefined, 3, signal);
      throwIfAborted(signal);
      await writeFileAtomic(indexPath, buf);
      index = JSON.parse(buf.toString('utf-8'));
    }

    const objects = index.objects ?? {};
    const entries = Object.entries(objects);
    onProgress?.('assets', 0, entries.length);

    /**
     * 资源下载**并发**执行。
     *
     * 参照 PCL（``ModNet.vb`` 的 ``NetTaskThreadLimit = 设置值 + 1``）：
     * 线程数是**用户可配**的，不是写死的常量 —— 家用宽带和机房网络的
     * 最优值差好几倍，写死任何一种都是替用户做决定。
     *
     * 为什么必须并发：资源是整个下载里体量最大的一块（现代版本数千个对象，
     * 上百 MB）。串行 await 意味着"带宽 ÷ 单文件往返延迟"，并发才能把
     * 延迟藏进带宽里。
     *
     * 单个失败仍然隔离（不阻断其余），失败计数记进返回值供调用方如实上报。
     */
    let done = 0;
    let failed = 0;
    const concurrency = Math.max(1, this.maxParallelDownloads());
    let cursor = 0;
    const worker = async (): Promise<void> => {
      for (;;) {
        throwIfAborted(signal);
        const i = cursor++;
        if (i >= entries.length) return;
        const [, obj] = entries[i]!;
        const hash = obj.hash;
        const dest = join(this.baseDir, 'assets', 'objects', hash.slice(0, 2), hash);
        if (!(await exists(dest))) {
          try {
            // 资源索引里**每个对象都带 hash 与 size**（PCL 的
            // `CheckAssetsHash` 就是拿它做校验），这里一并用上：
            // 资源的下载量最大，截断/损坏的概率也最高。
            const buf = await this.download(
              `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
              { sha1: hash, size: obj.size },
              3,
              signal,
            );
            throwIfAborted(signal);
            await writeFileAtomic(dest, buf);
          } catch (e) {
            // 取消不是"这个资源坏了"：要立刻停，不能把 AbortError 记成失败后
            // 继续把剩下几千个资源全跳过。
            if (isAbortError(e)) throw e;
            if (signal?.aborted) throw abortError();
            // 单个资源失败不阻断（可重试）。校验失败同样落这里：
            // 坏文件比缺文件更糟 —— 缺了游戏会明确报错，坏了是静默崩。
            failed++;
          }
        }
        done++;
        // 并发下 done 会被多个 worker 同时改 —— 单线程 JS 里 `++` 不会交错，
        // 但每 50 个才上报一次，没必要加锁。
        if (done % 50 === 0 || done === entries.length) {
          onProgress?.('assets', done, entries.length);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()),
    );
    throwIfAborted(signal);
    onProgress?.('assets', entries.length, entries.length);
    if (failed > 0) {
      throw new Error(
        `资源下载：${entries.length} 个中有 ${failed} 个失败（含校验不通过）。` +
          `缺失的资源会导致游戏启动报错，可重新下载该版本补齐。`,
      );
    }
  }

  /** 并发上限；可注入，便于测试。缺省 8（保守值：够快，也不会把慢线路打爆）。 */
  private maxParallelDownloads(): number {
    return this.maxParallelImpl ?? 8;
  }

  /** 下载 libraries（已存在则跳过） */
  async downloadLibraries(
    detail: VersionDetail,
    onProgress?: DownloadProgress,
    signal?: AbortSignal,
  ): Promise<string[]> {
    throwIfAborted(signal);
    const paths: string[] = [];
    let done = 0;
    const total = detail.libraryUrls.length;
    onProgress?.('libraries', 0, total);
    for (const lib of detail.libraryUrls) {
      throwIfAborted(signal);
      // 从 URL 推导本地路径: .../<group>/<artifact>/<ver>/<file>.jar
      const urlPath = new URL(lib.url).pathname; // 以 / 开头的路径
      const rel = urlPath.replace(/^\//, '');
      const dest = join(this.baseDir, 'libraries', ...rel.split('/'));
      if (!(await exists(dest))) {
        try {
          const buf = await this.download(lib.url, { sha1: lib.sha1, size: lib.size }, 3, signal);
          throwIfAborted(signal);
          await writeFileAtomic(dest, buf);
        } catch (e) {
          if (isAbortError(e)) throw e;
          if (signal?.aborted) throw abortError();
          // 单个库失败不阻断（启动时会报缺库）。
          // 校验失败也算在内 —— 坏文件比缺文件更糟，宁可让启动时明确报缺库。
        }
      }
      paths.push(dest);
      done++;
      onProgress?.('libraries', done, total);
    }
    throwIfAborted(signal);
    return paths;
  }

  /**
   * 组装 classpath 并启动 Java。
   *
   * 账户模式（§1.2：正版为第一路径，离线仅供开发/测试）：
   * - 传 `credentials` → **正版模式**：UUID 用 profile 的真实 UUID、
   *   accessToken 用真实 token、userType=msa。服务端能正常校验。
   * - 不传 → **离线模式**（§1.2 第 2 条：仅本地开发/测试）：
   *   accessToken=0、UUID 随机、userType=legacy。
   */
  async launchGame(
    detail: VersionDetail,
    opts: {
      username: string;
      memory: string;
      gameDir: string;
      javaPath?: string;
      /** 正版身份。缺省即离线模式。 */
      credentials?: LaunchCredentials;
      /** 日志逐行转发回调（stdout + stderr 合流）。缺省不转发。 */
      onLog?: (line: string) => void;
      /**
       * 游戏进程退出时回调一次（IPC 侧据此推 `done: true` 结束标记）。
       * 缺省即不监听退出事件。
       */
      onExit?: (info: { code: number | null; signal: NodeJS.Signals | null }) => void;
      /**
       * 实例的加载器（`fabric` / `neoforge` / `vanilla`）。
       *
       * **不传就按 `detail.profileChain` 推断** —— 档案链长度 > 1 就说明是个
       * 加载器档案。为什么不强制传：调用方（IPC / 测试替身）手里的
       * `VersionDetail` 才是权威判断依据，让它复述一遍反而多一处会说错的地方。
       *
       * 显式传 `vanilla` 可以覆盖推断（把加载器档案当原版跑，用来排查
       * 「是不是 mod 的锅」）。
       */
      loader?: 'vanilla' | 'fabric' | 'neoforge';
    },
  ): Promise<{ pid: number }> {
    assertVersionId(detail.id);
    assertMemorySpec(opts.memory);

    // 运行 jar 是**叶子档案**的 jar（加载器 jar），不是链底的原版 jar。
    // 跑原版 jar = mod 一个都不会加载 —— 这是之前 mod 装了没反应的根本原因。
    const jarPath = detail.jarPath ?? join(this.baseDir, 'versions', detail.id, `${detail.id}.jar`);
    /**
     * NeoForge 26.x 走**生产模式**：classpath 里**不能**有 Minecraft 的 jar。
     *
     * FML 12 先在 classpath 上找 Minecraft 的类：找到了就当「开发环境」，
     * 而开发环境要求 patched jar 带 `Minecraft-Dists` manifest 属性
     * （客户端安装器刻意不打），于是报
     * "NeoForge dev environment Minecraft jar does not have a Minecraft-Dists attribute"。
     * 找不到才走生产模式 —— 由 FML 自己去 `libraryDirectory` 取 patched jar
     * 与 NeoForge 本体。实测（2026-10-22）：这样起得来，窗口标题是
     * "Minecraft NeoForge* 26.3"，JEI / MezzConfig / NeoForge 都在 Mod List 里。
     */
    const neoforgeProduction = detail.neoforgeLaunch !== undefined;
    if (!neoforgeProduction && !(await exists(jarPath))) {
      throw new Error(
        detail.hasLoader
          ? `客户端 ${detail.profileChain?.at(-1) ?? detail.id} 的原版 jar 不存在（加载器与原版共用），请先下载客户端`
          : '客户端未下载，请先下载',
      );
    }

    const libraries = await this.downloadLibraries(detail);
    const classpath = (neoforgeProduction ? libraries : [...libraries, jarPath]).join(
      process.platform === 'win32' ? ';' : ':',
    );

    const assetsDir = join(this.baseDir, 'assets');
    const gameDir = resolveGameDir(this.baseDir, opts.gameDir, detail.id);
    await mkdir(gameDir, { recursive: true });
    // mods 目录必须在 gameDir 下存在，否则 Fabric / NeoForge 的加载器
    // 扫描不到（它们只看 `<gameDir>/mods`）。空目录也建 —— 加载器对
    // 「目录不存在」和「目录是空」的处理不一致。
    await mkdir(join(gameDir, 'mods'), { recursive: true });

    const java = opts.javaPath || 'java';
    // 正版：全部取自 profile；离线：随机 UUID + accessToken=0 + legacy。
    // ⚠️ 不能混用「正版 UUID + 0 号 token」——服务端会判定为伪造会话。
    const uuid = opts.credentials?.uuid ?? randomUUID();
    const accessToken = opts.credentials?.accessToken ?? '0';
    const userType = opts.credentials?.userType ?? 'legacy';
    // 用户名用 `||` 而不是 `??`：空串也必须回落。
    // profile 里 name 缺失（无档案账号）时 credentials.username 可能是 ''，
    // `??` 会把空串原样传下去 → 启动参数 `--username ''` 必然进不去。
    const username = opts.credentials?.username || opts.username || 'Steve';

    /**
     * 启动主类。
     *
     * 原版是 `net.minecraft.client.main.Main`；加载器档案给的是它自己的引导类
     * （Fabric `KnotClient` / NeoForge `BootstrapLauncher`）。**必须取档案里
     * 那个值** —— 用原版主类跑加载器 jar，加载器根本不会被执行，
     * 表现为「装了 mod 但游戏里什么都没有」。
     */
    const mainClass = detail.mainClass ?? VANILLA_MAIN_CLASS;

    /**
     * 加载器判定（仅用于加它特有的 JVM 参数）。
     *
     * 显式传入优先；否则**看主类**而不是看 id 前缀 —— installer 产出的档案 id
     * 形如 `1.21.1-0.19.5`，从 id 里猜不出是哪个加载器（`startsWith('fabric-loader')`
     * 这类写法对真实产物一律不成立）。主类是权威事实：Fabric 的引导类是
     * `net.fabricmc.loader.impl.launch.knot.KnotClient`，NeoForge 是
     * `cpw.mods.bootstraplauncher.BootstrapLauncher` / `net.neoforged.…`。
     *
     * 认不出来就当 `vanilla`（不加任何 -D）—— 让加载器用自己的默认值，
     * 好过加一个猜错的参数。
     */
    const loader: 'vanilla' | 'fabric' | 'neoforge' =
      opts.loader ?? inferLoaderFromMainClass(mainClass);

    /**
     * JVM 参数（`-D…`）。
     *
     * 为什么需要：Fabric / NeoForge 的引导类要靠系统属性知道自己该扫哪个
     * mods 目录、以及游戏实际跑在哪。引导类和游戏是**两个不同的 jar 入口**，
     * 属性从属方和原版不同（`fabric.gameVersion` / `fabric.dli.config`、
     * `neoforge.*`），这里不猜—— 不确定就不加，让加载器用自己的默认值
     * （`<gameDir>/mods`），那本来就是绝大多数场景的正解。
     *
     * 空数组是常态（纯原版），别为了「有参数显得专业」去编。
     */
    const jvmArgs: string[] =
      loader === 'fabric'
        ? [
            `-Dfabric.gameVersion=${detail.profileChain?.at(-1) ?? detail.id}`,
            `-Dfabric.dli.config=${join(this.baseDir, 'fabric', 'launch.cfg')}`,
            `-Dfabric.dli.env=client`,
            `-Dfabric.dli.main=${mainClass}`,
            `-Dfabric.dli.gameDir=${gameDir}`,
            `-Dfabric.dli.modDirs=${join(gameDir, 'mods')}`,
          ]
        : [];

    /**
     * 档案自带的参数（`arguments.jvm` / `arguments.game`）——**只对 NeoForge 用**。
     *
     * NeoForge 26.x 的档案里这些参数是**硬要求**：
     * `-DlibraryDirectory=…` 告诉 FML 12 去哪找 patched jar 与 NeoForge 本体，
     * `--fml.neoForgeVersion` / `--fml.mcVersion` / `--fml.neoFormVersion`
     * 告诉它这是哪个组合；缺任何一个都是「拒绝启动」（实测报错见
     * `neoforge-launch.ts`）。
     *
     * Fabric 的档案也带 `arguments`（`-DFabricMcEmu=…`），但那条启动路径
     * **已实测可用**（147 mods 正常加载），套上去会改变引导语义，
     * 所以这里只对 NeoForge 生效。
     */
    const profileArgVars: Record<string, string> = {
      library_directory: join(this.baseDir, 'libraries'),
      natives_directory: join(this.baseDir, 'libraries', 'natives'),
      version_name: detail.profileChain?.at(-1) ?? detail.id,
      version_type: detail.profileChain?.at(-1) ?? detail.id,
      game_directory: gameDir,
      assets_root: assetsDir,
      assets_index_name: detail.assets,
      auth_player_name: username,
      auth_uuid: uuid,
      auth_access_token: accessToken,
      auth_xuid: '',
      user_type: userType,
      clientid: '',
      classpath_separator: process.platform === 'win32' ? ';' : ':',
    };
    const profileJvmArgs =
      detail.neoforgeLaunch !== undefined
        ? substituteProfileArgs(detail.profileArgs?.jvm ?? [], profileArgVars)
        : [];
    const profileGameArgs =
      detail.neoforgeLaunch !== undefined
        ? substituteProfileArgs(detail.profileArgs?.game ?? [], profileArgVars)
        : [];

    const args = [
      ...profileJvmArgs,
      ...jvmArgs,
      `-Xmx${opts.memory}`,
      `-Xms${opts.memory}`,
      '-cp',
      classpath,
      mainClass,
      '--username',
      username,
      '--version',
      // ⚠️ 这里给的是**链底**（原版版本号），不是档案 id。
      // 加载器会把它传给游戏；给档案 id（`neoforge-21.1.209-1.21.1`）的话
      // 资源索引会找不到（原版档案的 assetIndex id 就是版本号本身）。
      detail.profileChain?.at(-1) ?? detail.id,
      '--gameDir',
      gameDir,
      '--assetsDir',
      assetsDir,
      '--assetIndex',
      detail.assets,
      '--uuid',
      uuid,
      '--accessToken',
      accessToken,
      '--userType',
      userType,
      // 档案自己的游戏参数（NeoForge 的 `--fml.*` 三个）放在最后。
      ...profileGameArgs,
    ];

    // Java 版本预检 —— 必须在 spawn **之前**拦住「版本太老」。
    //
    // 为什么必须有：java.exe 存在 ≠ 能跑这个 MC 版本。Java 8 跑 MC 1.21.11 时
    // spawn **会成功**，进程也起得来，然后在 JVM 里炸成 UnsupportedClassVersionError
    // —— 用户只看到日志流里一行天书（经 L7 转发到日志 tab），完全不知道是 JDK 的问题。
    //
    // 对照：构建路径早就有这道闸（`ipc/build.ts` 的 BUILD_CHECK_JAVA，
    // 用 `detectJavaVersion()` + `javaVersionFor()`）。启动路径此前完全没有 ——
    // 两条路径的防护不对称，见 docs/architecture-assessment.md §12。
    //
    // 位置很关键：必须在这里（spawn 之前），不能挪到 spawn 之后。
    // 挪晚了既拦不住，又会在 spawn 与 waitForSpawn 之间插入 await，
    // 让测试替身的 queueMicrotask 抢跑、真实进程也可能已��拉起。
    if (detail.javaMajor != null) {
      const have = await this.probeJavaImpl(java);
      // have 为 null = 探测不出来（**不是**「版本不对」）。此时放行：
      // 真正的「java 不存在」由下面的 spawn 报出更准确的错误，不该在这里猜。
      if (have != null && have < detail.javaMajor) {
        throw new Error(
          `本机 Java 是 ${have}，而 MC ${detail.id} 需要 Java ${detail.javaMajor} 或更高。` +
            `请安装 JDK ${detail.javaMajor}，或在实例设置里把「Java 路径」指向正确的 java.exe。`,
        );
      }
    }

    // 必须是 pipe：日志与退出码都从子进程的标准流来。
    const child: ChildProcess = this.spawnImpl(java, args, {
      // 工作目录必须是实例目录：Minecraft / log4j 的 `logs/latest.log`、
      // `crash-reports/` 都按**进程 CWD** 落盘，不跟 `--gameDir` 走。
      // 不设的话日志会写到 Electron 的启动目录（实测 `apps/desktop/logs/`），
      // 启动器的日志 tab 按实例读 `<gameDir>/logs/latest.log` 永远读不到。
      cwd: gameDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // 崩溃守卫必须在等 spawn **之前**挂上，否则等待期间就可能炸。
    // 它不上报任何东西 —— 理由见 attachErrorGuard 的注释。
    attachErrorGuard(child);

    // 'close' 也必须在 await 之前挂：真实进程可能在 spawn 确认后的下一个 tick
    // 就退出，等 await 完再挂会漏掉极快退出的那次 close。
    // 但 spawn 失败后 Node 同样会发 'close'（实测 ENOENT → error 后紧跟 close(-4058)），
    // 那一次的 close 由下面的 reject 负责上报，这里用 spawnOk 挡掉，避免双重通知。
    let spawnOk = false;
    if (opts.onExit && typeof child.on === 'function') {
      child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
        if (!spawnOk) return;
        opts.onExit?.({ code, signal });
      });
    }

    // 日志逐行转发到渲染层（L7）。stderr 走同一条路 —— Minecraft 的
    // 崩溃栈 / OpenAL / 模组加载失败几乎全在 stderr。
    // 注意用 `if (child.stdout)` 逐个判空而不是 `&&`：注入的假 spawn
    // （见 launcher-service-account.test.ts）只给 `{pid, on}`，两个都得容错。
    const stdout = child.stdout as unknown as LineSource | null;
    const stderr = child.stderr as unknown as LineSource | null;
    if (opts.onLog) {
      const emit = opts.onLog;
      forwardLines(stdout, emit);
      forwardLines(stderr, emit);
    } else {
      // 没有订阅者也要把流读干净，否则管道写满会让游戏卡死
      drainStream(stdout);
      drainStream(stderr);
    }

    // 先确认它真的起来了：java 不存在时 spawn 会**同步**返回 pid=undefined，
    // 错误下一个 tick 才以 'error' 形式发出。不等的话 launchGame 会带着
    // { pid: 0 } 正常返回，前端两个分支都不进 —— 按钮闪一下就没了，没有提示。
    // 详见 waitForSpawn 的注释（含未捕获异常的连锁后果）。
    //
    // 必须用 try/catch 而不是 `.catch()` 后再 await：
    // `.catch()` 把 rejection **转成了 resolve**，await 拿到的是 Error 对象而非抛出。
    try {
      await waitForSpawn(child);
    } catch (e) {
      throw friendlySpawnError(java, e);
    }
    spawnOk = true;

    return { pid: child.pid ?? 0 };
  }

  // ===== 日志文件读取（L7）=====
  //
  // ⚠️ 以下方法的第一个参数是**实例 id**，不是 MC 版本号（多实例之后两者
  // 不再相等 —— 见 `InstanceRecord.id` 的注释）。日志写在**实例的 gameDir**
  // 里，所以按实例取。

  /** 读取 `<gameDir>/logs/latest.log`（最近一次游戏日志）。 */
  async readLatestLog(instance: string, requestedGameDir?: string): Promise<string[]> {
    const logPath = join(this.gameDir(instance, requestedGameDir), 'logs', 'latest.log');
    try {
      const content = await readFile(logPath, 'utf-8');
      // 尾部换行会切出一个空串，去掉免得面板多一行空白
      const lines = content.split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      return lines;
    } catch {
      return [];
    }
  }

  /** 列举 `<gameDir>/crash-reports/crash-*.txt`。 */
  async listCrashReports(instance: string, requestedGameDir?: string): Promise<string[]> {
    const dir = join(this.gameDir(instance, requestedGameDir), 'crash-reports');
    try {
      const entries = await readdir(dir);
      return entries
        .filter((e) => e.startsWith('crash-') && e.endsWith('.txt'))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  /**
   * 读取指定的崩溃报告文件。
   *
   * ⚠️ `filename` 来自渲染层（用户可输入），**必须**经 `resolveInside`：
   * 只写 `join(dir, filename)` 的话，`../../evil.txt` 会读到实例目录
   * 之外的任意文件，等于把整个用户目录开放给 IPC。
   *
   * 越界时**抛错**而不是返回空串：静默返回 '' 会让「文件被删了」和
   * 「你越权了」在 UI 上长得一模一样，排查无从下手。
   */
  async readCrashReport(
    instance: string,
    filename: string,
    requestedGameDir?: string,
  ): Promise<string> {
    const root = resolve(this.gameDir(instance, requestedGameDir), 'crash-reports');
    const filePath = resolveInside(root, filename);
    try {
      return await readFile(filePath, 'utf-8');
    } catch {
      return '';
    }
  }

  // ===== 实例目录浏览（L8）=====

  /**
   * 实例游戏目录：`game/<实例名>`（与 launchGame / readLatestLog 同一处）。
   *
   * ⚠️ 键是**实例名**不是 MC 版本号（多实例）。`versions/1.21.1` 只有一份，
   * 但 `game/我的空岛/` 和 `game/高性能光影/` 各有一份 —— 后两者才是必须隔离的。
   *
   * `instance` 来自渲染层，**必须**经 `assertVersionId` 校验：它直接参与
   * 路径拼接，`../../..` 会把 gameDir 本身挪出 baseDir，此时下游任何基于
   * gameDir 相对计算的守卫（`resolveInside`）全部形同虚设。
   *
   * @param requestedGameDir 实例自定义目录（用户可能指向别的盘）；不传用缺省。
   *   必须走 `resolveGameDir` —— 它强制落在 baseDir 内。
   */
  gameDir(instance: string, requestedGameDir?: string): string {
    return resolveGameDir(this.baseDir, requestedGameDir ?? '', instance);
  }

  /**
   * 列出实例目录下一层条目（相对路径浏览，区别于项目文件树 FileTree）。
   *
   * 两道校验缺一不可：
   * 1. `assertVersionId` 守 `instance`（否则 gameDir 本身就可逃逸）
   * 2. `resolveInside` 守 `relPath`（`join(base, '..', '..')` 会逃出实例目录）
   *
   * `''` 是约定的「实例根目录」，单独放行（等价 `.`）。
   */
  async listInstanceFiles(
    instance: string,
    relPath: string,
    requestedGameDir?: string,
  ): Promise<InstanceFileInfo[]> {
    const root = resolve(this.gameDir(instance, requestedGameDir));
    const target = relPath === '' ? root : resolveInside(root, relPath);
    let entries: Dirent[];
    try {
      entries = await readdir(target, { withFileTypes: true });
    } catch {
      return [];
    }
    const files: InstanceFileInfo[] = [];
    for (const e of entries) {
      const abs = join(target, e.name);
      // 软链可能指向实例目录之外，不跟随（只标类型，不 stat 目标）
      let size: number | undefined;
      let modifiedAt: number | undefined;
      if (!e.isSymbolicLink()) {
        try {
          const st = await stat(abs);
          size = st.size;
          modifiedAt = st.mtimeMs;
        } catch {
          /* 条目在列举后消失：跳过 size，不影响列举 */
        }
      }
      files.push({
        name: e.name,
        path: relPath ? `${relPath}/${e.name}` : e.name,
        isDirectory: e.isDirectory(),
        isSymlink: e.isSymbolicLink(),
        size,
        modifiedAt,
      });
    }
    // 目录优先，其次按名称（与 VS Code 文件树一致）
    files.sort((a, b) =>
      a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1,
    );
    return files;
  }

  // ===== 世界列表（L9）=====

  /**
   * 列出 `game/<version>/saves/` 下的存档，并解析各自的 `level.dat`。
   *
   * ## 为什么不能只列目录名
   *
   * 目录名是玩家随手起的（「新世界」「111」），真正的世界名、最后游玩时间、
   * 游戏模式都存在 `level.dat` 里。不解析就只能给出一列毫无信息量的文件夹。
   *
   * ## 损坏存档的处理
   *
   * `level.dat` 来自玩家硬盘，可能被旧版工具写成未压缩、被截断、或干脆损坏。
   * **单个存档解析失败不能影响整个列表** —— 它仍然会被列出，只是
   * `readable: false`，UI 显示目录名 + 「元数据不可读」。
   * 这比静默跳过（用户以为存档丢了）或整体报错（一个坏存档毁掉整个世界列表）都强。
   */
  async listWorlds(instance: string, requestedGameDir?: string): Promise<WorldInfo[]> {
    const savesDir = join(this.gameDir(instance, requestedGameDir), 'saves');
    let entries: Dirent[];
    try {
      entries = await readdir(savesDir, { withFileTypes: true });
    } catch {
      return [];
    }

    const worlds: WorldInfo[] = [];
    for (const e of entries) {
      // saves 下只认目录；level.dat 旁的散落文件不是存档
      if (!e.isDirectory()) continue;
      const dirName = e.name;
      const worldDir = resolveInside(savesDir, dirName);
      const levelDat = join(worldDir, 'level.dat');

      let readable = true;
      let levelName = dirName;
      let lastPlayed: number | undefined;
      let gameMode: string | undefined;
      let mcVersion: string | undefined;

      try {
        const root = await readWorldNbt(levelDat);
        if (!root) {
          readable = false;
        } else {
          const rawName = nbtGet(root, 'LevelName');
          if (typeof rawName === 'string' && rawName.trim()) levelName = rawName.trim();
          const lp = nbtGet(root, 'LastPlayed');
          if (typeof lp === 'number' && lp > 0) lastPlayed = lp;
          const gt = nbtGet(root, 'GameType');
          if (typeof gt === 'number') gameMode = GAME_MODES[gt] ?? `未知(${gt})`;
          const ver = nbtCompound(root, 'Version');
          const name = nbtGet(ver ?? null, 'Name');
          if (typeof name === 'string') mcVersion = name;
        }
      } catch {
        // 读文件本身失败（权限 / 被占用）同样只标记为不可读，不抛出
        readable = false;
      }

      // 目录修改时间作为「最后游玩」的兜底：level.dat 读不出来时至少还有信息
      let modifiedAt: number | undefined;
      try {
        modifiedAt = (await stat(worldDir)).mtimeMs;
      } catch {
        /* 列举后被删除：留空 */
      }

      let sizeBytes: number | undefined;
      try {
        sizeBytes = await dirSize(worldDir);
      } catch {
        /* 同上 */
      }

      worlds.push({
        dirName,
        levelName,
        lastPlayed: lastPlayed ?? modifiedAt,
        gameMode,
        mcVersion,
        sizeBytes,
        readable,
      });
    }

    // 最近玩过的排前面，其次按世界名 —— 与主流启动器一致
    worlds.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    return worlds;
  }

  // ===== 加载器安装（Fabric / NeoForge）=====

  /**
   * 已安装加载器检测。
   *
   * ⚠️ 原来靠**目录名前缀**判断（`fabric-loader-*` / `neoforge-*`），这是错的：
   * 官方 installer 在 `-noprofile` 模式下的产物目录名是 **`<mc>-<loaderVer>`**
   * （如 `versions/1.21.1-0.19.5/`），不是带 `fabric-loader` 前缀的。所以旧实现
   * 永远返回 false —— 装完了还提示「未安装」。
   *
   * 改成读**档案内容**：找 `versions/<id>/<id>.json` 里 `inheritsFrom === version`
   * 且主类属于该加载器的档案。这与 `resolveVersion` 判「这是一个加载器档案」
   * 用的是同一套事实，不会有两处判断打架。
   */
  async isLoaderInstalled(version: string, loader: 'fabric' | 'neoforge'): Promise<boolean> {
    return (await this.findLoaderProfile(version, loader)) !== null;
  }

  /**
   * 找这个 MC 版本对应的、指定加载器的**档案 id**（如 `fabric-loader-0.19.5-26.3`）。
   *
   * 实例记录里只存 `versionId` + `loader`，启动时不能拿 `versionId` 当档案 id
   * 去 `resolveVersion()` —— 那样解析到的是原版档案，主类仍是
   * `net.minecraft.client.main.Main`，加载器完全不会介入，表现就是
   * 「游戏能开、mod 一个都不生效」。
   *
   * 判定与 `isLoaderInstalled` 完全相同（读档案内容，不猜目录名），
   * 两个方法共用这一处事实来源，避免「检测说装了、启动却找不到」。
   * 同一版本装了多个加载器版本时取 readdir 的第一个；它们都指向同一 MC。
   */
  async findLoaderProfile(version: string, loader: 'fabric' | 'neoforge'): Promise<string | null> {
    const versionsDir = join(this.baseDir, 'versions');
    let entries: string[];
    try {
      entries = await readdir(versionsDir);
    } catch {
      return null;
    }
    for (const id of entries) {
      const profile = await this.readLocalProfile(id);
      if (!profile) continue;
      if (profile.inheritsFrom !== version) continue;
      if (inferLoaderFromMainClass(profile.mainClass) === loader) return id;
    }
    return null;
  }

  /**
   * 写一份 `launcher_profiles.json`。
   *
   * ## 为什么需要
   *
   * Forge / NeoForge 的 installer 要求目标目录**长得像官方启动器的目录**：
   * 没有这个文件，installer 连第一步都过不去，直接报
   *
   * ```
   * There is no minecraft launcher profile in "<dir>", you need to run the launcher first!
   * ```
   *
   * 然后以退出码 1 结束（实测 NeoForge 26.3.0.95 的 installer）。
   * 我们的启动器目录里只有 `versions/` / `libraries/` / `assets/`，
   * 从来没写过这个文件 —— 所以「装 NeoForge」在任何版本上都是坏的。
   *
   * 格式照官方启动器（v2）：`profiles` 里每个条目带 `lastVersionId` 与
   * `gameDir`，`selectedProfile` 指名用哪一个。installer 靠它知道
   * 「这个 MC 版本的档案在哪儿、游戏目录在哪儿」。
   */
  private async writeLauncherProfiles(version: string, gameDir: string): Promise<void> {
    const profiles = {
      profiles: {
        [version]: {
          name: version,
          type: 'custom',
          created: 0,
          lastUsed: 0,
          lastVersionId: version,
          gameDir,
          icon: 'GrassBlock',
          javaArgs: '',
          jvmArguments: '',
          resolution: { width: 854, height: 480 },
          env: {},
          clientId: 'mc-creator',
        },
      },
      selectedProfile: version,
      clientToken: '',
      authenticationDatabase: {},
      launcherVersion: { name: 'MC Creator', version: '1.0' },
    };
    await writeFileAtomic(
      join(this.baseDir, 'launcher_profiles.json'),
      Buffer.from(`${JSON.stringify(profiles, null, 2)}\n`, 'utf-8'),
    );
  }

  /**
   * 一键安装加载器（Fabric / NeoForge）。
   *
   * 原理：下载官方 installer jar → 静默运行 client 安装到 launcher 目录。
   *
   * ⚠️ 产物目录名**不是** `fabric-loader-<ver>`：installer 在 `-noprofile`
   * 模式下产出 `<mc>-<loaderVer>`（如 `versions/1.21.1-0.19.5/`），
   * 里面是一份 `inheritsFrom: "1.21.1"` 的档案 + 打好的加载器 jar。
   * 找它要靠档案内容（见 `isLoaderInstalled`），不能靠目录名猜。
   *
   * @param loaderVersion 指定加载器版本。整合包清单里给的是**精确版本**
   *   （实测 `modrinth.index.json` 的 `dependencies["fabric-loader"] = "0.19.5"`），
   *   装错版本整合包大概率起不来，所以有它就别用 latest。缺省才用 latest。
   */
  async installLoader(
    version: string,
    loader: 'fabric' | 'neoforge',
    onProgress?: DownloadProgress,
    loaderVersion?: string,
    signal?: AbortSignal,
    gameDir?: string,
  ): Promise<void> {
    throwIfAborted(signal);
    const java = process.env.JAVA_HOME
      ? join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
      : 'java';
    /**
     * installer 自己也要下载东西（NeoForge 的库就在 maven.neoforged.net）。
     *
     * JVM **不认** Windows 的系统代理设置，直连被墙的站点就永远下不来。
     * `-Djava.net.useSystemProxies=true` 让它读 WinINET 的代理设置 ——
     * 这与下载器侧「直连失败再走代理」是同一件事的两半（见 resilient-fetch.ts）。
     *
     * 没配代理的机器上这个开关无害。
     */
    const javaProxyArgs = ['-Djava.net.useSystemProxies=true'];
    onProgress?.('versions', 0, 1);

    /**
     * 跑 installer 子进程，并在取消时把它杀掉。
     *
     * 只 reject 不 kill 是不够的 —— installer 会继续往 `versions/` 里写文件，
     * 用户以为取消了，下一次安装却撞见半套加载器档案。
     */
    const runInstaller = (child: ChildProcess, label: string): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          signal?.removeEventListener('abort', onAbort);
          fn();
        };
        const onAbort = (): void => {
          try {
            child.kill();
          } catch {
            // 进程可能已经退出；取消本身仍然要生效
          }
          finish(() => reject(abortError()));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        child.on('close', (code) => {
          finish(() =>
            code === 0 ? resolve() : reject(new Error(`${label} 安装失败（退出码 ${code}）`)),
          );
        });
        child.on('error', (err) => finish(() => reject(err)));
        if (signal?.aborted) onAbort();
      });

    if (loader === 'fabric') {
      const installerPath = join(this.baseDir, 'fabric-installer.jar');
      if (!(await exists(installerPath))) {
        // ⚠️ 这里曾硬编码 `.../fabric-installer/latest/fabric-installer.jar`，
        // **实测 404**：maven 布局没有 `latest` 这个版本目录，metadata 里的
        // `<latest>1.1.2</latest>` 是「最新版本号」这个字段，不是目录名。
        // 改为解析 maven-metadata 取具体版本号 —— 本侧有网络，没必要背陈旧风险。
        // 注意与下面传给 installer 的 `-loader latest` 区分：那是 Fabric CLI 的
        // **参数**（合法），与 URL 路径段无关。
        throwIfAborted(signal);
        const { url } = await resolveFabricInstallerRelease(async (u) => {
          throwIfAborted(signal);
          const res = await fetch(u, {
            headers: { 'User-Agent': USER_AGENT },
            signal: signal ?? null,
          });
          return { ok: res.ok, status: res.status, text: () => res.text() };
        });
        throwIfAborted(signal);
        const buf = await this.download(url, undefined, 3, signal);
        throwIfAborted(signal);
        await writeFileAtomic(installerPath, buf);
      }
      throwIfAborted(signal);
      const child = spawn(
        java,
        [
          ...javaProxyArgs,
          '-jar',
          installerPath,
          'client',
          '-mcversion',
          version,
          '-dir',
          this.baseDir,
          '-loader',
          // 整合包清单指定的精确版本；没有才用 latest
          loaderVersion && loaderVersion !== 'latest' ? loaderVersion : 'latest',
          '-noprofile',
        ],
        { stdio: 'ignore' },
      );
      await runInstaller(child, 'Fabric');
    } else {
      // NeoForge: 先解析版本对应的 installer URL（maven 元数据）
      //
      // ⚠️ 旧实现用 `<version>${mcVersion}\.(\d+)</version>` 匹配元数据，
      // **对所有 MC 版本都是 0 命中**（实测 26.3 / 1.21.1 / 1.21.8 / 1.20.4 / 26.1
      // 全部匹配不到）—— 因为 NeoForge 的编号另有一套：MC 1.x 要去掉开头的
      // `1.`（1.21.1 → 21.1.264），MC 26.x 又要比 MC 版本多两段（26.3 → 26.3.0.95）。
      // 规则与实测依据见 `neoforge-version.ts`。
      //
      // 整合包清单给的 `dependencies["neoforge"]` 就是完整的 build 号
      // （实测 "21.1.209"，与 maven 的 `<version>21.1.209</version>` 一一对应），
      // 有它就直接用，不必整份拉元数据再匹配。
      let best = '';
      if (loaderVersion !== undefined && isNeoForgeVersionString(loaderVersion)) {
        best = loaderVersion.trim();
      } else {
        throwIfAborted(signal);
        const metaBuf = await this.download(NEOFORGE_MAVEN_METADATA_URL, undefined, 3, signal);
        throwIfAborted(signal);
        const metaText = metaBuf.toString('utf-8');
        best = pickNeoForgeVersion(version, parseMavenVersions(metaText)) ?? '';
      }
      if (!best) throw new Error(`未找到 NeoForge ${version} 的 installer`);
      const installerUrl = neoforgeInstallerUrl(best);
      const installerPath = join(this.baseDir, `neoforge-${best}-installer.jar`);
      if (!(await exists(installerPath))) {
        throwIfAborted(signal);
        const buf = await this.download(installerUrl, undefined, 3, signal);
        throwIfAborted(signal);
        await writeFileAtomic(installerPath, buf);
      }
      throwIfAborted(signal);
      // installer 要求目标目录像官方启动器的目录（见 writeLauncherProfiles 的注释）
      await this.writeLauncherProfiles(
        version,
        gameDir ?? resolveGameDir(this.baseDir, '', version),
      );
      const child = spawn(
        java,
        [...javaProxyArgs, '-jar', installerPath, '--installClient', this.baseDir],
        {
          stdio: 'ignore',
        },
      );
      await runInstaller(child, 'NeoForge');
    }
    throwIfAborted(signal);
    onProgress?.('versions', 1, 1);
  }

  // ===== Mod 管理 =====

  /**
   * 实例的 mods 目录 = **`<gameDir>/mods`**。
   *
   * ⚠️ 这里从 `versions/<v>/mods` 改到了 gameDir 底下（2026-10-13）。
   *
   * 改的原因很具体：**Minecraft 只认 `<gameDir>/mods`**。原版 jar 不带
   * mod 扫描逻辑，Fabric / NeoForge 的加载器也只扫 gameDir 下的 `mods`。
   * 而 `--gameDir` 传的是 `game/<v>`，mod 却装在 `versions/<v>/mods` ——
   * 两个不同的目录，游戏永远看不到装进去的 jar。
   *
   * **必须 assertVersionId** —— 这是实测出来的洞（2026-10-11 修复）：
   * ``version`` 由渲染层经 ``LAUNCHER_LIST_MODS`` / ``INSTALL_MOD`` /
   * ``REMOVE_MOD`` / ``TOGGLE_MOD`` 直接传入。实测
   * ``modsDir('../../..')`` 会得到 ``<temp>/mods`` —— **完全在 baseDir 之外**，
   * 于是 ``installMod`` 能把任意 jar 写到应用管不到的地方。
   *
   * 与 ``gameDir()`` 同样的理由：``version`` 是渲染层可控的单段路径名。
   *
   * @param requestedGameDir 实例自定义的游戏目录（`InstanceRecord.gameDir`）。
   *   不传就用缺省 `game/<version>`。**要传就必须传实例真正在用的那个**，
   *   否则装到的 mods 和启动时的 gameDir 会对不上。
   */
  modsDir(version: string, requestedGameDir?: string): string {
    assertVersionId(version);
    const game = resolveGameDir(this.baseDir, requestedGameDir ?? '', version);
    return join(game, 'mods');
  }

  /**
   * 某类内容该装到 gameDir 下的**哪个目录**。
   *
   * 之前四种内容全都进 `mods/`。那对 mod 是对的，对另外三种是**明确的错误**：
   * Fabric / NeoForge 的加载器会扫 `mods/` 下的一切，把资源包 / 光影包 /
   * 数据包当 mod 加载 —— 症状是启动时在加载器阶段炸（缺 metadata、
   * 类找不到），而用户看到的提示与「资源包」毫无关系。
   *
   * | 类型 | 目录 | 依据 |
   * |---|---|---|
   * | mod | `mods/` | 加载器扫描目录 |
   * | 资源包 | `resourcepacks/` | 游戏内「选项 → 资源包 → 打开资源包文件夹」就是这个 |
   * | 光影包 | `shaderpacks/` | 游戏内「着色器 → 打开着色器文件夹」 |
   * | 数据包 | `saves/<world>/datapacks/` | **原版只有世界级目录** |
   *
   * ⚠️ 数据包这一行是重点：原版**没有** `<gameDir>/datapacks/`。
   * 网上能查到的「全局数据包目录」来自 CurseForge 上 *Global Datapacks*
   * 这个 mod（实测其说明：「Adds a `datapacks` folder to .minecraft」），
   * 原版 1.20.2 / 1.21 的更新日志里都没有这条。所以装数据包**必须选世界**，
   * 见 {@link datapackDir}。
   */
  contentDir(version: string, kind: ContentKind, requestedGameDir?: string): string {
    assertVersionId(version);
    const game = resolveGameDir(this.baseDir, requestedGameDir ?? '', version);
    switch (kind) {
      case 'resourcepack':
        return join(game, 'resourcepacks');
      case 'shader':
        return join(game, 'shaderpacks');
      case 'datapack':
        // 数据包要具体世界，由 datapackDir 处理。这里兜底到 saves 根下的
        // `datapacks/`（不会命中任何世界）—— 比退回 mods/ 好，后者会被加载器误扫。
        return join(game, 'saves', 'datapacks');
      case 'mod':
      case 'modpack':
      default:
        return join(game, 'mods');
    }
  }

  /**
   * 数据包的目标目录 = **某个世界**的 `saves/<world>/datapacks/`。
   *
   * 必须带世界名 —— 原版没有实例级数据包目录（见 {@link contentDir} 的说明）。
   * 世界名会做目录名校验：它来自玩家硬盘，能是任意字符串（空格、中文、
   * 甚至 `..`），而这里是拼进路径的。
   */
  datapackDir(version: string, worldDir: string, requestedGameDir?: string): string {
    assertVersionId(version);
    if (
      worldDir === '' ||
      isAbsolute(worldDir) ||
      /[\\/]/.test(worldDir) ||
      worldDir.includes('..')
    ) {
      throw new Error(`非法的世界目录名: ${worldDir}`);
    }
    const game = resolveGameDir(this.baseDir, requestedGameDir ?? '', version);
    return resolveInside(game, join('saves', worldDir, 'datapacks'));
  }

  /** 列出已安装 Mod（.jar 文件）；`.disabled` 同名标记表示已禁用。 */
  /**
   * 列出已装 Mod。
   * @param requestedGameDir 实例自定义的游戏目录；不传用缺省 `game/<version>`。
   */
  async listMods(version: string, requestedGameDir?: string): Promise<ModInfo[]> {
    const dir = this.modsDir(version, requestedGameDir);
    try {
      const entries = await readdir(dir);
      const mods = await Promise.all(
        entries
          .filter((e) => e.endsWith('.jar'))
          .sort()
          .map(async (name) => {
            const disabled = existsSync(join(dir, `${name}.disabled`));
            let size: number | undefined;
            let modifiedAt: number | undefined;
            try {
              const st = await stat(join(dir, name));
              size = st.size;
              modifiedAt = st.mtimeMs;
            } catch {
              /* 列举后被删除：仍返回条目，只是没有大小 */
            }
            return { name, enabled: !disabled, size, modifiedAt };
          }),
      );
      return mods;
    } catch {
      return [];
    }
  }

  /**
   * 下载 Mod jar 到实例 mods 目录（url 为 Modrinth 版本文件直链）。
   * @param requestedGameDir 实例自定义的游戏目录；不传用缺省 `game/<version>`。
   */
  async installMod(
    version: string,
    name: string,
    url: string,
    requestedGameDir?: string,
    expected?: { sha1?: string | null; size?: number | null },
  ): Promise<string> {
    assertModName(name);
    const dir = this.modsDir(version, requestedGameDir);
    const dest = join(dir, name.endsWith('.jar') ? name : `${name}.jar`);
    if (await exists(dest)) return dest;
    const buf = await this.download(url, expected);
    await writeFileAtomic(dest, buf);
    return dest;
  }

  /**
   * 按下载源候选列表取一个**内容文件**（Modrinth / CurseForge 的 jar、zip…），
   * 并带上清单给的校验信息。
   *
   * 为什么要有这个公开入口：ipc 层原本各写各的 `fetch(url)` —— 那样的下载
   * 不认候选源（镜像等于不存在）、不校验哈希（代理截断 / CDN 错误页会原样落盘）、
   * 也不重试。三件事都收在 {@link download} 里，公开它比让每个 handler 各抄一遍强。
   *
   * @param expected 清单给的 `sha1` / `size`；能给就给，给不出（接口没提供）
   *   就只做 HTTP 层面判断 —— 但**能验的地方不验**是这个项目的忌讳。
   */
  async fetchContent(
    url: string,
    expected?: { sha1?: string | null; size?: number | null },
    maxBytes?: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    throwIfAborted(signal);
    const buf = await this.download(url, expected, 3, signal);
    // zip bomb 兜底：解包前就拦住（`.mrpack` 这类"清单文件"可能是攻击面）
    if (maxBytes !== undefined && buf.length > maxBytes) {
      throw new Error(`文件过大：${buf.length} > ${maxBytes} 字节（已放弃，未落盘）`);
    }
    return buf;
  }

  /** 删除已装 Mod */
  async removeMod(version: string, name: string, requestedGameDir?: string): Promise<void> {
    assertModName(name);
    const dest = join(this.modsDir(version, requestedGameDir), name);
    await rm(dest, { force: true });
    // 连带清掉 .disabled 标记，否则同名 Mod 重装后仍是禁用态
    await rm(`${dest}.disabled`, { force: true });
  }

  /**
   * 启用/禁用 Mod：`<name>.jar.disabled` 空标记文件的有无即开关（幂等）。
   * Fabric / NeoForge 的 Mod 加载器只扫 `.jar`，标记文件对游戏不可见。
   */
  async toggleMod(
    version: string,
    name: string,
    enabled: boolean,
    requestedGameDir?: string,
  ): Promise<void> {
    assertModName(name);
    const jar = join(
      this.modsDir(version, requestedGameDir),
      name.endsWith('.jar') ? name : `${name}.jar`,
    );
    if (!existsSync(jar)) throw new Error(`未找到 Mod: ${name}`);
    const marker = `${jar}.disabled`;
    if (enabled) await rm(marker, { force: true });
    else await writeFile(marker, '', 'utf-8');
  }

  // ===== 第三方皮肤 / 认证站（§1.2 / §5.8 / §19 合规闸门）=====

  /**
   * **启用第三方认证站（authlib-injector / Yggdrasil）—— 唯一的产品路径。**
   *
   * 三道闸门（缺一即拒绝，见 `compliance-gate.ts`）：
   * 1. 默认关闭：`thirdPartyAuth` 未注入、或 `enabled !== true` → 拒绝；
   * 2. 显式确认：必须现场通过确认弹窗（展示 §1.2 三条立场全文）；
   * 3. 风险提示：确认框 detail 含 `RISK_NOTICE` 全文，不是摘要。
   *
   * 通过后才委派给 `installSkinSupport()` 装 CustomSkinLoader 配置。
   */
  async enableThirdPartyAuth(
    version: string,
    skinApiUrl: string,
    onProgress?: DownloadProgress,
    requestedGameDir?: string,
  ): Promise<void> {
    if (this.thirdPartyAuth === undefined) {
      throw new ComplianceDeniedError(
        'no_confirm_fn',
        '未接入第三方认证站的合规闸门（fail-closed）。' +
          '按 §1.2/§19，该能力默认关闭，需显式启用并通过风险确认。',
      );
    }
    await this.thirdPartyAuth.authorize(skinApiUrl);
    await this.installSkinSupport(version, skinApiUrl, onProgress, requestedGameDir);
  }

  // ===== 离线皮肤（CustomSkinLoader）=====

  /**
   * 安装第三方皮肤支持（**低层原语，不要从产品路径直接调**）：
   * 1. 下载 CustomSkinLoader mod（Fabric，Modrinth）到 mods 目录
   * 2. 生成 CustomSkinLoader 配置（皮肤站 API 列表）到 game 目录 config/
   *
   * ⚠️ **合规边界（§1.2 / §5.8 / §19）**：本方法**不做**任何合规判断，
   * 因此**产品路径必须走 `enableThirdPartyAuth()`**（默认关闭 + 显式确认
   * + 风险提示全文）。保留为 public 仅因为它是 `enableThirdPartyAuth` 的
   * 实现细节与既有测试的落点。
   *
   * 补充说明：CustomSkinLoader 是**纹理源**（皮肤/披风图片）插件，
   * **不是** authlib-injector —— 它不替换游戏的 Yggdrasil 认证环节，
   * 因此即使启用也不会改变你的微软账户登录方式。这正是 §5.8 允许它存在
   * 的原因（第三方皮肤站），也与「不得用于绕过正版验证」不冲突。
   */
  async installSkinSupport(
    version: string,
    skinApiUrl: string,
    onProgress?: DownloadProgress,
    requestedGameDir?: string,
  ): Promise<void> {
    onProgress?.('versions', 0, 2);

    // ⚠️ 这里原来把 `loaders=["fabric"]&game_versions=["26.1"]` 写死了 ——
    // 对 1.21.1 的实例会下到一份 26.1 的 CSL，mod 装进去了但**根本加载不了**
    // （游戏版本对不上），而界面只会显示「装好了」。两个都得按实例实际情况算：
    // - game_versions：本次要装的 MC 版本（`version` 参数）
    // - loaders：实例里实际装了哪个加载器（事实来源见 `isLoaderInstalled`）
    const loader = (await this.isLoaderInstalled(version, 'neoforge'))
      ? 'neoforge'
      : (await this.isLoaderInstalled(version, 'fabric'))
        ? 'fabric'
        : null;
    if (loader === null) {
      throw new Error(
        `实例 ${version} 既没装 Fabric 也没装 NeoForge，无法安装 CustomSkinLoader。` +
          '请先装好加载器再启用皮肤支持。',
      );
    }

    const q = new URLSearchParams({
      loaders: JSON.stringify([loader]),
      game_versions: JSON.stringify([version]),
    });
    const projUrl = `https://api.modrinth.com/v2/project/customskinloader/version?${q.toString()}`;
    try {
      const projBuf = await this.download(projUrl);
      const versions = JSON.parse(projBuf.toString('utf-8')) as Array<{
        files?: Array<{ url?: string; filename?: string }>;
      }>;
      const latest = versions[0];
      const file = latest?.files?.[0];
      const fileName = file?.filename;
      if (!file?.url || !fileName) {
        throw new Error(
          `Modrinth 上没有 CustomSkinLoader 的 ${loader} / MC ${version} 版本` +
            '（该版本可能太新或太旧，换个 MC 版本试试）',
        );
      }
      await this.installMod(version, fileName, file.url, requestedGameDir);
      onProgress?.('versions', 1, 2);

      // 配置写到**同一个** game 目录下 —— CustomSkinLoader 从 gameDir 读
      // config/CustomSkinLoader/。用同一个 resolver 才不会出现
      // 「mod 装在 A 盘、配置写在 B 盘」这种装完不生效的情况。
      const gameDir = resolveGameDir(this.baseDir, requestedGameDir ?? '', version);
      const configDir = join(gameDir, 'config');
      const cfgPath = join(configDir, 'CustomSkinLoader', 'CustomSkinLoader.json');
      const config = {
        version: 2,
        // LocalSkin **排第一**：CSL 按 loadlist 顺序加载，本地皮肤要盖过
        // 皮肤站的同名皮肤才生效（实测依据见 `skin-library.ts` 的
        // `ensureLocalSkinFirst`）。这里直接从源头写对，而不是等用户第一次
        // 「应用皮肤」时再去补 —— 否则装完到应用之前这段时间里，
        // LocalSkin 目录里的皮肤是不生效的。
        loadlist: [
          {
            name: 'LocalSkin',
            type: 'Legacy',
            root: 'LocalSkin/',
          },
          {
            name: 'LittleSkin',
            type: 'CustomSkinAPI',
            // 第三方纹理站（皮肤 + 该站自己的披风）。这是**第三方站提供的**披风，
            // 与 §5.8「披风仅正版、走 Mojang API」是两条独立能力：
            // 正版披风由 `MicrosoftAuthService.activeCape()` 从 Mojang profile 读。
            // 本项只在过合规闸门后才会被写入（见 enableThirdPartyAuth）。
            root: skinApiUrl || DEFAULT_THIRD_PARTY_SKIN_API,
          },
        ],
        enableDynamicSkull: true,
        enableTransparentSkin: true,
        forceUseHttpsPing: true,
        enableCape: true,
      };
      await writeFileAtomic(cfgPath, Buffer.from(JSON.stringify(config, null, 2)));
      onProgress?.('versions', 2, 2);
    } catch (e) {
      throw new Error(`皮肤支持安装失败: ${(e as Error).message}`);
    }
  }
}
