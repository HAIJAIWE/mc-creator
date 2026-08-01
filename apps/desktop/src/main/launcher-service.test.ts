import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LauncherService, type GameVersionEntry } from './launcher-service.js';

/**
 * launcher-service 测试：mock fetch 返回固定 manifest/version json，
 * 验证版本解析、libraries 提取、client/assets/libraries 下载与启动命令。
 */

// 构造 fake fetch：按 URL 返回对应内容
function makeFetch(manifest: unknown, versionJson: unknown) {
  const manifestBuf = Buffer.from(JSON.stringify(manifest));
  const versionBuf = Buffer.from(JSON.stringify(versionJson));
  return async (url: string) => {
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

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-launcher-test-'));
    service = new LauncherService(
      dir,
      makeFetch(MANIFEST, VERSION_JSON) as unknown as typeof fetch,
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('listVersions 只返回 release 且最新在前', async () => {
    const versions: GameVersionEntry[] = await service.listVersions();
    expect(versions.map((v) => v.id)).toEqual(['26.2', '1.21.11']);
    expect(versions[0].releaseTime).toBe('2026-06-16T00:00:00Z');
  });

  it('resolveVersion 提取 client/assets/libraries', async () => {
    const detail = await service.resolveVersion('26.2');
    expect(detail.id).toBe('26.2');
    expect(detail.assets).toBe('26');
    expect(detail.clientUrl).toContain('client.jar');
    expect(detail.libraryUrls).toHaveLength(3); // 2 artifact + 1 natives classifier
    expect(detail.libraryUrls[0]).toContain('commons-1.0.jar');
  });

  it('downloadClient 写入 jar 且幂等', async () => {
    const detail = await service.resolveVersion('26.2');
    const p1 = await service.downloadClient(detail);
    const p2 = await service.downloadClient(detail);
    expect(p1).toBe(p2);
    // 跨平台：路径以 versions/<id>/<id>.jar 结尾
    expect(p1.replace(/\\/g, '/')).toContain('versions/26.2/26.2.jar');
  });

  it('downloadAssets 下载索引与资源', async () => {
    // 覆写 fetch 支持 index json
    const indexData = { objects: { 'sound/ding.ogg': { hash: 'aabbcc', size: 9 } } };
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
    const asset = join(dir, 'assets', 'objects', 'aa', 'aabbcc');
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
