// @vitest-environment node
/**
 * 下载源候选列表（对标 PCL `ModMinecraft.vb` L2154-2173）。
 *
 * 这组用例守的是**信任边界**，不只是"能不能下下来"：
 * 镜像是第三方服务器，用户有权知道当前连的是谁，也有权决定优先级。
 * （默认国内镜像优先的理由、以及信任问题怎么兜，见 `download-sources.ts`
 * 里 `SourcePreference` 的注释。）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  MCIM_LABEL,
  MIRROR_ORIGIN,
  OFFICIAL_MANIFEST,
  SourcePreferenceStore,
  expandDownloadCandidates,
  makeCandidateFetch,
  manifestCandidates,
} from './download-sources.js';

describe('expandDownloadCandidates · 候选展开', () => {
  const MAVEN_URL =
    'https://libraries.minecraft.net/maven/net/minecraft/server/1.21/server-1.21.jar';

  it('官方优先：官方在前，镜像在后', () => {
    const c = expandDownloadCandidates(MAVEN_URL, { preferOfficial: true });
    expect(c.map((x) => x.label)).toEqual(['官方源', 'BMCLAPI 镜像']);
  });

  it('切到镜像优先：镜像在前，但**官方仍在候选里**', () => {
    const c = expandDownloadCandidates(MAVEN_URL, { preferOfficial: false });
    expect(c[0]?.official).toBe(false);
    expect(
      c.some((x) => x.official),
      '切到镜像优先后把官方源丢了',
    ).toBe(true);
  });

  it('**原始 URL 永远在候选里**（镜像是补充不是替换）', () => {
    for (const preferOfficial of [true, false]) {
      const c = expandDownloadCandidates(MAVEN_URL, { preferOfficial });
      expect(
        c.some((x) => x.url === MAVEN_URL),
        `preferOfficial=${preferOfficial} 时原始 URL 消失了`,
      ).toBe(true);
    }
  });

  it('非 maven 系 URL 不产生镜像候选（不是所有源都有镜像）', () => {
    const c = expandDownloadCandidates('https://piston-data.mojang.com/abc/client.jar', {
      preferOfficial: true,
    });
    expect(c).toHaveLength(1);
    expect(c[0]?.url).toBe('https://piston-data.mojang.com/abc/client.jar');
  });

  it('Mojang 锁定的路径不参与替换（/v1/objects、client.txt、.tsrg）', () => {
    for (const url of [
      'https://launcher.mojang.com/v1/objects/aa/bb/cc.txt',
      'https://launcher.mojang.com/client.txt',
      'https://s3.amazonaws.com/Minecraft.Download/versions/1.21/mappings/1.21.tsrg',
    ]) {
      expect(
        expandDownloadCandidates(url, { preferOfficial: true }),
        `${url} 不该被替换`,
      ).toHaveLength(1);
    }
  });

  it('镜像 URL 指向 BMCLAPI 且保留了 maven 之后的路径', () => {
    const c = expandDownloadCandidates(MAVEN_URL, { preferOfficial: false });
    const mirror = c[0]!;
    expect(mirror.url.startsWith(MIRROR_ORIGIN)).toBe(true);
    expect(mirror.url).toContain('/net/minecraft/server/1.21/server-1.21.jar');
  });

  it('每个候选都带 label —— 用户得知道当前连的是谁', () => {
    for (const x of expandDownloadCandidates(MAVEN_URL, { preferOfficial: false })) {
      expect(typeof x.label, '候选缺 label').toBe('string');
      expect(x.label.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Mod / 整合包这一系的镜像（MCIM，PCL 同款，见 core `sources/mirror.ts`）。
 *
 * 与 BMCLAPI 是**两套映射**，但共用同一个 `preferOfficial` 开关 ——
 * 让人为了"下得快"跑两个地方各切一次是糟糕的 UI。
 */
describe('expandDownloadCandidates · Mod 内容走 MCIM（国内镜像）', () => {
  const MODRINTH_CDN =
    'https://cdn.modrinth.com/data/AANobbMI/versions/ygf8cVZg/sodium-fabric-0.5.11%2Bmc1.20.1.jar';
  const CF_CDN = 'https://edge.forgecdn.net/files/9206/523/jei-26.3-neoforge-31.13.0.71.jar';

  it.each([MODRINTH_CDN, CF_CDN])('%s 有 MCIM 候选，路径原样保留', (url) => {
    const c = expandDownloadCandidates(url, { preferOfficial: true });
    expect(c).toHaveLength(2);
    expect(c[1]?.url.startsWith('https://mod.mcimirror.top/')).toBe(true);
    expect(c[1]?.label).toBe(MCIM_LABEL);
    // CDN 文件是**只换主机**：路径（含 `%2B` 这种转义）必须逐字保留
    expect(new URL(c[1]!.url).pathname).toBe(new URL(url).pathname);
    // 原 URL 永不丢
    expect(c[0]?.url).toBe(url);
  });

  it('API 地址要**多一段** `/modrinth`（镜像是挂子路径的，不是换主机）', () => {
    const c = expandDownloadCandidates('https://api.modrinth.com/v2/project/sodium', {
      preferOfficial: true,
    });
    expect(c[1]?.url).toBe('https://mod.mcimirror.top/modrinth/v2/project/sodium');
  });

  it('默认参数就是国内镜像优先（不传偏好时镜像在前）', () => {
    const c = expandDownloadCandidates(MODRINTH_CDN);
    expect(c[0]?.official).toBe(false);
    expect(c[0]?.url).toContain('mod.mcimirror.top');
    expect(c.some((x) => x.official)).toBe(true);
  });

  it('镜像候选指向 MCIM 而不是 BMCLAPI（两套映射不能串）', () => {
    const c = expandDownloadCandidates(CF_CDN, { preferOfficial: false });
    expect(c[0]!.url.startsWith(MIRROR_ORIGIN)).toBe(false);
    expect(c[0]!.url).toBe(
      'https://mod.mcimirror.top/files/9206/523/jei-26.3-neoforge-31.13.0.71.jar',
    );
  });

  it('Modrinth CDN 的文件名里 `+` 是 %2B：换前缀不能把它解成空格', () => {
    const c = expandDownloadCandidates(MODRINTH_CDN, { preferOfficial: false });
    expect(c[0]!.url.endsWith('/sodium-fabric-0.5.11%2Bmc1.20.1.jar')).toBe(true);
  });

  it('MC百科 / 皮肤站 / Mojang 认证这些**不托管 mod 文件**的站不参与镜像', () => {
    for (const url of [
      'https://www.mcmod.cn/class/1.html',
      'https://littleskin.cn/api/yggdrasil',
      'https://api.mineskin.org/generate/url',
      'https://piston-data.mojang.com/v1/objects/aa/bb/client.jar',
    ]) {
      expect(expandDownloadCandidates(url, { preferOfficial: false }), url).toHaveLength(1);
    }
  });
});

describe('manifestCandidates · 版本清单的候选', () => {
  it('官方优先时，piston-meta 在前，launchermeta 作为同家的备用入口', () => {
    const c = manifestCandidates({ preferOfficial: true });
    expect(c[0]?.url).toContain('piston-meta');
    expect(c.some((x) => x.url === OFFICIAL_MANIFEST)).toBe(true);
  });

  it('镜像优先时 BMCLAPI 排最前，但 piston-meta 仍在列表里', () => {
    const c = manifestCandidates({ preferOfficial: false });
    expect(c[0]?.official).toBe(false);
    expect(c.some((x) => x.url.includes('piston-meta'))).toBe(true);
  });
});

describe('SourcePreferenceStore · 偏好持久化', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dl-src-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('文件不存在 → 默认国内镜像优先（中文市场启动器；官方仍是兜底候选）', () => {
    expect(new SourcePreferenceStore(dir).read()).toEqual({ preferOfficial: false });
  });

  it('写入后能读回', () => {
    const s = new SourcePreferenceStore(dir);
    s.write({ preferOfficial: false });
    expect(new SourcePreferenceStore(dir).read()).toEqual({ preferOfficial: false });
  });

  it('损坏的 JSON → 回落默认值，不抛', () => {
    writeFileSync(join(dir, 'download-source.json'), '{ not json', 'utf-8');
    expect(new SourcePreferenceStore(dir).read()).toEqual({ preferOfficial: false });
  });

  it('类型不对的值（字符串 "false"）也当默认 —— 别让脏数据改掉信任模型', () => {
    writeFileSync(
      join(dir, 'download-source.json'),
      JSON.stringify({ preferOfficial: 'false' }),
      'utf-8',
    );
    expect(new SourcePreferenceStore(dir).read()).toEqual({ preferOfficial: false });
  });

  it('落盘内容是人可读的 JSON（出事时用户能自己改回来）', () => {
    new SourcePreferenceStore(dir).write({ preferOfficial: true });
    const raw = readFileSync(join(dir, 'download-source.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ preferOfficial: true });
  });

  it('read 有缓存：write 之后立刻 read 能看到新值', () => {
    const s = new SourcePreferenceStore(dir);
    expect(s.read().preferOfficial).toBe(false);
    s.write({ preferOfficial: true });
    expect(s.read().preferOfficial, 'write 没同步缓存，read 仍返回旧值').toBe(true);
  });
});

/**
 * `makeCandidateFetch` —— 「按候选源依次尝试」这一步**线上真的在跑**的那份实现。
 *
 * 起因是一次实测事故（2026-10-18）：装 Fabulously Optimized 26.3（49 个文件）时
 * 镜像偶发 **502**，一次安装丢了 7 个 mod，界面如实报「下载失败: HTTP 502」；
 * 而同一批 URL 一分钟后再取**全部 200**。502 是服务端一时抽风，不是"文件不存在"，
 * 一次抖动不该变成用户少一个 mod（整合包少 mod 常常表现为进游戏就崩）。
 */
describe('makeCandidateFetch · 5xx 不该让一次抖动变成少一个 mod', () => {
  const CDN =
    'https://cdn.modrinth.com/data/5ZwdcRci/versions/3MP9UR23/ImmediatelyFast-Fabric-1.17.1%2B26.3.jar';
  const MIRROR_HOST = 'mod.mcimirror.top';

  /** 记录调用顺序的替身 fetch；responder 决定每次返回什么（Error = 抛网络异常）。 */
  function stub(responder: (url: string, call: number) => Response | Error): {
    tried: string[];
    fetchImpl: typeof fetch;
  } {
    const tried: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      tried.push(url);
      const out = responder(url, tried.length);
      if (out instanceof Error) throw out;
      return out;
    }) as typeof fetch;
    return { tried, fetchImpl };
  }

  const noSleep = async (): Promise<void> => {};
  const ok = (): Response => new Response('jar', { status: 200 });
  const status = (code: number): Response => new Response('err', { status: code });
  const build = (fetchImpl: typeof fetch, preferOfficial = false): typeof fetch =>
    makeCandidateFetch({ readPreference: () => ({ preferOfficial }), fetchImpl, sleep: noSleep });

  it('镜像 502 → 落回官方源并拿到 200（就是实测丢文件的那个场景）', async () => {
    const { tried, fetchImpl } = stub((url) => (url.includes(MIRROR_HOST) ? status(502) : ok()));
    const res = await build(fetchImpl)(CDN);
    expect(res.status).toBe(200);
    expect(tried[0]).toContain(MIRROR_HOST);
    expect(tried[tried.length - 1]).toBe(CDN);
  });

  it('同一个候选的 502 会先重试（瞬时抽风再试一次就好）', async () => {
    let mirrorCalls = 0;
    const { fetchImpl } = stub((url) => {
      if (!url.includes(MIRROR_HOST)) return ok();
      mirrorCalls += 1;
      return status(502);
    });
    await build(fetchImpl)(CDN);
    expect(mirrorCalls).toBe(2);
  });

  it('403 / 404 不重试，直接换下一个候选（确定性失败重试没意义）', async () => {
    for (const code of [403, 404]) {
      const { tried, fetchImpl } = stub((url) => (url.includes(MIRROR_HOST) ? status(code) : ok()));
      const res = await build(fetchImpl)(CDN);
      expect(res.status, `HTTP ${code} 时没换到官方源`).toBe(200);
      expect(tried.filter((u) => u.includes(MIRROR_HOST))).toHaveLength(1);
    }
  });

  it('401 这类别的 4xx：原样返回，不重试也不换源（不是"再试一次"能解决的）', async () => {
    const { tried, fetchImpl } = stub(() => status(401));
    const res = await build(fetchImpl)(CDN);
    expect(res.status).toBe(401);
    expect(tried).toHaveLength(1);
  });

  it('网络异常（fetch 抛）也换下一个候选', async () => {
    const { tried, fetchImpl } = stub((url) =>
      url.includes(MIRROR_HOST) ? new Error('fetch failed') : ok(),
    );
    const res = await build(fetchImpl)(CDN);
    expect(res.status).toBe(200);
    // 镜像两次（重试）+ 官方一次
    expect(tried).toHaveLength(3);
  });

  it('取消：不重试、不换源（AbortError 不是网络抖动）', async () => {
    const ac = new AbortController();
    const { tried, fetchImpl } = stub(() => new DOMException('Aborted', 'AbortError'));
    const cf = build(fetchImpl);

    ac.abort();
    await expect(cf(CDN, { signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' });
    // 已经取消：连第一次请求都不该发
    expect(tried).toHaveLength(0);
  });

  it('请求发出后才取消：立刻停，不因 502 再重试', async () => {
    const ac = new AbortController();
    const { tried, fetchImpl } = stub(() => {
      ac.abort();
      return status(502);
    });

    await expect(build(fetchImpl)(CDN, { signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(tried).toHaveLength(1);
  });

  it('所有候选都不成 → 返回**最后一个非 2xx 响应**，调用方还读得到状态码', async () => {
    const { tried, fetchImpl } = stub(() => status(502));
    const res = await build(fetchImpl)(CDN);
    expect(res.status).toBe(502);
    // 2 个候选 × 各 2 次
    expect(tried).toHaveLength(4);
  });

  it('偏好**每次调用**重读：设置里刚切完源，下一次下载就换顺序', async () => {
    let preferOfficial = false;
    const { tried, fetchImpl } = stub(() => ok());
    const cf = makeCandidateFetch({
      readPreference: () => ({ preferOfficial }),
      fetchImpl,
      sleep: noSleep,
    });
    await cf(CDN);
    expect(tried[0]).toContain(MIRROR_HOST);
    tried.length = 0;
    preferOfficial = true;
    await cf(CDN);
    expect(tried[0]).toBe(CDN);
  });

  it('没有镜像候选的地址（Mojang 直链）只试它自己，不无中生有一个镜像', async () => {
    const plain = 'https://piston-data.mojang.com/v1/objects/aa/bb/client.jar';
    const { tried, fetchImpl } = stub(() => ok());
    await build(fetchImpl)(plain);
    expect(tried).toEqual([plain]);
  });
});
