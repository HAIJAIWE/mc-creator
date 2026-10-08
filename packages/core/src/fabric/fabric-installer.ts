/**
 * Fabric installer 的版本解析与下载 URL 构造。
 *
 * ## 起因：仓库里有一个实测 404 的死链
 *
 * 2026-10 实测：
 *
 * ```
 * https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer.jar
 *   → 404
 * https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.2/fabric-installer-1.1.2.jar
 *   → 200  (212123 bytes)
 * ```
 *
 * 即 **maven 布局里没有 `latest` 这个目录**。`maven-metadata.xml` 里
 * `<latest>1.1.2</latest>` 是**元数据字段**，说的是「最新版本号是 1.1.2」，
 * 不是「存在一个叫 latest 的版本目录」。把 `<latest>` 的值直接当路径段拼进去，
 * 是把元数据语义误当成目录名 —— 与 MEMORY §7.9「按想象造格式」同一类错误。
 *
 * 仓内旁证：`scripts/fetch_server_assets.ts` 用的是**显式版本号**
 * （`fabric-installer/1.0.1/fabric-installer-1.0.1.jar`，实测仍 200），
 * 而 `apps/desktop/src/main/launcher-service.ts` 与
 * `packages/kernel-java/src/content/server/server-generator.ts` 用的是死链。
 * 同一仓一份对两份错 —— 死链是后写的。
 *
 * ## 为什么取 `<release>` 而不是 `<latest>`
 *
 * Maven 语义：`<release>` 是最新的**发行版**，`<latest>` 是最新的版本
 * （可能含 SNAPSHOT）。给用户装的是 installer 发行版，取 `<release>`。
 * 实测样本里两者当前都等于 `1.1.2`，所以**必须测试区分它们**，
 * 否则将来 `<release>` 与 `<latest>` 分叉时无从察觉（见测试）。
 *
 * ## 为什么用正则而不上 XML 依赖
 *
 * 实测 `maven-metadata.xml` 共 80 行 / 2516 字节，结构是 Maven 自己的固定 schema：
 * 无命名空间、无自闭合标签、无注释、无 CDATA，`<release>` / `<latest>` 各出现 1 次，
 * `<version>` 出现 67 次。为这样一个定型输入引入 XML 依赖是 §13.3 的供应链成本，
 * 不划算。
 *
 * 但正则的代价是**会静默接受不认识的形状**，所以本模块的纪律是：
 * **凡是没在实测样本里确认过的形态，一律抛错**，绝不返回猜测值。
 * 解析结果不合法时抛 `FabricMetadataError`，由调用方显式处理。
 */

/** Fabric maven 仓库根（实测可达）。 */
export const FABRIC_MAVEN_BASE = 'https://maven.fabricmc.net/net/fabricmc';

/** installer 的 maven 坐标：groupId/artifactId（实测值）。 */
export const FABRIC_INSTALLER_GROUP_ID = 'net.fabricmc';
export const FABRIC_INSTALLER_ARTIFACT_ID = 'fabric-installer';

/** maven-metadata.xml 的路径（相对 `FABRIC_MAVEN_BASE`）。 */
export const FABRIC_INSTALLER_METADATA_PATH = '/fabric-installer/maven-metadata.xml';

/**
 * **钉住的** installer 发行版版本号，供**生成离线部署脚本**的场景使用。
 *
 * 为什么不动态解析：生成的 install.sh / install.bat 是在**用户的远程服务器**上跑的，
 * 那台机器不保证能访问 maven-fabricmc.net，更不该指望它会解析 XML。
 * 所以生成侧只能烘进一个具体版本号。
 *
 * 防陈旧靠 `packages/core/src/ci/verify-loader-versions.test.ts`
 * （`VERIFY_VERSIONS=1` 联网门控）比对 maven-metadata 的最新 `<release>`，
 * 与 LOADER_VERSIONS 用的是同一套机制。
 *
 * 钉 `1.1.2`（2026-10 实测 `<release>` 值；实测该版本 jar HTTP 200 / 212123 字节）。
 * **注意：这里必须是字面量，不能写成 `<latest>`** —— 那个路径实测 404。
 */
export const FABRIC_INSTALLER_PINNED_VERSION = '1.1.2';

export class FabricMetadataError extends Error {
  override readonly name = 'FabricMetadataError';
  /** 出问题的原始文本片段，便于排查（截断过）。 */
  readonly snippet: string;
  constructor(message: string, snippet = '') {
    super(message);
    this.snippet = snippet.slice(0, 200);
  }
}

/** 取出单个标签的文本内容；标签缺失或为空则返回 undefined。 */
function readTag(xml: string, tag: string): string | undefined {
  // 精确匹配 <tag>…</tag>，不匹配 <tag/>（自闭合 = 空内容 = 无值）
  const re = new RegExp(`<${tag}>([^<]*)</${tag}>`);
  const m = re.exec(xml);
  if (!m) return undefined;
  const v = (m[1] ?? '').trim();
  return v === '' ? undefined : v;
}

/**
 * 校验这份 metadata 确实是 `fabric-installer` 的，而不是别的 artifact。
 *
 * 不校验的后果很具体：同一个 maven 根下还有 `fabric-loader`、`fabric-api` 等，
 * 一份形状相同的 metadata 被误读就会给出**错误的版本号**，
 * 然后拼出一个 404 的 jar URL —— 和原来那个 bug 一模一样，只是换了来源。
 */
function assertArtifact(xml: string): void {
  const group = readTag(xml, 'groupId');
  const artifact = readTag(xml, 'artifactId');
  if (group !== FABRIC_INSTALLER_GROUP_ID || artifact !== FABRIC_INSTALLER_ARTIFACT_ID) {
    throw new FabricMetadataError(
      `metadata 的坐标不是 ${FABRIC_INSTALLER_GROUP_ID}:${FABRIC_INSTALLER_ARTIFACT_ID}` +
        `（读到 ${group ?? '<无>'}:${artifact ?? '<无>'}）。` +
        `误读别的 artifact 会给出错误版本号，进而拼出 404 的下载 URL。`,
      xml,
    );
  }
}

/** 取出全部历史版本号（实测 67 个，按发布时间升序）。 */
export function parseMavenMetadataVersions(xml: string): string[] {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new FabricMetadataError('maven-metadata 内容为空', String(xml));
  }
  assertArtifact(xml);
  if (!xml.includes('</versioning>')) {
    throw new FabricMetadataError('缺少 </versioning>，不是 Maven metadata 的形状', xml);
  }
  const out: string[] = [];
  const re = /<version>([^<]*)<\/version>/g;
  for (const m of xml.matchAll(re)) {
    const v = (m[1] ?? '').trim();
    if (v === '') continue;
    out.push(v);
  }
  if (out.length === 0) {
    throw new FabricMetadataError('versions 段里没有任何 <version>', xml);
  }
  return out;
}

/**
 * 取发行版版本号（`<release>`）。
 *
 * 缺 `<release>` 时**不回退到 `<latest>`**：两者语义不同（见文件头注释），
 * 悄悄回退等于把「发行版」悄悄换成「可能含 SNAPSHOT 的最新版」。
 * 要用 latest 就由调用方显式调用 `parseMavenMetadataLatest`。
 */
export function parseMavenMetadataRelease(xml: string): string {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new FabricMetadataError('maven-metadata 内容为空', String(xml));
  }
  assertArtifact(xml);
  const release = readTag(xml, 'release');
  if (release === undefined) {
    // 显式区分「没有这个标签」与「标签为空」—— 两者都不可用，但排查方向不同。
    const selfClosed = xml.includes('<release/>') || xml.includes('<release />');
    throw new FabricMetadataError(
      selfClosed
        ? '<release/> 是空元素，没有任何可用版本号'
        : '缺少 <release> 标签（不静默回退到 <latest>：两者语义不同）',
      xml,
    );
  }
  return release;
}

/** 取 `<latest>`（含 SNAPSHOT 语义）。调用方要它就得自己承担这个语义。 */
export function parseMavenMetadataLatest(xml: string): string {
  const latest = readTag(xml, 'latest');
  if (latest === undefined) throw new FabricMetadataError('缺少 <latest> 标签', xml);
  return latest;
}

/**
 * 构造 installer jar 的**真实**下载 URL。
 *
 * 版本号必须是形如 `1.1.2` 的具体值。显式拒绝 `latest` / 空串：
 * 那两个拼出来的路径实测 404（见文件头）。
 */
export function fabricInstallerJarUrl(version: string): string {
  const v = typeof version === 'string' ? version.trim() : '';
  if (v === '') {
    throw new FabricMetadataError('版本号为空，无法构造下载 URL');
  }
  if (v.toLowerCase() === 'latest') {
    throw new FabricMetadataError(
      "版本号不能是 'latest'：maven 没有 latest 这个版本目录，" +
        `实测 .../fabric-installer/latest/fabric-installer.jar → 404。` +
        `请先用 parseMavenMetadataRelease 解析出具体版本号。`,
    );
  }
  // 版本号会进 URL 路径，必须挡住路径穿越与 URL 注入
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v)) {
    throw new FabricMetadataError(`版本号含非法字符（可能造成路径穿越）: ${v}`);
  }
  return `${FABRIC_MAVEN_BASE}/${FABRIC_INSTALLER_ARTIFACT_ID}/${v}/${FABRIC_INSTALLER_ARTIFACT_ID}-${v}.jar`;
}

/**
 * 单次 fetch 的注入点（便于测试注入假响应，不打真实网络）。
 *
 * 名字带 `Fabric` 前缀：共享 barrel（`packages/core/src/index.ts`）里
 * `papermc` 模块已经导出了一个 `FetchLike`，同名会在 `export *` 时产生歧义。
 */
export type FabricFetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export interface FabricInstallerRelease {
  /** 具体版本号，如 '1.1.2'（绝不返回 'latest'）。 */
  version: string;
  /** 由该版本号构造出的下载 URL。 */
  url: string;
}

/** 取 installer 发行版的下载信息（真网络；`fetchImpl` 可注入以离线测试）。 */
export async function resolveFabricInstallerRelease(
  fetchImpl: FabricFetchLike,
): Promise<FabricInstallerRelease> {
  const metaUrl = `${FABRIC_MAVEN_BASE}${FABRIC_INSTALLER_METADATA_PATH}`;
  const res = await fetchImpl(metaUrl);
  if (!res.ok) {
    throw new FabricMetadataError(`取 maven-metadata 失败：HTTP ${res.status}`);
  }
  const version = parseMavenMetadataRelease(await res.text());
  return { version, url: fabricInstallerJarUrl(version) };
}
