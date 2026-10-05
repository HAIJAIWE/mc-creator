/**
 * jdk-download.ts 测试（§8.1#1 JDK 自动下载）。
 * 全注入、不触网：fake fetch（Response 直构）+ 注入解压函数；
 * 默认 extractZip 用最小 STORE 法手工拼 zip 字节验证，不依赖任何第三方。
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  adoptiumBinaryUrl,
  currentAdoptiumArch,
  currentAdoptiumOs,
  ensureJdk,
  extractZip,
} from './jdk-download.js';

const dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function mkTmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

function asFetch(fn: (...args: never[]) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch;
}

function neverFetch(): typeof fetch {
  return asFetch(async () => {
    throw new Error('测试不应触发网络请求');
  });
}

/**
 * 最小 STORE 法 zip（无压缩、无依赖）：local 头 + 中央目录 + EOCD。
 * 与 extractZip 的解析逻辑相互独立手写（字段偏移按 zip 规范），可验证生产路径。
 */
function buildStoreZip(files: { name: string; content: string }[]): Buffer {
  const enc = new TextEncoder();
  const chunks: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(enc.encode(f.name));
    const dataBuf = Buffer.from(enc.encode(f.content));
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt32LE(dataBuf.length, 18); // compSize
    local.writeUInt32LE(dataBuf.length, 22); // uncompSize
    local.writeUInt16LE(nameBuf.length, 26); // nameLen
    local.writeUInt16LE(0, 28); // extraLen
    nameBuf.copy(local, 30);
    chunks.push(local, dataBuf);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // STORE
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(central, 46);
    centrals.push(central);
    offset += local.length + dataBuf.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralDir, eocd]);
}

describe('adoptiumBinaryUrl 纯函数（API 出入只改这一个函数）', () => {
  it('拼装形状符合 Adoptium v3 文档', () => {
    expect(adoptiumBinaryUrl(21, 'windows', 'x64')).toBe(
      'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse',
    );
    expect(adoptiumBinaryUrl(17, 'mac', 'aarch64')).toBe(
      'https://api.adoptium.net/v3/binary/latest/17/ga/mac/aarch64/jdk/hotspot/normal/eclipse',
    );
    expect(adoptiumBinaryUrl(8, 'linux', 'x64')).toBe(
      'https://api.adoptium.net/v3/binary/latest/8/ga/linux/x64/jdk/hotspot/normal/eclipse',
    );
  });

  it('非法 os/arch/version 抛中文错', () => {
    expect(() => adoptiumBinaryUrl(21, 'solaris' as never, 'x64')).toThrow(/操作系统参数非法/);
    expect(() => adoptiumBinaryUrl(21, 'windows', 'arm' as never)).toThrow(/架构参数非法/);
    expect(() => adoptiumBinaryUrl(0, 'windows', 'x64')).toThrow(/主版本号非法/);
    expect(() => adoptiumBinaryUrl(Number.NaN, 'windows', 'x64')).toThrow(/主版本号非法/);
  });

  it('process.platform/arch 映射：win32→windows、darwin→mac、arm64→aarch64；非法抛中文错', () => {
    expect(currentAdoptiumOs('win32')).toBe('windows');
    expect(currentAdoptiumOs('darwin')).toBe('mac');
    expect(currentAdoptiumOs('linux')).toBe('linux');
    expect(() => currentAdoptiumOs('freebsd' as NodeJS.Platform)).toThrow(/不支持的操作系统/);
    expect(currentAdoptiumArch('x64')).toBe('x64');
    expect(currentAdoptiumArch('arm64')).toBe('aarch64');
    expect(() => currentAdoptiumArch('ia32')).toThrow(/不支持的 CPU 架构/);
  });
});

describe('extractZip 默认解压（零第三方）', () => {
  it('STORE 包 round-trip：目录层级与字节一致', async () => {
    const dir = await mkTmp('jdk-zip-');
    const zipPath = join(dir, 'a.zip');
    await writeFile(
      zipPath,
      buildStoreZip([
        { name: 'jdk-21/bin/java', content: 'stub-java' },
        { name: 'jdk-21/release', content: 'JAVA_VERSION="21"\n' },
      ]),
    );
    const out = join(dir, 'out');
    await extractZip(zipPath, out);
    expect(await readFile(join(out, 'jdk-21', 'bin', 'java'), 'utf8')).toBe('stub-java');
    expect(await readFile(join(out, 'jdk-21', 'release'), 'utf8')).toBe('JAVA_VERSION="21"\n');
  });

  it('../ 条目被拦截（ZipSlip），且目标目录外无残留', async () => {
    const dir = await mkTmp('jdk-zipslip-');
    const zipPath = join(dir, 'evil.zip');
    await writeFile(zipPath, buildStoreZip([{ name: '../evil.txt', content: 'x' }]));
    await expect(extractZip(zipPath, join(dir, 'out'))).rejects.toThrow(/路径穿越/);
    expect(existsSync(join(dir, 'evil.txt'))).toBe(false);
  });

  it('非 zip 字节报 ZIP_INVALID（未找到 EOCD）', async () => {
    const dir = await mkTmp('jdk-zipbad-');
    const bad = join(dir, 'bad.zip');
    await writeFile(bad, Buffer.from('not a zip at all'));
    await expect(extractZip(bad, join(dir, 'out'))).rejects.toMatchObject({ code: 'ZIP_INVALID' });
  });
});

describe('ensureJdk 缓存与下载（全注入，不断网）', () => {
  it('命中 .ready → source=cache，不触发 fetch', async () => {
    const cacheDir = await mkTmp('jdk-cache-');
    await mkdir(join(cacheDir, '21'), { recursive: true });
    await writeFile(join(cacheDir, '21', '.ready'), 'x');
    const fetchImpl = vi.fn(neverFetch());
    const r = await ensureJdk({ version: 21, cacheDir, fetchImpl });
    expect(r).toMatchObject({ javaHome: join(cacheDir, '21'), source: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('未命中 → 下载→注入解压→写 .ready，tmp 无残留；二次调用走缓存', async () => {
    const cacheDir = await mkTmp('jdk-dl-');
    const zipBytes = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('payload')]);
    const fetchImpl = vi.fn(
      asFetch(async () => new Response(new Uint8Array(zipBytes), { status: 200 })),
    );
    let seenArchive = '';
    const extract = async (archivePath: string, destDir: string): Promise<void> => {
      seenArchive = archivePath;
      await mkdir(destDir, { recursive: true });
      await writeFile(join(destDir, 'bin-java-stub'), 'stub');
    };
    const r = await ensureJdk({
      version: 21,
      cacheDir,
      fetchImpl,
      extract,
      os: 'windows',
      arch: 'x64',
    });
    expect(r.source).toBe('download');
    expect(r.javaHome).toBe(join(cacheDir, '21'));
    // 请求的是 Adoptium v3 地址
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse',
    );
    // 压缩包确实先落 tmp 再交解压层
    expect(seenArchive.endsWith('.part')).toBe(true);
    expect(existsSync(join(r.javaHome, '.ready'))).toBe(true);
    // tmp 已清理
    expect((await readdir(cacheDir)).some((f) => f.endsWith('.part'))).toBe(false);
    // 二次调用走缓存，不再 fetch
    fetchImpl.mockClear();
    const r2 = await ensureJdk({ version: 21, cacheDir, fetchImpl, extract });
    expect(r2).toMatchObject({ source: 'cache' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('生产路径：fake fetch 返回手工 STORE zip，默认 extractZip 真解压', async () => {
    const cacheDir = await mkTmp('jdk-e2e-');
    const zip = buildStoreZip([{ name: 'jdk-21-test/bin/java', content: 'stub' }]);
    const fetchImpl = asFetch(async () => new Response(new Uint8Array(zip), { status: 200 }));
    const r = await ensureJdk({ version: 21, cacheDir, fetchImpl, os: 'windows', arch: 'x64' });
    expect(r.source).toBe('download');
    expect(await readFile(join(r.javaHome, 'jdk-21-test', 'bin', 'java'), 'utf8')).toBe('stub');
  });

  it('HTTP 500 → network 可重试，共 3 次调用后抛', async () => {
    const cacheDir = await mkTmp('jdk-500-');
    const fetchImpl = vi.fn(asFetch(async () => new Response('err', { status: 500 })));
    await expect(
      ensureJdk({
        version: 21,
        cacheDir,
        fetchImpl,
        extract: async () => undefined,
        os: 'windows',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ category: 'network', retryable: true, code: 'HTTP_500' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('HTTP 404 → validation 不可重试，只调 1 次', async () => {
    const cacheDir = await mkTmp('jdk-404-');
    const fetchImpl = vi.fn(asFetch(async () => new Response('nope', { status: 404 })));
    await expect(
      ensureJdk({
        version: 21,
        cacheDir,
        fetchImpl,
        extract: async () => undefined,
        os: 'windows',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ category: 'validation', retryable: false, code: 'HTTP_404' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('网络抛错 → network 可重试，共 3 次', async () => {
    const cacheDir = await mkTmp('jdk-net-');
    const fetchImpl = vi.fn(
      asFetch(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(
      ensureJdk({
        version: 21,
        cacheDir,
        fetchImpl,
        extract: async () => undefined,
        os: 'windows',
        arch: 'x64',
      }),
    ).rejects.toMatchObject({ category: 'network', retryable: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('gzip 魔数 → 明确报 tar.gz 不支持，且不调用解压层', async () => {
    const cacheDir = await mkTmp('jdk-gz-');
    const gz = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]);
    const fetchImpl = asFetch(async () => new Response(gz, { status: 200 }));
    const extract = vi.fn(async (_a: string, _d: string): Promise<void> => undefined);
    await expect(
      ensureJdk({ version: 21, cacheDir, fetchImpl, extract, os: 'linux', arch: 'x64' }),
    ).rejects.toThrow(/tar\.gz/);
    expect(extract).not.toHaveBeenCalled();
  });

  it('非法 version/cacheDir 直接抛 validation，不触网', async () => {
    const cacheDir = await mkTmp('jdk-arg-');
    const fetchImpl = vi.fn(neverFetch());
    await expect(ensureJdk({ version: 0, cacheDir, fetchImpl })).rejects.toThrow(/主版本号非法/);
    await expect(ensureJdk({ version: 21, cacheDir: '   ', fetchImpl })).rejects.toThrow(
      /缓存目录/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
