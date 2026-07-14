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
    if (opts.loader) facets.push([`categories:${opts.loader}`]);
    if (opts.mcVersion) facets.push([`versions:${opts.mcVersion}`]);

    const params = new URLSearchParams();
    params.set('query', query);
    if (facets.length > 0) params.set('facets', JSON.stringify(facets));
    params.set('limit', String(opts.limit ?? 20));

    const url = `${this.baseUrl}/search?${params.toString()}`;
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) {
      throw new Error(`Modrinth search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { hits: ModrinthSearchHit[] };
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
    if (opts.loader) params.set('loaders', JSON.stringify([opts.loader]));

    const url = `${this.baseUrl}/project/${encodeURIComponent(projectId)}/version?${params.toString()}`;
    const res = await fetch(url, { headers: { 'User-Agent': this.userAgent } });
    if (!res.ok) {
      throw new Error(`Modrinth getVersions failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ModrinthVersion[];
  }
}
