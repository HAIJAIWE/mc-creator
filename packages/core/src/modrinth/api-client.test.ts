import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { ModrinthApiClient, ModrinthRateLimitError } from './api-client.js';
import { MIRROR_MODRINTH_API, OFFICIAL_MODRINTH_API } from '../sources/index.js';

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
      // 字段名必须是 `total_hits`：Modrinth v2 /search 实测返回的就是这个名，
      // 写成 `total` 会让上层分页拿到 undefined（曾经真的这么错过）。
      json: async () => ({ hits, total_hits: hits.length, limit: 5, offset: 0 }),
    } as Response);

    const result = await client.search('sodium', { limit: 5 });

    // search 返回 { hits, total }：total 来自服务端的 total_hits，分页要用它
    expect(result.hits).toEqual(hits);
    expect(result.total).toBe(1);
    expect(result.hits[0].project_id).toBe('AABB');
  });

  it('search 带 loader/mcVersion 时 URL 包含 facets', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
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

  /**
   * 排序：`index` 参数必须真的进 URL。
   *
   * 这条钉的是一个**曾经的静默故障**：下载页一直传 `sort: 'downloads'`，
   * 但客户端没有这个参数，UI 的意图全程落空（服务端默认 relevance）。
   * 实测（2026-10-16，`api.modrinth.com/v2/search?query=optimization`）：
   * `relevance` / `downloads` / `updated` 三种返回的排序明显不同，
   * 证明这不是被上游忽略的野生参数。
   */
  it('search 带 index 时 URL 带上排序', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
    } as Response);

    await client.search('optimization', { index: 'downloads' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('index=downloads');
  });

  it('不传 index 时 URL 里没有这个参数（保持服务端默认）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
    } as Response);

    await client.search('optimization');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).not.toContain('index=');
  });

  it('C-9：legacy_fabric 映射到 Modrinth fabric 分类，vanilla 不过滤', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
    } as Response);

    await client.search('sodium', { loader: 'legacy_fabric' });
    const legacyUrl = String(fetchMock.mock.calls[0][0]);
    // facets 是 JSON 编码，冒号会被百分号编码（%3A）
    expect(legacyUrl).toContain('categories%3Afabric');
    expect(legacyUrl).not.toContain('legacy_fabric');

    await client.search('sodium', { loader: 'vanilla' });
    const vanillaUrl = String(fetchMock.mock.calls[1][0]);
    expect(vanillaUrl).not.toContain('facets=');

    // getVersions 同样映射
    await client.getVersions('AABB', { loader: 'legacy_fabric' });
    const versionUrl = String(fetchMock.mock.calls[2][0]);
    expect(versionUrl).toContain('fabric');
    expect(versionUrl).not.toContain('legacy_fabric');
  });

  /**
   * 数据包在 Modrinth 上 `project_type` 是 `mod`，唯一能区分"数据包构建"与
   * "mod 构建"的就是 `loaders: ["datapack"]`（实测 `GET /project/veinminer/version?loaders=["datapack"]`
   * → 16 个版本、文件名全是 `.zip`；拿 Sodium 去问则返回 0 条，说明是精确匹配）。
   * 这个值下不去，数据包分类就会下到一个只能进 `mods/` 的 jar。
   */
  it('datapack 作为加载器过滤值下发给源站（loaders=["datapack"]）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    } as Response);

    await client.getVersions('AABB', { loader: 'datapack' });

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain('loaders=["datapack"]');
    expect(ModrinthApiClient.loaderToCategory('datapack')).toBe('datapack');
  });

  it('search 不带 loader/mcVersion 时不带 facets', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
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

  it('C-1：5xx 错误重试后仍失败则抛错', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    } as Response);

    await expect(client.search('x')).rejects.toThrow();
    // 3 次尝试（1 次 + 2 次重试）
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('C-1：网络异常重试后仍失败则透传错误', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(client.search('x')).rejects.toThrow('network down');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  // ── 限流（官方 300 请求/分钟，按 IP 计；2026-10 核实 + 实测响应头）──────────

  /** 造一个带 x-ratelimit-* 头的 Headers 替身 */
  function rlHeaders(limit: string, remaining: string, reset: string): Headers {
    const map: Record<string, string> = {
      'x-ratelimit-limit': limit,
      'x-ratelimit-remaining': remaining,
      'x-ratelimit-reset': reset,
    };
    return { get: (k: string) => map[k.toLowerCase()] ?? null } as unknown as Headers;
  }

  it('记录官方 x-ratelimit-* 头，供上层预判配额', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: rlHeaders('300', '299', '12'),
      json: async () => ({ hits: [], total_hits: 0 }),
    } as Response);

    await client.search('x');
    // 字面量钉死官方实测值，不 toEqual(常量)
    expect(client.rateLimit).toEqual({ limit: 300, remaining: 299, resetSeconds: 12 });
  });

  it('没有限流头时 rateLimit 为 null（不猜、不填默认值）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ hits: [], total_hits: 0 }),
    } as Response);

    await client.search('x');
    expect(client.rateLimit).toBeNull();
  });

  it('429 且带 x-ratelimit-reset 时，等到窗口重置后才重试（而不是固定 300ms）', async () => {
    // 这是本轮修的真实缺陷：旧实现对 429 固定退避 300ms/600ms，
    // 而配额窗口是**一分钟**，两次重试必然仍打在耗尽的窗口上。
    //
    // ⚠️ 断言必须验**时序**而不是「最终调用了几次」——只验次数的话，
    // 「退避 300ms」和「退避 30s」都能通过，那这条断言等于没写。
    vi.useFakeTimers();
    try {
      fetchMock
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          headers: rlHeaders('300', '0', '30'),
          json: async () => ({}),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: rlHeaders('300', '300', '0'),
          json: async () => ({ hits: [], total_hits: 0 }),
        } as Response);

      const p = client.search('x');
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock, 't=0 首次请求').toHaveBeenCalledTimes(1);

      // 关键的判别点：旧的 300ms 退避到此刻**早就已经重试过**了
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchMock, 't=1s 仍不应重试（reset 是 30s）').toHaveBeenCalledTimes(1);

      // 到 29.999s 仍未重试
      await vi.advanceTimersByTimeAsync(28_999);
      expect(fetchMock, 't≈30s 前一刻仍未重试').toHaveBeenCalledTimes(1);

      // 到达官方给的 reset 才重试
      await vi.advanceTimersByTimeAsync(2);
      expect(fetchMock, 't=30s 应重试').toHaveBeenCalledTimes(2);
      await expect(p).resolves.toEqual({ hits: [], total: 0 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('429 只按 reset 等一次：第二次失败后用短退避，不再叠加等 10s', async () => {
    // 同样是时序判别：若「只等一次」的守卫失效，第三次请求会在 t=20s 才发出；
    // 守卫生效时它应该在第一次等待结束后 ~300ms 内发出。
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        headers: rlHeaders('300', '0', '10'),
        json: async () => ({}),
      } as Response);

      const p = client.search('x').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchMock, 't=0').toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(fetchMock, 't=10s 第二次（等满官方 reset）').toHaveBeenCalledTimes(2);
      // 第二次失败后用**短退避**（300 * (attempt+1) = 600ms），而不是再叠加一个 10s
      await vi.advanceTimersByTimeAsync(599);
      expect(fetchMock, 't≈10.6s 前仍在等短退避').toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2);
      expect(fetchMock, 't≈10.6s 第三次已发出（没有叠加等待）').toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(String(await p)).toMatch(/限流|429/);
      expect(fetchMock, '总共 3 次').toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('429 最终失败时抛 ModrinthRateLimitError，且带官方给的 reset 秒数', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        headers: rlHeaders('300', '0', '7'),
        json: async () => ({}),
      } as Response);

      const p = client.search('x').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      const err = await p;
      expect(err).toBeInstanceOf(ModrinthRateLimitError);
      // 字面量钉死：reset 秒数要来自官方响应头，不能是 undefined/0
      expect((err as ModrinthRateLimitError).resetSeconds).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reset 头缺失时退回旧的短退避（不无限等）', async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        // 故意不给 x-ratelimit-reset
        headers: { get: () => null } as unknown as Headers,
        json: async () => ({}),
      } as Response);

      const p = client.search('x');
      const assertion = expect(p).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(2_000);
      await assertion;
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getVersions 非 2xx 时抛错（4xx 不重试）', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await expect(client.getVersions('missing')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * 候选根（官方 / 国内镜像 MCIM）。
 *
 * 这两条钉的是「换源」这件事本身：单根客户端只能干等，多根客户端要能
 * 换个源把请求做完 —— 而**抛出的错误类型不能变**（上层按
 * `instanceof ModrinthRateLimitError` 分辨并显示重置秒数）。
 */
describe('ModrinthApiClient · 镜像与官方的换源', () => {
  let fetchMock: MockInstance;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('镜像优先：镜像挂了自动落回官方，两条 URL 都长得对', async () => {
    const client = new ModrinthApiClient([MIRROR_MODRINTH_API, OFFICIAL_MODRINTH_API]);
    // 镜像网络层失败（每次重试都失败），官方成功
    fetchMock.mockImplementation(async (url: string) =>
      url.startsWith(MIRROR_MODRINTH_API)
        ? Promise.reject(new Error('mirror down'))
        : ({
            ok: true,
            status: 200,
            json: async () => ({ hits: [], total_hits: 0 }),
          } as Response),
    );

    const r = await client.search('sodium');
    expect(r.total).toBe(0);

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    // 先在镜像上重试 3 次（1 + 2），再换官方
    expect(urls.slice(0, 3).every((u) => u.startsWith(MIRROR_MODRINTH_API))).toBe(true);
    expect(urls[3]).toContain('/search?');
    expect(urls[3]!.startsWith(OFFICIAL_MODRINTH_API)).toBe(true);
    // 同一份路径，只是换了前缀
    expect(urls[3]!.replace(OFFICIAL_MODRINTH_API, '')).toBe(
      urls[0]!.replace(MIRROR_MODRINTH_API, ''),
    );
  });

  it('官方被限流（429）时换到镜像，且不干等配额窗口', async () => {
    vi.useFakeTimers();
    try {
      const client = new ModrinthApiClient([OFFICIAL_MODRINTH_API, MIRROR_MODRINTH_API]);
      fetchMock.mockImplementation(async (url: string) =>
        url.startsWith(OFFICIAL_MODRINTH_API)
          ? ({
              ok: false,
              status: 429,
              // 官方会带这个头；后面还有候选时**不该**按它睡满
              headers: { get: (k: string) => (k === 'x-ratelimit-reset' ? '3600' : null) },
              json: async () => ({}),
            } as unknown as Response)
          : ({
              ok: true,
              status: 200,
              json: async () => ({ hits: [], total_hits: 0 }),
            } as Response),
      );

      const p = client.search('sodium');
      // 3 次尝试的退避一共 1.8 秒；要是真按 3600 秒睡，这里推进 5 秒是醒不来的
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(p).resolves.toEqual({ hits: [], total: 0 });

      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls.slice(0, 3).every((u) => u.startsWith(OFFICIAL_MODRINTH_API))).toBe(true);
      expect(urls[3]!.startsWith(MIRROR_MODRINTH_API)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('所有候选都失败时抛的是最后一个错误，且类型没被包壳', async () => {
    vi.useFakeTimers();
    try {
      const client = new ModrinthApiClient([OFFICIAL_MODRINTH_API, MIRROR_MODRINTH_API]);
      fetchMock.mockResolvedValue({
        ok: false,
        status: 429,
        headers: { get: () => null } as unknown as Headers,
        json: async () => ({}),
      } as Response);

      const p = client.search('x').catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(20_000);
      const err = await p;
      expect(err).toBeInstanceOf(ModrinthRateLimitError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('镜像 200 返回 HTML 时，不重试同一地址，直接换下一个源', async () => {
    const client = new ModrinthApiClient([MIRROR_MODRINTH_API, OFFICIAL_MODRINTH_API]);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' } as unknown as Headers,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ hits: [], total_hits: 0 }),
      } as Response);

    await expect(client.search('sodium')).resolves.toEqual({ hits: [], total: 0 });

    // 同源 3 次重试是白等：只打镜像一次，第二次就落到官方源
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0]).startsWith(MIRROR_MODRINTH_API)).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0]).startsWith(OFFICIAL_MODRINTH_API)).toBe(true);
  });

  it('只有镜像且返回 HTML 时，错误明确说「非 JSON」', async () => {
    const client = new ModrinthApiClient([MIRROR_MODRINTH_API]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' } as unknown as Headers,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    await expect(client.search('sodium')).rejects.toThrow(/非 JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
