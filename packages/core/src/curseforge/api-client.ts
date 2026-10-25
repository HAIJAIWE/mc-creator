/**
 * CurseForge API 客户端（规格 §P29：与 P25 Modrinth 共同构成资源市场）。
 *
 * CurseForge 需 API key（用户去 https://console.curseforge.com/ 免费申请）。
 * 主进程通过 IPC 转发调用以避免渲染进程 CORS 问题，并保护 API key 不暴露给渲染进程。
 *
 * ⚠️ **走国内镜像（MCIM）时不需要 key**：镜像自己带了 key（这也是 PCL 从没跟
 * 用户要过 CF key 的原因）。所以 key 是**按根地址**判定的，见 `fetchJsonWithSources`。
 * 我们**不把用户的 key 发给镜像** —— 那等于白送一个配额凭证给第三方。
 */

import { OFFICIAL_CURSEFORGE_API, isOfficialCurseForgeBase, swapBase } from '../sources/index.js';

/** CurseForge 搜索结果条目 */
export interface CurseForgeSearchHit {
  id: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  downloadCount: number;
  categories: string[];
  /**
   * 分类的原始 id 列表（`categories[].id`）。
   *
   * 为什么不能只用 `categories`（中文名）：判定「这是不是数据包」要靠
   * **id 5193**，中文名会被源站改。
   */
  categoryIds: number[];
  /**
   * 项目主页 URL。它的**路径**才是项目类型的可靠依据（见 `typeFromWebsite`）。
   *
   * `classId` 过滤不可靠 —— CurseForge 会把数据包混进资源包，
   * 所以拿到结果后必须按 websiteUrl 二次判定（PCL 对应 issue #8265）。
   */
  websiteUrl: string | null;
}

/**
 * 从 websiteUrl 的路径反推项目真实类型。
 *
 * CurseForge 的 `classId` 过滤**不精确**（资源包 class 里混着数据包），
 * 所以只能用 URL 路径二次判定 —— PCL 也是这么做的。兜底返回 `datapack`：
 * CurseForge 上没匹配到任何已知路径的，实践中就是数据包。
 */
export function typeFromWebsite(
  websiteUrl: string | null,
): 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader' {
  const u = (websiteUrl ?? '').toLowerCase();
  if (u.includes('/mc-mods/') || u.includes('/mod/')) return 'mod';
  if (u.includes('/modpacks/')) return 'modpack';
  if (u.includes('/resourcepacks/') || u.includes('/texture-packs/')) return 'resourcepack';
  if (u.includes('/shaders/')) return 'shader';
  return 'datapack';
}

/**
 * CurseForge 的 `gameVersions` 是**混装**数组：既装 MC 版本，也装 loader 名
 * （`["Client","NeoForge","Server","26.3"]`）、`Client` / `Server` 这类端标记。
 * 这条判定把「像 MC 版本」的条目挑出来（`1.21.1` / `26.3` / `26.1-snapshot`）。
 */
export function isCurseForgeMcVersion(token: string): boolean {
  if (!/^\d+(\.\d+)+/.test(token)) return false;
  // `Client` / `Server` / loader 名都不以数字开头，正则已挡住；这里只再排除
  // 「纯数字但不是版本」的噪声（CF 的 sortableGameVersions 里出现过 `0`）。
  return Number.isFinite(Number.parseFloat(token));
}

/**
 * 搜索排序（与渲染层 `LauncherSearchModsRequest.sort` 的四种取值一致）。
 *
 * 两个源各说各话：Modrinth 用 `index`，CurseForge 用 `sortField`（数字枚举，
 * 见 `CurseForgeApiClient.SORT_FIELDS`）。这个类型是两边共用的"人话"。
 */
export type CurseForgeSort = 'relevance' | 'downloads' | 'updated' | 'newest';

/**
 * 文件级依赖的一条：`{ modId, relationType }`。
 *
 * ⚠️ **实测（2026-10-17，走 MCIM 镜像）**：`relationType` **是有的**，
 * 而且语义能拿真实关系对钉死：
 *
 *   | 观测到的关系对                                              | relationType | 语义 |
 *   | ----------------------------------------------------------- | ------------ | ---- |
 *   | Iris Shaders → Sodium（Iris 没有 Sodium 起不来）             | 3            | 必需 |
 *   | Xaero's Minimap (fabric) → Fabric API（Fabric mod 的硬前置） | 3            | 必需 |
 *   | Xaero's Minimap → Xaero's World Map / Open Parties and Claims | 2          | 可选 |
 *   | JEI 26.3 → MezzConfig / MezzConfigGUI                        | 3 / 2        | 必需 / 可选 |
 *
 * 老实现把这层信息**丢掉了**（`.map((d) => d.modId)`），于是界面上把可选依赖
 * 也报成"缺前置会导致启动失败"—— JEI 一装就吓人一跳。
 */
export interface CurseForgeFileDependency {
  /** 依赖的 CF 项目 id。 */
  modId: number;
  /**
   * 关系类型（1=内置库、2=可选、3=必需、4=工具、5=不兼容、6=内含……）。
   * 只有 2 / 3 是**实测**出来的（见上表），其余照枚举名留着；判定只认 3。
   */
  relationType?: number;
}

/**
 * 归一化文件级依赖：只留 `{ modId, relationType }`，丢掉源站可能后来加的
 * 其它字段（对我们没用，而且会把 IPC 的响应 schema 顶掉）。
 */
function normalizeCfDependencies(
  deps?: Array<{ modId?: number; relationType?: number }> | null,
): CurseForgeFileDependency[] | undefined {
  if (!deps) return undefined;
  const out = deps
    .filter((d) => Number.isFinite(d.modId))
    .map((d) => ({
      modId: d.modId as number,
      ...(typeof d.relationType === 'number' ? { relationType: d.relationType } : {}),
    }));
  return out.length > 0 ? out : undefined;
}

/**
 * 从 CurseForge 的文件下载地址反推文件 id。
 *
 * 源站的 URL 约定是 `/files/{id 去掉末三位}/{末三位}/{文件名}`（实测：
 * `id=9221721` → `/files/9221/721/jei-...jar`；六个样本全中）。末三位
 * **会补零**（`005`），所以按数字拼而不是字符串拼。
 *
 * 用途：详情页那一行"按 URL 下载"的路径手上只有 URL，想要报"缺哪个前置"
 * 就得先把文件 id 找回来（见 `main/ipc/launcher.ts` 的 `LAUNCHER_DOWNLOAD_URL`）。
 * 反推不出来返回 `null` —— 调用方**不要**猜一个 id 出来。
 */
export function curseforgeFileIdFromUrl(url: string): number | null {
  const m = /\/files\/(\d+)\/(\d+)\//.exec(url);
  if (!m) return null;
  const hi = Number(m[1]);
  const lo = Number(m[2]);
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
  return hi * 1000 + lo;
}

/**
 * loader 名的识别表（小写子串匹配）。
 *
 * 用 `includes` 而不是等号：CF 的 loader 名在不同端点会带版本后缀
 * （`forge-43.2.0`）。表里放的是**能确定的**那几种。
 */
const CF_LOADER_TOKENS = ['neoforge', 'fabric', 'quilt', 'liteloader', 'forge'] as const;

/**
 * 从一个 CF 文件里取出 loader 名列表。
 *
 * ⚠️ **实测（2026-10-17，走 MCIM 镜像）**：`/mods/{id}/files` 的响应里
 * `modLoaders` **整个字段都不存在** —— 不是空数组，是 `undefined`。JEI /
 * Fabric API / Sodium 这些大项目全都没有。也就是说：
 *   - 老实现 `f.modLoaders.map(...)` 是**必崩**的（`undefined.map`），
 *     而这条路径在「没 CF key + 走镜像」之前根本走不到，所以一直没暴露；
 *   - loader 信息其实只存在于 `gameVersions` 里（`"NeoForge"` / `"Fabric"`）。
 *
 * 所以：有 `modLoaders` 就用它（官方根将来补上该字段也照样对），没有就从
 * `gameVersions` 里把认得出的 loader 名挑出来。返回**源站原始写法**
 * （`"NeoForge"`），调用方按需 `toLowerCase()` —— 与本仓既有的比较方式一致。
 */
export function curseforgeLoaderNames(f: {
  modLoaders?: Array<{ name: string }> | null;
  gameVersions?: string[] | null;
}): string[] {
  const fromField = (f.modLoaders ?? []).map((m) => m.name).filter((n) => n !== '');
  if (fromField.length > 0) return fromField;
  const out: string[] = [];
  for (const token of f.gameVersions ?? []) {
    const lower = token.toLowerCase();
    if (CF_LOADER_TOKENS.some((t) => lower.includes(t)) && !out.includes(token)) out.push(token);
  }
  return out;
}

/**
 * CF loader 名 → 归一化小写键（`"NeoForge"` / `"forge-43.2.0"` → `neoforge` / `forge`）。
 *
 * 为什么要先判 neoforge 再判 forge：`"neoforge".includes("forge")` 为真，
 * 顺序反过来会把 NeoForge 认成 Forge。
 *
 * 放在这里（而不是各调用方）是因为**同一张表**同时服务三处：整合包适配器
 * （`modpack/adapters.ts`）、桌面主进程挑文件、以及 `CurseForgeSearchPanel`
 * 的加载器筛选。写三遍必然漂。
 */
export function curseforgeLoaderKey(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('neoforge')) return 'neoforge';
  if (l.includes('fabric')) return 'fabric';
  if (l.includes('quilt')) return 'quilt';
  if (l.includes('liteloader')) return 'liteloader';
  if (l.includes('forge')) return 'forge';
  return l;
}

/** CurseForge 项目文件 */
export interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  downloadUrl: string | null;
  /**
   * MC 版本（**已过滤**：不含 `Client` / `Server` / loader 名 —— 源站的
   * `gameVersions` 是混装的，见 `isCurseForgeMcVersion`）。
   */
  gameVersions: string[];
  /** loader 名（`"NeoForge"` / `"Fabric"`；来源见 `curseforgeLoaderNames`）。 */
  modLoaderNames: string[];
  /**
   * 发布时间（ISO 字符串，源站 `fileDate`）。
   *
   * 有了它才能**自己排序**挑文件：接口虽然按发布时间倒序返回，但那是接口的
   * 当前行为而不是承诺（实测 2026-10-17：Sodium 的 12 条确实是降序）。
   */
  fileDate?: string;
  /**
   * 发布渠道：1=release、2=beta、3=alpha（源站 `releaseType`）。
   *
   * 实测依据：Sodium 的文件名 `-beta.1` → 2、`-alpha.1` → 3、无后缀 → 1。
   */
  releaseType?: number;
  /** 文件哈希（API hashes；可能缺失） */
  hashes?: Array<{ value: string; algo: number }>;
  /**
   * 文件级依赖（`{ modId, relationType }`）。
   *
   * ⚠️ **不是**一串裸 modId —— `relationType` 是"必需 / 可选"的唯一依据，
   * 别在归一化时把它丢掉（见 `CurseForgeFileDependency`）。
   * 取必需依赖用 `requiredDependencyIds()`（`./dependencies.js`）。
   */
  dependencies?: CurseForgeFileDependency[];
}

/** `POST /mods/files` 单批条数上限。CF 文档没写死，取一个明显安全的值。 */
const CF_FILE_BATCH = 200;

/**
 * `GET /mods/{id}/files` 的默认 `pageSize`。
 *
 * 老实现写死 10000（照抄 PCL 的「一次取完，老版本也翻得到」），但那是**大项目
 * 会超时**的值。实测（2026-10-17，走 MCIM 镜像，项目 = JEI 238222，它有 3909 个
 * 文件）：
 *
 * | pageSize | 耗时   | 体积  | 覆盖到的 MC 版本数 |
 * | -------- | ------ | ----- | ------------------ |
 * | 100      | 0.8s   | 185KB | 11                 |
 * | 200      | 0.5s   | 369KB | 11                 |
 * | 500      | 2.3s   | 916KB | 12                 |
 * | 1000     | 4.6s   | 1.8MB | 13                 |
 * | 2000     | 9.7s   | 3.4MB | 22                 |
 * | 10000    | 16.7s  | 6.0MB | 全部（3909 个文件）|
 *
 * 客户端单请求超时是 10s —— 也就是说**打开 JEI 的详情页在 10000 下必然超时**
 * （10s × 重试 3 次），而版本覆盖在 100 个文件时就已经饱和（JEI 共 13 个版本，
 * 100 个文件覆盖 11 个）。所以默认取 500：2.3s、12 个版本，留足余量。
 *
 * 需要更多的地方（整合包按 id 批量取文件）走的是 `POST /mods/files`，不受影响。
 */
const CF_FILE_DEFAULT_LIMIT = 500;

export class CurseForgeApiClient {
  /**
   * API 根地址的**候选**，按偏好排序（见 `sources/mirror.ts`）。
   *
   * 缺省只有官方一个根：用不用国内镜像由设置决定，不由本类替调用方决定。
   */
  private readonly bases: string[];
  private readonly apiKey: string;
  /** 单次请求超时（毫秒，与 Modrinth 客户端对齐） */
  private readonly timeoutMs = 10_000;

  constructor(apiKey: string, bases: string[] = [OFFICIAL_CURSEFORGE_API]) {
    this.apiKey = apiKey;
    // 空数组会让每个方法都拼出畸形 URL，直接退回官方
    this.bases = bases.length > 0 ? bases : [OFFICIAL_CURSEFORGE_API];
  }

  /** 首选根（方法内部拼 URL 用）。 */
  private get baseUrl(): string {
    return this.bases[0]!;
  }

  /**
   * 有没有**任何一个**候选能干活：有 key，或者候选里有镜像（镜像不带 key）。
   *
   * 一个都不能用就别发请求、当场说清楚 —— 这也是原实现
   * 「`if (!this.apiKey) throw`」那四处的意图，只是现在多了一个例外。
   */
  private assertAnyUsable(): void {
    if (this.apiKey !== '') return;
    if (this.bases.some((b) => !isOfficialCurseForgeBase(b))) return;
    throw new Error('CurseForge API key 未配置');
  }

  /**
   * app 的四种排序 → CurseForge 的 `sortField`。
   *
   * ⚠️ **不带 `sortField` 时 CF 的返回顺序等于没排**：实测（2026-10-17 走
   * MCIM 镜像）搜 "sodium" 头一条是 "Wick - Smooth & Dynamic Lights"，
   * 一条 Sodium 都不在前面。所以这个参数不是锦上添花，是"搜索能不能用"。
   *
   * 表是**实测**出来的（同样是 2026-10-17，搜 "map" 看前几条反推排序依据）：
   *
   *   | sortField | 观测到的顺序                              | 结论            |
   *   | --------- | ----------------------------------------- | --------------- |
   *   | 1         | 名字里含 "Map" 的排前面（搜 sodium 则首条是 Sodium） | 相关度  |
   *   | 2         | Xaero's Minimap / Moonlight / JourneyMap，popularityRank 12/16/82 | 热度 |
   *   | 3         | dateModified 严格降序 13:39 → 13:06 → 12:38 | 最后更新      |
   *   | 6         | 下载量严格降序 355M → 292M → 254M          | 总下载量        |
   *   | 11        | dateReleased 严格降序 10-16 23:34 → 21:43 → 20:37 | 发布日期 |
   *
   * 图省事猜一个的后果很具体：**非法值直接 500**（实测 sortField=99 →
   * `{"error":"Internal Server Error"...}`），搜索会变成"源站挂了"。
   */
  private static readonly SORT_FIELDS: Record<CurseForgeSort, number> = {
    relevance: 1,
    downloads: 6,
    updated: 3,
    newest: 11,
  };

  /**
   * loader 名称 → CurseForge `modLoaderType` 数字（gameId=432 是 Minecraft）。
   *
   * ⚠️ 这组数字是**实测**出来的，不是照抄文档（2026-10-17，走 MCIM 镜像搜
   * "sodium"，看返回项目最新文件的 `gameVersions` 里哪种 loader 最多）：
   *
   *   | modLoaderType | 结果里占多数的 loader | 结论        |
   *   | ------------- | --------------------- | ----------- |
   *   | 1             | Forge ×11             | Forge = 1   |
   *   | 4             | Fabric ×13            | Fabric = 4  |
   *   | 5             | Quilt ×10             | Quilt = 5   |
   *   | 6             | NeoForge ×13          | NeoForge = 6|
   *
   * 老实现把 fabric 写成 5、neoforge 写成 4（正好互换了）—— 症状是「筛选器选
   * Fabric，返回的却是 Quilt 项目」，而且因为 4/5 都是合法枚举值，不会报错。
   */
  static loaderToType(loader?: string): number | undefined {
    switch (loader) {
      case 'fabric':
      case 'legacy_fabric':
        return 4;
      case 'quilt':
        return 5;
      case 'neoforge':
        return 6;
      case 'forge':
        return 1;
      default:
        return undefined;
    }
  }

  /**
   * 内容类型 → CurseForge `classId`（Fixed ID 的二级分类）。
   *
   * 不传 undefined 就不加该过滤。这些数字是 CurseForge 固定的 classId，
   * 不是猜的：mods=6、modpack=4471、resourcepack=12、shader=6552、datapack=6945。
   * 少了它，搜「整合包」会返回一堆 mod —— 和 Modrinth 侧必须带 project_type 同理。
   */
  static contentTypeToClassId(
    contentType?: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader',
  ): number | undefined {
    switch (contentType) {
      case 'mod':
        return 6;
      case 'modpack':
        return 4471;
      case 'resourcepack':
        return 12;
      case 'shader':
        return 6552;
      case 'datapack':
        return 6945;
      default:
        return undefined;
    }
  }

  /** 4xx（非限流）等不应重试的 API 错误标记 */
  private static readonly NonRetryableError = class NonRetryableError extends Error {};

  /**
   * 带超时 + 重试的 fetch（网络错误 / 5xx / 429 重试，最多 2 次；4xx 直接抛错）。
   * 与 ModrinthApiClient.fetchJson 同形，注意：4xx 错误用 NonRetryableError 包装并立刻抛出，
   * 避免被外层 catch 捕获后误判为可重试。
   */
  private async fetchJson<T>(url: string): Promise<T> {
    return this.fetchJsonWithSources<T>(url, undefined);
  }

  /**
   * POST + JSON body 的重试包装。
   *
   * CurseForge 的 `POST /mods/files`（批量取文件，PCL 装整合包用的就是它）
   * 是 POST，其余端点是 GET，所以这里要单独一个能带 body 的入口 ——
   * 不能把 `fetchJson` 的 GET 硬改成「有 body 就 POST」，那会让「哪天加了个
   * 带 query 的 POST」这种正常需求变成陷阱。
   */
  private async fetchJsonPost<T>(url: string, body: unknown): Promise<T> {
    return this.fetchJsonWithSources<T>(url, JSON.stringify(body));
  }

  /**
   * 按候选根依次请求：首选根全失败才换下一个根（同 `ModrinthApiClient` 的约定）。
   *
   * **key 按根判定**：官方根没 key 就跳过这个根（镜像自带 key，不需要用户配）。
   * 全都不可用（只有官方根且没 key，或镜像也挂了）时抛 `CurseForge API key 未配置`，
   * 并在文案里点出「不填也能走镜像」—— 见 {@link fetchJsonWithSources} 的抛出点。
   */
  private async fetchJsonWithSources<T>(url: string, body: string | undefined): Promise<T> {
    const urls: string[] = [];
    for (const base of this.bases) {
      const swapped = swapBase(url, this.baseUrl, base) ?? url;
      if (!urls.includes(swapped)) urls.push(swapped);
    }
    let lastErr: unknown;
    for (const u of urls) {
      // 官方根要 key；镜像自带 key，**不**把用户的 key 发过去
      if (isOfficialCurseForgeBase(u) && this.apiKey === '') {
        // 文案里带一句「可以走镜像」：没配 key 是**正常**用法（走镜像时镜像
        // 自带 key），只有连镜像也没成功时才会走到这里 —— 那时用户需要知道
        // 官方这条路要 key，以及去哪儿填。
        lastErr = new Error(
          'CurseForge API key 未配置（官方源需要；不填就走国内镜像，见「设置 → 下载源」）',
        );
        continue;
      }
      try {
        return await this.fetchJsonOnce<T>(u, body);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private async fetchJsonOnce<T>(url: string, body: string | undefined): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: {
            // key 只发给**官方根**：镜像自带 key，把用户的凭证发给第三方
            // 等于白送一个配额凭证。没 key 时不带这个头（空值会被当脏请求）。
            ...(this.apiKey !== '' && isOfficialCurseForgeBase(url)
              ? { 'x-api-key': this.apiKey }
              : {}),
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { method: 'POST', body } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) {
          try {
            return (await res.json()) as T;
          } catch {
            // 与 Modrinth 侧同一个坑：镜像可能 200 + HTML。格式错误是确定性失败，
            // 不重试同一地址，直接让外层换源。
            const contentType = (res.headers as Headers | undefined)?.get('content-type') ?? '未知';
            throw new CurseForgeApiClient.NonRetryableError(
              `CurseForge API 返回了非 JSON 响应（HTTP ${res.status}，Content-Type: ${contentType}）` +
                `: ${url} —— 可能是镜像错误页，不会重试同一地址`,
            );
          }
        }
        if (res.status < 500 && res.status !== 429) {
          throw new CurseForgeApiClient.NonRetryableError(
            `CurseForge API ${res.status} ${res.statusText}: ${url}`,
          );
        }
        lastErr = new Error(`CurseForge API ${res.status} ${res.statusText}: ${url}`);
      } catch (err) {
        if (err instanceof CurseForgeApiClient.NonRetryableError) throw err; // 4xx 直接抛错，不重试
        if (err instanceof Error && err.name === 'AbortError') {
          lastErr = new Error(`CurseForge API 请求超时（${this.timeoutMs}ms）: ${url}`);
        } else {
          lastErr = err;
        }
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * 搜索 CurseForge 项目。
   * gameId=432 是 Minecraft；modLoaderType 数字见 loaderToType。
   */
  /**
   * 搜索 CurseForge 项目。
   *
   * 返回 `{ hits, total }`，`total` 来自响应头的 `pagination.totalCount` ——
   * 不是本页条数，分页必须用它。
   */
  async search(
    query: string,
    opts: {
      loader?: string;
      mcVersion?: string;
      limit?: number;
      index?: number;
      contentType?: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader';
      /** 排序；不传就是 CF 的默认顺序（**实测等于没排**，见 `SORT_FIELDS`）。 */
      sort?: CurseForgeSort;
    } = {},
  ): Promise<{ hits: CurseForgeSearchHit[]; total: number }> {
    this.assertAnyUsable();

    const params = new URLSearchParams();
    params.set('gameId', '432');
    params.set('searchFilter', query);
    const loaderType = CurseForgeApiClient.loaderToType(opts.loader);
    if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));
    if (opts.mcVersion) params.set('gameVersion', opts.mcVersion);
    const classId = CurseForgeApiClient.contentTypeToClassId(opts.contentType);
    if (classId !== undefined) params.set('classId', String(classId));
    if (opts.sort !== undefined) {
      params.set('sortField', String(CurseForgeApiClient.SORT_FIELDS[opts.sort]));
      params.set('sortOrder', 'desc');
    }
    params.set('pageSize', String(opts.limit ?? 20));
    params.set('index', String(opts.index ?? 0));

    const url = `${this.baseUrl}/mods/search?${params.toString()}`;
    const data = await this.fetchJson<{
      data: Array<{
        id: number;
        name: string;
        summary: string;
        /** 可能是 null 或整个缺席（按可选处理，少个图标不该让整页搜索报错）。 */
        logo?: { thumbnailUrl: string; url: string } | null;
        downloadCount: number;
        categories?: Array<{ id: number; name: string }> | null;
        links?: { websiteUrl: string | null } | null;
      }>;
      pagination: { index: number; pageSize: number; resultCount: number; totalCount: number };
    }>(url);
    return {
      hits: data.data.map((d) => ({
        id: d.id,
        name: d.name,
        summary: d.summary,
        // thumbnailUrl 为空时退回原图，否则会拿到一个空 src（PCL 同款处理）。
        // 整个 `logo` 对象也可能是 null / 缺席（实测两种都出现过）——
        // 少一个图标不值得让整页搜索报错。
        logoUrl:
          d.logo == null
            ? null
            : d.logo.thumbnailUrl === '' || d.logo.thumbnailUrl == null
              ? (d.logo.url ?? null)
              : d.logo.thumbnailUrl,
        downloadCount: d.downloadCount,
        // `categories` / `links` 按可选处理：少一个分类不该让整页搜索 500
        // （这就是「详情页 undefined.map」那类崩溃的同族）。
        categories: (d.categories ?? []).map((c) => c.name),
        categoryIds: (d.categories ?? []).map((c) => c.id),
        websiteUrl: d.links?.websiteUrl ?? null,
      })),
      total: data.pagination.totalCount,
    };
  }

  /**
   * 获取项目的文件列表（downloadUrl 为直链，无需跳转）。
   *
   * ⚠️ `pageSize` 写死 **20** 的日子：详情页的版本 tab 只能看到最近 20 个文件。
   * 后来照 PCL（`ResourceVersion.vb`：`files?pageSize=` 用的 10000）改成「一次
   * 取完」，但那对**大项目是超时的**（实测 JEI：6MB / 16.7s，而本客户端单请求
   * 超时 10s）。现在默认 {@link CF_FILE_DEFAULT_LIMIT}（500），理由与实测数据
   * 见那个常量的注释；`opts.limit` 可以覆盖。
   */
  async getFiles(
    modId: number,
    opts: { loader?: string; mcVersion?: string; limit?: number } = {},
  ): Promise<CurseForgeFile[]> {
    this.assertAnyUsable();

    const params = new URLSearchParams();
    const loaderType = CurseForgeApiClient.loaderToType(opts.loader);
    if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));
    if (opts.mcVersion) params.set('gameVersion', opts.mcVersion);
    params.set('pageSize', String(opts.limit ?? CF_FILE_DEFAULT_LIMIT));

    const url = `${this.baseUrl}/mods/${modId}/files?${params.toString()}`;
    const data = await this.fetchJson<{
      data: Array<{
        id: number;
        displayName: string;
        fileName: string;
        fileLength: number;
        downloadUrl: string | null;
        gameVersions: string[] | null;
        modLoaders?: Array<{ name: string }> | null;
        fileDate?: string | null;
        releaseType?: number | null;
        hashes?: Array<{ value: string; algo: number }>;
        dependencies?: Array<{ modId?: number; relationType?: number }>;
      }>;
    }>(url);
    return data.data.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      fileName: f.fileName,
      fileLength: f.fileLength,
      downloadUrl: f.downloadUrl,
      gameVersions: (f.gameVersions ?? []).filter(isCurseForgeMcVersion),
      modLoaderNames: curseforgeLoaderNames(f),
      ...(f.fileDate ? { fileDate: f.fileDate } : {}),
      ...(typeof f.releaseType === 'number' ? { releaseType: f.releaseType } : {}),
      ...(f.hashes ? { hashes: f.hashes } : {}),
      // ⚠️ 依赖**连 relationType 一起留**：那是"必需还是可选"的唯一依据
      // （老实现 `.map((d) => d.modId)` 把它丢了，界面于是把可选依赖也
      // 报成"缺前置会导致启动失败"，见 `CurseForgeFileDependency`）。
      ...(() => {
        const deps = normalizeCfDependencies(f.dependencies);
        return deps === undefined ? {} : { dependencies: deps };
      })(),
    }));
  }

  /**
   * **批量**取文件（`POST /v1/mods/files`，body `{ fileIds: [...] }`）。
   *
   * 装整合包必需：整合包清单里的 `files[]` 给的是 `projectID` / `fileID`，
   * 逐个 `getFiles(projectId)` 会发 N 次请求，而且 CF 的限流比 Modrinth 紧得多。
   * PCL 走的就是这个端点（`ModModpack.vb:230`：`POST /v1/mods/files`）。
   *
   * ⚠️ **被作者删掉的文件会被源站静默跳过** —— 返回的 `data` 比请求的少，
   * 而且不告诉你少了哪些。所以这里按 `fileId` 对齐成 Map，让调用方能查出
   * 「哪几个没了」并如实报给用户（PCL 也是这么处理的，见同文件 232-253 行）。
   *
   * 超出 500 个一批：CF 文档没写死上限，取一个明显安全的值。
   */
  async getFilesByIds(fileIds: number[]): Promise<Map<number, CurseForgeFile>> {
    const out = new Map<number, CurseForgeFile>();
    this.assertAnyUsable();
    const unique = [...new Set(fileIds.filter((id) => Number.isFinite(id)))];
    if (unique.length === 0) return out;

    for (let i = 0; i < unique.length; i += CF_FILE_BATCH) {
      const slice = unique.slice(i, i + CF_FILE_BATCH);
      const data = await this.fetchJsonPost<{
        data: Array<{
          id: number;
          displayName: string;
          fileName: string;
          fileLength: number;
          downloadUrl: string | null;
          gameVersions: string[] | null;
          modLoaders?: Array<{ name: string }> | null;
          fileDate?: string | null;
          releaseType?: number | null;
          hashes?: Array<{ value: string; algo: number }>;
          dependencies?: Array<{ modId?: number; relationType?: number }>;
        }>;
      }>(`${this.baseUrl}/mods/files`, { fileIds: slice });
      for (const f of data.data) {
        const deps = normalizeCfDependencies(f.dependencies);
        out.set(f.id, {
          id: f.id,
          displayName: f.displayName,
          fileName: f.fileName,
          fileLength: f.fileLength,
          downloadUrl: f.downloadUrl,
          gameVersions: (f.gameVersions ?? []).filter(isCurseForgeMcVersion),
          modLoaderNames: curseforgeLoaderNames(f),
          ...(f.fileDate ? { fileDate: f.fileDate } : {}),
          ...(typeof f.releaseType === 'number' ? { releaseType: f.releaseType } : {}),
          ...(f.hashes ? { hashes: f.hashes } : {}),
          ...(deps === undefined ? {} : { dependencies: deps }),
        });
      }
    }
    return out;
  }

  /**
   * 项目详情（详情页头部那份：简介、长描述、分类、外链、下载量）。
   *
   * `/mods/{id}` 与 `/mods/{id}/files` 是两个端点，没有这个就得
   * 只用文件渲染详情页 —— 头部信息全空。拿不到就抛，由上层降级。
   *
   * ⚠️ **必须拆信封**：CurseForge 的这个端点返回 `{ data: {...} }`。老实现
   * 直接把整个信封当项目返回，于是调用方的 `project.categories.map(...)`
   * 永远抛 `Cannot read properties of undefined (reading 'map')` ——
   * 详情页在这种情况下**每一页都打不开**（症状看着像"网络坏了"）。
   */
  async getMod(modId: number): Promise<CurseForgeProject> {
    this.assertAnyUsable();
    const data = await this.fetchJson<{ data: CurseForgeProject }>(`${this.baseUrl}/mods/${modId}`);
    return data.data;
  }
}

/**
 * CurseForge 项目详情（`/mods/{id}` 的子集）。
 *
 * 字段的**可选性按实测来定**（2026-10-17，JEI 238222 走 MCIM 镜像抓的原响应）：
 *   - `links`：官网 / wiki / 源码 / issue 全在这个对象里，**不是顶层字段**；
 *     `wikiUrl` 可能是 `""`（JEI 就是），别当它是 URL。
 *   - `description`：**整个字段不存在**（20/20 抽样都没有），镜像也没有
 *     `/mods/{id}/description`（404）→ 详情页的长描述只能用 `summary`。
 *   - `dateCreated` / `dateModified` / `dateReleased`：ISO 字符串，存在。
 *
 * 所以这里标 `?` 的都是"能拿到就显示、拿不到就算了"的字段，**调用方不许
 * 直接点上去调方法**。
 */
export interface CurseForgeProject {
  id: number;
  name: string;
  summary: string;
  /** HTML 长描述。实测缺失（见上），只当"如果源站给了"处理。 */
  description?: string;
  downloadCount: number;
  categories?: Array<{ id: number; name: string }>;
  /** 项目类型 id：6=Mods、12=Resource packs、4471=Modpacks、6552=Shaders、6945=Datapacks。 */
  classId: number;
  /**
   * 外链集合（实测形状）：
   * `{ websiteUrl, wikiUrl, issuesUrl, sourceUrl }`，取值可能是 `null` 或空串。
   */
  links?: {
    websiteUrl?: string | null;
    wikiUrl?: string | null;
    issuesUrl?: string | null;
    sourceUrl?: string | null;
  };
  slug: string;
  dateCreated?: string;
  dateModified?: string;
  dateReleased?: string;
  /**
   * 最新文件列表（接口内嵌，省一次 files 请求）。
   *
   * ⚠️ 与 `getFiles()` 不同：这里的每个文件**没有** `fileDate` / `releaseType`
   * 的归一化，`modLoaders` 也不存在（见下）。要文件列表就用 `getFiles()`。
   */
  latestFiles?: Array<{
    id: number;
    displayName: string;
    fileName: string;
    fileLength: number;
    downloadUrl: string | null;
    gameVersions: string[];
    /**
     * ⚠️ 实测（2026-10-17，走 MCIM 镜像）：这个字段**整个不存在**（不是空数组）。
     * 要 loader 信息请用 `getFiles()` —— 它会把 `gameVersions` 里的 loader 名
     * 认出来（见 `curseforgeLoaderNames`）。
     */
    modLoaders?: Array<{ name: string }>;
    fileStatus: number;
    releaseType: number;
    fileDate: string;
  }>;
}
