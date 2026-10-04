/**
 * CurseForge API 客户端（规格 §P29：与 P25 Modrinth 共同构成资源市场）。
 *
 * CurseForge 需 API key（用户去 https://console.curseforge.com/ 免费申请）。
 * 主进程通过 IPC 转发调用以避免渲染进程 CORS 问题，并保护 API key 不暴露给渲染进程。
 */

/** CurseForge 搜索结果条目 */
export interface CurseForgeSearchHit {
  id: number;
  name: string;
  summary: string;
  logoUrl: string | null;
  downloadCount: number;
  categories: string[];
}

/** CurseForge 项目文件 */
export interface CurseForgeFile {
  id: number;
  displayName: string;
  fileName: string;
  fileLength: number;
  downloadUrl: string | null;
  gameVersions: string[];
  modLoaderNames: string[];
  /** 文件哈希（API hashes；可能缺失） */
  hashes?: Array<{ value: string; algo: number }>;
  /** 依赖的 modId 列表（API dependencies；可能为空） */
  dependencies?: number[];
}

export class CurseForgeApiClient {
  private readonly baseUrl = 'https://api.curseforge.com/v1';
  private readonly apiKey: string;
  /** 单次请求超时（毫秒，与 Modrinth 客户端对齐） */
  private readonly timeoutMs = 10_000;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /** loader 名称 → CurseForge modLoaderType 数字（gameId=432 是 Minecraft） */
  static loaderToType(loader?: string): number | undefined {
    switch (loader) {
      case 'fabric':
      case 'legacy_fabric':
        return 5;
      case 'neoforge':
        return 4;
      case 'quilt':
        return 6;
      case 'forge':
        return 1;
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
    let lastErr: unknown;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        const res = await fetch(url, {
          headers: { 'x-api-key': this.apiKey },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (res.ok) return (await res.json()) as T;
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
  async search(
    query: string,
    opts: { loader?: string; mcVersion?: string; limit?: number } = {},
  ): Promise<CurseForgeSearchHit[]> {
    if (!this.apiKey) throw new Error('CurseForge API key 未配置');

    const params = new URLSearchParams();
    params.set('gameId', '432');
    params.set('searchFilter', query);
    const loaderType = CurseForgeApiClient.loaderToType(opts.loader);
    if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));
    if (opts.mcVersion) params.set('gameVersion', opts.mcVersion);
    params.set('pageSize', String(opts.limit ?? 20));

    const url = `${this.baseUrl}/mods/search?${params.toString()}`;
    const data = await this.fetchJson<{
      data: Array<{
        id: number;
        name: string;
        summary: string;
        logo: { thumbnailUrl: string } | null;
        downloadCount: number;
        categories: Array<{ name: string }>;
      }>;
    }>(url);
    return data.data.map((d) => ({
      id: d.id,
      name: d.name,
      summary: d.summary,
      logoUrl: d.logo?.thumbnailUrl ?? null,
      downloadCount: d.downloadCount,
      categories: d.categories.map((c) => c.name),
    }));
  }

  /**
   * 获取项目的文件列表（downloadUrl 为直链，无需跳转）。
   */
  async getFiles(
    modId: number,
    opts: { loader?: string; mcVersion?: string } = {},
  ): Promise<CurseForgeFile[]> {
    if (!this.apiKey) throw new Error('CurseForge API key 未配置');

    const params = new URLSearchParams();
    const loaderType = CurseForgeApiClient.loaderToType(opts.loader);
    if (loaderType !== undefined) params.set('modLoaderType', String(loaderType));
    if (opts.mcVersion) params.set('gameVersion', opts.mcVersion);
    params.set('pageSize', '20');

    const url = `${this.baseUrl}/mods/${modId}/files?${params.toString()}`;
    const data = await this.fetchJson<{
      data: Array<{
        id: number;
        displayName: string;
        fileName: string;
        fileLength: number;
        downloadUrl: string | null;
        gameVersions: string[];
        modLoaders: Array<{ name: string }>;
        hashes?: Array<{ value: string; algo: number }>;
        dependencies?: Array<{ modId: number }>;
      }>;
    }>(url);
    return data.data.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      fileName: f.fileName,
      fileLength: f.fileLength,
      downloadUrl: f.downloadUrl,
      gameVersions: f.gameVersions,
      modLoaderNames: f.modLoaders.map((m) => m.name),
      ...(f.hashes ? { hashes: f.hashes } : {}),
      ...(f.dependencies ? { dependencies: f.dependencies.map((d) => d.modId) } : {}),
    }));
  }
}
