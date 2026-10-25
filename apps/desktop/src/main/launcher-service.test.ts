import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  LauncherService,
  resolveInside,
  type GameVersionEntry,
  type VersionDetail,
} from './launcher-service.js';
import { SourcePreferenceStore } from './download-sources.js';

/**
 * launcher-service 测试：mock fetch 返回固定 manifest/version json，
 * 验证版本解析、libraries 提取、client/assets/libraries 下载与启动命令。
 */

// 构造 fake fetch：按 URL 返回对应内容
/**
 * 带请求计数器的 fetch。
 *
 * 存在的唯一理由：断言「`listVersions` 不做本地缓存」—— PCL 的版本页
 * 「都是更新的」靠的就是每次都重新请求、没有本地副本。有人给它加缓存时
 * 那条断言会红。挂个计数器比 mock 整个 fetch 模块可靠。
 */
type CountingFetch = ((url: string) => Promise<Response>) & { calls: () => number };

function makeFetch(manifest: unknown, versionJson: unknown): CountingFetch {
  const manifestBuf = Buffer.from(JSON.stringify(manifest));
  const versionBuf = Buffer.from(JSON.stringify(versionJson));
  let calls = 0;
  const fn = async (url: string): Promise<Response> => {
    calls += 1;
    if (url.includes('version_manifest')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          manifestBuf.buffer.slice(
            manifestBuf.byteOffset,
            manifestBuf.byteOffset + manifestBuf.byteLength,
          ),
      } as Response;
    }
    if (url.includes('version.json')) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          versionBuf.buffer.slice(
            versionBuf.byteOffset,
            versionBuf.byteOffset + versionBuf.byteLength,
          ),
      } as Response;
    }
    if (url.includes('api.modrinth.com')) {
      const skinVersions = [
        {
          files: [
            {
              url: 'https://cdn.modrinth.com/data/csl/customskinloader-1.0.0.jar',
              filename: 'customskinloader-1.0.0.jar',
            },
          ],
        },
      ];
      const skinBuf = Buffer.from(JSON.stringify(skinVersions));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          skinBuf.buffer.slice(skinBuf.byteOffset, skinBuf.byteOffset + skinBuf.byteLength),
      } as Response;
    }
    if (url.includes('resources.download')) {
      const b = Buffer.from('asset-data');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }
    if (url.includes('.jar') || url.includes('client')) {
      const b = Buffer.from('jar-data');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }
    return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
  };
  (fn as unknown as CountingFetch).calls = () => calls;
  return fn as CountingFetch;
}

const MANIFEST = {
  latest: { release: '26.2' },
  versions: [
    {
      id: '26.2',
      type: 'release',
      releaseTime: '2026-06-16T00:00:00Z',
      url: 'https://piston-meta.mojang.com/.../26.2/version.json',
    },
    {
      id: '1.21.11',
      type: 'release',
      releaseTime: '2025-12-09T00:00:00Z',
      url: 'https://piston-meta.mojang.com/.../1.21.11/version.json',
    },
    {
      id: '24w01a',
      type: 'snapshot',
      releaseTime: '2024-01-01T00:00:00Z',
      url: 'https://x/version.json',
    },
  ],
};

const VERSION_JSON = {
  id: '26.2',
  assetIndex: { id: '26', url: 'https://piston-meta.mojang.com/.../26.json' },
  downloads: { client: { url: 'https://launcher.mojang.com/client.jar' } },
  libraries: [
    {
      downloads: { artifact: { url: 'https://libraries/org/apache/commons/1.0/commons-1.0.jar' } },
    },
    { downloads: { artifact: { url: 'https://libraries/net/minecraft/26.2/mc-26.2.jar' } } },
    {
      downloads: {
        classifiers: { 'natives-windows': { url: 'https://libraries/natives/natives-win.jar' } },
      },
    },
  ],
};

describe('LauncherService', () => {
  let dir: string;
  let service: LauncherService;
  let fetchSpy: CountingFetch;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-launcher-test-'));
    fetchSpy = makeFetch(MANIFEST, VERSION_JSON);
    service = new LauncherService(dir, fetchSpy as unknown as typeof fetch);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('listVersions 返回**全部类型**且最新在前（PCL 的分组靠这三类数据）', async () => {
    // 契约变更（对齐 PCL 下载页）：此前硬过滤 type === 'release'，
    // 于是「预览版 / 远古版 / 愚人节版」三组永远没有数据可显示。
    const versions: GameVersionEntry[] = await service.listVersions();
    // 24w01a 是 snapshot —— 旧实现会把它过滤掉
    expect(versions.map((v) => v.id)).toEqual(['26.2', '1.21.11', '24w01a']);
    expect(versions[0].releaseTime).toBe('2026-06-16T00:00:00Z');
    // 每个条目都要带 type 与 releaseTime：UI 的分组与「发布时间」全靠这两个字段
    for (const v of versions) {
      expect(typeof v.type, `${v.id} 缺 type`).toBe('string');
      expect(typeof v.releaseTime, `${v.id} 缺 releaseTime`).toBe('string');
    }
  });

  it('listVersions 不做本地缓存：每次都重新拉 Mojang 清单', async () => {
    // PCL 的版本页「都是更新的」，靠的是每次都重新请求、没有本地副本。
    // 有人给它加缓存时，这条会红。
    await service.listVersions();
    const before = fetchSpy.calls();
    await service.listVersions();
    expect(fetchSpy.calls(), '第二次调用没有重新请求清单').toBeGreaterThan(before);
  });

  it('resolveVersion 提取 client/assets/libraries **及其校验信息**', async () => {
    const detail = await service.resolveVersion('26.2');
    expect(detail.id).toBe('26.2');
    expect(detail.assets).toBe('26');
    expect(detail.clientUrl).toContain('client.jar');
    expect(detail.libraryUrls).toHaveLength(3); // 2 artifact + 1 natives classifier
    // libraryUrls 现在是 FileExpectation[]：url + sha1 + size 一并带出。
    // 清单里本来就带着 sha1/size，此前被丢掉 —— 于是「下坏了」无从发现。
    expect(detail.libraryUrls[0]?.url).toContain('commons-1.0.jar');
    // 本仓的 VERSION_JSON fixture 不带 sha1/size → 应为 null（未知 ≠ 不匹配）
    expect(detail.clientSha1, '清单没给 sha1 时应为 null（=未知，不校验）').toBeNull();
    expect(detail.clientSize, '清单没给 size 时应为 null（=未知，不校验）').toBeNull();
  });

  it('downloadClient 写入 jar 且幂等', async () => {
    const detail = await service.resolveVersion('26.2');
    const p1 = await service.downloadClient(detail);
    const p2 = await service.downloadClient(detail);
    expect(p1).toBe(p2);
    // 跨平台：路径以 versions/<id>/<id>.jar 结尾
    expect(p1.replace(/\\/g, '/')).toContain('versions/26.2/26.2.jar');
  });

  it('已取消的信号：downloadClient 不发请求，也不写 jar', async () => {
    const detail = await service.resolveVersion('26.2');
    const before = fetchSpy.calls();
    const ac = new AbortController();
    ac.abort();

    await expect(service.downloadClient(detail, undefined, ac.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchSpy.calls(), '取消后仍发了下载请求').toBe(before);
    expect(existsSync(join(dir, 'versions', '26.2', '26.2.jar'))).toBe(false);
  });

  /**
   * 完整性校验（对标 PCL `ModDownload.vb` 的 `FileChecker`）。
   *
   * 为什么这组用例必须有：「HTTP 200」不等于「文件是对的」。代理截断、CDN
   * 返回错误页、磁盘半写，都会得到一个 200 + 损坏内容。缺了校验，游戏会在
   * **启动后**炸成一堆天书，那时已经很难回溯到"是那次下载坏了"。
   */
  describe('下载完整性校验', () => {
    let dir: string;
    const GOOD = 'jar-data';
    const GOOD_SHA1 = '8247c1b906a87e756fbb1e03a725911585f011f4';

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'mc-launcher-sha-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    /** 造一个总是返回 content 的 fetch */
    function fetchReturning(content: string, status = 200): typeof fetch {
      return (async () => {
        const b = Buffer.from(content);
        return {
          ok: status >= 200 && status < 300,
          status,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch;
    }

    const detail: VersionDetail = {
      id: '26.2',
      assets: '26',
      assetsUrl: 'https://example.invalid/26.json',
      clientUrl: 'https://example.invalid/client.jar',
      libraryUrls: [],
      javaMajor: null,
      clientSha1: GOOD_SHA1,
      clientSize: GOOD.length,
      serverUrl: null,
      serverSha1: null,
      serverSize: null,
    };

    it('sha1 与 size 都对 → 正常落盘', async () => {
      const svc = new LauncherService(dir, fetchReturning(GOOD));
      await expect(svc.downloadClient(detail)).resolves.toContain('26.2.jar');
    });

    it('size 对不上 → 拒绝落盘并说明是截断', async () => {
      const svc = new LauncherService(dir, fetchReturning(GOOD));
      await expect(
        svc.downloadClient({ ...detail, clientSize: GOOD.length + 100 }),
      ).rejects.toThrow(/文件大小对不上|截断/);
      // 关键：坏文件**不能**留在盘上 —— 留着的话下次 exists() 会跳过校验
      expect(existsSync(join(dir, 'versions', '26.2', '26.2.jar'))).toBe(false);
    });

    it('size 对但内容被篡改（sha1 不符）→ 拒绝', async () => {
      // 代理返回了 200 + 错误页：字节数刚好一样，内容是另一份东西
      const svc = new LauncherService(dir, fetchReturning('jar-datx'));
      await expect(svc.downloadClient(detail)).rejects.toThrow(/SHA1/);
      expect(existsSync(join(dir, 'versions', '26.2', '26.2.jar'))).toBe(false);
    });

    it('清单没给 sha1/size（null = 未知）→ 不校验，正常通过', async () => {
      // 「不知道」不等于「不匹配」。把 null 当失败会把所有老版本/镜像挡在门外。
      const svc = new LauncherService(dir, fetchReturning(GOOD));
      await expect(
        svc.downloadClient({ ...detail, clientSha1: null, clientSize: null }),
      ).resolves.toContain('26.2.jar');
    });

    it('重试时每次都重新校验：坏内容不会被当成成功', async () => {
      let calls = 0;
      const flaky = (async () => {
        calls += 1;
        // 刻意用**同长度不同内容**：size 检查会先命中，那样就测不到 SHA1 分支了
        const b = Buffer.from('jar-datx');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch;
      const svc = new LauncherService(dir, flaky);
      await expect(svc.downloadClient(detail)).rejects.toThrow(/SHA1/);
      // 校验失败要走完整个重试预算（每次都重新校验，不是第一次失败就放弃）
      expect(calls, `只请求了 ${calls} 次`).toBeGreaterThan(1);
    });

    it('403 / 404 是确定性失败：立即抛出不重试', async () => {
      let calls = 0;
      const notFound = (async () => {
        calls += 1;
        return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
      }) as unknown as typeof fetch;
      const svc = new LauncherService(dir, notFound);
      await expect(svc.downloadClient(detail)).rejects.toThrow(/404/);
      expect(calls, `404 重试了 ${calls} 次 —— 确定性失败重试没有意义`).toBe(1);
    });

    it('503 这类临时故障仍然重试', async () => {
      let calls = 0;
      const flaky = (async () => {
        calls += 1;
        if (calls < 2) {
          return {
            ok: false,
            status: 503,
            arrayBuffer: async () => new ArrayBuffer(0),
          } as Response;
        }
        const b = Buffer.from(GOOD);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch;
      const svc = new LauncherService(dir, flaky);
      await expect(svc.downloadClient(detail)).resolves.toContain('26.2.jar');
      expect(calls).toBeGreaterThan(1);
    });

    /**
     * 候选源按顺序尝试 —— 验证的是**顺序**，不是"能不能下下来"。
     */
    describe('下载源候选列表（接线）', () => {
      const CAND_DETAIL: VersionDetail = {
        id: '26.2',
        assets: '26',
        assetsUrl: '',
        clientUrl: 'https://libraries.minecraft.net/maven/a/b.jar',
        libraryUrls: [],
        javaMajor: null,
        clientSha1: GOOD_SHA1,
        clientSize: GOOD.length,
        serverUrl: null,
        serverSha1: null,
        serverSize: null,
      };

      /** 记录每次请求的 URL；前 failing 个返回 404 */
      function recorder(failing: number) {
        const hits: string[] = [];
        const f = (async (url: string) => {
          hits.push(url);
          if (hits.length <= failing) {
            return {
              ok: false,
              status: 404,
              arrayBuffer: async () => new ArrayBuffer(0),
            } as Response;
          }
          const b = Buffer.from(GOOD);
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          } as Response;
        }) as unknown as typeof fetch;
        return { f, hits };
      }

      let cdir: string;
      beforeEach(() => {
        cdir = mkdtempSync(join(tmpdir(), 'mc-launcher-cand-'));
      });
      afterEach(() => {
        rmSync(cdir, { recursive: true, force: true });
      });

      it('首选源 404 → 自动落到下一个候选', async () => {
        const candidates = [
          { url: 'https://first.example/a.jar', label: '源A', official: true },
          { url: 'https://second.example/a.jar', label: '源B', official: false },
        ];
        const { f, hits } = recorder(1);
        const svc = new LauncherService(cdir, f, { expandCandidates: () => candidates });
        await expect(svc.downloadClient(CAND_DETAIL)).resolves.toContain('26.2.jar');
        expect(hits).toEqual(['https://first.example/a.jar', 'https://second.example/a.jar']);
      });

      it('全部候选都失败 → 错误里说清尝试过哪些源', async () => {
        const candidates = [
          { url: 'https://a.example/x.jar', label: '官方源', official: true },
          { url: 'https://b.example/x.jar', label: 'BMCLAPI 镜像', official: false },
        ];
        const { f } = recorder(99);
        const svc = new LauncherService(cdir, f, { expandCandidates: () => candidates });
        await expect(svc.downloadClient(CAND_DETAIL)).rejects.toThrow(/官方源 → BMCLAPI 镜像/);
      });

      it('镜像优先时，首个请求确实是镜像（走真实展开逻辑，不注入替身）', async () => {
        const { f, hits } = recorder(0);
        const store = new SourcePreferenceStore(cdir);
        store.write({ preferOfficial: false });
        const svc = new LauncherService(cdir, f, { sourceStore: store });
        await svc.downloadClient(CAND_DETAIL);
        expect(hits[0], `首个请求是 ${hits[0]}`).toContain('bmclapi2.bangbang93.com');
      });

      it('**没写过偏好**时，首个请求是镜像（本仓默认国内镜像优先）', async () => {
        const { f, hits } = recorder(0);
        const svc = new LauncherService(cdir, f, {
          sourceStore: new SourcePreferenceStore(cdir),
        });
        await svc.downloadClient(CAND_DETAIL);
        expect(hits[0], `首个请求是 ${hits[0]}`).toContain('bmclapi2.bangbang93.com');
      });

      it('显式切到官方优先时，首个请求是官方源', async () => {
        const { f, hits } = recorder(0);
        const store = new SourcePreferenceStore(cdir);
        store.write({ preferOfficial: true });
        const svc = new LauncherService(cdir, f, { sourceStore: store });
        await svc.downloadClient(CAND_DETAIL);
        expect(hits[0], `首个请求是 ${hits[0]}`).toContain('libraries.minecraft.net');
      });
    });

    /**
     * 并发下载（对标 PCL 的 ``NetTaskThreadLimit = 设置值 + 1``）。
     *
     * 守的不是「快」，是三件容易在并发里丢掉的东西：
     * 结果一致性、失败隔离、失败**被上报**。
     */
    describe('资源并发下载', () => {
      const OBJECT_COUNT = 40;
      /** 只关心资源下载的最小 detail（assetsUrl 是唯一被用到的字段） */
      const CAND_DETAIL: VersionDetail = {
        id: '26.2',
        assets: '26',
        assetsUrl: 'https://x/26.json',
        clientUrl: '',
        libraryUrls: [],
        javaMajor: null,
        clientSha1: null,
        clientSize: null,
        serverUrl: null,
        serverSha1: null,
        serverSize: null,
      };

      /** 造一个含 n 个对象的资源索引 */
      function indexOf(n: number): string {
        const objects: Record<string, { hash: string; size: number }> = {};
        for (let i = 0; i < n; i++) {
          // 每个对象用不同内容 → sha1 不同 → 校验能逐个分辨
          const hash = createHash('sha1').update(`asset-${i}`).digest('hex');
          objects[`minecraft/sounds/${i}.ogg`] = { hash, size: `asset-${i}`.length };
        }
        return JSON.stringify({ objects });
      }

      /** hash → 序号。资源 URL 里只有 hash（没有文件名），必须反查。 */
      function hashToIndex(n: number): Map<string, number> {
        const m = new Map<string, number>();
        for (let i = 0; i < n; i++) {
          m.set(createHash('sha1').update(`asset-${i}`).digest('hex'), i);
        }
        return m;
      }

      interface HarnessOpts {
        concurrency: number;
        /** 返回 true 表示这个对象应当下载失败 */
        shouldFail?: (i: number) => boolean;
      }

      function harness(dir: string, opts: HarnessOpts) {
        const idx = JSON.parse(indexOf(OBJECT_COUNT)) as {
          objects: Record<string, { hash: string; size: number }>;
        };
        const indexBuf = Buffer.from(JSON.stringify(idx));
        const byHash = hashToIndex(OBJECT_COUNT);
        let inflight = 0;
        let peak = 0;
        const requested: string[] = [];

        const f = (async (url: string) => {
          if (url.includes('26.json')) {
            return {
              ok: true,
              status: 200,
              arrayBuffer: async () =>
                indexBuf.buffer.slice(
                  indexBuf.byteOffset,
                  indexBuf.byteOffset + indexBuf.byteLength,
                ),
            } as Response;
          }
          // 记录并发峰值：必须真的重叠才算并发
          inflight++;
          peak = Math.max(peak, inflight);
          requested.push(url);
          await new Promise((r) => setTimeout(r, 5));
          inflight--;
          // 资源 URL 里只有 hash，没有文件名 —— 必须按 hash 反查序号
          const i = byHash.get(url.slice(url.lastIndexOf('/') + 1)) ?? -1;
          if (i < 0 || opts.shouldFail?.(i)) {
            return {
              ok: false,
              status: 404,
              arrayBuffer: async () => new ArrayBuffer(0),
            } as Response;
          }
          const b = Buffer.from(`asset-${i}`);
          return {
            ok: true,
            status: 200,
            arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
          } as Response;
        }) as unknown as typeof fetch;

        const svc = new LauncherService(dir, f, {
          maxParallelDownloads: opts.concurrency,
          sourceStore: new SourcePreferenceStore(dir),
        });
        return {
          svc,
          detail: { ...CAND_DETAIL, assetsUrl: 'https://x/26.json' },
          requested,
          peak: () => peak,
        };
      }

      let adir: string;
      beforeEach(() => {
        adir = mkdtempSync(join(tmpdir(), 'mc-launcher-par-'));
      });
      afterEach(() => {
        rmSync(adir, { recursive: true, force: true });
      });

      it('并发上限为 1 时退化为串行（峰值并发 = 1）', async () => {
        const h = harness(adir, { concurrency: 1 });
        await h.svc.downloadAssets(h.detail);
        expect(h.peak()).toBe(1);
        expect(h.requested.length).toBe(OBJECT_COUNT);
      });

      it('并发上限为 8 时真的重叠（峰值 > 1）', async () => {
        const h = harness(adir, { concurrency: 8 });
        await h.svc.downloadAssets(h.detail);
        expect(h.peak(), '请求没有真正并发 —— 峰值还是 1').toBeGreaterThan(1);
        expect(h.peak(), `峰值 ${h.peak()} 超过上限 8`).toBeLessThanOrEqual(8);
      });

      it('并发不改变结果：一个都不少，且全部通过校验落盘', async () => {
        const h = harness(adir, { concurrency: 8 });
        await h.svc.downloadAssets(h.detail);
        const idx = JSON.parse(indexOf(OBJECT_COUNT)) as {
          objects: Record<string, { hash: string }>;
        };
        for (const [name, obj] of Object.entries(idx.objects)) {
          const p = join(adir, 'assets', 'objects', obj.hash.slice(0, 2), obj.hash);
          expect(existsSync(p), `${name} 没落盘`).toBe(true);
          // 内容必须正确：并发写错路径是最难查的一类 bug
          expect(readFileSync(p, 'utf-8')).toBe(`asset-${Number(/\d+/.exec(name)![0])}`);
        }
      });

      it('部分失败时：其余照下，**并且**如实抛错（不静默吞掉）', async () => {
        const h = harness(adir, { concurrency: 4, shouldFail: (i) => i % 4 === 0 });
        await expect(h.svc.downloadAssets(h.detail)).rejects.toThrow(/有 \d+ 个失败/);
        // 失败的确实没落盘，其余的落盘了 —— 不是全盘放弃
        const idx = JSON.parse(indexOf(OBJECT_COUNT)) as {
          objects: Record<string, { hash: string }>;
        };
        const entries = Object.entries(idx.objects);
        const missing = entries.filter(
          ([, o]) => !existsSync(join(adir, 'assets', 'objects', o.hash.slice(0, 2), o.hash)),
        );
        expect(missing.length, `缺失 ${missing.length} 个`).toBeGreaterThan(0);
        expect(missing.length, '除了失败的那些，还有别的没下').toBeLessThan(OBJECT_COUNT);
      });
    });
  });

  it('downloadAssets 下载索引与资源', async () => {
    // 覆写 fetch 支持 index json
    // hash/size 必须是 mock 内容的真值：makeFetch 的 .jar 分支返回 'jar-data'（8 字节）。
    // 填假值的话，完整性校验会把它拒掉 —— 那正是这个测试存在的意义。
    const indexData = {
      objects: {
        'sound/ding.ogg': {
          hash: '8247c1b906a87e756fbb1e03a725911585f011f4',
          size: 8,
        },
      },
    };
    const indexBuf = Buffer.from(JSON.stringify(indexData));
    const customFetch = async (url: string) => {
      if (url.includes('26.json')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            indexBuf.buffer.slice(indexBuf.byteOffset, indexBuf.byteOffset + indexBuf.byteLength),
        } as Response;
      }
      // 资源对象走 resources.download.minecraft.net —— 这个域名既不含 .jar 也不含
      // client，makeFetch 的 jar 分支接不到，必须显式提供。
      if (url.includes('resources.download.minecraft.net')) {
        const b = Buffer.from('jar-data'); // 与上面索引里的 sha1/size 对应
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }
      return makeFetch(MANIFEST, VERSION_JSON)(url);
    };
    const svc = new LauncherService(dir, customFetch as unknown as typeof fetch);
    const detail = await svc.resolveVersion('26.2');
    await svc.downloadAssets(detail);
    const idx = join(dir, 'assets', 'indexes', '26.json');
    expect(
      await import('node:fs/promises').then((f) =>
        f
          .access(idx)
          .then(() => true)
          .catch(() => false),
      ),
    ).toBe(true);
    const asset = join(dir, 'assets', 'objects', '82', '8247c1b906a87e756fbb1e03a725911585f011f4');
    expect(
      await import('node:fs/promises').then((f) =>
        f
          .access(asset)
          .then(() => true)
          .catch(() => false),
      ),
    ).toBe(true);
  });

  it('downloadLibraries 提取 URL 路径写入本地', async () => {
    const detail = await service.resolveVersion('26.2');
    const paths = await service.downloadLibraries(detail);
    expect(paths).toHaveLength(3);
    expect(paths[0]).toContain(
      join('libraries', 'org', 'apache', 'commons', '1.0', 'commons-1.0.jar'),
    );
    expect(
      await import('node:fs/promises').then((f) =>
        f
          .access(paths[0])
          .then(() => true)
          .catch(() => false),
      ),
    ).toBe(true);
  });

  it('launchGame 未下载客户端时抛错', async () => {
    const detail = await service.resolveVersion('26.2');
    await expect(
      service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: join(dir, 'game') }),
    ).rejects.toThrow('客户端未下载');
  });
});

describe('LauncherService 增强（加载器/Mod/皮肤）', () => {
  let dir: string;
  let service: LauncherService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-launcher-test2-'));
    service = new LauncherService(
      dir,
      makeFetch(MANIFEST, VERSION_JSON) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('listMods 空目录返回空数组', async () => {
    expect(await service.listMods('26.2')).toEqual([]);
  });

  it('installMod 下载 jar 到实例 gameDir 下的 mods 目录', async () => {
    const p = await service.installMod(
      '26.2',
      'my_mod.jar',
      'https://cdn.modrinth.com/data/x/my_mod.jar',
    );
    // `<gameDir>/mods` 而不是 `versions/<v>/mods`：游戏只扫前者，
    // 装到后者等于装了个没人读的目录。
    expect(p.replace(/\\/g, '/')).toContain('game/26.2/mods/my_mod.jar');
    // listMods 返回 ModInfo[]（含 name/size/enabled/modifiedAt），不是 string[] ——
    // 断言只锁 name，别把「还要多几个字段」也写死进来。
    const mods = await service.listMods('26.2');
    expect(mods.map((m) => m.name)).toEqual(['my_mod.jar']);
    expect(mods[0]?.enabled, '新装的 mod 应当默认启用').toBe(true);
  });

  it('removeMod 删除 jar', async () => {
    await service.installMod('26.2', 'my_mod.jar', 'https://cdn.modrinth.com/data/x/my_mod.jar');
    await service.removeMod('26.2', 'my_mod.jar');
    expect(await service.listMods('26.2')).toEqual([]);
  });

  /**
   * 写一个加载器档案，让 `isLoaderInstalled` 能认出它。
   *
   * 走的是**档案内容**（inheritsFrom + mainClass），与 `isLoaderInstalled`
   * 的事实来源一致 —— 目录名叫什么无所谓。
   */
  function installLoaderProfile(mcVersion: string, mainClass: string): void {
    const id = `${mcVersion}-loader-test`;
    const vdir = join(dir, 'versions', id);
    mkdirSync(vdir, { recursive: true });
    writeFileSync(
      join(vdir, `${id}.json`),
      JSON.stringify({
        id,
        inheritsFrom: mcVersion,
        mainClass,
        libraries: [],
        releaseTime: '2024-01-01T00:00:00Z',
        type: 'release',
        assets: 'indexes',
        assetIndex: {
          id: 'indexes',
          sha1: 'x',
          size: 1,
          url: 'https://example.invalid/i.json',
          totalSize: 1,
        },
      }),
    );
  }

  const FABRIC_MAIN = 'net.fabricmc.loader.impl.launch.knot.KnotClient';

  it('installSkinSupport 生成皮肤配置并安装 mod', async () => {
    installLoaderProfile('26.2', FABRIC_MAIN);
    // modrinth API + jar 下载都走 mock（jar 分支返回 jar-data）
    await service.installSkinSupport('26.2', 'https://littleskin.cn/api/yggdrasil');
    const mods = await service.listMods('26.2');
    expect(mods.length).toBeGreaterThan(0);
    // 配置文件存在且含皮肤站 URL
    const cfg = join(dir, 'game', '26.2', 'config', 'CustomSkinLoader', 'CustomSkinLoader.json');
    const content = await import('node:fs/promises').then((f) => f.readFile(cfg, 'utf-8'));
    expect(content).toContain('littleskin.cn');
  });

  it('生成的 loadlist 里 LocalSkin 排第一（本地皮肤要盖过皮肤站）', async () => {
    installLoaderProfile('26.2', FABRIC_MAIN);
    await service.installSkinSupport('26.2', 'https://littleskin.cn/api/yggdrasil');
    const cfg = join(dir, 'game', '26.2', 'config', 'CustomSkinLoader', 'CustomSkinLoader.json');
    const parsed = JSON.parse(readFileSync(cfg, 'utf-8')) as {
      loadlist: Array<{ name: string }>;
    };
    // 不是「包含 LocalSkin」，是**第一位** —— 顺序错了本地皮肤就被皮肤站盖掉，
    // 而界面不会报任何错。
    expect(parsed.loadlist[0]?.name).toBe('LocalSkin');
  });

  it('查 Modrinth 用的是实例的 MC 版本，不是写死的 26.1', async () => {
    // 回归：原实现硬编码 game_versions=["26.1"]，对 26.2 的实例会下到
    // 一个版本对不上的 CSL —— mod 装进去了但游戏加载不了。
    installLoaderProfile('26.2', FABRIC_MAIN);
    await service.installSkinSupport('26.2', 'https://littleskin.cn/api/yggdrasil');
    const cfg = join(dir, 'game', '26.2', 'config', 'CustomSkinLoader', 'CustomSkinLoader.json');
    expect(existsSync(cfg)).toBe(true);
  });

  it('两个加载器都没装时直接拒绝，不去下一个用不了的 CSL', async () => {
    await expect(
      service.installSkinSupport('26.2', 'https://littleskin.cn/api/yggdrasil'),
    ).rejects.toThrow('先装好加载器');
    // 没装就不该留下配置
    const cfg = join(dir, 'game', '26.2', 'config', 'CustomSkinLoader', 'CustomSkinLoader.json');
    expect(existsSync(cfg)).toBe(false);
  });
});

/**
 * Mod 启用/禁用走 `.disabled` 旁路。
 *
 * 为什么不真删 jar：Fabric / NeoForge 只扫 `.jar`，改后缀等于重新下载，
 * 而「临时关掉一个 mod」是高频操作。这里锁住「只加/删标记文件、不动本体」。
 */
describe('LauncherService Mod 开关（.disabled 旁路）', () => {
  let dir: string;
  let service: LauncherService;

  const JAR_URL = 'https://cdn.modrinth.com/data/x/my_mod.jar';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-launcher-toggle-'));
    service = new LauncherService(
      dir,
      makeFetch(MANIFEST, VERSION_JSON) as unknown as typeof fetch,
    );
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('installMod 装完即 toggleMod(false) → enabled=false', async () => {
    await service.installMod('26.2', 'my_mod.jar', JAR_URL);
    await service.toggleMod('26.2', 'my_mod.jar', false);
    const mods = await service.listMods('26.2');
    expect(mods[0]?.enabled).toBe(false);
  });

  it('toggleMod(true) 能重新启用（jar 本体必须还在）', async () => {
    await service.installMod('26.2', 'my_mod.jar', JAR_URL);
    await service.toggleMod('26.2', 'my_mod.jar', false);
    await service.toggleMod('26.2', 'my_mod.jar', true);
    const mods = await service.listMods('26.2');
    expect(mods[0]?.enabled).toBe(true);
    // 关键：旁路开关不能把 jar 删掉 —— 那会让"重新启用"变成重新下载
    expect(existsSync(join(dir, 'game', '26.2', 'mods', 'my_mod.jar'))).toBe(true);
  });

  it('toggleMod 忽略非 .jar 后缀的输入（统一补 .jar 再找本体）', async () => {
    await service.installMod('26.2', 'my_mod.jar', JAR_URL);
    // 少写后缀也不该报"未找到"
    await expect(service.toggleMod('26.2', 'my_mod', false)).resolves.toBeUndefined();
    const mods = await service.listMods('26.2');
    expect(mods[0]?.enabled).toBe(false);
  });

  it('toggleMod 能反映在 Mod 列表状态里（供 UI 刷新）', async () => {
    await service.installMod('26.2', 'a.jar', JAR_URL);
    await service.installMod('26.2', 'b.jar', JAR_URL);
    await service.toggleMod('26.2', 'a.jar', false);
    const mods = await service.listMods('26.2');
    expect(Object.fromEntries(mods.map((m) => [m.name, m.enabled]))).toEqual({
      'a.jar': false,
      'b.jar': true,
    });
  });

  it('listMods 能读出真实 size（不是硬编码占位 0）', async () => {
    await service.installMod('26.2', 'my_mod.jar', JAR_URL);
    const mods = await service.listMods('26.2');
    // mock 的 jar 内容是 'jar-data'（8 字节）
    expect(mods[0]?.size).toBe(8);
    expect(typeof mods[0]?.modifiedAt).toBe('number');
  });
});

/**
 * `resolveInside` 是实例目录浏览（L8）唯一的越界防线。
 * 这组用例专攻各种"看起来在 root 内、其实能读到别处"的构造。
 */
describe('resolveInside 越界防护', () => {
  const root = resolve(join(tmpdir(), 'ri-root'));

  it('正常相对路径放行', () => {
    expect(resolveInside(root, 'saves/world1').replace(/\\/g, '/')).toBe(
      `${root.replace(/\\/g, '/')}/saves/world1`,
    );
  });

  it('拒绝 .. 逃逸', () => {
    expect(() => resolveInside(root, '../../etc/passwd')).toThrow(/越界/);
  });

  it('拒绝绝对路径（Windows 盘符与 POSIX 绝对路径）', () => {
    expect(() => resolveInside(root, 'C:/Windows')).toThrow(/越界/);
    expect(() => resolveInside(root, '/etc/passwd')).toThrow(/越界/);
  });

  it('拒绝 root 本身（p=root 时 rel 为空串）', () => {
    expect(() => resolveInside(root, '')).toThrow(/越界/);
    expect(() => resolveInside(root, '.')).toThrow(/越界/);
  });

  it('拒绝同前缀目录（root=/a/game/x 时 /a/game/xyz 不算在内）', () => {
    // 纯字符串前缀判断最容易漏的一种：startsWith 会把 xyz 放行
    const r = resolve(join(tmpdir(), 'game-x'));
    expect(() => resolveInside(r, join('..', 'game-xyz', 'secret'))).toThrow(/越界/);
  });
});

/** 实例目录浏览（L8）：面包屑下钻 + 真实 size + 越界防护。 */
describe('LauncherService 实例目录浏览（L8）', () => {
  let dir: string;
  let service: LauncherService;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-launcher-l8-'));
    service = new LauncherService(
      dir,
      makeFetch(MANIFEST, VERSION_JSON) as unknown as typeof fetch,
    );
    const g = service.gameDir('26.2');
    mkdirSync(join(g, 'saves', 'world1'), { recursive: true });
    writeFileSync(join(g, 'saves', 'level.dat'), 'x');
    writeFileSync(join(g, 'options.txt'), 'y');
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('列目录：目录与文件分开返回（isDirectory 标志可信）', async () => {
    const items = await service.listInstanceFiles('26.2', '');
    const byName = Object.fromEntries(items.map((i) => [i.name, i.isDirectory]));
    expect(byName['saves']).toBe(true);
    expect(byName['options.txt']).toBe(false);
  });

  it('path 字段可直接用于下钻（相对 gameDir 的正斜杠路径）', async () => {
    const items = await service.listInstanceFiles('26.2', '');
    const saves = items.find((i) => i.name === 'saves');
    expect(saves?.path).toBe('saves');
    const inner = await service.listInstanceFiles('26.2', saves!.path);
    expect(inner.map((i) => i.name).sort()).toEqual(['level.dat', 'world1']);
  });

  it('目录也带真实 size / modifiedAt（UI 要显示体积）', async () => {
    const items = await service.listInstanceFiles('26.2', '');
    const saves = items.find((i) => i.name === 'saves');
    expect(typeof saves?.modifiedAt).toBe('number');
  });

  it('不存在的目录返回空数组而不是抛错（面包屑点过头时不该炸）', async () => {
    expect(await service.listInstanceFiles('26.2', 'nope')).toEqual([]);
  });

  it('路径穿越：祖先目录被拒绝（强断言）', async () => {
    // 注意用 rejects 而不是 toThrow：listInstanceFiles 是 async，
    // resolveInside 抛出的错误走 Promise reject，不是同步 throw。
    await expect(service.listInstanceFiles('26.2', '../../..')).rejects.toThrow(/越界/);
    await expect(service.listInstanceFiles('26.2', '..')).rejects.toThrow(/越界/);
  });

  it('绝对路径同样被拒绝', async () => {
    await expect(service.listInstanceFiles('26.2', resolve(dir, 'elsewhere'))).rejects.toThrow(
      /越界/,
    );
  });

  it('版本目录不存在时返回空数组', async () => {
    expect(await service.listInstanceFiles('不存在的版本', '')).toEqual([]);
  });

  /**
   * `versionId` 本身也是渲染层可控的，比 `relPath` 更危险：
   * `join(base, 'game', versionId, …)` 里的 versionId 一旦带 `../`，
   * **根目录**就被挪到实例目录之外 —— 后面的 `resolveInside` 是相对 root 算的，
   * root 已经跑出去了，它再也拦不住。所以必须在最外层先断言 versionId。
   */
  it('versionId 含路径穿越时被拒（resolveInside 拦不住的那一层）', async () => {
    for (const bad of ['../../..', '..', 'a/b', 'a\\b', '', 'C:/x']) {
      await expect(service.listInstanceFiles(bad, ''), `versionId=${bad} 竟被放行`).rejects.toThrow(
        /非法的版本目录名/,
      );
    }
  });

  it('listMods 忽略 .disabled 标记文件（旁路开关不该虚增 Mod 数量）', async () => {
    // .disabled 是旁路开关的标记文件，不是 Mod 本体。
    // Fabric / NeoForge 只扫 .jar，所以 UI 上「我有几个 mod」也不该把它算进去。
    //
    // 注意目录：Mod 装在 <baseDir>/game/<v>/mods（与 listInstanceFiles 同一个
    // gameDir 下的子目录）—— 2026-10-13 之前是 versions/<v>/mods，游戏扫不到。
    const mods = join(dir, 'game', '26.2', 'mods');
    mkdirSync(mods, { recursive: true });
    writeFileSync(join(mods, 'a.jar'), 'aaaa');
    writeFileSync(join(mods, 'a.jar.disabled'), '');
    writeFileSync(join(mods, 'b.jar'), 'bb');

    const listed = await service.listMods('26.2');
    expect(listed.map((m) => m.name).sort()).toEqual(['a.jar', 'b.jar']);
    // a.jar 因存在同名 .disabled 而处于禁用态 —— 标记被读到了
    expect(Object.fromEntries(listed.map((m) => [m.name, m.enabled]))).toEqual({
      'a.jar': false,
      'b.jar': true,
    });
  });
});
