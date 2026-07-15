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
}

export class CurseForgeApiClient {
  private readonly baseUrl = 'https://api.curseforge.com/v1';
  private readonly apiKey: string;

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
    const res = await fetch(url, { headers: { 'x-api-key': this.apiKey } });
    if (!res.ok) {
      throw new Error(`CurseForge search failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      data: Array<{
        id: number;
        name: string;
        summary: string;
        logo: { thumbnailUrl: string } | null;
        downloadCount: number;
        categories: Array<{ name: string }>;
      }>;
    };
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
    const res = await fetch(url, { headers: { 'x-api-key': this.apiKey } });
    if (!res.ok) {
      throw new Error(`CurseForge getFiles failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as {
      data: Array<{
        id: number;
        displayName: string;
        fileName: string;
        fileLength: number;
        downloadUrl: string | null;
        gameVersions: string[];
        modLoaders: Array<{ name: string }>;
      }>;
    };
    return data.data.map((f) => ({
      id: f.id,
      displayName: f.displayName,
      fileName: f.fileName,
      fileLength: f.fileLength,
      downloadUrl: f.downloadUrl,
      gameVersions: f.gameVersions,
      modLoaderNames: f.modLoaders.map((m) => m.name),
    }));
  }
}
