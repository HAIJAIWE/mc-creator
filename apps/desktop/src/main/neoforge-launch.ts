/**
 * NeoForge（26.x / FML 12）的启动参数处理。
 *
 * ## 为什么 NeoForge 要单独一套
 *
 * 别的加载器是「把加载器 jar 放到 classpath 末尾、跑它自己的主类」；
 * NeoForge 26.x（FancyModLoader 12）**不是**这么跑的：
 *
 * - 它的档案 `arguments.jvm` 里带 `-DlibraryDirectory=${library_directory}`，
 *   `arguments.game` 里带 `--fml.neoForgeVersion` / `--fml.mcVersion` /
 *   `--fml.neoFormVersion`；
 * - 少了这些，FML 12 直接拒绝启动（实测报错：
 *   "When launching in production, the system property libraryDirectory must point
 *   to the libraries directory." / "--fml.neoForgeVersion must be presented as a
 *   command-line argument"）；
 * - 更关键的是：**classpath 里不能放 Minecraft 的 jar**。FML 12 会先在
 *   classpath 上找 Minecraft 的类；找到了就当「开发环境」走，而开发环境
 *   要求的 patched jar 带 `Minecraft-Dists` manifest 属性（客户端安装器
 *   刻意不打这个属性），于是报
 *   "NeoForge dev environment Minecraft jar does not have a Minecraft-Dists
 *   attribute in its manifest"。找不到才走**生产模式**：由 FML 自己去
 *   libraryDirectory 里取 patched jar 与 NeoForge 本体。
 *
 * 生产模式下真正跑起来的组合（实测 2026-10-22，MC 26.3 + NeoForge 26.3.0.95）：
 *
 * - classpath = 档案里的 libraries（**不含** Minecraft jar、不含 patched jar）；
 * - `-DlibraryDirectory=<libraries 目录>`；
 * - `--fml.neoForgeVersion 26.3.0.95 --fml.mcVersion 26.3 --fml.neoFormVersion 1`；
 * - `--add-opens java.base/java.lang.invoke=ALL-UNNAMED`
 *   `--add-exports jdk.naming.dns/com.sun.jndi.dns=java.naming`；
 * - 主类 `net.neoforged.fml.startup.Client`。
 */

/** NeoForge 启动所需的三件套（全部来自档案的 `arguments.game`）。 */
export interface NeoForgeLaunchSpec {
  /** NeoForge 构建号，如 `26.3.0.95`。 */
  neoForgeVersion: string;
  /** MC 版本号，如 `26.3`。 */
  mcVersion: string;
  /** NeoForm 版本号，如 `1`（MCP_VERSION 是 `26.3-1`，后半段就是它）。 */
  neoFormVersion: string;
}

/**
 * 从档案的 `arguments.game` 里解析出 NeoForge 的三个版本参数。
 *
 * 找不到就返回 null —— 调用方据此判定「这个档案不是 NeoForge 26.x 的形状」，
 * 而不是拿空串去拼命令（拼出来的命令会以更难懂的方式失败）。
 */
export function parseNeoForgeLaunchSpec(gameArgs: readonly string[]): NeoForgeLaunchSpec | null {
  const valueOf = (flag: string): string | null => {
    const i = gameArgs.indexOf(flag);
    if (i < 0) return null;
    const v = gameArgs[i + 1];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const neoForgeVersion = valueOf('--fml.neoForgeVersion');
  const mcVersion = valueOf('--fml.mcVersion');
  const neoFormVersion = valueOf('--fml.neoFormVersion');
  if (neoForgeVersion === null || mcVersion === null || neoFormVersion === null) return null;
  return { neoForgeVersion, mcVersion, neoFormVersion };
}

/**
 * 替换参数里的 `${...}` 占位符。
 *
 * - 已知占位符 → 替换成实际值；
 * - **未知占位符 → 整条参数丢掉**。
 *
 * 丢掉而不是原样传：把 `${classpath}` 这种字面量交给 JVM，症状是
 * "Could not find or load main class" 之类的天书错误，比少传一条参数难查得多。
 * 我们目前不认识的占位符（`${classpath}` / `${natives_directory}` / …）
 * 恰好都属于「我们另有安排」的那类。
 *
 * 连带规则：丢掉一条参数时，如果前一条是 `-` 开头的**开关**，一起丢掉 ——
 * 孤零零的 `-cp` 后面没有值，比缺一条参数更糟。
 */
export function substituteProfileArgs(
  args: readonly string[],
  vars: Readonly<Record<string, string>>,
): string[] {
  const out: string[] = [];
  for (const arg of args) {
    const matches = arg.match(/\$\{[^}]+\}/g);
    if (matches === null) {
      out.push(arg);
      continue;
    }
    let resolved = arg;
    let ok = true;
    for (const m of matches) {
      const key = m.slice(2, -1);
      const value = vars[key];
      if (value === undefined) {
        ok = false;
        break;
      }
      resolved = resolved.split(m).join(value);
    }
    if (ok) {
      out.push(resolved);
      continue;
    }
    const last = out[out.length - 1];
    if (last !== undefined && last.startsWith('-') && !last.includes('=')) out.pop();
  }
  return out;
}
