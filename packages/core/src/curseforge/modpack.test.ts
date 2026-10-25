/**
 * CurseForge 整合包清单（`manifest.json`）。
 *
 * fixture 逐字段对着 PCL 的实际读取代码（`ModModpack.vb:163-223`）写，
 * 不是照文档想象：
 * - `minecraft.version`（PCL:180）
 * - `minecraft.modLoaders[].id`，格式 `neoforge-<ver>`（PCL:181-198）
 * - `overrides` 字段**可自定义**（PCL:203），`client-overrides` 固定名（PCL:414-416）
 * - `files[].projectID` / `fileID` / `required`（PCL:217-223）
 */
import { describe, it, expect, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';

import {
  parseCfModpack,
  buildCfModpackManifest,
  parseModLoaderId,
  targetDirForCfFileName,
} from './modpack.js';
import type { CurseForgeFile } from './api-client.js';

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

const MANIFEST = {
  minecraft: {
    version: '1.21.1',
    modLoaders: [{ id: 'neoforge-21.1.209', primary: true }],
  },
  manifestType: 'minecraftModpack',
  manifestVersion: 1,
  name: 'Test CF Pack',
  version: '1.0.0',
  author: 'someone',
  overrides: 'overrides',
  files: [
    { projectID: 238222, fileID: 4712334, required: true },
    { projectID: 306612, fileID: 4712335, required: true },
    { projectID: 999999, fileID: 4712336, required: false },
    // 缺 fileID → PCL 是「跳过 + 提示」
    { projectID: 123 },
  ],
};

const OVERRIDES: Array<[string, string]> = [
  ['overrides/options.txt', 'fov:70'],
  ['overrides/config/cfhcore/cfhcore.toml', 'x = 1'],
  ['client-overrides/config/client-only.json', '{}'],
];

function pack(manifest: unknown = MANIFEST, overrides = OVERRIDES): Buffer {
  return makeZip([
    { name: 'manifest.json', content: JSON.stringify(manifest) },
    ...overrides.map(([n, c]) => ({ name: n, content: c })),
  ]);
}

describe('parseModLoaderId', () => {
  it('`neoforge-<ver>` / `fabric-<ver>`（PCL 的格式）', () => {
    expect(parseModLoaderId('neoforge-21.1.209')).toEqual({
      loader: 'neoforge',
      version: '21.1.209',
    });
    expect(parseModLoaderId('fabric-0.19.5')).toEqual({ loader: 'fabric', version: '0.19.5' });
  });

  it('大小写不敏感', () => {
    expect(parseModLoaderId('NeoForge-21.1.209')?.loader).toBe('neoforge');
  });

  it('forge / 未知 loader → null（不硬塞成 neo）', () => {
    expect(parseModLoaderId('forge-47.2.0')).toBeNull();
    expect(parseModLoaderId('quilt-0.20.0')).toBeNull();
    expect(parseModLoaderId('custom-launcher-1.0')).toBeNull();
    expect(parseModLoaderId('')).toBeNull();
  });
});

describe('parseCfModpack', () => {
  it('MC 版本来自 minecraft.version（不是 dependencies）', () => {
    expect(parseCfModpack(pack(), { projectId: 1, versionId: 2 }).mcVersion).toBe('1.21.1');
  });

  it('加载器与精确版本来自 modLoaders[].id', () => {
    const m = parseCfModpack(pack(), { projectId: 1, versionId: 2 });
    expect(m.loader).toBe('neoforge');
    expect(m.loaderVersion).toBe('21.1.209');
  });

  it('modLoaders 多个时取最后一个能识别的（PCL 的覆盖语义）', () => {
    const m = parseCfModpack(
      pack({
        ...MANIFEST,
        minecraft: {
          version: '1.21.1',
          modLoaders: [{ id: 'fabric-0.19.5' }, { id: 'neoforge-21.1.209' }],
        },
      }),
      { projectId: 1, versionId: 2 },
    );
    expect(m.loader).toBe('neoforge');
    expect(m.loaderVersion).toBe('21.1.209');
  });

  it('Forge 整合包 → loader=null 并明说，不按 neo 装', () => {
    const m = parseCfModpack(
      pack({
        ...MANIFEST,
        minecraft: { version: '1.12.2', modLoaders: [{ id: 'forge-14.23.5.2859' }] },
      }),
      { projectId: 1, versionId: 2 },
    );
    expect(m.loader).toBeNull();
    expect(m.missing.some((x) => x.reason.includes('forge-14.23.5.2859'))).toBe(true);
  });

  it('files → fileIds + fileToProject 映射', () => {
    const m = parseCfModpack(pack(), { projectId: 1, versionId: 2 });
    expect(m.fileIds).toEqual([4712334, 4712335, 4712336]);
    expect(m.fileToProject.get(4712334)).toBe(238222);
  });

  it('required: false 归入可选（PCL 的 ModOptionalList）', () => {
    const m = parseCfModpack(pack(), { projectId: 1, versionId: 2 });
    expect([...m.optionalIds]).toEqual([4712336]);
  });

  it('缺 fileID 的条目跳过并报缺（PCL 是 Hint + Continue）', () => {
    const m = parseCfModpack(pack(), { projectId: 1, versionId: 2 });
    expect(m.fileIds).toHaveLength(3);
    expect(m.missing.some((x) => x.reason.includes('projectID 或 fileID'))).toBe(true);
  });

  it('overrides 用清单给的目录名', () => {
    const m = parseCfModpack(pack(), { projectId: 1, versionId: 2 });
    expect(m.overrides.map((o) => o.targetPath).sort()).toEqual([
      'config/cfhcore/cfhcore.toml',
      'config/client-only.json',
      'options.txt',
    ]);
  });

  it('overrides 目录名可自定义（PCL: `If(Json("overrides"), "")`）', () => {
    const m = parseCfModpack(
      makeZip([
        { name: 'manifest.json', content: JSON.stringify({ ...MANIFEST, overrides: 'my-files' }) },
        { name: 'my-files/config/a.json', content: '{}' },
        { name: 'overrides/config/should-not-appear.json', content: '{}' },
      ]),
      { projectId: 1, versionId: 2 },
    );
    expect(m.overrides.map((o) => o.targetPath)).toEqual(['config/a.json']);
  });

  it('没有 overrides 字段也没有 client-overrides → 空，不报错', () => {
    const m = parseCfModpack(
      makeZip([
        { name: 'manifest.json', content: JSON.stringify({ ...MANIFEST, overrides: undefined }) },
      ]),
      { projectId: 1, versionId: 2 },
    );
    expect(m.overrides).toHaveLength(0);
  });

  it('overrides 路径穿越 → 拒绝', () => {
    const m = parseCfModpack(
      makeZip([
        { name: 'manifest.json', content: JSON.stringify(MANIFEST) },
        { name: 'overrides/../../evil.txt', content: 'pwned' },
      ]),
      { projectId: 1, versionId: 2 },
    );
    expect(m.overrides).toHaveLength(0);
    expect(m.missing.some((x) => x.reason.includes('路径不安全'))).toBe(true);
  });

  it('没有 manifest.json → 明确报错', () => {
    expect(() =>
      parseCfModpack(makeZip([{ name: 'x', content: 'y' }]), { projectId: 1, versionId: 2 }),
    ).toThrow(/没有 manifest.json/);
  });

  it('没有 minecraft.version → 报错（PCL 同款文案）', () => {
    expect(() =>
      parseCfModpack(makeZip([{ name: 'manifest.json', content: '{"name":"x"}' }]), {
        projectId: 1,
        versionId: 2,
      }),
    ).toThrow(/未提供 Minecraft 版本/);
  });
});

describe('buildCfModpackManifest · 查下载信息', () => {
  function client(overrides: Partial<Record<string, CurseForgeFile>> = {}) {
    const base: Record<number, CurseForgeFile> = {
      4712334: {
        id: 4712334,
        displayName: 'JEI',
        fileName: 'jei-1.21.1.jar',
        fileLength: 100,
        downloadUrl: 'https://edge.forgecdn.net/jei.jar',
        gameVersions: ['1.21.1'],
        modLoaderNames: ['NeoForge'],
      },
      4712335: {
        id: 4712335,
        displayName: 'Some Lib',
        fileName: 'lib.jar',
        fileLength: 50,
        downloadUrl: 'https://edge.forgecdn.net/lib.jar',
        gameVersions: ['1.21.1'],
        modLoaderNames: [],
      },
      // 清单里标了 required:false 的那一个 —— API 是能返回的，
      // 用来验证「可选依赖不下」而不是「拿不到所以不下」
      4712336: {
        id: 4712336,
        displayName: 'Optional Mod',
        fileName: 'optional.jar',
        fileLength: 10,
        downloadUrl: 'https://edge.forgecdn.net/optional.jar',
        gameVersions: ['1.21.1'],
        modLoaderNames: [],
      },
    };
    const map = new Map<number, CurseForgeFile>(
      Object.entries({ ...base, ...overrides }).map(([k, v]) => [Number(k), v as CurseForgeFile]),
    );
    return {
      getFilesByIds: vi.fn(async () => map),
    } as unknown as Parameters<typeof buildCfModpackManifest>[1];
  }

  it('批量查一次（不是逐个项目拉）', async () => {
    const c = client();
    await buildCfModpackManifest(pack(), c, { projectId: 1, versionId: 2 });
    expect(c.getFilesByIds).toHaveBeenCalledTimes(1);
    expect(c.getFilesByIds).toHaveBeenCalledWith([4712334, 4712335, 4712336]);
  });

  it('文件落 mods/，用 fileName 命名', async () => {
    const m = await buildCfModpackManifest(pack(), client(), { projectId: 1, versionId: 2 });
    expect(m.files.map((f) => f.targetPath)).toEqual(['mods/jei-1.21.1.jar', 'mods/lib.jar']);
  });

  /**
   * sha1 必须跟着文件走。
   *
   * 不带它，安装时无从校验下载完整性（坏 jar 会静默躺在 `mods/`，用户看到的
   * 症状是「装完了进不去」）。CF 的文件接口把 sha1 放在 `hashes` 里 `algo = 1`
   * 那一项（`algo 2` 是 md5，安装侧不比对它）。
   */
  it('文件带上 sha1（安装时校验下载完整性用）', async () => {
    const c = client({
      4712334: {
        id: 4712334,
        displayName: 'JEI',
        fileName: 'jei-1.21.1.jar',
        fileLength: 100,
        downloadUrl: 'https://edge.forgecdn.net/jei.jar',
        gameVersions: ['1.21.1'],
        modLoaderNames: ['NeoForge'],
        hashes: [
          { value: '0123456789abcdef0123456789abcdef01234567', algo: 1 },
          { value: '0'.repeat(32), algo: 2 },
        ],
      },
    });
    const m = await buildCfModpackManifest(pack(), c, { projectId: 1, versionId: 2 });
    expect(m.files[0]?.sha1).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('CF 没给哈希时文件上没有 sha1 字段（不是空串）', async () => {
    const m = await buildCfModpackManifest(pack(), client(), { projectId: 1, versionId: 2 });
    expect(m.files[0]?.sha1).toBeUndefined();
  });

  /**
   * 每个文件带上「属于哪个项目」（`cf_<projectID>`，与 `ModEntry.id` 同格式）。
   * 装完成员的账本靠它认亲 —— 用户之后再从搜索页下同一个 mod 才不会留下两份 jar。
   */
  it('文件带上项目归属 cf_<projectID>（清单里本来就有 projectID）', async () => {
    const m = await buildCfModpackManifest(pack(), client(), { projectId: 1, versionId: 2 });
    // fixture：4712334→238222、4712335→306612（4712336 是可选，不装）
    expect(m.files.map((f) => f.projectId)).toEqual(['cf_238222', 'cf_306612']);
  });

  /**
   * `.zip` 必须去 `resourcepacks/`，不能留在 `mods/`。
   *
   * 老实现一律丢 `mods/`：CF 整合包里的资源包/光影因此被当 mod 扫，
   * 症状是「包装完了但游戏里没有那个材质包」。PCL 是按类型分目录的
   * （`ModModpack.vb:246-261`）。这里用**后缀**判（CF 清单不说是哪一类）。
   */
  it('.zip 落到 resourcepacks/，.jar 留在 mods/', async () => {
    const c = client({
      4712334: {
        id: 4712334,
        displayName: 'Faithful',
        fileName: 'Faithful 64x.zip',
        fileLength: 100,
        downloadUrl: 'https://edge.forgecdn.net/faithful.zip',
        gameVersions: ['1.21.1'],
        modLoaderNames: [],
      },
      4712335: {
        id: 4712335,
        displayName: 'BSL Shader',
        fileName: 'BSL_v8.zip',
        fileLength: 50,
        downloadUrl: 'https://edge.forgecdn.net/bsl.zip',
        gameVersions: ['1.21.1'],
        modLoaderNames: [],
      },
    });
    const m = await buildCfModpackManifest(pack(), c, { projectId: 1, versionId: 2 });
    expect(m.files.map((f) => f.targetPath)).toEqual([
      'resourcepacks/Faithful 64x.zip',
      'resourcepacks/BSL_v8.zip',
    ]);
  });

  it('targetDirForCfFileName：后缀大小写都认，未知后缀保守进 mods/', () => {
    expect(targetDirForCfFileName('a.JAR')).toBe('mods/a.JAR');
    expect(targetDirForCfFileName('a.Zip')).toBe('resourcepacks/a.Zip');
    expect(targetDirForCfFileName('a.png')).toBe('mods/a.png');
    expect(targetDirForCfFileName('noext')).toBe('mods/noext');
  });

  it('可选依赖不自动装，并说明数量（与 PCL 一致）', async () => {
    const m = await buildCfModpackManifest(pack(), client(), { projectId: 1, versionId: 2 });
    expect(m.files.map((f) => f.name)).not.toContain('optional.jar');
    expect(m.missing.some((x) => x.reason.includes('可选依赖'))).toBe(true);
  });

  it('⚠️ 文件被作者删掉（源站静默跳过）→ 必须报缺', async () => {
    // 只给 4712334，4712335 缺席 —— 模拟 CF 的行为
    const c = client({ 4712335: undefined as unknown as CurseForgeFile });
    (c.getFilesByIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([
        [
          4712334,
          {
            id: 4712334,
            displayName: 'JEI',
            fileName: 'jei.jar',
            fileLength: 1,
            downloadUrl: 'https://x/jei.jar',
            gameVersions: [],
            modLoaderNames: [],
          } as CurseForgeFile,
        ],
      ]),
    );
    const m = await buildCfModpackManifest(pack(), c, { projectId: 1, versionId: 2 });
    expect(m.missing.some((x) => x.reason.includes('删除或下架'))).toBe(true);
  });

  it('downloadUrl 为 null → 报缺，不生成坏条目', async () => {
    const c = client();
    (c.getFilesByIds as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([
        [
          4712334,
          {
            id: 4712334,
            displayName: 'X',
            fileName: 'x.jar',
            fileLength: 1,
            downloadUrl: null,
            gameVersions: [],
            modLoaderNames: [],
          } as CurseForgeFile,
        ],
      ]),
    );
    const m = await buildCfModpackManifest(pack(), c, { projectId: 1, versionId: 2 });
    expect(m.files).toHaveLength(0);
    expect(m.missing.some((x) => x.reason.includes('不公开下载'))).toBe(true);
  });
});
