import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { ModrinthApiClient } from './api-client.js';

/**
 * Modrinth API 客户端测试。
 * 用 vi.stubGlobal('fetch', mock) mock 网络请求，避免真实调用。
 */
describe('ModrinthApiClient', () => {
  let client: ModrinthApiClient;
  let fetchMock: MockInstance;

  beforeEach(() => {
    client = new ModrinthApiClient();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('search 返回 hits 数组', async () => {
    const hits = [
      {
        project_id: 'AABB',
        slug: 'sodium',
        title: 'Sodium',
        description: 'Rendering optimization',
        icon_url: 'https://example.com/icon.png',
        downloads: 1000000,
        categories: ['fabric', 'optimization'],
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits }),
    } as Response);

    const result = await client.search('sodium', { limit: 5 });

    expect(result).toEqual(hits);
    expect(result[0].project_id).toBe('AABB');
  });

  it('search 带 loader/mcVersion 时 URL 包含 facets', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    } as Response);

    await client.search('sodium', { loader: 'fabric', mcVersion: '1.21.11' });

    // 校验调用了 fetch，且 URL 包含 facets 编码
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    // facets 应包含 categories:fabric 和 versions:1.21.11
    expect(calledUrl).toContain('facets=');
    expect(calledUrl).toContain('categories');
    expect(calledUrl).toContain('fabric');
    expect(calledUrl).toContain('versions');
    expect(calledUrl).toContain('1.21.11');
    expect(calledUrl).toContain('query=sodium');
  });

  it('search 不带 loader/mcVersion 时不带 facets', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [] }),
    } as Response);

    await client.search('test');

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain('facets=');
  });

  it('getVersions 返回版本数组', async () => {
    const versions = [
      {
        id: 'ver-1',
        project_id: 'AABB',
        version_number: '1.0.0',
        name: 'Sodium 1.0.0',
        files: [{ url: 'https://example.com/a.jar', filename: 'a.jar', primary: true, size: 1024 }],
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => versions,
    } as Response);

    const result = await client.getVersions('AABB', { loader: 'fabric', mcVersion: '1.21.11' });

    expect(result).toEqual(versions);
    expect(result[0].files[0].filename).toBe('a.jar');
    // 校验 URL 包含 game_versions 和 loaders
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/project/AABB/version');
    expect(calledUrl).toContain('game_versions=');
    expect(calledUrl).toContain('loaders=');
    expect(calledUrl).toContain('fabric');
  });

  it('fetch 失败（非 2xx）时抛错', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await expect(client.search('x')).rejects.toThrow();
  });

  it('fetch 抛异常时透传错误', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(client.search('x')).rejects.toThrow('network down');
  });

  it('getVersions 非 2xx 时抛错', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await expect(client.getVersions('missing')).rejects.toThrow();
  });
});
