/**
 * Modrinth API 客户端（规格 §P25：mod 搜索 → 选中 → 添加到整合包 spec）。
 *
 * 用 Node.js 内置 fetch（Node 18+）。API 无需认证，但需要 User-Agent header。
 * 主进程通过 IPC 转发调用以避免渲染进程 CORS 问题。
 */

import { OFFICIAL_MODRINTH_API, swapBase } from '../sources/index.js';

/** Modrinth 搜索结果条目 */
export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
  /**
   * 下面这些**搜索命中里本来就带**，却一度没接 ——
   * 于是 `enrichModrinthHit` 为了拿它们又发了一次请求（一页 20 条 = 20 次额外请求，
   * 并发打出去容易撞 429，而客户端撞 429 后要等窗口重置、最多 65 秒）。
   * 能用免费的就不该再花一次配额。
   */
  /**
   * 最新版本的 **id**（不是版本号！）。
   *
   * ⚠️ 实测它是 8 位版本 id（如 `JRfg4hxD`），而不是 `0.163.0+26.4` 这种
   * 版本号。把它当显示字符串直接填进 `ModEntry.latestVersion`，列表行
   * 就会显示一串乱码 id。
   *
   * 正确用处：拿它去 `getVersionsByIds` 批量取，才能同时得到**版本号**、
   * `files`（→ downloadUrl）、loaders、支持版本 —— 一次批量覆盖整页。
   */
  latest_version?: string;
  /** 最后修改时间（ISO）。免费，填 `ModEntry.updatedAt`。 */
  date_modified?: string;
  /** 收藏数。详情页可能用，先接着。 */
  follows?: number;
  /** 客户端/服务端支持。详情页可展示。 */
  client_side?: string;
  server_side?: string;
}

/** Modrinth 项目版本 */
export interface ModrinthVersion {
  id: string; // version ID
  project_id: string;
  version_number: string;
  name: string;
  /** 支持的 MC 版本（API game_versions） */
  game_versions?: string[];
  /** 支持的 loader（API loaders） */
  loaders?: string[];
  /** 依赖声明（API dependencies）。
   *
   *  ⚠️ `project_id` 与 `version_id` **可以是 null** —— 整合包用
   *  `{ project_id: null, file_name: 'xxx.zip', embedded }` 表示「整合包
   *  自带的文件」。按 `string` 读会在整合包解析时炸掉。
   *
   *  `file_name` 也是：项目引用时为 null，自带文件时才有值。 */
  dependencies?: Array<{
    project_id?: string | null;
    version_id?: string | null;
    file_name?: string | null;
    dependency_type: 'required' | 'optional' | 'incompatible' | 'embedded';
  }>;
  files: Array<{
    url: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes?: { sha512?: string; sha1?: string };
  }>;
  /** 发布时间（API date_published，ISO 字符串）。UI 用来显示「21 天前」。 */
  date_published?: string;
}

/**
 * Modrinth 官方限流（2026-10 实测 + 官方文档核实）：
 *
 * - **按 IP 计，当前 300 请求/分钟**，带 token 与否相同
 * - 响应头给出窗口状态：
 *   `X-Ratelimit-Limit` / `X-Ratelimit-Remaining` / `X-Ratelimit-Reset`（秒）
 * - 实测：`x-ratelimit-limit: 300`、`x-ratelimit-remaining` 逐次递减
 *
 * ⚠️ 旧实现有个真实缺陷：429 时固定退避 300ms / 600ms，而配额窗口是**一分钟**
 * ——两次重试必然仍打在耗尽的窗口上，白费 2 次请求，最后还抛出一个看起来像
 * 「接口坏了」的错误。现在改为尊重 `x-ratelimit-reset`。
 */
const RATE_LIMIT_WAIT_CAP_MS = 65_000;

/**
 * 批量接口单批条数（`/versions?ids=` / `/projects?ids=`）。
 *
 * 100 是社区实测的稳定上限（官方文档没写死）。整合包实测最大的也就 55 个
 * embedded 依赖，所以绝大多数情况一批就够。
 */
const BATCH_SIZE = 100;

/**
 * 安全读取响应头。
 *
 * `X-Ratelimit-*` 按官方文档是**可选**的（只在 API 网关下发时才带），所以
 * 「读不到」是正常情况，必须容忍 —— 不能因为缺头就抛错。同时也保证非标准
 * fetch 实现（测试替身等）不会把整个请求搞崩。
 */
function header(res: Response, name: string): string | null {
  const h = (res as { headers?: { get?: (n: string) => string | null } }).headers;
  if (h === undefined || typeof h.get !== 'function') return null;
  try {
    return h.get(name);
  } catch {
    return null;
  }
}

/** 从响应头解析「还需等待多久配额才重置」，解析不出来返回 undefined。 */
function parseRateLimitResetMs(res: Response): number | undefined {
  const raw = header(res, 'x-ratelimit-reset');
  if (raw === null) return undefined;
  const secs = Number.parseInt(raw, 10);
  if (!Number.isFinite(secs) || secs < 0) return undefined;
  // 上限保护：绝不让调用方无限期挂起
  return Math.min(secs * 1000, RATE_LIMIT_WAIT_CAP_MS);
}

/** 从响应头解析限流窗口状态（用于展示 / 预判），缺失字段为 null。 */
function parseRateLimit(res: Response): ModrinthRateLimit | null {
  const num = (name: string): number | null => {
    const raw = header(res, name);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  };
  const limit = num('x-ratelimit-limit');
  const remaining = num('x-ratelimit-remaining');
  const reset = num('x-ratelimit-reset');
  if (limit === null && remaining === null && reset === null) return null;
  return { limit, remaining, resetSeconds: reset };
}

/** Modrinth 限流窗口状态（来自官方 `X-Ratelimit-*` 响应头）。 */
export interface ModrinthRateLimit {
  /** 窗口内最大请求数（官方当前为 300/分钟） */
  limit: number | null;
  /** 当前窗口剩余请求数 */
  remaining: number | null;
  /** 距窗口重置的秒数 */
  resetSeconds: number | null;
}

/** 被限流（HTTP 429）且已等到窗口重置后仍失败。 */
export class ModrinthRateLimitError extends Error {
  override readonly name = 'ModrinthRateLimitError';
  /** 官方给出的重置秒数（可能为 null 表示上游没给）。 */
  readonly resetSeconds: number | null;
  constructor(message: string, resetSeconds: number | null) {
    super(message);
    this.resetSeconds = resetSeconds;
  }
}

export class ModrinthApiClient {
  /**
   * API 根地址的**候选**，按偏好排序（见 `sources/mirror.ts`）。
   *
   * 方法里一律用第一个根拼 URL，`fetchJson` 在失败时换下一个根重试 ——
   * 于是：国内镜像挂了会自动落回官方，**官方 429 时也会落到镜像**
   * （官方配额按 IP 算 300/分，镜像有自己的配额，这比干等 65 秒有用）。
   *
   * 缺省只有官方一个根：本类不该替调用方决定用不用镜像，那件事属于设置。
   */
  private readonly bases: string[];
  private readonly userAgent = 'mc-creator/0.0.0 (https://github.com/mc-creator)';
  /** 单次请求超时（毫秒） */
  private readonly timeoutMs = 10_000;

  constructor(bases: string[] = [OFFICIAL_MODRINTH_API]) {
    // 空数组会让每个方法都拼出畸形 URL，直接退回官方
    this.bases = bases.length > 0 ? bases : [OFFICIAL_MODRINTH_API];
  }

  /** 首选根（方法内部拼 URL 用）。 */
  private get baseUrl(): string {
    return this.bases[0]!;
  }

  /**
   * loader 名称 → Modrinth 分类（facets / `loaders` 过滤用）。
   * C-9 修复：Modrinth 无 legacy_fabric 分类（旧 Fabric mod 归类到 fabric）；
   * vanilla 无对应分类，返回 undefined 表示不过滤（否则 facets 恒为空结果）。
   *
   * `datapack` 是**真的能过滤**的（实测 `GET /project/veinminer/version?loaders=["datapack"]`
   * → 16 个版本，文件名全是 `.zip`，`loaders` 恰好是 `["datapack"]`；
   * 拿它去问 Sodium 返回 0 条，说明是精确匹配而非忽略）。
   * 数据包在 Modrinth 上 `project_type` 是 `mod`，唯一能把数据包构建与 mod 构建
   * 分开的就是这个 loader 值。
   */
  static loaderToCategory(loader?: string): string | undefined {
    switch (loader) {
      case 'fabric':
      case 'quilt':
      case 'neoforge':
      case 'forge':
      case 'datapack':
        return loader;
      case 'legacy_fabric':
        return 'fabric';
      default:
        return undefined;
    }
  }

  /** 4xx（非限流）等不应重试的 API 错误标记 */
  private static readonly NonRetryableError = class NonRetryableError extends Error {};

  /**
   * C-1 修复：带超时 + 重试的 fetch（网络错误 / 5xx / 429 重试，最多 2 次；4xx 直接抛错）。
   * 注意：4xx 错误用 NonRetryableError 包装并立刻抛出，避免被外层 catch 捕获后误判为可重试。
   */
  private lastRateLimit: ModrinthRateLimit | null = null;

  /**
   * 最近一次响应携带的限流窗口状态（官方 `X-Ratelimit-*` 头）。
   *
   * 供上层在批量解析前预判「还够不够用」，以及在 UI 上说明为何变慢。
   * 没有该响应头时为 null —— 不猜、不填默认值。
   */
  get rateLimit(): ModrinthRateLimit | null {
    return this.lastRateLimit;
  }

  /**
   * 按候选根依次请求：首选根全失败才换下一个根。
   *
   * 每个根自己重试 3 次（见 `fetchJsonOnce`）。只有**最后一个**候选才允许
   * 为 429 睡满 `x-ratelimit-reset` —— 后面还有别的源时，换源比干等快得多。
   */
  private async fetchJson<T>(url: string): Promise<T> {
    const urls = this.candidateUrls(url);
    let lastErr: unknown;
    for (let i = 0; i < urls.length; i++) {
      try {
        return await this.fetchJsonOnce<T>(urls[i]!, i === urls.length - 1);
      } catch (err) {
        lastErr = err;
      }
    }
    // 抛**最后一个**错误，不包壳：`ModrinthRateLimitError` 这类类型上层要按
    // instanceof 分辨，包一层就毁了。消息里带 URL，能看出是哪个源。
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * 同一个路径在**每个候选根**上的完整 URL（换不了根的退化成单元素）。
   *
   * 用 `swapBase` 换前缀而不是重新拼：方法里已经把查询串拼好了，
   * 重新拼等于把每个端点的参数再写一遍。
   */
  private candidateUrls(url: string): string[] {
    const urls: string[] = [];
    for (const base of this.bases) {
      const swapped = swapBase(url, this.baseUrl, base) ?? url;
      if (!urls.includes(swapped)) urls.push(swapped);
    }
    return urls;
  }

  /** 对**一个**根地址的重试请求（网络错误 / 5xx / 429 重试，最多 2 次；4xx 直接抛错）。 */
  private async fetchJsonOnce<T>(url: string, allowRateLimitWait: boolean): Promise<T> {
    let lastErr: unknown;
    // 已按官方 x-ratelimit-reset 等过一次之后就不再等第二次：
    // 窗口重置后本就该成功，仍失败说明不是限流问题，继续等只是白等。
    let honoredRateLimitWait = false;
    for (let attempt = 0; attempt <= 2; attempt++) {
      let waitMs = 300 * (attempt + 1);
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const rl = parseRateLimit(res);
        if (rl !== null) this.lastRateLimit = rl;
        if (res.ok) {
          try {
            return (await res.json()) as T;
          } catch {
            // 国内镜像偶尔会用 200 返回 HTML 错误页（实测见过）。这是**确定性**
            // 的响应格式错误，重试同一个地址没有意义 —— 包成 NonRetryableError
            // 让外层直接换下一个源，而不是白等 3 次退避。
            const contentType = (res.headers as Headers | undefined)?.get('content-type') ?? '未知';
            throw new ModrinthApiClient.NonRetryableError(
              `Modrinth API 返回了非 JSON 响应（HTTP ${res.status}，Content-Type: ${contentType}）` +
                `: ${url} —— 可能是镜像错误页，不会重试同一地址`,
            );
          }
        }
        if (res.status < 500 && res.status !== 429) {
          throw new ModrinthApiClient.NonRetryableError(
            `Modrinth API ${res.status} ${res.statusText}: ${url}`,
          );
        }
        if (res.status === 429 && !honoredRateLimitWait && allowRateLimitWait) {
          const resetMs = parseRateLimitResetMs(res);
          if (resetMs !== undefined) {
            honoredRateLimitWait = true;
            waitMs = resetMs;
          }
        }
        lastErr =
          res.status === 429
            ? new ModrinthRateLimitError(
                `Modrinth API 429 限流（官方配额按 IP 计，剩余 ` +
                  `${header(res, 'x-ratelimit-remaining') ?? '未知'}，` +
                  `约 ${header(res, 'x-ratelimit-reset') ?? '?'} 秒后重置）: ${url}`,
                parseRateLimit(res)?.resetSeconds ?? null,
              )
            : new Error(`Modrinth API ${res.status} ${res.statusText}: ${url}`);
      } catch (err) {
        if (err instanceof ModrinthApiClient.NonRetryableError) throw err; // 4xx 直接抛错，不重试
        if (err instanceof ModrinthRateLimitError) {
          // 保留为 lastErr 继续按 waitMs 退避；到最后一轮由循环外抛出
          lastErr = err;
        } else if (err instanceof Error && err.name === 'AbortError') {
          lastErr = new Error(`Modrinth API 请求超时（${this.timeoutMs}ms）: ${url}`);
        } else {
          lastErr = err;
        }
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, waitMs));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * 内容类型 → Modrinth `project_type` facet 值。
   *
   * 不传（undefined）时不加该 facet —— Modrinth 的 /search 默认只搜 mod，
   * 所以「整合包 / 数据包 / 资源包 / 光影包」必须显式带 project_type，
   * 否则搜出来全是 mod，这也是"分类切了但结果不对"的根因。
   */
  static contentTypeToProjectType(
    contentType?: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader',
  ): string | undefined {
    switch (contentType) {
      case 'mod':
        return 'mod';
      case 'modpack':
        return 'modpack';
      case 'datapack':
        return 'datapack';
      case 'resourcepack':
        return 'resourcepack';
      case 'shader':
        return 'shader';
      default:
        return undefined;
    }
  }

  /**
   * 搜索 Modrinth 项目。
   *
   * 返回 `{ hits, total }` —— `total` 是**服务端**给出的命中总数，
   * 不是本页条数。分页必须用它，否则「下一页」永远点不动，或者
   * 把 20 条当全部结果。
   */
  async search(
    query: string,
    opts: {
      loader?: string;
      mcVersion?: string;
      limit?: number;
      offset?: number;
      contentType?: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader';
      category?: string;
      /**
       * 排序。Modrinth 的取值：`relevance` | `downloads` | `follows` | `newest` | `updated`。
       *
       * **之前没有这个参数**：调用方（下载页）一直传 `sort: 'downloads'`，
       * 到这里被丢掉 —— 服务端默认 `relevance`，UI 上的意图全程没生效。
       * 实测（2026-10-16）：同一个 query 下 `relevance` / `downloads` / `updated`
       * 三种返回的排序明显不同（`optimization` 一例：relevance 全部是名字带
       * optimization 的小项目，downloads 是 ferrite-core / lithium 这类大头），
       * 说明这不是被忽略的野生参数。
       */
      index?: string;
    } = {},
  ): Promise<{ hits: ModrinthSearchHit[]; total: number }> {
    // 构建 facets：每个维度一个数组，数组内是 OR，维度间是 AND
    const facets: string[][] = [];
    const projectType = ModrinthApiClient.contentTypeToProjectType(opts.contentType);
    if (projectType) facets.push([`project_type:${projectType}`]);
    if (opts.category) facets.push([`categories:${opts.category}`]);
    const loaderCategory = ModrinthApiClient.loaderToCategory(opts.loader);
    if (loaderCategory) facets.push([`categories:${loaderCategory}`]);
    if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`]);

    const params = new URLSearchParams();
    params.set('query', query);
    if (facets.length > 0) params.set('facets', JSON.stringify(facets));
    params.set('limit', String(opts.limit ?? 20));
    if (opts.offset !== undefined) params.set('offset', String(opts.offset));
    if (opts.index !== undefined) params.set('index', opts.index);

    const url = `${this.baseUrl}/search?${params.toString()}`;
    // ⚠️ Modrinth v2 /search 的命中总数字段名是 **`total_hits`**，不是 `total`。
    // （实测 2026-10：响应体为 `{hits, offset, limit, total_hits}`。）
    // 之前按 `total` 读 → 恒为 undefined → 上层分页的「共 N 个 / 还有下一页」
    // 全是假的，「加载更多」按钮永远不出现。两个名字都兜住。
    const data = await this.fetchJson<{
      hits: ModrinthSearchHit[];
      total_hits: number;
      limit: number;
      offset: number;
    }>(url);
    return { hits: data.hits, total: data.total_hits };
  }

  /**
   * 获取项目的版本列表。
   * game_versions / loaders 均为 JSON 编码的数组字符串。
   */
  async getVersions(
    projectId: string,
    opts: { loader?: string; mcVersion?: string } = {},
  ): Promise<ModrinthVersion[]> {
    const params = new URLSearchParams();
    if (opts.mcVersion) params.set('game_versions', JSON.stringify([opts.mcVersion]));
    const category = ModrinthApiClient.loaderToCategory(opts.loader);
    if (category) params.set('loaders', JSON.stringify([category]));

    const url = `${this.baseUrl}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`;
    return this.fetchJson<ModrinthVersion[]>(url);
  }

  /**
   * **批量**取版本（`GET /versions?ids=[...]`）。
   *
   * 为什么必须有批量：整合包清单里的 mod 是 `embedded` 依赖给出的
   * **精确 version_id** 列表（Fabulously Optimized 实测 55 个）。逐个
   * `getVersions(projectId)` 会打 55 次请求 —— 而 Modrinth 的限流是
   * **按 IP 300 次/分**（见本文件顶部注释），这么打必然 429。
   * 批量一次拿完，只花 1 次配额。
   *
   * 返回的是**按 id 对齐**的对象映射（不是数组）：源站不保证返回顺序，
   * 也不保证缺失的 id 会被显式标注；用 Map 让调用方显式面对「查无此项」。
   *
   * 空 id 列表直接返回空 Map，不发请求（`ids=[]` 源站会当成无效参数）。
   */
  async getVersionsByIds(ids: string[]): Promise<Map<string, ModrinthVersion>> {
    const out = new Map<string, ModrinthVersion>();
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
    if (unique.length === 0) return out;

    // 源站单次批量有上限（未公开承诺，按 100 分批最稳；55 个的整合包一批就够）
    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const slice = unique.slice(i, i + BATCH_SIZE);
      const url = `${this.baseUrl}/versions?ids=${encodeURIComponent(JSON.stringify(slice))}`;
      const list = await this.fetchJson<ModrinthVersion[]>(url);
      for (const v of list) {
        if (v && typeof v.id === 'string') out.set(v.id, v);
      }
    }
    return out;
  }

  /**
   * **批量**取项目（`GET /projects?ids=[...]`）。与 {@link getVersionsByIds} 同理：
   * 拿 mod 名字只能靠项目元数据，逐个拉会打爆限流。
   *
   * 查不到的 id **不进 Map**，调用方据此判断「这个 mod 的名字拿不到」，
   * 而不是拿到一个空壳对象假装成功。
   */
  async getProjectsByIds(ids: string[]): Promise<Map<string, ModrinthProject>> {
    const out = new Map<string, ModrinthProject>();
    const unique = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
    if (unique.length === 0) return out;

    for (let i = 0; i < unique.length; i += BATCH_SIZE) {
      const slice = unique.slice(i, i + BATCH_SIZE);
      const url = `${this.baseUrl}/projects?ids=${encodeURIComponent(JSON.stringify(slice))}`;
      const list = await this.fetchJson<ModrinthProject[]>(url);
      for (const p of list) {
        if (p && typeof p.id === 'string') out.set(p.id, p);
      }
    }
    return out;
  }

  /**
   * 取**单个**版本（`GET /version/{id}`）。
   *
   * 与 `getVersions(projectId)` 的区别：后者要拉整个项目的版本列表，
   * 为了一个 version_id 去拉几百条是纯浪费。
   *
   * ⚠️ 404 会抛错（与 `getProject` 一致）。调用方自己决定是跳过还是整体失败 ——
   * 「清单里指定的版本已被作者删掉」是真会发生的事，不该被静默吞掉。
   */
  async getVersion(versionId: string): Promise<ModrinthVersion> {
    return this.fetchJson<ModrinthVersion>(
      `${this.baseUrl}/version/${encodeURIComponent(versionId)}`,
    );
  }

  /**
   * 项目详情（详情页头部的那些字段：完整描述、主页、issue 跟踪、客户端/服务端支持等）。
   *
   * 搜索命中里没有这些 —— 它们只在 `/project/{id}` 上。拿不到就抛错，
   * 让上层决定是显示搜索命中降级还是报错，这里不猜。
   */
  async getProject(projectId: string): Promise<ModrinthProject> {
    return this.fetchJson<ModrinthProject>(
      `${this.baseUrl}/project/${encodeURIComponent(projectId)}`,
    );
  }
}

/** Modrinth 项目详情（`/project/{id}` 的子集）。 */
export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** Markdown 长描述；详情页可折叠展示。 */
  body: string;
  icon_url: string | null;
  categories: string[];
  downloads: number;
  followers: number;
  /** 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader' … */
  project_type: string;
  /** 发布的游戏版本（全部支持版本，不一定连续）。 */
  game_versions: string[];
  loaders: string[];
  /** 最新版本号（项目级冗余字段，接口给的，省一次 version 请求）。 */
  versions: string[];
  wiki_url: string | null;
  source_url: string | null;
  issues_url: string | null;
  discord_url: string | null;
  donation_urls: Array<{ id: string; platform: string; url: string }>;
  published: string;
  updated: string;
  /** 客户端/服务端支持：'required' | 'optional' | 'unsupported'。 */
  client_side: string;
  server_side: string;
  team: string;
}
