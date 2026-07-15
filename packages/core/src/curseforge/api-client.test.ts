import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { CurseForgeApiClient } from './api-client.js';

/**
 * CurseForge API 客户端测试。
 * 用 vi.stubGlobal('fetch', mock) mock 网络请求，避免真实调用。
 */
describe('CurseForgeApiClient', () => {
  let client: CurseForgeApiClient;
  let fetchMock: MockInstance;

  beforeEach(() => {
    client = new CurseForgeApiClient('test-api-key');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search 返回 hits 数组（验证 logo.thumbnailUrl → logoUrl, categories[].name → categories[]）', async () => {
    const data = [
      {
        id: 123,
        name: 'JEI',
        summary: 'Just Enough Items',
        logo: { thumbnailUrl: 'https://example.com/icon.png' },
        downloadCount: 500_000_000,
        categories: [{ name: 'Fabric' }, { name: 'Utility' }],
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data }),
    } as Response);

    const result = await client.search('jei');

    expect(result).toEqual([
      {
        id: 123,
        name: 'JEI',
        summary: 'Just Enough Items',
        logoUrl: 'https://example.com/icon.png',
        downloadCount: 500_000_000,
        categories: ['Fabric', 'Utility'],
      },
    ]);
    expect(result[0].logoUrl).toBe('https://example.com/icon.png');
    expect(result[0].categories).toEqual(['Fabric', 'Utility']);
  });

  it('search 带 loader/mcVersion 时 URL 包含 modLoaderType 和 gameVersion', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);

    await client.search('sodium', { loader: 'fabric', mcVersion: '1.21.1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    // gameId=432 是 Minecraft
    expect(calledUrl).toContain('gameId=432');
    expect(calledUrl).toContain('searchFilter=sodium');
    // fabric → modLoaderType=5
    expect(calledUrl).toContain('modLoaderType=5');
    expect(calledUrl).toContain('gameVersion=1.21.1');
    expect(calledUrl).toContain('pageSize=20');
    // 校验请求头带 x-api-key
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)['x-api-key']).toBe('test-api-key');
  });

  it('search 不带 loader 时不带 modLoaderType', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    } as Response);

    await client.search('test');

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain('modLoaderType=');
    expect(calledUrl).not.toContain('gameVersion=');
  });

  it('loaderToType 静态方法映射正确：fabric→5, neoforge→4, quilt→6, legacy_fabric→5, forge→1, undefined→undefined', () => {
    expect(CurseForgeApiClient.loaderToType('fabric')).toBe(5);
    expect(CurseForgeApiClient.loaderToType('neoforge')).toBe(4);
    expect(CurseForgeApiClient.loaderToType('quilt')).toBe(6);
    expect(CurseForgeApiClient.loaderToType('legacy_fabric')).toBe(5);
    expect(CurseForgeApiClient.loaderToType('forge')).toBe(1);
    expect(CurseForgeApiClient.loaderToType(undefined)).toBeUndefined();
  });

  it('getFiles 返回文件数组（验证 modLoaders[].name → modLoaderNames[]）', async () => {
    const data = [
      {
        id: 456,
        displayName: 'JEI 1.21.1',
        fileName: 'jei-1.21.1-fabric.jar',
        fileLength: 1024,
        downloadUrl: 'https://example.com/jei.jar',
        gameVersions: ['1.21.1', 'Fabric'],
        modLoaders: [{ name: 'Fabric' }, { name: 'Quilt' }],
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data }),
    } as Response);

    const result = await client.getFiles(123, { loader: 'fabric', mcVersion: '1.21.1' });

    expect(result).toEqual([
      {
        id: 456,
        displayName: 'JEI 1.21.1',
        fileName: 'jei-1.21.1-fabric.jar',
        fileLength: 1024,
        downloadUrl: 'https://example.com/jei.jar',
        gameVersions: ['1.21.1', 'Fabric'],
        modLoaderNames: ['Fabric', 'Quilt'],
      },
    ]);
    expect(result[0].modLoaderNames).toEqual(['Fabric', 'Quilt']);
    // 校验 URL
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/mods/123/files');
    expect(calledUrl).toContain('modLoaderType=5');
    expect(calledUrl).toContain('gameVersion=1.21.1');
  });

  it('fetch 失败（非 2xx）时抛错', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({}),
    } as Response);

    await expect(client.search('x')).rejects.toThrow();
  });

  it('apiKey 为空时抛 "CurseForge API key 未配置" 错误', async () => {
    const emptyClient = new CurseForgeApiClient('');
    await expect(emptyClient.search('x')).rejects.toThrow('CurseForge API key 未配置');
    await expect(emptyClient.getFiles(1)).rejects.toThrow('CurseForge API key 未配置');
  });
});
