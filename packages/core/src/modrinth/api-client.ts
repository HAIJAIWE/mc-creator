/**
 * Modrinth API 客户端（规格 §P25：mod 搜索 → 选中 → 添加到整合包 spec）。
 *
 * 用 Node.js 内置 fetch（Node 18+）。API 无需认证，但需要 User-Agent header。
 * 主进程通过 IPC 转发调用以避免渲染进程 CORS 问题。
 */

/** Modrinth 搜索结果条目 */
export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  icon_url: string | null;
  downloads: number;
  categories: string[];
}

/** Modrinth 项目版本 */
export interface ModrinthVersion {
  id: string; // version ID
  project_id: string;
  version_number: string;
  name: string;
  files: Array<{ url: string; filename: string; primary: boolean; size: number }>;
}

export class ModrinthApiClient {
  private readonly baseUrl = 'https://api.modrinth.com/v2';
  private readonly userAgent = 'mc-creator/0.0.0 (https://github.com/mc-creator)';
  /** 单次请求超时（毫秒） */
  private readonly timeoutMs = 10_000;

  /**
   * loader 名称 → Modrinth 分类（facets 用）。
   * C-9 修复：Modrinth 无 legacy_fabric 分类（旧 Fabric mod 归类到 fabric）；
   * vanilla 无对应分类，返回 undefined 表示不过滤（否则 facets 恒为空结果）。
   */
  static loaderToCategory(loader?: string): string | undefined {
    switch (loader) {
      case 'fabric':
      case 'quilt':
      case 'neoforge':
      case 'forge':
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
  private async fetchJson<T>(url: string): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return (await res.json()) as T;
        if (res.status < 500 && res.status !== 429) {
          throw new ModrinthApiClient.NonRetryableError(
            `Modrinth API ${res.status} ${res.statusText}: ${url}`,
          );
        }
        lastErr = new Error(`Modrinth API ${res.status} ${res.statusText}: ${url}`);
      } catch (err) {
        if (err instanceof ModrinthApiClient.NonRetryableError) throw err; // 4xx 直接抛错，不重试
        if (err instanceof Error && err.name === 'AbortError') {
          lastErr = new Error(`Modrinth API 请求超时（${this.timeoutMs}ms）: ${url}`);
        } else {
          lastErr = err;
        }
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  /**
   * 搜索 Modrinth 项目。
   * facets 格式：`[["categories:<loader>"],["versions:<mcVersion>"]]`（JSON 字符串）
   */
  async search(
    query: string,
    opts: { loader?: string; mcVersion?: string; limit?: number } = {},
  ): Promise<ModrinthSearchHit[]> {
    // 构建 facets：每个维度一个数组，数组内是 OR，维度间是 AND
    const facets: string[][] = [];
    const category = ModrinthApiClient.loaderToCategory(opts.loader);
    if (category) facets.push([`categories:${category}`]);
    if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`]);

    const params = new URLSearchParams();
    params.set('query', query);
    if (facets.length > 0) params.set('facets', JSON.stringify(facets));
    params.set('limit', String(opts.limit ?? 20));

    const url = `${this.baseUrl}/search?${params.toString()}`;
    const data = await this.fetchJson<{ hits: ModrinthSearchHit[] }>(url);
    return data.hits;
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
}
