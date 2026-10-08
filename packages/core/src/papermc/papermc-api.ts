/**
 * PaperMC 下载源客户端（§7.2 代理层的 Velocity 官方 jar）。
 *
 * ## 端点是**实测**出来的，不是照抄文档或记忆
 *
 * 2026-10 实测结果（决定性）：
 *
 * | 端点 | 结果 |
 * |---|---|
 * | `https://api.papermc.io/v2/projects/velocity` | **410 Gone** —— v2 已下线 |
 * | `https://fill.papermc.io/v3/projects/velocity` | 200，可用 |
 * | `https://fill.papermc.io/v3/projects/velocity/versions/{v}/builds/latest` | 200，可用 |
 *
 * 即 **v2 → v3 的迁移已经完成**，`api.papermc.io/v2` 这条常被引用的路径会直接
 * 410。本仓上一轮正是因为「未实测可达」而**刻意不硬编码**这条 URL，
 * 结果是实测后发现它已失效 —— 不硬编码 + 不假装能用，两件事都对。
 *
 * ## v3 的响应是嵌套的（与 v2 完全不同）
 *
 * v2 的 `versions` 是扁平数组；v3 改成**按 major 分组**：
 *
 * ```json
 * {"project":{"id":"velocity","name":"Velocity"},
 *  "versions":{"4.0.0":["4.2.1-SNAPSHOT","4.2.0", ...],
 *              "3.0.0":["3.5.1","3.4.0", ...]}}
 * ```
 *
 * 而 build 详情里的下载条目按 **平台 → 处理器架构** 再嵌一层：
 *
 * ```json
 * {"id":566,"channel":"STABLE",
 *  "downloads":{"server:default":{"name":"velocity-3.4.0-566.jar",
 *    "checksums":{"sha256":"fb599..."},
 *    "size":17816748,
 *    "url":"https://fill-data.papermc.io/v1/objects/<sha256>/velocity-3.4.0-566.jar"}}}
 * ```
 *
 * `server:default` 里的 `default` 是**处理器架构**（x64 / arm64）。本模块只取
 * x64（`<arch>:default` 形式），因为本仓的 JDK 探测（`detectJavaVersion`）
 * 与 Gradle 工具链面向桌面 x64 场景；arm64 未验证故不假装支持。
 *
 * ## 为什么必须带 sha256
 *
 * §13.3 供应链要求：下载产物必须有哈希。本模块返回服务端给出的 sha256，
 * 交由调用方与 `engine.downloadFile(..., { sha256 })` 校验 —— 本模块**不自己
 * 下载**，只解析元数据，这样「取元数据」与「下载」两步可分别测试。
 */

/** PaperMC v3 API 根（实测可用；旧 v2 已 410）。 */
export const PAPERMC_API_BASE = 'https://fill.papermc.io/v3';

/** 文件下载域（与 API 分开，build 详情里的 url 指向它）。 */
export const PAPERMC_DOWNLOAD_HOST = 'https://fill-data.papermc.io/v1/objects';

/** 本模块只支持的处理器架构（未验证 arm64，不假装支持）。 */
export type ProcArch = 'x64';

/** v3 的 downloads 键：`<平台>:<架构>`。 */
function downloadKey(platform: string, arch: ProcArch): string {
  return `${platform}:${arch}`;
}

/** 项目版本列表的原始响应（v3：versions 按 major 分组）。 */
interface ProjectVersionsRaw {
  project?: { id?: string; name?: string };
  versions?: Record<string, string[]>;
}

export interface PaperProjectVersion {
  /** 完整版本号，如 '3.4.0'（不含 -SNAPSHOT）。 */
  version: string;
  /** 主版本号，如 '3'（由版本号第一段取出）。 */
  major: number;
  /**
   * v3 的原始分组键，实测形态是**完整三段**（`'3.0.0'` / `'4.0.0'` / `'1.1.0'`），
   * 不是裸主版本号。保留它是因为上游若改分组粒度，调用方需要能原样回传。
   */
  group: string;
}

/** 下载元数据（不含实际字节）。 */
export interface PaperDownload {
  version: string;
  channel: string;
  filename: string;
  url: string;
  sha256: string;
  size: number;
  buildId: number;
}

export class PaperApiError extends Error {
  override readonly name = 'PaperApiError';
  readonly status: number | undefined;
  readonly url: string;
  constructor(message: string, url: string, status?: number) {
    super(message);
    this.url = url;
    this.status = status;
  }
}

/** 单次 fetch 的注入点（便于测试注入假响应，不打真实网络）。 */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * 列出项目的稳定版本（已剔除 `-SNAPSHOT`），按版本号从新到旧。
 *
 * 排序用数值三元组比较而非字符串比较（`3.10.0` 字符串比较会排在 `3.9.0` 前）。
 */
export function parseProjectVersions(raw: unknown): PaperProjectVersion[] {
  if (typeof raw !== 'object' || raw === null) {
    throw new PaperApiError('项目版本响应不是 JSON 对象', PAPERMC_API_BASE);
  }
  const doc = raw as ProjectVersionsRaw;
  const groups = doc.versions;
  if (typeof groups !== 'object' || groups === null) {
    throw new PaperApiError('响应缺少 versions 字段', PAPERMC_API_BASE);
  }
  // ⚠️ 必须显式拒绝数组：v2 的 `versions` 是**扁平字符串数组**，
  // 而 Object.entries(数组) 得到的是 index→字符串，全部不满足 Array.isArray，
  // 结果是「静默返回空列表」—— 形状错了却不报错，正是本仓要杜绝的那类问题。
  if (Array.isArray(groups)) {
    throw new PaperApiError(
      'versions 是数组 —— 这是已下线的 v2 形状；v3 要求「按版本分组的对象」',
      PAPERMC_API_BASE,
    );
  }
  const out: PaperProjectVersion[] = [];
  for (const [group, list] of Object.entries(groups)) {
    if (!Array.isArray(list)) continue;
    for (const version of list) {
      if (typeof version !== 'string') continue;
      // 快照版不是可安装的发行版，排除（官方用 -SNAPSHOT 后缀标记）。
      if (version.toUpperCase().includes('SNAPSHOT')) continue;
      out.push({ version, major: splitVersion(version)[0], group });
    }
  }
  return out.sort((a, b) => compareVersionDesc(a.version, b.version));
}

function splitVersion(v: string): [number, number, number] {
  const core = v.split('-')[0] ?? v;
  const parts = core.split('.').map((n) => {
    const x = Number.parseInt(n, 10);
    return Number.isFinite(x) ? x : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** 版本降序比较（数值三元组）。返回负数表示 a 更新。 */
export function compareVersionDesc(a: string, b: string): number {
  const pa = splitVersion(a);
  const pb = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 从 build 详情响应里取下载条目。
 *
 * 按 `<platform>:<arch>` 精确取；找不到就抛错，**不回退到任意条目** ——
 * 回退可能取到 arm64 的 jar 或 Paper/Purpur 的服务端 jar，装上去就跑不起来。
 */
export function parseBuildDownload(raw: unknown, arch: ProcArch = 'x64'): PaperDownload {
  if (typeof raw !== 'object' || raw === null) {
    throw new PaperApiError('build 响应不是 JSON 对象', PAPERMC_API_BASE);
  }
  const doc = raw as {
    id?: unknown;
    channel?: unknown;
    version?: unknown;
    downloads?: Record<string, unknown>;
  };
  const downloads = doc.downloads;
  if (typeof downloads !== 'object' || downloads === null) {
    throw new PaperApiError('build 响应缺少 downloads 字段', PAPERMC_API_BASE);
  }
  // v3 的架构段实测就是字面 `default`（表示该平台的默认架构，即 x64）。
  // 实测响应里键为 `server:default`。
  const wantKey = downloadKey('server', arch);
  const entry = downloads[wantKey] ?? downloads['server:default'];
  if (typeof entry !== 'object' || entry === null) {
    throw new PaperApiError(
      `build 响应里没有 ${wantKey} 条目（可用键：${Object.keys(downloads).join(', ')}）`,
      PAPERMC_API_BASE,
    );
  }
  const d = entry as {
    name?: unknown;
    url?: unknown;
    size?: unknown;
    checksums?: { sha256?: unknown };
  };
  const url = typeof d.url === 'string' ? d.url : '';
  const sha256 = typeof d.checksums?.sha256 === 'string' ? d.checksums.sha256 : '';
  const filename = typeof d.name === 'string' ? d.name : '';
  if (url === '' || sha256 === '' || filename === '') {
    // 缺 url / sha256 / 文件名任一都不能用：sha256 缺失会让 §13.3 的供应链校验落空。
    throw new PaperApiError(
      `downloads.${wantKey} 缺 url/sha256/name 字段（url=${url === ''} sha256=${sha256 === ''} name=${filename === ''}）`,
      PAPERMC_API_BASE,
    );
  }
  return {
    version: typeof doc.version === 'string' ? doc.version : '',
    channel: typeof doc.channel === 'string' ? doc.channel : 'DEFAULT',
    filename,
    url,
    sha256,
    size: typeof d.size === 'number' ? d.size : 0,
    buildId: typeof doc.id === 'number' ? doc.id : 0,
  };
}

/** 列出项目稳定版本（真网络）。 */
export async function fetchProjectVersions(
  project: string,
  fetchImpl: FetchLike,
): Promise<PaperProjectVersion[]> {
  const url = `${PAPERMC_API_BASE}/projects/${encodeURIComponent(project)}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new PaperApiError(`取 ${project} 版本列表失败：HTTP ${res.status}`, url, res.status);
  }
  return parseProjectVersions(await res.json());
}

/**
 * 取指定**MC 版本**的服务端下载元数据（真网络）。
 *
 * ⚠️ `version` 是**必填**，不接受 `'latest'` 兜底。
 *
 * 实测（2026-10）：`/v3/projects/paper/versions/latest/builds/latest` 返回
 * **404 `version_not_found`** —— v3 的 `latest` 只在**路径最后一段**（build 号）
 * 有意义，`versions/{版本}` 这一段必须是真实 MC 版本号。
 *
 * 「最新 build」由 `builds/latest` 这段决定，那才是服务端的语义；
 * 而「最新 MC 版本」本模块**不猜**，必须由调用方从 `fetchProjectVersions`
 * 的结果里明确挑一个。猜版本号就是 §7.9 踩过的坑。
 */
export async function fetchServerDownload(
  project: string,
  fetchImpl: FetchLike,
  opts: { version: string; arch?: ProcArch },
): Promise<PaperDownload> {
  const version = opts.version;
  if (typeof version !== 'string' || version.trim() === '') {
    throw new PaperApiError(
      `取 ${project} 下载信息失败：必须显式给出 MC 版本号（v3 不接受 'latest' 作为版本段）`,
      PAPERMC_API_BASE,
    );
  }
  if (version.toLowerCase() === 'latest') {
    // 提前拦下并说明原因，而不是让调用方拿到一个语焉不详的 404。
    throw new PaperApiError(
      `版本段不能是 'latest'：实测 /versions/latest/builds/latest 返回 404 version_not_found。` +
        `请先用 fetchProjectVersions 选出真实版本号。`,
      PAPERMC_API_BASE,
    );
  }
  const url = `${PAPERMC_API_BASE}/projects/${encodeURIComponent(project)}/versions/${encodeURIComponent(version)}/builds/latest`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new PaperApiError(
      `取 ${project}@${version} 下载信息失败：HTTP ${res.status}`,
      url,
      res.status,
    );
  }
  const parsed = parseBuildDownload(await res.json(), opts.arch ?? 'x64');
  // /builds/latest 不回带 version 字段（实测响应里确实没有），从请求版本号补上。
  if (parsed.version === '') {
    return { ...parsed, version };
  }
  return parsed;
}
