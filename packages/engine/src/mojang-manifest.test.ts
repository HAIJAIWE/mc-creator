/**
 * Mojang 版本清单运行时拉取测试（backlog T1a）。
 * 全自包含：fetch 全部注入 mock，缓存用临时目录；不断网、不碰真实 Mojang。
 */
import { mkdtemp, readdir, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { fetchVersionManifest, type FetchVersionManifestOptions } from './mojang-manifest.js';

type FetchImpl = NonNullable<FetchVersionManifestOptions['fetchImpl']>;

const FALLBACK_IDS = ['1.20.1', '1.19.4'];

const MANIFEST = {
  latest: { release: '1.21', snapshot: '24w01a' },
  versions: [
    {
      id: '1.21',
      type: 'release',
      url: 'https://example.com/1.21.json',
      releaseTime: '2024-06-13T00:00:00Z',
    },
    {
      id: '24w01a',
      type: 'snapshot',
      url: 'https://example.com/24w01a.json',
      releaseTime: '2024-01-03T00:00:00Z',
    },
    {
      id: 'b1.7.3',
      type: 'old_beta',
      url: 'https://example.com/b1.7.3.json',
      releaseTime: '2011-07-08T00:00:00Z',
    },
  ],
};
const MANIFEST_TEXT = JSON.stringify(MANIFEST);

let dir = '';
let cachePath = '';

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mc-manifest-test-'));
  cachePath = join(dir, 'version_manifest.json');
});

function okFetch(text: string = MANIFEST_TEXT, counter?: { n: number }): FetchImpl {
  return (async () => {
    if (counter) counter.n += 1;
    return new Response(text, { status: 200 });
  }) as FetchImpl;
}

async function seedCache(text: string, mtimeMs: number): Promise<void> {
  await writeFile(cachePath, text, 'utf8');
  await utimes(cachePath, mtimeMs / 1000, mtimeMs / 1000);
}

async function cacheFiles(): Promise<string[]> {
  return readdir(dir);
}

describe('fetchVersionManifest', () => {
  it('网络成功：source=network，ids/entries/latestRelease 完整，并写缓存', async () => {
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: okFetch(),
    });
    expect(r.source).toBe('network');
    expect(r.ids).toEqual(['1.21', '24w01a', 'b1.7.3']);
    expect(r.entries).toEqual([
      { id: '1.21', type: 'release' },
      { id: '24w01a', type: 'snapshot' },
      { id: 'b1.7.3', type: 'old_beta' },
    ]);
    expect(r.latestRelease).toBe('1.21');
    // 缓存已原子落盘且内容可解析
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual(MANIFEST);
  });

  it('缓存有效期内直接读缓存：不发起网络请求', async () => {
    await fetchVersionManifest({ cachePath, fallbackIds: FALLBACK_IDS, fetchImpl: okFetch() });
    let calls = 0;
    const boom: FetchImpl = (async () => {
      calls += 1;
      throw new Error('must not fetch');
    }) as FetchImpl;
    const r = await fetchVersionManifest({ cachePath, fallbackIds: FALLBACK_IDS, fetchImpl: boom });
    expect(r.source).toBe('cache');
    expect(r.ids).toEqual(['1.21', '24w01a', 'b1.7.3']);
    expect(r.latestRelease).toBe('1.21');
    expect(calls).toBe(0);
  });

  it('500 仅重试可重试状态：耗尽后读过期缓存（source=cache）', async () => {
    await seedCache(MANIFEST_TEXT, Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 天前 → 过期
    const counter = { n: 0 };
    const always500: FetchImpl = (async () => {
      counter.n += 1;
      return new Response('boom', { status: 500 });
    }) as FetchImpl;
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: always500,
      retries: 1,
    });
    expect(r.source).toBe('cache');
    expect(r.ids).toEqual(['1.21', '24w01a', 'b1.7.3']);
    expect(counter.n).toBe(2); // 1 首次 + 1 重试
  });

  it('超时走 fallback：无缓存时 source=fallback，ids 为调用方传入的 fallbackIds', async () => {
    const timeout: FetchImpl = (async () => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    }) as FetchImpl;
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: timeout,
      retries: 0,
    });
    expect(r.source).toBe('fallback');
    expect(r.ids).toEqual(FALLBACK_IDS);
    expect(r.latestRelease).toBe('1.20.1');
  });

  it('坏 JSON（200 但解析失败）走 fallback', async () => {
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: okFetch('not-json{{{'),
      retries: 0,
    });
    expect(r.source).toBe('fallback');
    expect(r.ids).toEqual(FALLBACK_IDS);
  });

  it('200 但形状非法（versions 缺失）时降级读过期缓存', async () => {
    await seedCache(MANIFEST_TEXT, Date.now() - 2 * 24 * 60 * 60 * 1000);
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: okFetch(JSON.stringify({ latest: {}, versions: [{ noId: true }] })),
      retries: 0,
    });
    expect(r.source).toBe('cache');
    expect(r.ids).toEqual(['1.21', '24w01a', 'b1.7.3']);
  });

  it('缓存损坏 + 网络失败 → fallback', async () => {
    await writeFile(cachePath, 'garbage{{{', 'utf8');
    const down: FetchImpl = (async () => {
      throw new Error('network down');
    }) as FetchImpl;
    const r = await fetchVersionManifest({
      cachePath,
      fallbackIds: FALLBACK_IDS,
      fetchImpl: down,
      retries: 0,
    });
    expect(r.source).toBe('fallback');
    expect(r.ids).toEqual(FALLBACK_IDS);
  });

  it('无 cachePath 时网络失败直接 fallback，不抛异常', async () => {
    const down: FetchImpl = (async () => {
      throw new Error('network down');
    }) as FetchImpl;
    const r = await fetchVersionManifest({
      fallbackIds: FALLBACK_IDS,
      fetchImpl: down,
      retries: 0,
    });
    expect(r.source).toBe('fallback');
    expect(r.ids).toEqual(FALLBACK_IDS);
  });

  it('不遗留 *.tmp 临时文件', async () => {
    await fetchVersionManifest({ cachePath, fallbackIds: FALLBACK_IDS, fetchImpl: okFetch() });
    const files = await cacheFiles();
    expect(files).toEqual(['version_manifest.json']);
    await expect(stat(join(dir, 'version_manifest.json.tmp'))).rejects.toThrow();
  });
});
