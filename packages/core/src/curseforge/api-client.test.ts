import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  type MockInstance,
} from 'vitest';
import {
  CurseForgeApiClient,
  curseforgeFileIdFromUrl,
  curseforgeLoaderKey,
  typeFromWebsite,
} from './api-client.js';
import { requiredDependencyIds } from './dependencies.js';
import { MIRROR_CURSEFORGE_API, OFFICIAL_CURSEFORGE_API } from '../sources/index.js';

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
        categories: [{ id: 418, name: 'Utility' }],
        // websiteUrl 的**路径**是项目类型的唯一可靠判据（classId 过滤会混类）
        links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' },
      },
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data,
        pagination: { index: 0, pageSize: 20, resultCount: data.length, totalCount: data.length },
      }),
    } as Response);

    const result = await client.search('jei');

    // search 现在返回 { hits, total }：total 来自响应的 pagination.totalCount
    expect(result.hits).toEqual([
      {
        id: 123,
        name: 'JEI',
        summary: 'Just Enough Items',
        logoUrl: 'https://example.com/icon.png',
        downloadCount: 500_000_000,
        categories: ['Utility'],
        categoryIds: [418],
        websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei',
      },
    ]);
    expect(result.total).toBe(1);
    expect(result.hits[0].logoUrl).toBe('https://example.com/icon.png');
    expect(result.hits[0].categories).toEqual(['Utility']);
  });

  it('search 带 loader/mcVersion 时 URL 包含 modLoaderType 和 gameVersion', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [],
        pagination: { index: 0, pageSize: 20, resultCount: 0, totalCount: 0 },
      }),
    } as Response);

    await client.search('sodium', { loader: 'fabric', mcVersion: '1.21.1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    // gameId=432 是 Minecraft
    expect(calledUrl).toContain('gameId=432');
    expect(calledUrl).toContain('searchFilter=sodium');
    // fabric → modLoaderType=4（实测值，见下方 loaderToType 用例）
    expect(calledUrl).toContain('modLoaderType=4');
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
      json: async () => ({
        data: [],
        pagination: { index: 0, pageSize: 20, resultCount: 0, totalCount: 0 },
      }),
    } as Response);

    await client.search('test');

    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain('modLoaderType=');
    expect(calledUrl).not.toContain('gameVersion=');
  });

  /**
   * 排序映射。
   *
   * 为什么值得单测：**CF 不带 `sortField` 时返回顺序等于没排**（实测搜
   * "sodium" 头一条是 "Wick - Smooth & Dynamic Lights"，一条 Sodium 都不在
   * 前面），而非法值会直接 500。所以"传没传、传对没传对"两头都要钉住。
   * 这张表的数字怎么测出来的写在 `SORT_FIELDS` 的注释里。
   */
  it('search 的 sort 映射到 CF 的 sortField / sortOrder', async () => {
    const emptyPage = {
      ok: true,
      status: 200,
      json: async () => ({
        data: [],
        pagination: { index: 0, pageSize: 20, resultCount: 0, totalCount: 0 },
      }),
    } as Response;

    // 实测反推：1=相关度、6=总下载量、3=最后更新、11=发布日期
    for (const [sort, field] of [
      ['relevance', '1'],
      ['downloads', '6'],
      ['updated', '3'],
      ['newest', '11'],
    ] as const) {
      fetchMock.mockResolvedValueOnce(emptyPage);
      await client.search('map', { sort });
      const url = new URL(String(fetchMock.mock.calls.at(-1)?.[0]));
      expect(url.searchParams.get('sortField')).toBe(field);
      expect(url.searchParams.get('sortOrder')).toBe('desc');
    }

    // 不传 sort 就不带这两个参数（保持"默认顺序"这条口子开着，别硬塞一个默认值）
    fetchMock.mockResolvedValueOnce(emptyPage);
    await client.search('map');
    const url = new URL(String(fetchMock.mock.calls.at(-1)?.[0]));
    expect(url.searchParams.get('sortField')).toBeNull();
    expect(url.searchParams.get('sortOrder')).toBeNull();
  });

  /**
   * `loaderToType` 的映射另有**专门的**实测用例（见下方「loaderToType 与实测的
   * CF 枚举一致」）—— 那里记了每个数字是怎么测出来的。这里不重复断言那张表。
   */

  /**
   * 二次类型过滤的判据。
   *
   * CurseForge 的 `classId` 过滤会把数据包混进资源包（PCL issue #8265），
   * 所以必须按 websiteUrl 路径反推真实类型。这组用例钉住这张映射表 ——
   * 改错了会让「选了资源包却列出数据包」这类问题静默回归。
   */
  describe('typeFromWebsite（classId 不可靠时的二次判定）', () => {
    it('按路径识别各类型', () => {
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/mc-mods/jei')).toBe('mod');
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/mc-mods/x')).toBe('mod');
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/modpacks/all-the-mods')).toBe(
        'modpack',
      );
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/resourcepacks/fresh')).toBe(
        'resourcepack',
      );
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/texture-packs/x')).toBe(
        'resourcepack',
      );
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/shaders/complementary')).toBe(
        'shader',
      );
    });

    it('无法识别时兜底为 datapack（与 PCL 一致）', () => {
      // CurseForge 上没匹配到已知路径的，实践中就是数据包
      expect(typeFromWebsite(null)).toBe('datapack');
      expect(typeFromWebsite('')).toBe('datapack');
      expect(typeFromWebsite('https://www.curseforge.com/minecraft/datapacks/x')).toBe('datapack');
    });

    it('大小写不敏感', () => {
      expect(typeFromWebsite('https://www.curseforge.com/MINECRAFT/MC-MODS/JEI')).toBe('mod');
    });
  });

  it('contentTypeToClassId 映射正确（这是第一次过滤，仍然要发）', () => {
    expect(CurseForgeApiClient.contentTypeToClassId('mod')).toBe(6);
    expect(CurseForgeApiClient.contentTypeToClassId('modpack')).toBe(4471);
    expect(CurseForgeApiClient.contentTypeToClassId('datapack')).toBe(6945);
    expect(CurseForgeApiClient.contentTypeToClassId('resourcepack')).toBe(12);
    expect(CurseForgeApiClient.contentTypeToClassId('shader')).toBe(6552);
    expect(CurseForgeApiClient.contentTypeToClassId(undefined)).toBeUndefined();
  });

  /**
   * `loaderToType` 的数字是**实测**出来的（见方法注释里的表格）。这条测试
   * 就是那份实测结论的可执行版本 —— 老实现把 fabric/neoforge 写反了
   * （fabric→5=Quilt、neoforge→4=Fabric），两个方向都不会报错，只会静默
   * 返回错的项目。
   */
  it('loaderToType 与实测的 CF 枚举一致（Forge=1 / Fabric=4 / Quilt=5 / NeoForge=6）', () => {
    expect(CurseForgeApiClient.loaderToType('forge')).toBe(1);
    expect(CurseForgeApiClient.loaderToType('fabric')).toBe(4);
    expect(CurseForgeApiClient.loaderToType('quilt')).toBe(5);
    expect(CurseForgeApiClient.loaderToType('neoforge')).toBe(6);
    expect(CurseForgeApiClient.loaderToType('legacy_fabric')).toBe(4);
    expect(CurseForgeApiClient.loaderToType(undefined)).toBeUndefined();
  });

  it('getFiles 返回文件数组（modLoaders[].name → modLoaderNames[]）', async () => {
    const data = [
      {
        id: 456,
        displayName: 'JEI 1.21.1',
        fileName: 'jei-1.21.1-fabric.jar',
        fileLength: 1024,
        downloadUrl: 'https://example.com/jei.jar',
        gameVersions: ['1.21.1', 'Fabric'],
        modLoaders: [{ name: 'Fabric' }, { name: 'Quilt' }],
        fileDate: '2026-10-15T17:51:37.020Z',
        releaseType: 2,
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
        // 源站的 gameVersions 是混装的，出口只留 MC 版本（`Fabric` 被剥掉）
        gameVersions: ['1.21.1'],
        modLoaderNames: ['Fabric', 'Quilt'],
        fileDate: '2026-10-15T17:51:37.020Z',
        releaseType: 2,
      },
    ]);
    // 校验 URL
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain('/mods/123/files');
    expect(calledUrl).toContain('modLoaderType=4'); // 4 = Fabric（实测）
    expect(calledUrl).toContain('gameVersion=1.21.1');
  });

  /**
   * 依赖的 `relationType` **必须留着**。
   *
   * 老实现 `.map((d) => d.modId)` 把「必需还是可选」这唯一依据丢了，于是每个
   * 可选依赖都被报成"缺前置会导致启动失败"（实测：JEI 26.3 的 MezzConfigGUI、
   * Xaero 的 World Map 都是可选，却被喊成缺前置）。
   *
   * 同时钉住：源站将来往每条依赖里加别的字段时，出口只留 `{modId, relationType}`
   * （IPC 响应 schema 是严格对象）。
   */
  it('getFiles 保留依赖的 relationType，并丢掉杂字段 / 脏条目', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 9221721,
            displayName: '31.15.0.79 for NeoForge 26.3',
            fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
            fileLength: 1234567,
            downloadUrl: 'https://edge.forgecdn.net/files/9221/721/jei.jar',
            gameVersions: ['NeoForge', '26.3'],
            // 实测形状：MezzConfig 必需（3）、MezzConfigGUI 可选（2）
            dependencies: [
              { modId: 1689768, relationType: 3 },
              { modId: 1700987, relationType: 2 },
              // 将来可能多带的字段（不许漏进 IPC 响应）
              { modId: 42, relationType: 3, somethingNew: 'x' },
              // 脏条目：没有 modId
              { relationType: 2 },
            ],
          },
          {
            id: 2,
            displayName: 'no deps',
            fileName: 'a.jar',
            fileLength: 1,
            downloadUrl: 'https://edge.forgecdn.net/files/0/2/a.jar',
            gameVersions: ['26.3'],
            dependencies: [],
          },
        ],
      }),
    } as Response);

    const result = await client.getFiles(238222, {});

    expect(result[0].dependencies).toEqual([
      { modId: 1689768, relationType: 3 },
      { modId: 1700987, relationType: 2 },
      { modId: 42, relationType: 3 },
    ]);
    // 空数组 → 干脆不出现（schema 是 `.optional()`，空数组没有意义）
    expect(result[1].dependencies).toBeUndefined();
  });

  /**
   * 这一条对应**真实崩溃**：`/mods/{id}/files` 的响应里 `modLoaders` 整个字段
   * 都不存在（实测 JEI / Fabric API / Sodium 全都没有），老实现
   * `f.modLoaders.map(...)` 直接 `Cannot read properties of undefined (reading 'map')`。
   *
   * 这里的 fixture 抄的就是实测响应：loader 名只出现在 gameVersions 里，
   * 另外还有 Client / Server 这类端标记。
   */
  it('modLoaders 缺失时不崩，loader 从 gameVersions 里认出来（实测形状）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 9221721,
            displayName: '31.15.0.79 for NeoForge 26.3',
            fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
            fileLength: 1234567,
            downloadUrl: 'https://edge.forgecdn.net/files/9221/721/jei.jar',
            gameVersions: ['Client', 'NeoForge', 'Server', '26.3'],
            // 注意：**没有** modLoaders 键
            fileDate: '2026-10-15T17:51:37.020Z',
            releaseType: 1,
          },
        ],
      }),
    } as Response);

    const result = await client.getFiles(238222, {});

    expect(result[0].modLoaderNames).toEqual(['NeoForge']);
    expect(result[0].gameVersions).toEqual(['26.3']);
    expect(result[0].releaseType).toBe(1);
  });

  it('getFilesByIds 走同一套归一化（modLoaderNames 不因端点不同而漂）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          {
            id: 7164821,
            displayName: 'Sodium 0.9.2',
            fileName: 'sodium-fabric-0.9.2+mc26.3.jar',
            fileLength: 999,
            downloadUrl: 'https://edge.forgecdn.net/files/x.jar',
            gameVersions: ['Client', 'Fabric', '26.3', '1.21.1'],
          },
        ],
      }),
    } as Response);

    const map = await client.getFilesByIds([7164821]);
    const f = map.get(7164821)!;
    expect(f.modLoaderNames).toEqual(['Fabric']);
    expect(f.gameVersions).toEqual(['26.3', '1.21.1']);
  });

  it('curseforgeLoaderKey：neoforge 不被当成 forge（顺序敏感的经典坑）', () => {
    expect(curseforgeLoaderKey('NeoForge')).toBe('neoforge');
    expect(curseforgeLoaderKey('forge-43.2.0')).toBe('forge');
    expect(curseforgeLoaderKey('Fabric')).toBe('fabric');
    expect(curseforgeLoaderKey('Quilt')).toBe('quilt');
    expect(curseforgeLoaderKey('LiteLoader')).toBe('liteloader');
  });

  /**
   * `/mods/{id}` 返回的是 `{ data: {...} }` **信封**。
   *
   * 老实现把整个信封当项目返回，调用方的 `project.categories.map(...)` 于是
   * 恒抛 `Cannot read properties of undefined (reading 'map')` —— 表现是
   * 「CurseForge 详情页每一页都打不开」。这条用例钉的就是"拆信封"这一步。
   */
  it('getMod 拆掉 { data } 信封（不拆的话调用方连 categories 都摸不到）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          id: 238222,
          name: 'Just Enough Items',
          summary: 'View Items and Recipes',
          downloadCount: 1_500_000_000,
          // 实测形状：外链全在 links 里，wikiUrl 可能是空串
          links: {
            websiteUrl: 'https://x',
            wikiUrl: '',
            issuesUrl: 'https://i',
            sourceUrl: 'https://s',
          },
          categories: [{ id: 421, name: 'API and Library' }],
          classId: 6,
          slug: 'jei',
          dateCreated: '2015-11-23T23:00:41.923Z',
          dateModified: '2026-10-17T11:19:33.153Z',
        },
      }),
    } as Response);

    const p = await client.getMod(238222);

    expect(p.name).toBe('Just Enough Items');
    expect(p.categories).toEqual([{ id: 421, name: 'API and Library' }]);
    expect(p.links?.sourceUrl).toBe('https://s');
    // description 实测整个字段不存在 —— 类型上是可选的，不该硬塞一个假值
    expect(p.description).toBeUndefined();
    expect(String(fetchMock.mock.calls[0][0])).toContain('/mods/238222');
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

/**
 * 候选根（官方 / 国内镜像 MCIM）。
 *
 * 关键事实（2026-10 实测）：**镜像自带 key，不带 key 也能查**。这正是 PCL
 * 从来没跟用户要过 CurseForge key 的原因。所以我们把 key 按**根地址**判定：
 * 官方根要 key、镜像根不要，而且**不把用户的 key 发给镜像**（那等于白送一个
 * 配额凭证给第三方）。
 */
describe('CurseForgeApiClient · 镜像与 key', () => {
  let fetchMock: MockInstance;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('镜像优先 + 没 key：照样能查，而且不带 x-api-key 头', async () => {
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API, OFFICIAL_CURSEFORGE_API]);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { totalCount: 0 } }),
    } as Response);

    const r = await client.search('jei');
    expect(r.total).toBe(0);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url.startsWith(MIRROR_CURSEFORGE_API)).toBe(true);
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['x-api-key']).toBeUndefined();
  });

  it('官方优先 + 没 key：跳过官方根落到镜像；只有官方根时才抛「未配置」', async () => {
    const client = new CurseForgeApiClient('', [OFFICIAL_CURSEFORGE_API, MIRROR_CURSEFORGE_API]);
    // 官方根没 key → 跳过它；镜像根没 key 也能用 → 于是会落到镜像
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ data: [], pagination: { totalCount: 0 } }),
    } as Response);
    await client.search('jei');
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url.startsWith(MIRROR_CURSEFORGE_API)).toBe(true);

    // 只有官方一个根（=`sources/mirror.ts` 的缺省）时才是「未配置」
    const officialOnly = new CurseForgeApiClient('');
    fetchMock.mockClear();
    await expect(officialOnly.search('jei')).rejects.toThrow('CurseForge API key 未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('镜像 200 返回 HTML 时，不重试同一地址，直接换官方源', async () => {
    const client = new CurseForgeApiClient('my-key', [
      MIRROR_CURSEFORGE_API,
      OFFICIAL_CURSEFORGE_API,
    ]);
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'text/html' } as unknown as Headers,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [], pagination: { totalCount: 0 } }),
      } as Response);

    await client.search('jei');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]![0]).startsWith(MIRROR_CURSEFORGE_API)).toBe(true);
    expect(String(fetchMock.mock.calls[1]![0]).startsWith(OFFICIAL_CURSEFORGE_API)).toBe(true);
  });

  it('只有镜像且返回 HTML 时，错误明确说「非 JSON」', async () => {
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'text/html' } as unknown as Headers,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    await expect(client.search('jei')).rejects.toThrow(/非 JSON/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('镜像挂了落回官方：这次带上用户的 key，两次 URL 同路径不同前缀', async () => {
    const client = new CurseForgeApiClient('my-key', [
      MIRROR_CURSEFORGE_API,
      OFFICIAL_CURSEFORGE_API,
    ]);
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(MIRROR_CURSEFORGE_API)) throw new Error('mirror down');
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: [], pagination: { totalCount: 0 } }),
      } as Response;
    });

    await client.search('jei');

    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    const mirrorCall = calls[0]!;
    const officialCall = calls.find((c) => c[0].startsWith(OFFICIAL_CURSEFORGE_API))!;
    expect(mirrorCall[0].replace(MIRROR_CURSEFORGE_API, '')).toBe(
      officialCall[0].replace(OFFICIAL_CURSEFORGE_API, ''),
    );
    // 镜像那几次不带 key，落到官方才带
    expect((mirrorCall[1].headers as Record<string, string>)['x-api-key']).toBeUndefined();
    expect((officialCall[1].headers as Record<string, string>)['x-api-key']).toBe('my-key');
  });
});

/**
 * 真网络冒烟：**镜像上的 CF 文件列表长什么样**。
 *
 * 为什么非要真打一次：这个响应形状是不能再从文档推的 —— 线上实测
 * `modLoaders` **整个字段不存在**，loader 名混在 `gameVersions` 里
 * （`["Client","NeoForge","Server","26.3"]`）。fixture 只能锁住"我以为的形状"，
 * 锁不住"源站实际给的形状"。这条用例是上面那些 fixture 的对照物。
 *
 * 依赖外网（与其他真网络用例一致）。
 */
describe('真网络冒烟 · 镜像的 CurseForge 文件列表', () => {
  /**
   * 镜像整体不可用（5xx / 网络异常）时跳过这组**冒烟**用例。
   *
   * 这组测试验的是「源站此刻给的响应形状」，不是本仓代码；2026-10-20 实测
   * MCIM 整站 503 而官方 API 正常。让外部维护把整个测试套件染红没有意义，
   * 但也不能假装验过 —— 所以显式 skip，并在输出里留下原因。
   */
  let mirrorAvailable = true;
  beforeAll(async () => {
    try {
      const res = await fetch(`${MIRROR_CURSEFORGE_API}/mods/238222`, {
        signal: AbortSignal.timeout(10_000),
      });
      mirrorAvailable = res.status < 500 && res.status !== 429;
    } catch {
      mirrorAvailable = false;
    }
  });

  const skipIfMirrorDown = (ctx: { skip: () => void }): void => {
    if (!mirrorAvailable) {
      console.warn('[真网络冒烟] MCIM 镜像暂不可用（5xx / 网络异常），本次跳过');
      ctx.skip();
    }
  };

  it('loader 名混在 gameVersions 里也能认出来，且 MC 版本已剔除客户端/服务端标记', async (ctx) => {
    skipIfMirrorDown(ctx);
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API]);
    // 238222 = Just Enough Items：同时有 NeoForge 与 Fabric 构建
    const files = await client.getFiles(238222, {});
    expect(files.length).toBeGreaterThan(0);
    // 默认必须有上限：JEI 有 3909 个文件，全量 6MB / 16.7s（实测），
    // 而客户端单请求超时 10s —— 不封顶就是「打开详情页必失败」。
    expect(files.length).toBeLessThanOrEqual(500);

    const keys = new Set(files.flatMap((f) => f.modLoaderNames.map(curseforgeLoaderKey)));
    expect([...keys].some((k) => k === 'neoforge' || k === 'fabric')).toBe(true);

    for (const f of files) {
      // 出口的 gameVersions 只能是 MC 版本
      for (const v of f.gameVersions) {
        expect(v).not.toBe('Client');
        expect(v).not.toBe('Server');
        expect(curseforgeLoaderKey(v)).not.toBe('neoforge');
        expect(curseforgeLoaderKey(v)).not.toBe('fabric');
      }
      // 字段既然存在就必须是可信的：fileDate 可解析，releaseType 在 1..3
      expect(Number.isNaN(Date.parse(f.fileDate ?? ''))).toBe(false);
      expect([1, 2, 3]).toContain(f.releaseType);
    }
    // 至少有一条能对上 MC = 26.3（写死一个实测存在的版本，防止"全空但通过"）
    expect(files.some((f) => f.gameVersions.includes('26.3'))).toBe(true);

    /**
     * 顺带钉住「服务端过滤也走同一条归一化」：加上真实存在的筛选条件后应当更快
     * 更少（实测 63 条 / 0.18s），而且每一条都得真的符合条件 —— 如果镜像忽略
     * `modLoaderType`，这里会立刻发现（返回的 NeoForge 文件里会出现 Fabric）。
     */
    const neoforge = await client.getFiles(238222, { loader: 'neoforge', mcVersion: '26.3' });
    expect(neoforge.length).toBeGreaterThan(0);
    for (const f of neoforge) {
      expect(f.gameVersions).toContain('26.3');
      expect(f.modLoaderNames.map(curseforgeLoaderKey)).toContain('neoforge');
    }
  }, 30_000);

  /**
   * 依赖的 `relationType` 语义**是实测出来的**，这条用例把结论钉在真数据上：
   *
   *   - JEI 26.3 的 NeoForge 构建声明 `MezzConfig`（1689768，**必需**）与
   *     `MezzConfigGUI`（1700987，**可选**）
   *   - 反例面：Iris→Sodium、Xaero(fabric)→Fabric API 都是 3（真·硬前置），
   *     Xaero→World Map 是 2（可选联动）
   *
   * 如果哪天镜像/源站把 relationType 洗掉了（或语义变了），`requiredDependencyIds`
   * 会把可选的 MezzConfigGUI 也算成前置 —— 这条立刻红。
   */
  it('依赖的 relationType 3=必需 / 2=可选（用 JEI 的真数据钉住）', async (ctx) => {
    skipIfMirrorDown(ctx);
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API]);
    const files = await client.getFiles(238222, { loader: 'neoforge', mcVersion: '26.3' });
    const jei = files.find((f) => f.fileName.includes('jei-26.3-neoforge'));
    expect(jei).toBeDefined();

    const deps = jei?.dependencies ?? [];
    expect(deps).toEqual(
      expect.arrayContaining([
        { modId: 1689768, relationType: 3 }, // MezzConfig
        { modId: 1700987, relationType: 2 }, // MezzConfigGUI
      ]),
    );
    // 只有必需的算"前置"
    expect(requiredDependencyIds(jei!)).toEqual([1689768]);

    // 下载地址反推文件 id（详情页 URL 通道报前置要靠它）
    expect(curseforgeFileIdFromUrl(jei?.downloadUrl ?? '')).toBe(jei?.id);
  }, 30_000);

  /**
   * `getMod` 的字段布局**只能实测**：信封要不要拆、外链在哪一层、description
   * 在不在 —— 这三个都是照着这篇用例的结果写进实现的。
   */
  it('getMod 拆信封后：分类是数组、外链在 links 里、description 缺席', async (ctx) => {
    skipIfMirrorDown(ctx);
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API]);
    const p = await client.getMod(238222); // JEI

    expect(p.name).toContain('Just Enough Items');
    // 不拆信封的话这里是 undefined（就是"详情页 undefined.map"的根因）
    expect(Array.isArray(p.categories)).toBe(true);
    expect((p.categories ?? []).length).toBeGreaterThan(0);
    // 外链对象实测存在；wikiUrl 实测是空串（不是 URL）
    expect(p.links).toBeDefined();
    expect(String(p.links?.issuesUrl ?? '')).toContain('github.com');
    // 描述实测整个字段不存在（镜像也没有 /description 端点）
    expect(p.description).toBeUndefined();
    // 时间字段存在且可解析
    expect(Number.isNaN(Date.parse(p.dateCreated ?? ''))).toBe(false);
    expect(Number.isNaN(Date.parse(p.dateModified ?? ''))).toBe(false);
  }, 30_000);

  /**
   * 排序是**实测**行为：sortField=6（总下载量）时下载量必须严格降序。
   *
   * 反过来说：如果哪天镜像/CF 忽略了 `sortField`，这条会在真数据上红 ——
   * 这正是 `SORT_FIELDS` 想防的事（不排序时返回顺序是"随机"的，
   * 单看应用界面根本看不出是"没排"还是"这个搜索词就没好结果"）。
   */
  it('sort=downloads 真的按下载量降序（sortField=6 生效）', async (ctx) => {
    skipIfMirrorDown(ctx);
    const client = new CurseForgeApiClient('', [MIRROR_CURSEFORGE_API]);
    const { hits } = await client.search('map', {
      contentType: 'mod',
      limit: 10,
      sort: 'downloads',
    });

    expect(hits.length).toBeGreaterThan(1);
    const dls = hits.map((h) => h.downloadCount);
    expect(dls[0]).toBe(Math.max(...dls));
    // 严格降序（允许相等：并列下载量本身合法）
    for (let i = 1; i < dls.length; i++) expect(dls[i]!).toBeLessThanOrEqual(dls[i - 1]!);
  }, 30_000);
});
