/**
 * Minecraft 版本档案（version JSON）的**继承链**解析。
 *
 * ## 为什么非有不可
 *
 * Fabric / NeoForge 的官方 installer 产出**不是**一个新游戏，而是一份
 * `versions/<id>/<id>.json`，它 `inheritsFrom` 原版版本，再叠加自己的
 * `libraries` 和 `mainClass`：
 *
 * ```json
 * {
 *   "id": "neoforge-21.1.209-1.21.1",
 *   "inheritsFrom": "1.21.1",
 *   "mainClass": "cpw.mods.bootstraplauncher.BootstrapLauncher",
 *   "libraries": [ ... 只列 NeoForge 自己的库 ... ]
 * }
 * ```
 *
 * 官方启动器启动的是**这份档案**（`versions/neoforge-…/neoforge-….jar`），
 * 而不是 `versions/1.21.1/1.21.1.jar`。跑原版 jar + 原版主类 = mod 一个都不加载。
 *
 * 本项目此前的 `resolveVersion()` 只认 Mojang 清单里的版本 id
 * （`launcher-service.ts` 里 `find(v => v.id === version)`），于是加载器档案
 * 直接抛「版本不存在」。这个模块就是补上那一段。
 *
 * ## 合并规则（照搬官方启动器）
 *
 * 1. 链的顺序是 **叶子 → 根**（`neoforge-…` → `1.21.1`），逐层往上走。
 * 2. libraries 按 `name` **先到先得**去重 —— 所以叶子（同 id 的库）赢，
 *    这正是「NeoForge 要覆盖 Mojang 那份 LWJGL」所需要的语义。
 * 3. `mainClass` 取叶子给的；叶子没给就沿链往上找。
 * 4. `assetIndex` / `javaVersion` / `downloads.client` 从**链底**（原版）取。
 * 5. `rules`（OS 约束）不匹配的库直接丢弃。
 *
 * 这里**不做**的事：不缓存、不读盘、不发网络请求 —— 纯函数，I/O 在
 * `launcher-service.ts` 那侧，这样合并规则能被单测直接钉住。
 */

/** 清单给的一份文件校验信息。缺字段 = 未知，不参与校验（不是「不匹配」）。 */
export interface FileExpectation {
  url: string;
  /** Mojang 给的 SHA1；null 表示没给，不校验 */
  sha1: string | null;
  /** 字节数；null 表示没给，不校验 */
  size: number | null;
}

/** Mojang / 加载器用的 OS 名（`os.name`）。 */
export type OsName = 'windows' | 'linux' | 'osx' | 'unknown';
/** Mojang / 加载器用的架构名（`os.arch`）。 */
export type OsArch = 'x86' | 'x86_64' | 'arm64' | 'unknown';

/** 判定 rules 用的最小环境描述。可注入，所以单测不必真的跑在某个系统上。 */
export interface PlatformInfo {
  os: OsName;
  arch: OsArch;
}

/** `libraries[].rules[]` 的一条。 */
export interface ProfileRule {
  /** `'allow'` / `'disallow'`。缺省按 `'allow'` 处理（官方启动器同）。 */
  action?: string;
  os?: { name?: string; arch?: string; version?: string };
}

/** `libraries[]` 的一条（只保留我们会用到的字段）。 */
export interface ProfileLibrary {
  /** Maven 坐标名，如 `org.lwjgl:lwjgl:3.3.3`。**去重键**。 */
  name: string;
  /**
   * Maven 仓库根地址。加载器档案（Fabric / NeoForge）的库常常**只有
   * `name` + `url`**，没有 `downloads.artifact.url` —— 官方启动器按
   * Maven 坐标拼路径。旧实现只认 `downloads`，于是 Fabric 的
   * fabric-loader / asm / mixin 全部被丢掉，启动时主类 NoClassDefFoundError。
   */
  url?: string;
  downloads?: {
    artifact?: Partial<FileExpectation> & { url?: string };
    /** `natives-windows` / `natives-linux` / …（1.20 及更早才有；1.21+ 无 natives） */
    classifiers?: Record<string, Partial<FileExpectation> & { url?: string }>;
  };
  rules?: ProfileRule[];
}

/** 一份版本 JSON（只取我们会用到的字段）。 */
export interface VersionProfileJson {
  id?: string;
  /** 父档案 id。**没有这个字段就是链底**（Mojang 原版档案）。 */
  inheritsFrom?: string;
  /** 启动主类。没给就沿链往上找。 */
  mainClass?: string;
  assetIndex?: { id?: string; url?: string };
  javaVersion?: { majorVersion?: number };
  libraries?: ProfileLibrary[];
  /**
   * 档案自带的启动参数。
   *
   * NeoForge 26.x 的档案在这里给的是**必需**参数（`-DlibraryDirectory=…`、
   * `--fml.neoForgeVersion` 等），少一个 FML 就拒绝启动（实测）。
   * Mojang 原版档案也有 `arguments`，但里面全是 `${classpath}` / `${natives_directory}`
   * 这类我们不实现的占位符 —— 所以**只取叶子（加载器）档案的**，
   * 原版档案的 arguments 一律不用。
   */
  arguments?: {
    jvm?: string[];
    game?: string[];
  };
  downloads?: {
    client?: { url?: string; sha1?: string; size?: number };
    server?: { url?: string; sha1?: string; size?: number };
  };
}

/** 合并结果。字段名刻意与 `VersionDetail` 对齐，方便直接搬。 */
export interface MergedProfile {
  /** 叶子档案 id（如 `neoforge-21.1.209-1.21.1`）。 */
  id: string;
  /** 链底档案 id（Mojang 版本号，如 `1.21.1`）。 */
  baseId: string;
  /** 整条链，**叶子 → 根**。第 0 个是叶子。 */
  chain: string[];
  /** 启动主类；链上一路都没给则 null（调用方按原版主类兜底）。 */
  mainClass: string | null;
  /** assetIndex.id（通常等于链底版本号）。 */
  assetIndexId: string | null;
  /** assetIndex.url；null = 链底没给，调用方不该去下资源。 */
  assetIndexUrl: string | null;
  /** 链底要求的 Java 主版本；null = 不知道（调用方应当**放行**而不是猜）。 */
  javaMajor: number | null;
  /** client.jar 下载信息；null = 链底没给（加载器档案本来就不给，它用继承来的）。 */
  client: FileExpectation | null;
  /** 合并去重 + OS 过滤后的库，逐个展开成待下载文件。 */
  libraryUrls: FileExpectation[];
  /** 合并后的库本身（去重后、已过滤），供调试/测试断言用。 */
  libraries: ProfileLibrary[];
  /**
   * **叶子档案**（加载器档案）自带的 JVM 参数。
   *
   * 链长为 1（纯原版）时为空数组 —— 原版档案的 `arguments` 全是
   * `${classpath}` / `${natives_directory}` 这类我们不实现的占位符，
   * 照抄反而会把原版启动搞坏。
   */
  jvmArgs: string[];
  /** 同上，`arguments.game`。 */
  gameArgs: string[];
}

/** 原版档案的启动主类。没给 `mainClass` 时的兜底。 */
export const VANILLA_MAIN_CLASS = 'net.minecraft.client.main.Main';

/**
 * `os.name` 归一化。
 *
 * Mojang / 加载器两种写法都见过（`'osx'` 和 `'macos'`），都归到 `'osx'`。
 * 不认识的原样返回 `'unknown'` —— 而不是猜成 linux，那会让本该被过滤掉的
 * Windows 原生库悄悄进 classpath，最后以一个天书般的 UnsatisfiedLinkError 爆掉。
 */
function normalizeOsName(name: string): OsName {
  const n = name.toLowerCase();
  if (n === 'windows' || n === 'win') return 'windows';
  if (n === 'linux') return 'linux';
  if (n === 'osx' || n === 'macos' || n === 'mac' || n === 'darwin') return 'osx';
  return 'unknown';
}

/** `os.arch` 归一化。x86_64 / amd64 / x64 都算 64 位 x86。 */
function normalizeArch(arch: string): OsArch {
  const a = arch.toLowerCase();
  if (a === 'x86' || a === 'i386' || a === 'x86_32') return 'x86';
  if (a === 'x86_64' || a === 'amd64' || a === 'x64') return 'x86_64';
  if (a === 'arm64' || a === 'aarch64') return 'arm64';
  return 'unknown';
}

/**
 * 一条 rule 是否匹配当前环境。
 *
 * rule 里没写的字段**不做约束**（这是 Mojang 的语义：
 * `{action:'disallow', os:{name:'osx'}}` 只排除 macOS，不限制别的）。
 *
 * `os.version` 刻意**不评估**：官方启动器按正则匹配系统版本串，但
 * 拿不到可靠的系统版本字符串，且 Minecraft 的 libraries rules 几乎不用它。
 * 当作「不约束」比用一个猜出来的版本串去比对安全得多 —— 误判成不匹配会
 * 静默丢掉一个必需库。
 */
export function ruleMatches(rule: ProfileRule, platform: PlatformInfo): boolean {
  const os = rule.os;
  if (!os) return true;
  if (os.name !== undefined && normalizeOsName(os.name) !== platform.os) return false;
  if (os.arch !== undefined && normalizeArch(os.arch) !== platform.arch) return false;
  return true;
}

/**
 * 这个库在当前环境**该不该**进 classpath。
 *
 * 语义：**逐条求值，后一条匹配的 rule 覆盖前一条；初始值 = 「rules 为空时才允许」**。
 *
 * 初始值这一条是关键，不是随手写的。实测 Mojang 全部正式版档案里
 * `rules` 只有两种形状：
 *
 * ```json
 * [{"action":"allow"},                  {"action":"disallow","os":{"name":"osx"}}]   // 除 macOS 外都要
 * [{"action":"allow","os":{"name":"osx"}}]                                          // 只有 macOS 要
 * ```
 *
 * 若把「没有 rule 匹配上」当成允许，第二种形状在 Windows 上就会**被放行**
 * ——`ca.weblite:java-objc-bridge`（macOS 的 JNI 桥）和
 * `io.netty:netty-transport-native-epoll`（Linux 原生库）会进 classpath，
 * 最终以一个和「mod 坏了」毫无关系的 UnsatisfiedLinkError 爆掉。
 */
export function libraryAllowed(rules: ProfileRule[] | undefined, platform: PlatformInfo): boolean {
  // 没有 rules = 没有任何平台限制 → 放行
  if (!rules || rules.length === 0) return true;
  // 有 rules 但一条都没匹配上 → 默认**不放行**（见上）
  let allowed = false;
  for (const rule of rules) {
    if (rule && ruleMatches(rule, platform)) {
      allowed = (rule.action ?? 'allow') === 'allow';
    }
  }
  return allowed;
}

/** 从进程环境推断平台。启动器实际跑的地方只有这三种。 */
export function currentPlatform(
  processRef: { platform: string; arch: string } = process,
): PlatformInfo {
  const os: OsName =
    processRef.platform === 'win32'
      ? 'windows'
      : processRef.platform === 'darwin'
        ? 'osx'
        : processRef.platform === 'linux'
          ? 'linux'
          : 'unknown';
  const arch: OsArch =
    processRef.arch === 'x64' ? 'x86_64' : processRef.arch === 'arm64' ? 'arm64' : 'x86';
  return { os, arch };
}

/**
 * 把 Maven 坐标 `group:artifact:version[:classifier][@ext]` 展开成仓库内路径。
 *
 * 例：`net.fabricmc:fabric-loader:0.19.5`
 *   → `net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar`
 *
 * 只接受至少 3 段；坐标不合法返回 null（调用方跳过，不猜）。
 * 扩展名缺省 `jar`，支持 `@zip` 这类写法。
 */
export function mavenCoordinatePath(coordinate: string): string | null {
  const at = coordinate.lastIndexOf('@');
  const ext = at >= 0 ? coordinate.slice(at + 1) : 'jar';
  const body = at >= 0 ? coordinate.slice(0, at) : coordinate;
  const parts = body.split(':');
  if (parts.length < 3 || parts.length > 4) return null;
  const [group, artifact, version, classifier] = parts;
  if (!group || !artifact || !version) return null;
  if (!ext) return null;
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${fileName}`;
}

/**
 * 把一条库展开成要下载的文件。
 *
 * - 有 `downloads.artifact.url` → 用档案给的完整 URL（Mojang 原版库）
 * - 否则有 `url` + Maven 坐标 → 按坐标拼路径（Fabric / NeoForge 加载器库）
 * - `classifiers` 里**只收当前平台的** `natives-*`
 *
 * natives 必须按平台挑：实测 1.12.2 的档案里同一个库同时挂着
 * `natives-linux` / `natives-osx` / `natives-windows` 三个 classifier，
 * 全收的话 Windows 上会把 Linux 的 `.so` 塞进 classpath。
 *
 * Fabric 的档案是第二种形状：`libraries` 里只有
 * `{"name":"net.fabricmc:fabric-loader:0.19.5","url":"https://maven.fabricmc.net/"}`，
 * 没有 `downloads`。旧实现把这些条目全部丢掉，结果加载器主类不在 classpath，
 * 游戏进程以退出码 1 秒退（连日志都来不及创建）。
 */
export function libraryToExpectations(
  lib: ProfileLibrary,
  platform: PlatformInfo = currentPlatform(),
): FileExpectation[] {
  const out: FileExpectation[] = [];
  const dl = lib.downloads;
  const artifact = dl?.artifact;
  if (artifact?.url) {
    out.push({
      url: artifact.url,
      sha1: artifact.sha1 ?? null,
      size: typeof artifact.size === 'number' ? artifact.size : null,
    });
  } else if (lib.url && lib.name) {
    const path = mavenCoordinatePath(lib.name);
    if (path) {
      const base = lib.url.endsWith('/') ? lib.url : `${lib.url}/`;
      out.push({
        url: `${base}${path}`,
        sha1: artifact?.sha1 ?? null,
        size: typeof artifact?.size === 'number' ? artifact.size : null,
      });
    }
  }
  const classifiers = dl?.classifiers;
  if (classifiers && typeof classifiers === 'object') {
    for (const [classifier, f] of Object.entries(classifiers)) {
      // `natives-windows` → 只在 windows 上要；`natives-<平台>` 之外的
      // classifier（如某些库带的 sources/javadoc）一律不收。
      if (!isNativeForPlatform(classifier, platform)) continue;
      if (!f?.url) continue;
      out.push({
        url: f.url,
        sha1: f.sha1 ?? null,
        size: typeof f.size === 'number' ? f.size : null,
      });
    }
  }
  return out;
}

/** `natives-windows` 这样的 classifier 是否属于当前平台。 */
export function isNativeForPlatform(classifier: string, platform: PlatformInfo): boolean {
  const prefix = 'natives-';
  if (!classifier.startsWith(prefix)) return false;
  return normalizeOsName(classifier.slice(prefix.length)) === platform.os;
}

/** 把一份原始 JSON 安全地当成 {@link VersionProfileJson}。 */
export function parseProfileJson(raw: unknown): VersionProfileJson {
  if (typeof raw !== 'object' || raw === null) return {};
  return raw as VersionProfileJson;
}

/**
 * 顺着 `inheritsFrom` 走出一条 **叶子 → 根** 的链。
 *
 * `lookup(id)` 由调用方提供（本地磁盘 or Mojang 清单 —— 加载器档案在磁盘上，
 * 它的 `inheritsFrom` 指向的根在网络上），因此是 **async**：一份档案可能要从
 * 网络下。返回的链**不含**找不到的 id：`lookup` 返回 null 就说明这条断了，
 * 链到此为止，由调用方决定要不要报错。
 *
 * 环保护：`seen` 集合。病态数据（自引用 / A→B→A）会让朴素递归爆栈，
 * 而版本档案是本地文件 + 公开 API 都可能给的输入，不能假设它一定干净。
 */
export async function walkProfileChain(
  leafId: string,
  lookup: (id: string) => Promise<VersionProfileJson | null>,
): Promise<VersionProfileJson[]> {
  const chain: VersionProfileJson[] = [];
  const seen = new Set<string>();
  let cur: string | null = leafId;
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    const p = await lookup(cur);
    if (!p) break;
    chain.push(p);
    cur = p.inheritsFrom ?? null;
  }
  return chain;
}

/**
 * 合并一整条链（顺序：叶子 → 根）。
 *
 * 这是本模块的核心。`chain` 必须是 {@link walkProfileChain} 的输出顺序。
 */
export function mergeProfileChain(chain: VersionProfileJson[], leafId: string): MergedProfile {
  if (chain.length === 0) {
    throw new Error(`版本档案链为空: ${leafId}`);
  }
  const base = chain[chain.length - 1]!; // 链底 = 原版
  const platform = currentPlatform();

  // libraries：叶子 → 根，**先到先得**去重（同名时叶子赢）
  const seenNames = new Set<string>();
  const libraries: ProfileLibrary[] = [];
  for (const profile of chain) {
    for (const lib of profile.libraries ?? []) {
      if (!lib) continue;
      // 坐标名是去重键。**没有 name 的条目不丢弃、也不参与去重** ——
      // Mojang 的真实档案总带 name，但丢了它不代表这个 jar 不该进 classpath，
      // 丢掉的后果是「mod 报缺库」这种极难定位的错。
      const name = typeof lib.name === 'string' ? lib.name : null;
      if (name !== null) {
        if (seenNames.has(name)) continue; // 根那份同名库被覆盖掉
        seenNames.add(name);
      }
      if (!libraryAllowed(lib.rules, platform)) continue; // 规则不允许的丢弃
      libraries.push(lib);
    }
  }

  const libraryUrls = libraries.flatMap((lib) => libraryToExpectations(lib, platform));

  // mainClass：叶子给就用叶子的，没有就往上找
  let mainClass: string | null = null;
  for (const profile of chain) {
    if (typeof profile.mainClass === 'string' && profile.mainClass.length > 0) {
      mainClass = profile.mainClass;
      break;
    }
  }

  const clientDownload = base.downloads?.client;
  // 叶子（加载器）档案的参数：链长为 1 时是原版档案，它的 arguments 我们不用。
  const leaf = chain[0];
  const leafArgs = chain.length > 1 ? leaf : {};
  return {
    id: leafId,
    baseId: typeof base.id === 'string' ? base.id : leafId,
    chain: chain.map((p, i) => (typeof p.id === 'string' ? p.id : i === 0 ? leafId : '')),
    mainClass,
    assetIndexId: base.assetIndex?.id ?? null,
    assetIndexUrl: base.assetIndex?.url ?? null,
    javaMajor:
      typeof base.javaVersion?.majorVersion === 'number' ? base.javaVersion.majorVersion : null,
    client:
      clientDownload?.url !== undefined
        ? {
            url: clientDownload.url,
            sha1: clientDownload.sha1 ?? null,
            size: typeof clientDownload.size === 'number' ? clientDownload.size : null,
          }
        : null,
    libraryUrls,
    libraries,
    jvmArgs: Array.isArray(leafArgs.arguments?.jvm) ? [...leafArgs.arguments!.jvm!] : [],
    gameArgs: Array.isArray(leafArgs.arguments?.game) ? [...leafArgs.arguments!.game!] : [],
  };
}

/**
 * 叶子档案的**运行 jar** 路径。
 *
 * 加载器档案要跑的是它自己的 jar（installer 生成的，已打补丁、
 * 主类指向加载器）；原版则是 `versions/<id>/<id>.jar`。
 *
 * 注意这里是**叶子**而不是链底 —— 用链底就退回到「跑原版 jar」，
 * 那正是 mod 不生效的根因。
 */
export function runtimeJarName(leafId: string): string {
  return `${leafId}.jar`;
}
