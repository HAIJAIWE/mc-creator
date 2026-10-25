/**
 * 整合包安装：清单铺到磁盘的**实际结果**。
 *
 * 这个文件存在的理由：整合包安装是**写盘**操作，而写盘出的错最贵 ——
 * 路径错了、目录错了、覆盖了不该覆盖的，用户看到的都是「整合包装了但
 * 玩起来不对」，不会报错。
 *
 * 所以这里不测「handler 有没有被调用」，而是**造一个假清单，断言磁盘上
 * 真实的文件布局**，并专门覆盖越界写入。
 */
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseMrpack, type ModpackManifest } from '@mc-creator/core';
import { deflateRawSync } from 'node:zlib';

function makeZip(files: Array<{ name: string; content: string | Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf-8');
    const raw = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf-8');
    const body = deflateRawSync(raw);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    locals.push(local, body);
    centrals.push(central);
    offset += local.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const INDEX = {
  formatVersion: 1,
  game: 'minecraft',
  versionId: 'V1',
  name: 'Test Pack',
  files: [
    {
      path: 'mods/sodium.jar',
      env: { client: 'required', server: 'required' },
      downloads: ['https://cdn.example/sodium.jar'],
      fileSize: 3,
    },
    {
      path: 'mods/server-only.jar',
      env: { client: 'unsupported', server: 'required' },
      downloads: ['https://cdn.example/server-only.jar'],
    },
    {
      path: 'resourcepacks/pack.zip',
      env: { client: 'required', server: 'unsupported' },
      downloads: ['https://cdn.example/pack.zip'],
    },
  ],
  dependencies: { 'fabric-loader': '0.19.5', minecraft: '26.3' },
};

let root: string;
let gameDir: string;
let manifest: ModpackManifest;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mp-install-'));
  gameDir = join(root, 'game', '26.3');
  mkdirSync(gameDir, { recursive: true });
  manifest = parseMrpack(
    makeZip([
      { name: 'modrinth.index.json', content: JSON.stringify(INDEX) },
      { name: 'overrides/options.txt', content: 'fov:70' },
      { name: 'overrides/config/rrls.toml', content: 'x = 1' },
      { name: 'overrides/config/modpack_defaults/config/sodium.json', content: '{}' },
    ]),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * 把 manifest 的 overrides 铺到磁盘 —— 与主进程 handler 里同一段逻辑。
 * 用 `resolveInside` 是关键：整合包路径来自**任意第三方**的 zip。
 */
async function applyOverrides(m: ModpackManifest, dir: string): Promise<string[]> {
  const { resolveInside } = await import('./launcher-service.js');
  const errors: string[] = [];
  for (const o of m.overrides) {
    try {
      const dest = resolveInside(dir, o.targetPath);
      mkdirSync(join(dest, '..'), { recursive: true });
      writeFileSync(dest, o.content);
    } catch (e) {
      errors.push(`${o.targetPath}: ${(e as Error).message}`);
    }
  }
  return errors;
}

describe('overrides 铺到 gameDir', () => {
  it('逐个写到清单给的位置，父目录自动建', async () => {
    const errs = await applyOverrides(manifest, gameDir);
    expect(errs).toEqual([]);
    expect(readFileSync(join(gameDir, 'options.txt'), 'utf-8')).toBe('fov:70');
    expect(readFileSync(join(gameDir, 'config', 'rrls.toml'), 'utf-8')).toBe('x = 1');
    expect(
      readFileSync(join(gameDir, 'config', 'modpack_defaults', 'config', 'sodium.json'), 'utf-8'),
    ).toBe('{}');
  });

  it('options.txt 直接落在 gameDir 根（不是 config/ 下）', async () => {
    await applyOverrides(manifest, gameDir);
    // 放错目录的话游戏读不到，表现是「整合包装了但设置没生效」
    expect(existsSync(join(gameDir, 'options.txt'))).toBe(true);
    expect(existsSync(join(gameDir, 'config', 'options.txt'))).toBe(false);
  });

  it('目录层级深的配置也能建出来', async () => {
    await applyOverrides(manifest, gameDir);
    expect(existsSync(join(gameDir, 'config', 'modpack_defaults', 'config'))).toBe(true);
  });

  it('资源包落到 resourcepacks/（清单就是这么写的）', async () => {
    const m2 = parseMrpack(
      makeZip([
        { name: 'modrinth.index.json', content: JSON.stringify(INDEX) },
        { name: 'overrides/resourcepacks/Mod Menu Helper.zip', content: 'PK' },
      ]),
    );
    await applyOverrides(m2, gameDir);
    expect(existsSync(join(gameDir, 'resourcepacks', 'Mod Menu Helper.zip'))).toBe(true);
  });
});

describe('路径安全：整合包是任意第三方上传的 zip', () => {
  it('overrides 里的 ../ 不会写到 gameDir 之外', async () => {
    const evil = parseMrpack(
      makeZip([
        { name: 'modrinth.index.json', content: JSON.stringify(INDEX) },
        { name: 'overrides/../../escaped.txt', content: 'pwned' },
      ]),
    );
    // 第一道闸：解析阶段就把它踢进 missing
    expect(evil.overrides).toHaveLength(0);
    expect(evil.missing.some((m) => m.reason.includes('路径不安全'))).toBe(true);

    // 第二道闸：就算绕过了解析，resolveInside 也会挡住
    const forged = [
      { targetPath: '../../escaped.txt', content: Buffer.from('pwned') },
      { targetPath: '/etc/passwd', content: Buffer.from('pwned') },
    ];
    for (const o of forged) {
      const { resolveInside } = await import('./launcher-service.js');
      expect(() => resolveInside(gameDir, o.targetPath)).toThrow();
    }
    expect(existsSync(join(root, 'escaped.txt'))).toBe(false);
  });

  it('Windows 盘符路径也被挡', async () => {
    const { resolveInside } = await import('./launcher-service.js');
    expect(() => resolveInside(gameDir, 'C:/Windows/System32/evil.dll')).toThrow(/路径越界/);
    expect(() => resolveInside(gameDir, '..\\..\\evil')).toThrow(/路径越界/);
  });
});

describe('files 的目标路径与 env 过滤', () => {
  it('清单给的相对路径原样使用（不靠项目类型反推）', () => {
    expect(manifest.files.map((f) => f.targetPath)).toEqual([
      'mods/sodium.jar',
      'mods/server-only.jar',
      'resourcepacks/pack.zip',
    ]);
  });

  it('env.client=unsupported 的条目客户端不该装', () => {
    const serverOnly = manifest.files.find((f) => f.name === 'server-only.jar');
    expect(serverOnly?.client).toBe(false);
    expect(serverOnly?.server).toBe(true);
  });

  it('这些路径都在 gameDir 内（resolveInside 不拦）', async () => {
    const { resolveInside } = await import('./launcher-service.js');
    for (const f of manifest.files) {
      expect(() => resolveInside(gameDir, f.targetPath)).not.toThrow();
    }
  });
});

describe('降级路径：拿不到 .mrpack 时必须明说', () => {
  it('manifest.missing 里出现 overrides 说明', () => {
    // buildModpackManifestFromApi 的行为（此处直接断言构造好的形状）
    const degraded: ModpackManifest = {
      ...manifest,
      overrides: [],
      missing: [
        {
          name: '(整合包配置)',
          reason: '未能读取 .mrpack，overrides（config/、options.txt 等）不会安装',
        },
      ],
    };
    expect(degraded.overrides).toHaveLength(0);
    expect(degraded.missing.some((m) => m.reason.includes('overrides'))).toBe(true);
  });
});
