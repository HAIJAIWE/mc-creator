/**
 * NeoForge 版本解析：**MC 版本 → NeoForge 构建号**。
 *
 * ## 为什么单独一个文件
 *
 * NeoForge 的版本号**不是** MC 版本号加后缀，而是另一套编号，且这套编号
 * 有两种形状：
 *
 * | MC 版本 | NeoForge 版本 | installer 里的 `minecraft` 字段（实测） |
 * |---|---|---|
 * | `1.21.1` | `21.1.264` | `1.21.1` |
 * | `26.3`   | `26.3.0.95` | `26.3` |
 *
 * 也就是说：
 * - MC 1.x → NeoForge **去掉开头的 `1.`**，且 MC 只有 `1.21` 这种两段时
 *   补成 `21.0`（NeoForge 21.0.x 服务的是 MC 1.21）；
 * - MC 26.x 起 → NeoForge **沿用 MC 版本号做前缀**，后面再跟自己的
 *   修订号与构建号（`26.3` → `26.3.0.95`）。
 *
 * 上表不是猜的：`install_profile.json` 就装在 installer jar 里，
 * 下载两个 installer 打开读 `minecraft` 字段即可对上
 * （见本文件下方的用例）。
 *
 * ## 旧实现错在哪
 *
 * 旧代码用一条正则 `<version>${mcVersion}\.(\d+)</version>` 去匹配元数据：
 *
 * - 对 MC `26.3`，元数据里是 `26.3.0.95` —— 后面多两段，**匹配不到**；
 * - 对 MC `1.21.1`，元数据里是 `21.1.264` —— 开头就少个 `1`，**也匹配不到**。
 *
 * 实测：拿真实 maven 元数据跑旧正则，MC `26.3` / `1.21.1` / `1.21.8` /
 * `1.20.4` / `26.1` 全部 0 命中。也就是说**「装 NeoForge」在任何 MC 版本上
 * 都必然失败**，报「未找到 NeoForge X 的 installer」。
 *
 * 这里改成：解析出全部版本号 → 按上面的映射算出**前缀** → 取前缀匹配到的
 * 最高版本。纯函数，不发网络请求，好测。
 */

/** NeoForge 官方 maven 的元数据地址（releases 组）。 */
export const NEOFORGE_MAVEN_METADATA_URL =
  'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';

/** maven 仓库根（拼 installer 路径用）。 */
const NEOFORGE_MAVEN_ROOT = 'https://maven.neoforged.net/releases/net/neoforged/neoforge';

/**
 * 从 maven-metadata.xml 里取出全部 `<version>` 值。
 *
 * 只认 `<version>…</version>` 这一种形状：maven 的元数据就是这个结构，
 * 解析器不需要通用 XML —— 少一个依赖，也少一类误解析。
 */
export function parseMavenVersions(metaText: string): string[] {
  const out: string[] = [];
  const re = /<version>([^<]+)<\/version>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(metaText)) !== null) {
    const v = (m[1] ?? '').trim();
    if (v !== '') out.push(v);
  }
  return out;
}

/**
 * MC 版本 → NeoForge 版本**前缀**（可能多个候选）。
 *
 * - `1.21.1` → `['21.1']`（去掉开头的 `1.`）
 * - `1.21`   → `['21.0']`（两段版本补 `.0`：NeoForge 21.0.x 服务 MC 1.21）
 * - `26.3`   → `['26.3']`（26.x 起 NeoForge 沿用 MC 版本号）
 * - 快照号（`26.4-snapshot-5`）→ `[]`：没有对应的 NeoForge 正式版
 */
export function neoforgeVersionPrefixes(mcVersion: string): string[] {
  const v = mcVersion.trim();
  if (v === '') return [];
  if (v.startsWith('1.')) {
    const rest = v.slice(2);
    const parts = rest.split('.');
    const major = parts[0] ?? '';
    if (!/^\d+$/.test(major)) return [];
    const minor = parts[1];
    if (minor !== undefined && /^\d+$/.test(minor)) return [`${major}.${minor}`];
    return [`${major}.0`];
  }
  // 26.x 及以后：NeoForge 前缀 = MC 版本号本身（26.3 → 26.3.0.95）
  if (!/^\d+(\.\d+)*$/.test(v)) return [];
  return [v];
}

/**
 * 比较两个点分版本号（**按数字比**，不是按字符串比）。
 *
 * 字符串比较会栽在 `26.3.0.9` vs `26.3.0.95` 上：字符串看 `"9" > "95"`，
 * 数字看 `95 > 9`。构建号必须按数字比，否则会装到一个更旧的构建。
 */
export function compareVersionSegments(a: string, b: string): number {
  const as = a.split('.');
  const bs = b.split('.');
  const n = Math.min(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = Number(as[i]);
    const y = Number(bs[i]);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      // 出现非数字段（理论上不该有）时退回字符串比，保证结果确定。
      const sx = as[i] ?? '';
      const sy = bs[i] ?? '';
      if (sx !== sy) return sx < sy ? -1 : 1;
      continue;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  if (as.length !== bs.length) return as.length < bs.length ? -1 : 1;
  return 0;
}

/**
 * 从候选版本号里挑出该 MC 版本对应的**最新稳定** NeoForge。
 *
 * 优先只认纯数字版本（`26.3.0.95`）；`-beta` 之类预发布只有在没有任何
 * 稳定版时才作为退路 —— 预发布版的 installer 未必能跑起来。
 */
export function pickNeoForgeVersion(mcVersion: string, versions: string[]): string | null {
  const prefixes = neoforgeVersionPrefixes(mcVersion);
  if (prefixes.length === 0) return null;
  const matched = versions.filter((v) => prefixes.some((p) => v.startsWith(`${p}.`)));
  if (matched.length === 0) return null;
  const stable = matched.filter((v) => /^\d+(\.\d+)+$/.test(v));
  const pool = stable.length > 0 ? stable : matched;
  let best = pool[0]!;
  for (const v of pool) {
    if (compareVersionSegments(v, best) > 0) best = v;
  }
  return best;
}

/**
 * 这个字符串长得像 NeoForge 版本号吗？
 *
 * 整合包清单里的 `dependencies["neoforge"]` 给的就是完整构建号
 * （实测 `"21.1.209"`），有它就别再拉元数据猜。26.x 的构建号有四段
 * （`26.3.0.95`），所以这里接受 **3~5 段**纯数字。
 *
 * 少于 3 段的不认：NeoForge 的版本号至少是 `主.次.构建`（`21.1.209`），
 * 两段的 `21.1` 是 MC 版本号，穿帮了就说明调用方传错了字段。
 */
export function isNeoForgeVersionString(value: string): boolean {
  return /^\d+(\.\d+){2,4}$/.test(value.trim());
}

/** installer jar 的下载地址。 */
export function neoforgeInstallerUrl(nfVersion: string): string {
  return `${NEOFORGE_MAVEN_ROOT}/${nfVersion}/neoforge-${nfVersion}-installer.jar`;
}
