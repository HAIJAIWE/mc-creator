// @vitest-environment node
/**
 * 服务端下载（对标 PCL 版本行上的「下载服务端」按钮）。
 *
 * 三件容易做错的事，各有用例：
 *  1. 远古版**没有** `downloads.server` —— 必须明确报错，不能静默跳过
 *  2. 落点必须是 `versions/<id>/<id>-server.jar`，与 PCL 同构
 *  3. jar 形态（bundler / 独立包）必须**实测** jar 头部得出，
 *     不能按版本号或 javaMajor 猜 —— 1.18 要求 Java 17，不是 18
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { LauncherService, detectServerJarKind, type VersionDetail } from './launcher-service.js';

/** 造一个 zip 的本地文件头（只到文件名，不填数据）。 */
function localHeader(name: string, compSize = 0): Buffer {
  const nameBuf = Buffer.from(name, 'utf-8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); // 签名
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0, 6); // flags
  h.writeUInt16LE(0, 8); // method = stored
  h.writeUInt32LE(compSize, 18);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28); // extra len
  return Buffer.concat([h, nameBuf]);
}

/** 独立包：根目录直接是混淆后的 a.class / aa.class…（实测 1.17.1） */
function standaloneJar(): Buffer {
  const parts: Buffer[] = [localHeader('META-INF/'), localHeader('META-INF/MANIFEST.MF')];
  for (const n of ['a.class', 'aa.class', 'aaa.class']) {
    parts.push(localHeader(n, 4));
    parts.push(Buffer.alloc(4));
  }
  return Buffer.concat(parts);
}

/** bundler：META-INF + net/minecraft/bundler/Main.class + 根 version.json（实测 1.18.2+） */
function bundlerJar(): Buffer {
  const parts: Buffer[] = [
    localHeader('META-INF/'),
    localHeader('META-INF/MANIFEST.MF'),
    localHeader('net/'),
    localHeader('net/minecraft/'),
    localHeader('net/minecraft/bundler/'),
    localHeader('net/minecraft/bundler/Main.class', 8),
    Buffer.alloc(8),
    localHeader('version.json', 4),
    Buffer.alloc(4),
  ];
  return Buffer.concat(parts);
}

describe('detectServerJarKind · 服务端 jar 形态靠实测而不是猜', () => {
  it('独立包（根目录是 a.class）→ standalone', () => {
    expect(detectServerJarKind(standaloneJar())).toBe('standalone');
  });

  it('bundler（net/minecraft/bundler/ + 根 version.json）→ bundler', () => {
    expect(detectServerJarKind(bundlerJar())).toBe('bundler');
  });

  it('version.json 在第 10 个条目也要认出来（1.18.2 就是这个位置）', () => {
    const parts: Buffer[] = [];
    for (let i = 0; i < 9; i++) parts.push(localHeader(`filler-${i}.class`, 0));
    parts.push(localHeader('version.json', 0));
    expect(detectServerJarKind(Buffer.concat(parts))).toBe('bundler');
  });

  it('认不出来就返回 unknown，不硬猜', () => {
    // 完全不是 zip（404 的 HTML 页面被当成 jar 落盘）
    expect(detectServerJarKind(Buffer.from('<html>404 Not Found</html>'))).toBe('unknown');
    // 空
    expect(detectServerJarKind(Buffer.alloc(0))).toBe('unknown');
    // 头部被截断：本地文件头本身完整，但文件名长度说 200、实际缓冲区不够
    const trunc = Buffer.alloc(30);
    trunc.writeUInt32LE(0x04034b50, 0);
    trunc.writeUInt16LE(200, 26);
    expect(detectServerJarKind(trunc)).toBe('unknown');
  });

  it('开头就是中央目录（不是 jar 的开头）→ unknown，不是 standalone', () => {
    // 真实独立包的第一个条目总是 `META-INF/`；以中央目录开头说明这段数据
    // 不是 jar 的头，判成 standalone 是在编故事。
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    expect(detectServerJarKind(cd)).toBe('unknown');
  });

  it('真实 jar 那样带中央目录结束记录也能收口，不死循环', () => {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    expect(detectServerJarKind(eocd)).toBe('unknown');
  });
});

describe('downloadServer · 服务端下载', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'srv-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const JAR = bundlerJar();

  function detail(over: Partial<VersionDetail> = {}): VersionDetail {
    return {
      id: '26.3',
      assets: '26',
      assetsUrl: '',
      clientUrl: '',
      libraryUrls: [],
      javaMajor: 21,
      clientSha1: null,
      clientSize: null,
      serverUrl: 'https://example.invalid/server.jar',
      serverSha1: createHash('sha1').update(JAR).digest('hex'),
      serverSize: JAR.length,
      ...over,
    };
  }

  function service(body?: () => Buffer): LauncherService {
    return new LauncherService(dir, (async () => {
      const b = body ? body() : JAR;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);
  }

  it('落在 versions/<id>/<id>-server.jar，与 PCL 的 VersionFolder & Id & "-server.jar" 同构', async () => {
    const r = await service().downloadServer(detail());
    expect(r.path).toBe(join(dir, 'versions', '26.3', '26.3-server.jar'));
    expect(existsSync(r.path)).toBe(true);
    // 内容逐字节一致
    expect(readFileSync(r.path).equals(JAR)).toBe(true);
  });

  it('返回实测出的形态（bundler），不是按版本号推的', async () => {
    const r = await service().downloadServer(detail());
    expect(r.kind).toBe('bundler');
  });

  it('独立包形态也能测出来', async () => {
    const body = standaloneJar();
    const svc = service(() => body);
    const r = await svc.downloadServer(
      detail({
        serverSha1: createHash('sha1').update(body).digest('hex'),
        serverSize: body.length,
      }),
    );
    expect(r.kind).toBe('standalone');
  });

  it('远古版没有服务端时**明确报错**，不静默跳过、不写空文件', async () => {
    const svc = service();
    await expect(svc.downloadServer(detail({ serverUrl: null }))).rejects.toThrow(
      /Mojang 没有给 Minecraft 26.3 提供官方服务端下载/,
    );
    expect(existsSync(join(dir, 'versions'))).toBe(false);
  });

  it('sha1 不符 → 不落盘（坏文件比缺文件更糟）', async () => {
    const svc = service();
    await expect(svc.downloadServer(detail({ serverSha1: 'deadbeef' }))).rejects.toThrow();
    expect(existsSync(join(dir, 'versions', '26.3', '26.3-server.jar'))).toBe(false);
  });

  it('size 不符 → 不落盘', async () => {
    const svc = service();
    await expect(svc.downloadServer(detail({ serverSize: 999999 }))).rejects.toThrow();
    expect(existsSync(join(dir, 'versions', '26.3', '26.3-server.jar'))).toBe(false);
  });

  it('已下载过就跳过，但仍会实测形态（展示给用户的信息不该靠猜）', async () => {
    const svc = service();
    const first = await svc.downloadServer(detail());
    expect(first.kind).toBe('bundler');

    // 换一个"会炸"的 fetch 再调一次：不该真的去下载
    const svc2 = new LauncherService(dir, (async () => {
      throw new Error('不该再下载');
    }) as unknown as typeof fetch);
    const second = await svc2.downloadServer(detail());
    expect(second.path).toBe(first.path);
    expect(second.kind, '跳过下载时也要给出形态').toBe('bundler');
  });

  it('version 带路径穿越 → 直接被拒，不碰磁盘', async () => {
    const svc = service();
    await expect(svc.downloadServer(detail({ id: '../../..' }))).rejects.toThrow(
      /非法的版本目录名/,
    );
  });

  it('进度事件：server 阶段从 0 到 1', async () => {
    const seen: [string, number, number][] = [];
    await service().downloadServer(detail(), (s, d, t) => seen.push([s, d, t]));
    expect(seen[0]).toEqual(['server', 0, 1]);
    expect(seen[seen.length - 1]).toEqual(['server', 1, 1]);
  });

  it('进度：校验失败时**不**上报 1/1 —— 进度条不许假装成功', async () => {
    /**
     * 必须用**另一个空目录**：上一条已经把 jar 落盘了，而 `downloadServer`
     * 与 `downloadClient` 一样是"已存在就跳过"，那就会直接返回、
     * 根本不下载，坏 sha1 也就永远没被检查过。
     * 首版就踩了这个 —— 断言看着在测校验失败，实际测的是"文件已存在"。
     */
    const fresh = mkdtempSync(join(tmpdir(), 'srv-fail-'));
    try {
      const seen: [string, number, number][] = [];
      await service2(fresh)
        .downloadServer(detail({ serverSha1: 'bad' }), (s, d, t) => seen.push([s, d, t]))
        .catch(() => undefined);
      expect(seen[0], '失败路径也要先发 0/1，让进度条动起来').toEqual(['server', 0, 1]);
      expect(
        seen.some(([, d]) => d === 1),
        '校验失败却上报了 1/1 —— 界面会显示"下载完成"',
      ).toBe(false);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  function service2(base: string): LauncherService {
    return new LauncherService(base, (async () => {
      const b = JAR;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);
  }
});
