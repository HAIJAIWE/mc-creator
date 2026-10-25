/**
 * 整合包清单解析：`.mrpack` 主路径 + API 降级路径。
 *
 * ## fixture 来自真实数据，不是编的
 *
 * zip 是**用真字节造出来的**（`makeMrpack()`：手写 local header / 中央目录 /
 * EOCD + `deflateRawSync`），index.json 的内容逐字段对着实测的
 * Fabulously Optimized `1KVo5vLL` 抄。
 *
 * 为什么这么较劲：`overrides` 与 `files` 都要**写盘**，路径和内容都不能错。
 * 用 mock 的 zip 解析器，测试就变成「验证 mock 自己」，路径穿越、
 * 符号链接、条目偏移错位这些真正会出事的地方一个都测不到。
 */
import { describe, it, expect, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';

import { parseMrpack, buildModpackManifestFromApi, modrinthProjectIdFromUrl } from './modpack.js';
import type { ModrinthVersion } from './api-client.js';
import { MIRROR_MODRINTH_API, mirrorUrlOf } from '../sources/mirror.js';

/** 手写一个最小合法 zip。 */
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
    local.writeUInt16LE(method(), 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method(), 10);
    central.writeUInt32LE(0, 16);
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
const method = () => 8;

/** index.json（实测形状）。类型标成宽的，好让每个用例改其中一个维度。 */
const INDEX: {
  formatVersion: number;
  game: string;
  versionId: string;
  name: string;
  files: Array<{
    path: string;
    hashes?: Record<string, string>;
    env: { client: string; server: string };
    downloads?: string[];
    redirects?: string[];
    fileSize?: number;
  }>;
  dependencies: Record<string, string>;
} = {
  formatVersion: 1,
  game: 'minecraft',
  versionId: 'D35n5vLL',
  name: 'Fabulously.Optimized-v15.0.0-beta.1.mrpack',
  files: [
    {
      path: 'mods/BetterGrassify-1.8.8+fabric.26.3.jar',
      hashes: { sha1: 'a', sha512: 'b' },
      env: { client: 'required', server: 'required' },
      downloads: ['https://cdn.modrinth.com/data/m5T5xmUy/versions/8qcmuwZa/BetterGrassify.jar'],
      fileSize: 89214,
    },
    {
      // 服务端专用：客户端实例不该装
      path: 'mods/server-only.jar',
      env: { client: 'unsupported', server: 'required' },
      downloads: ['https://cdn.modrinth.com/data/x/versions/y/server-only.jar'],
    },
    {
      // CurseForge 重定向：没 CF key 拿不到 URL
      path: 'mods/redirected.jar',
      env: { client: 'required', server: 'unsupported' },
      redirects: ['curseforge:238222:4712334'],
      hashes: { sha1: 'c', sha512: 'd' },
      fileSize: 5,
    },
    {
      // 两端都不要 → 不该出现在清单里
      path: 'mods/neither.jar',
      env: { client: 'unsupported', server: 'unsupported' },
      downloads: ['https://cdn.modrinth.com/data/z/versions/w/neither.jar'],
    },
  ],
  dependencies: { 'fabric-loader': '0.19.5', minecraft: '26.3' },
};

/** 实测：51 个 overrides，含 options.txt、配置、18 个语言包。 */
const OVERRIDES: Array<[string, string]> = [
  ['overrides/options.txt', 'fov:70'],
  ['overrides/config/rrls.toml', 'x = 1'],
  ['overrides/config/modpack_defaults/config/sodium-extra-options.json', '{}'],
  ['overrides/resourcepacks/Mod Menu Helper.zip', 'PK-ish'],
];

function makeMrpack(
  index: unknown = INDEX,
  overrides: Array<[string, string | Buffer]> = OVERRIDES,
): Buffer {
  return makeZip([
    { name: 'modrinth.index.json', content: JSON.stringify(index) },
    ...overrides.map(([n, c]) => ({ name: n, content: c })),
  ]);
}

describe('parseMrpack · 主路径', () => {
  it('MC 版本与加载器来自 index.json 的 dependencies', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.mcVersion).toBe('26.3');
    expect(m.loader).toBe('fabric');
  });

  it('加载器精确版本（API 不给，只有 index.json 有）', () => {
    expect(parseMrpack(makeMrpack()).loaderVersion).toBe('0.19.5');
    const nf = parseMrpack(
      makeMrpack({
        ...INDEX,
        dependencies: { neoforge: '21.1.209', minecraft: '1.21.1' },
      }),
    );
    expect(nf.loader).toBe('neoforge');
    expect(nf.loaderVersion).toBe('21.1.209');
  });

  it('overrides 全部解出来，剥掉 overrides/ 前缀', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.overrides.map((o) => o.targetPath).sort()).toEqual([
      'config/modpack_defaults/config/sodium-extra-options.json',
      'config/rrls.toml',
      'options.txt',
      'resourcepacks/Mod Menu Helper.zip',
    ]);
    expect(m.overrides.find((o) => o.targetPath === 'options.txt')?.content.toString()).toBe(
      'fov:70',
    );
  });

  it('overrides 内容字节完全一致（含二进制）', () => {
    const bin = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00]);
    const m = parseMrpack(makeMrpack(INDEX, [...OVERRIDES, ['overrides/x.zip', bin]]));
    expect(m.overrides.find((o) => o.targetPath === 'x.zip')?.content.equals(bin)).toBe(true);
  });

  it('files 的 targetPath 就是清单给的相对 gameDir 路径', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.files[0]?.targetPath).toBe('mods/BetterGrassify-1.8.8+fabric.26.3.jar');
  });

  /**
   * 「这个文件属于哪个项目」—— 装整合包时要靠它记进实例的下载账本，之后用户
   * 从搜索页再下同一个 mod 才能认出旧文件并替换掉。认不出来时**不猜**。
   */
  it('每个文件带上项目归属（CDN 直链认 /data/<id>/，CF 重定向用清单里的 projectId）', () => {
    const m = parseMrpack(makeMrpack());
    const byName = (n: string) => m.files.find((f) => f.name === n);
    expect(byName('BetterGrassify-1.8.8+fabric.26.3.jar')?.projectId).toBe('mr_m5T5xmUy');
    expect(byName('redirected.jar')?.projectId).toBe('cf_238222');
    // 清单里的 `/data/x/…` 不是合法项目 id（fixture 是假的）→ 宁可不记
    expect(byName('server-only.jar')?.projectId).toBeUndefined();
  });

  /**
   * sha1 必须从清单透传到安装计划。
   *
   * 不透传的话，安装循环里的校验永远没有参照物（等于没写）—— 断流/半个文件
   * 会静默躺进 `mods/`，用户看到的症状是「装完了进游戏崩」。清单里本来就有
   * `hashes`（我们的打包器也按这个格式写），没有理由不用。
   */
  it('清单里的 sha1 跟着文件走（安装时校验下载完整性）', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.files.find((f) => f.name === 'BetterGrassify-1.8.8+fabric.26.3.jar')?.sha1).toBe('a');
    // 走 CurseForge 重定向的那条也要带（有 hashes 就带）
    expect(m.files.find((f) => f.name === 'redirected.jar')?.sha1).toBe('c');
  });

  it('清单没给 hashes 时不是空串，而是没有这个字段', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.files.find((f) => f.name === 'server-only.jar')?.sha1).toBeUndefined();
  });

  it('env.client = unsupported 的条目标成服务端专用（客户端不该装）', () => {
    const m = parseMrpack(makeMrpack());
    const serverOnly = m.files.find((f) => f.name === 'server-only.jar');
    expect(serverOnly?.client).toBe(false);
    expect(serverOnly?.server).toBe(true);
  });

  it('两端都不要的条目直接不出现', () => {
    const m = parseMrpack(makeMrpack());
    expect(m.files.map((f) => f.name)).not.toContain('neither.jar');
  });

  it('CurseForge 重定向被解析出来，url 留 null（要 CF key）', () => {
    const m = parseMrpack(makeMrpack());
    const r = m.files.find((f) => f.name === 'redirected.jar');
    expect(r?.url).toBeNull();
    expect(r?.curseforge).toEqual({ projectId: 238222, fileId: 4712334 });
  });

  it('既没地址也没可识别重定向 → 报缺', () => {
    const m = parseMrpack(
      makeMrpack({
        ...INDEX,
        files: [{ path: 'mods/x.jar', env: { client: 'required' }, downloads: [] }],
      }),
    );
    expect(m.missing.some((x) => x.name === 'x.jar')).toBe(true);
  });

  it('文件路径穿越 → 拒绝并报缺，不写盘', () => {
    const m = parseMrpack(
      makeMrpack({
        ...INDEX,
        files: [
          {
            path: '../../evil.jar',
            env: { client: 'required' },
            downloads: ['https://cdn.modrinth.com/x'],
          },
        ],
      }),
    );
    expect(m.files).toHaveLength(0);
    expect(m.missing[0]?.reason).toMatch(/路径不安全/);
  });

  it('overrides 路径穿越 → 拒绝并报缺', () => {
    const m = parseMrpack(makeMrpack(INDEX, [['overrides/../../evil.txt', 'x']]));
    expect(m.overrides).toHaveLength(0);
    expect(m.missing.some((x) => x.reason.includes('路径不安全'))).toBe(true);
  });

  it('没有 index.json → 明确报错', () => {
    expect(() => parseMrpack(makeZip([{ name: 'overrides/x', content: 'y' }]))).toThrow(
      /没有 modrinth.index.json/,
    );
  });

  it('不是 zip → 明确报错', () => {
    expect(() => parseMrpack(Buffer.from('nope'))).toThrow(/不是有效的 zip/);
  });

  it('清单没声明 Minecraft 版本 → 报错（不能猜一个装到错的实例）', () => {
    expect(() => parseMrpack(makeMrpack({ ...INDEX, dependencies: {} }))).toThrow(
      /没有声明 Minecraft 版本/,
    );
  });

  it('Forge / Quilt 整合包明确拒绝', () => {
    const f = makeMrpack({
      ...INDEX,
      dependencies: { forge: '47.2.0', minecraft: '1.20.1' },
    });
    expect(() => parseMrpack(f)).toThrow(/只支持 NeoForge 与 Fabric/);
  });

  it('legacy_fabric 归一到 fabric', () => {
    const m = parseMrpack(
      makeMrpack({
        ...INDEX,
        dependencies: { 'fabric-loader': '0.14.9', minecraft: '1.20.1' },
      }),
    );
    expect(m.loader).toBe('fabric');
  });
});

// ===========================================================================
// 降级路径（拿不到 .mrpack 时）
// ===========================================================================

const PACK: ModrinthVersion = {
  id: 'D35n5vLL',
  project_id: '1KVo5zza',
  version_number: '15.0.0-beta.1',
  name: 'Fabulously.Optimized-v15.0.0-beta.1.mrpack',
  game_versions: ['26.3'],
  loaders: ['fabric'],
  files: [
    {
      url: 'https://cdn.modrinth.com/data/1KVo5zza/versions/D35n5vLL/pack.mrpack',
      filename: 'pack.mrpack',
      primary: true,
      size: 1000,
    },
  ],
  dependencies: [
    { version_id: 'd5ddUdiB', project_id: 'uXXizFIs', dependency_type: 'embedded' },
    { version_id: 'gone', project_id: 'DELETED', dependency_type: 'embedded' },
    {
      version_id: null,
      project_id: null,
      file_name: 'Mod Menu Helper.zip',
      dependency_type: 'embedded',
    },
  ],
};

function fakeClient() {
  return {
    getVersionsByIds: vi.fn(async (ids: string[]) => {
      const map = new Map<string, ModrinthVersion>([
        [
          'd5ddUdiB',
          {
            id: 'd5ddUdiB',
            project_id: 'uXXizFIs',
            version_number: '9.0.0',
            name: 'ferritecore',
            files: [
              {
                url: 'https://cdn.modrinth.com/data/uXXizFIs/versions/d5ddUdiB/ferritecore.jar',
                filename: 'ferritecore.jar',
                primary: true,
                size: 72677,
                hashes: { sha1: 'e'.repeat(40), sha512: 'f'.repeat(128) },
              },
            ],
          },
        ],
      ]);
      const out = new Map<string, ModrinthVersion>();
      for (const id of ids) {
        const v = map.get(id);
        if (v) out.set(id, v);
      }
      return out;
    }),
    getProjectsByIds: vi.fn(async (ids: string[]) => {
      const map = new Map<string, never>([
        ['uXXizFIs', { id: 'uXXizFIs', title: 'FerriteCore', project_type: 'mod' } as never],
      ]);
      const out = new Map<string, never>();
      for (const id of ids) {
        const p = map.get(id);
        if (p) out.set(id, p);
      }
      return out;
    }),
  } as unknown as Parameters<typeof buildModpackManifestFromApi>[1];
}

describe('buildModpackManifestFromApi · 降级路径', () => {
  it('MC 版本与加载器仍能从版本对象拿到', async () => {
    const m = await buildModpackManifestFromApi(PACK, fakeClient());
    expect(m.mcVersion).toBe('26.3');
    expect(m.loader).toBe('fabric');
  });

  it('embedded 依赖 → 文件，路径按项目类型推', async () => {
    const m = await buildModpackManifestFromApi(PACK, fakeClient());
    expect(m.files.map((f) => f.targetPath)).toEqual(['mods/ferritecore.jar']);
    expect(m.files[0]?.displayName).toBe('FerriteCore');
    // 版本对象里的 sha1 也要跟着走（这条路上同样要能校验下载）
    expect(m.files[0]?.sha1).toBe('e'.repeat(40));
    // 归属直接来自依赖条目（装完进账本，之后从搜索页再下才认得出是旧文件）
    expect(m.files[0]?.projectId).toBe('mr_uXXizFIs');
  });

  it('一次批量取版本（逐个拉会撞 300 次/分 限流）', async () => {
    const c = fakeClient();
    await buildModpackManifestFromApi(PACK, c);
    expect(c.getVersionsByIds).toHaveBeenCalledTimes(1);
    expect(c.getVersionsByIds).toHaveBeenCalledWith(['d5ddUdiB', 'gone']);
  });

  it('版本被删 → 报缺', async () => {
    const m = await buildModpackManifestFromApi(PACK, fakeClient());
    expect(m.missing.some((x) => x.name === 'DELETED')).toBe(true);
  });

  it('**明说 overrides 没装**（不装配置却装作成功，比不装更坑）', async () => {
    const m = await buildModpackManifestFromApi(PACK, fakeClient());
    expect(m.overrides).toHaveLength(0);
    expect(m.missing.some((x) => x.reason.includes('overrides'))).toBe(true);
  });

  it('整合包自带文件报为「需手动放入」', async () => {
    const m = await buildModpackManifestFromApi(PACK, fakeClient());
    expect(m.missing.some((x) => x.name === 'Mod Menu Helper.zip')).toBe(true);
  });

  it('loaderVersion 拿不到（API 不给）→ null，交给主进程选最新兼容版', async () => {
    expect((await buildModpackManifestFromApi(PACK, fakeClient())).loaderVersion).toBeNull();
  });

  it('Forge / Quilt 明确拒绝', async () => {
    await expect(
      buildModpackManifestFromApi({ ...PACK, loaders: ['forge'] }, fakeClient()),
    ).rejects.toThrow(/只支持 NeoForge 与 Fabric/);
  });
});

/**
 * CDN 地址 → 项目 id。认得出才认（账本记错项目会让替换删错文件），
 * 所以这条把「认不出」的面也钉住。
 */
describe('modrinthProjectIdFromUrl', () => {
  it('实测形状的 CDN 地址能认出来', () => {
    expect(
      modrinthProjectIdFromUrl(
        'https://cdn.modrinth.com/data/AANobbMI/versions/ygf8cVZg/sodium-fabric-0.5.11%2Bmc1.20.1.jar',
      ),
    ).toBe('mr_AANobbMI');
    // 真实整合包清单里的那种（Percent-encoded 文件名不影响）
    expect(
      modrinthProjectIdFromUrl(
        'https://cdn.modrinth.com/data/m5T5xmUy/versions/8qcmuwZa/BetterGrassify-1.8.8+fabric.26.3.jar',
      ),
    ).toBe('mr_m5T5xmUy');
  });

  it('不是 Modrinth CDN / 项目 id 不像话 → null，不猜', () => {
    expect(modrinthProjectIdFromUrl('https://edge.forgecdn.net/files/9221/721/jei.jar')).toBeNull();
    expect(modrinthProjectIdFromUrl('https://example.com/data/ABCDEF/versions/x/a.jar')).toBeNull();
    expect(modrinthProjectIdFromUrl('https://cdn.modrinth.com/data/x/versions/y/a.jar')).toBeNull();
    expect(modrinthProjectIdFromUrl('')).toBeNull();
  });
});

/**
 * 真网络冒烟：**上游此刻真的这么发**。
 *
 * 上面那些 fixture 是我抄下来的，抄错了测试照样绿。这条从镜像（生产同款的
 * 「官方 CDN → 国内镜像」映射）取一个真实的 `.mrpack` 回来解析 —— 它测的正是
 * 「装完整合包 → 从搜索页再下同一个 mod → 旧文件被替换」这条链的**起点**：
 * 清单里认不出归属，后面全落空。
 */
describe('真网络冒烟：真实 .mrpack 的文件归属（上游此刻行为）', () => {
  it('Fabulously Optimized 的 .mrpack：每个文件都认得出 mr_/cf_', async (ctx) => {
    const versionsRes = await fetch(`${MIRROR_MODRINTH_API}/project/1KVo5zza/version`);
    // 实测 2026-10-20：MCIM 整站 503（官方 API 仍 200）。真网络冒烟依赖第三方
    // 镜像的可用性；镜像维护期间跳过并保留原因，不把外部故障算成代码回归。
    if (versionsRes.status >= 500) {
      console.warn(`[真网络冒烟] MCIM 镜像暂不可用（HTTP ${versionsRes.status}），本次跳过`);
      ctx.skip();
    }
    expect(versionsRes.status).toBe(200);
    const versions = (await versionsRes.json()) as Array<{
      version_number: string;
      loaders: string[];
      files: Array<{ url: string; filename: string }>;
    }>;

    // 近几版的加载器会变；挑一版本启动器支持、且带 .mrpack 的
    const version = versions.find(
      (v) =>
        v.loaders.some((l) => l === 'fabric' || l === 'neoforge') &&
        v.files.some((f) => f.filename.endsWith('.mrpack')),
    );
    expect(version).toBeDefined();
    const packFile = version?.files.find((f) => f.filename.endsWith('.mrpack'));
    expect(packFile).toBeDefined();

    const mirrored = mirrorUrlOf(packFile?.url ?? '');
    expect(mirrored).not.toBeNull();
    const zipRes = await fetch(mirrored as string);
    expect(zipRes.status).toBe(200);

    const manifest = parseMrpack(Buffer.from(await zipRes.arrayBuffer()));
    expect(manifest.files.length).toBeGreaterThan(0);

    // 1) 每个文件都得有归属（这个包里全是 Modrinth 上架的 mod）
    const noOwner = manifest.files.filter((f) => f.projectId === undefined);
    expect(noOwner.map((f) => f.name)).toEqual([]);

    // 2) 归属必须和它自己的下载地址对得上（认错了，替换时就会删错文件）
    const mismatched = manifest.files.filter(
      (f) =>
        f.projectId?.startsWith('mr_') === true &&
        !f.url?.includes(`/data/${f.projectId.slice(3)}/`),
    );
    expect(mismatched.map((f) => f.name)).toEqual([]);
    expect(manifest.files.filter((f) => f.projectId?.startsWith('mr_')).length).toBeGreaterThan(0);
  }, 60_000);
});
