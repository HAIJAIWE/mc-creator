/**
 * 加载器档案（`inheritsFrom`）端到端：**解析 → 启动**。
 *
 * ## 这组用例在钉什么
 *
 * 之前「装了 mod 没反应」有两层原因，都在这里：
 *
 * 1. `resolveVersion` 只认 Mojang 清单 → 加载器档案直接抛「版本不存在」，
 *    根本进不到启动那一步；
 * 2. 即便解析出来了，`launchGame` 的 classpath 末位是**原版 jar**、
 *    主类写死 `net.minecraft.client.main.Main` → 跑的还是原版游戏，
 *    mod 一个都不会加载。
 *
 * 第 2 条尤其阴险：它**不报错**。用户看到的是「游戏能开，但 mod 没效果」，
 * 而所有错误提示都指向不到它。所以这里直接断言 spawn 出去的**完整参数**，
 * 包括主类、classpath 末位 jar、`--version` 的值。
 *
 * fixture 用 NeoForge installer 产出的档案形状（`inheritsFrom` + 自己的
 * mainClass + 自己的 library），这是官方格式，不是本仓臆造的。
 */
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

import { LauncherService, inferLoaderFromMainClass } from './launcher-service.js';
import { VANILLA_MAIN_CLASS } from './version-profile.js';

const MC = '1.21.1';
const LOADER = 'neoforge-21.1.209-1.21.1';
const NEOFORGE_MAIN = 'cpw.mods.bootstraplauncher.BootstrapLauncher';

/** 记录 spawn 出去的参数。 */
let lastArgs: string[] = [];
const fakeChild = (): ChildProcess => {
  const c = new EventEmitter() as unknown as ChildProcess;
  Object.assign(c, { pid: 4242, kill: () => true });
  return c;
};
const fakeSpawn = ((_cmd: string, args: string[]) => {
  lastArgs = args;
  const child = fakeChild();
  queueMicrotask(() => child.emit('spawn'));
  return child;
}) as unknown as typeof spawn;

/** Mojang 侧的离线 fetch：只认清单与版本 JSON，其余一律 404。 */
const MANIFEST = {
  versions: [
    { id: MC, type: 'release', releaseTime: '2024-08-08T12:24:45Z', url: `https://mc/${MC}.json` },
  ],
};
const BASE_JSON = {
  id: MC,
  mainClass: VANILLA_MAIN_CLASS,
  assetIndex: { id: '17', url: `https://mc/${MC}/assets.json` },
  javaVersion: { majorVersion: 21 },
  downloads: { client: { url: `https://mc/${MC}/client.jar` } },
  libraries: [
    { name: 'org.lwjgl:lwjgl:3.3.3', downloads: { artifact: { url: 'https://mc/lib/lwjgl.jar' } } },
  ],
};
const FABRIC_PROFILE = `fabric-loader-0.19.5-${MC}`;
const FABRIC_MAIN = 'net.fabricmc.loader.impl.launch.knot.KnotClient';
/**
 * 真实 Fabric installer（-noprofile）产物形状：**没有版本 jar**，
 * libraries 里只有 name + 仓库根，没有 downloads。
 */
const FABRIC_JSON = {
  id: FABRIC_PROFILE,
  inheritsFrom: MC,
  mainClass: FABRIC_MAIN,
  libraries: [
    { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:sponge-mixin:0.17.4+mixin.0.8.7', url: 'https://maven.fabricmc.net/' },
    { name: 'net.fabricmc:fabric-loader:0.19.5', url: 'https://maven.fabricmc.net/' },
  ],
};
const LOADER_JSON = {
  id: LOADER,
  inheritsFrom: MC,
  mainClass: NEOFORGE_MAIN,
  libraries: [
    {
      name: 'net.neoforged:neoforge:21.1.209',
      downloads: {
        artifact: {
          url: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.209/neoforge-21.1.209-universal.jar',
        },
      },
    },
  ],
};

const offlineFetch = (async (url: unknown) => {
  const u = String(url);
  const body = ((): string => {
    if (u.includes('version_manifest') || u.endsWith('/mc/game/version_manifest_v2.json'))
      return JSON.stringify(MANIFEST);
    if (u === `https://mc/${MC}.json`) return JSON.stringify(BASE_JSON);
    if (u.endsWith('/client.jar')) return 'client-bytes';
    if (u.endsWith('/lwjgl.jar')) return 'lwjgl-bytes';
    if (u.endsWith('neoforge-21.1.209-universal.jar')) return 'neoforge-bytes';
    if (u.startsWith('https://maven.fabricmc.net/')) return 'fabric-bytes';
    return '{}';
  })();
  return {
    ok: !u.endsWith('/not-found'),
    status: 200,
    arrayBuffer: async () => {
      const b = Buffer.from(body);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
  } as Response;
}) as unknown as typeof fetch;

let baseDir: string;
let service: LauncherService;

/** 在 versions/<id>/ 造一份档案 JSON + 一个占位 jar（installer 的产物形态）。 */
function writeProfile(id: string, json: unknown, opts: { versionJar?: boolean } = {}): void {
  const d = join(baseDir, 'versions', id);
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, `${id}.json`), JSON.stringify(json));
  // 真实 Fabric installer（-noprofile）只写 JSON，不产出版本 jar；测试默认
  // 保留占位 jar 是为了兼容旧用例，需要模拟真实产物时传 versionJar:false。
  if (opts.versionJar !== false) writeFileSync(join(d, `${id}.jar`), `jar-of-${id}`);
}

beforeEach(() => {
  baseDir = join(mkdtempSync(join(tmpdir(), 'loader-profile-')), 'mc-launcher');
  mkdirSync(join(baseDir, 'versions', MC), { recursive: true });
  // 加载器档案与原版共用这个客户端 jar
  writeFileSync(join(baseDir, 'versions', MC, `${MC}.jar`), 'client-jar');
  lastArgs = [];
  service = new LauncherService(baseDir, offlineFetch, { spawn: fakeSpawn });
});

afterEach(() => {
  rmSync(join(baseDir, '..'), { recursive: true, force: true });
});

describe('resolveVersion · 加载器档案', () => {
  it('本地有 versions/<id>/<id>.json 时解析继承链（此前直接抛「版本不存在」）', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    expect(detail.id).toBe(LOADER);
    expect(detail.profileChain).toEqual([LOADER, MC]);
    expect(detail.hasLoader).toBe(true);
  });

  it('mainClass 取加载器的引导类，不是原版主类', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    expect(detail.mainClass).toBe(NEOFORGE_MAIN);
    expect(detail.mainClass).not.toBe(VANILLA_MAIN_CLASS);
  });

  it('运行 jar 是原版客户端 jar（加载器档案只写 JSON，不产出版本 jar）', async () => {
    // 真实 Fabric installer -noprofile 的产物：目录里只有 JSON，没有 <id>.jar
    writeProfile(LOADER, LOADER_JSON, { versionJar: false });
    const detail = await service.resolveVersion(LOADER);
    expect(detail.jarPath).toBe(join(baseDir, 'versions', MC, `${MC}.jar`));
    // 加载器自己的 jar 在 libraries 里，靠 classpath 进入，不靠 jarPath
    expect(detail.libraryUrls.map((l) => l.url)).toContain(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.209/neoforge-21.1.209-universal.jar',
    );
  });

  it('assetIndex / javaMajor 来自链底（资源与 JDK 要求是原版那份）', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    expect(detail.assets).toBe('17');
    expect(detail.assetsUrl).toBe(`https://mc/${MC}/assets.json`);
    expect(detail.javaMajor).toBe(21);
  });

  it('libraries 是「加载器的 + 原版的」并集', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    const urls = detail.libraryUrls.map((l) => l.url);
    expect(urls).toContain(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.209/neoforge-21.1.209-universal.jar',
    );
    expect(urls, '原版的库不能因为被继承就丢掉').toContain('https://mc/lib/lwjgl.jar');
  });

  it('纯原版版本 hasLoader=false，且 mainClass 仍是原版主类', async () => {
    const detail = await service.resolveVersion(MC);
    expect(detail.hasLoader).toBe(false);
    expect(detail.mainClass).toBe(VANILLA_MAIN_CLASS);
    expect(detail.profileChain).toEqual([MC]);
    expect(detail.jarPath).toBe(join(baseDir, 'versions', MC, `${MC}.jar`));
  });

  it('真实 Fabric 档案：只声明 name + maven 根的库不能被丢掉', async () => {
    writeProfile(FABRIC_PROFILE, FABRIC_JSON, { versionJar: false });
    const detail = await service.resolveVersion(FABRIC_PROFILE);
    expect(detail.hasLoader).toBe(true);
    expect(detail.mainClass).toBe(FABRIC_MAIN);
    expect(detail.libraryUrls.map((l) => l.url)).toContain(
      'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',
    );
    expect(detail.libraryUrls.map((l) => l.url)).toContain(
      'https://maven.fabricmc.net/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar',
    );
  });

  it('完全未知的版本仍然报「版本不存在」（不是静默给一份空档案）', async () => {
    await expect(service.resolveVersion('9.9.9')).rejects.toThrow(/版本不存在/);
  });
});

describe('launchGame · 加载器实例真的会被加载', () => {
  it('spawn 出去的主类是加载器引导类', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    expect(lastArgs[lastArgs.indexOf('-cp') + 2]).toBe(NEOFORGE_MAIN);
  });

  it('classpath 末位是原版客户端 jar，加载器 universal jar 也在其中', async () => {
    writeProfile(LOADER, LOADER_JSON, { versionJar: false });
    const detail = await service.resolveVersion(LOADER);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    const cp = lastArgs[lastArgs.indexOf('-cp') + 1]!;
    const sep = process.platform === 'win32' ? ';' : ':';
    const entries = cp.split(sep);
    // 游戏类来自原版 jar；没有它加载器主类会 NoClassDefFoundError
    expect(entries.at(-1)).toBe(join(baseDir, 'versions', MC, `${MC}.jar`));
    // 加载器的 universal jar 必须在 classpath 里，否则主类本身都找不到
    expect(entries.some((e) => e.includes('neoforge-21.1.209-universal.jar'))).toBe(true);
  });

  it('真实 Fabric 档案启动：classpath 必须有 fabric-loader / asm，主类是 KnotClient', async () => {
    writeProfile(FABRIC_PROFILE, FABRIC_JSON, { versionJar: false });
    const detail = await service.resolveVersion(FABRIC_PROFILE);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    const cp = lastArgs[lastArgs.indexOf('-cp') + 1]!;
    // 这一条直接防「进程以退出码 1 秒退、连日志都没有」：
    // 缺 fabric-loader jar 时 JVM 报 NoClassDefFoundError，不会创建 latest.log。
    expect(cp).toContain('fabric-loader-0.19.5.jar');
    expect(cp).toContain('asm-9.10.1.jar');
    expect(lastArgs[lastArgs.indexOf('-cp') + 2]).toBe(FABRIC_MAIN);
    expect(lastArgs).toContain(`-Dfabric.gameVersion=${MC}`);
  });

  it('--version 传的是链底版本号，不是加载器档案 id', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    // 给档案 id 的话资源索引会找不到（assetIndex id 就是原版版本号）
    expect(lastArgs[lastArgs.indexOf('--version') + 1]).toBe(MC);
  });

  it('Fabric 实例带上 -Dfabric.modDirs=，指向 gameDir/mods', async () => {
    const fab = 'fabric-loader-0.19.5-1.21.1';
    writeProfile(fab, {
      id: fab,
      inheritsFrom: MC,
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [],
    });
    const detail = await service.resolveVersion(fab);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    // 属性名是 `fabric.dli.modDirs`（`dli` = dev launch impl），不是 `fabric.modDirs`
    const modsArg = lastArgs.find((a) => a.startsWith('-Dfabric.dli.modDirs='));
    expect(modsArg).toBe(`-Dfabric.dli.modDirs=${join(baseDir, 'game', fab, 'mods')}`);
    // 引导类与 gameVersion 也必须给对，否则 Fabric 会去读它自己那份默认 gameDir
    expect(lastArgs[lastArgs.indexOf('-cp') + 2]).toBe(
      'net.fabricmc.loader.impl.launch.knot.KnotClient',
    );
    expect(lastArgs).toContain(`-Dfabric.gameVersion=${MC}`);
  });

  it('启动时把 gameDir/mods 建出来（目录不存在时加载器扫不到）', async () => {
    writeProfile(LOADER, LOADER_JSON);
    const detail = await service.resolveVersion(LOADER);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    expect(existsSync(join(baseDir, 'game', LOADER, 'mods'))).toBe(true);
  });

  it('原版实例不加任何 -D 加载器参数', async () => {
    mkdirSync(join(baseDir, 'versions', MC), { recursive: true });
    writeFileSync(join(baseDir, 'versions', MC, `${MC}.jar`), 'jar');
    const detail = await service.resolveVersion(MC);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    expect(lastArgs.some((a) => a.startsWith('-Dfabric'))).toBe(false);
    expect(lastArgs[lastArgs.indexOf('-cp') + 2]).toBe(VANILLA_MAIN_CLASS);
  });

  it('原版客户端 jar 缺失时报「请先下载客户端」（加载器与原版共用）', async () => {
    writeProfile(LOADER, { ...LOADER_JSON, mainClass: NEOFORGE_MAIN }, { versionJar: false });
    rmSync(join(baseDir, 'versions', MC, `${MC}.jar`));
    const detail = await service.resolveVersion(LOADER);
    await expect(
      service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' }),
    ).rejects.toThrow(/原版 jar 不存在.*请先下载客户端/);
  });
});

describe('加载器识别靠主类，不靠目录名', () => {
  it('isLoaderInstalled 能认出 installer 真实产物目录 <mc>-<loaderVer>', async () => {
    // 旧实现找 `fabric-loader-*` 前缀，而 installer 产物是 `1.21.1-0.16.9`
    // —— 装完了也一直返回 false。
    writeProfile(`${MC}-0.16.9`, {
      id: `${MC}-0.16.9`,
      inheritsFrom: MC,
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [],
    });
    expect(await service.isLoaderInstalled(MC, 'fabric')).toBe(true);
    expect(await service.isLoaderInstalled(MC, 'neoforge')).toBe(false);
  });

  it('没装过就返回 false', async () => {
    expect(await service.isLoaderInstalled(MC, 'fabric')).toBe(false);
  });

  it('findLoaderProfile 返回档案 id（启动必须解析它，不能解析原版 versionId）', async () => {
    writeProfile(`${MC}-0.16.9`, {
      id: `${MC}-0.16.9`,
      inheritsFrom: MC,
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [],
    });
    expect(await service.findLoaderProfile(MC, 'fabric')).toBe(`${MC}-0.16.9`);
    expect(await service.findLoaderProfile(MC, 'neoforge')).toBeNull();
  });

  it('NeoForge 档案不算 Fabric', async () => {
    writeProfile(LOADER, LOADER_JSON);
    expect(await service.isLoaderInstalled(MC, 'neoforge')).toBe(true);
    expect(await service.isLoaderInstalled(MC, 'fabric')).toBe(false);
  });

  it('主类认不出来时不猜：回 vanilla（等价于不加任何 -D）', () => {
    expect(inferLoaderFromMainClass(VANILLA_MAIN_CLASS)).toBe('vanilla');
    expect(inferLoaderFromMainClass(undefined)).toBe('vanilla');
    expect(inferLoaderFromMainClass(null)).toBe('vanilla');
    expect(inferLoaderFromMainClass('com.example.SomeModLauncher')).toBe('vanilla');
  });

  it('主类 → 加载器的映射', () => {
    expect(inferLoaderFromMainClass('net.fabricmc.loader.impl.launch.knot.KnotClient')).toBe(
      'fabric',
    );
    expect(inferLoaderFromMainClass('net.fabricmc.loader.impl.launch.knot.KnotServer')).toBe(
      'fabric',
    );
    expect(inferLoaderFromMainClass('cpw.mods.bootstraplauncher.BootstrapLauncher')).toBe(
      'neoforge',
    );
    expect(inferLoaderFromMainClass('net.neoforged.neoforge.client.launcher.NeoForgeClient')).toBe(
      'neoforge',
    );
  });

  it('launchGame 按主类加参数，不看档案 id 的前缀', async () => {
    // 档案 id 是 `<mc>-<loaderVer>`，里面根本没有 `fabric` 字样
    const fab = `${MC}-0.16.9`;
    writeProfile(fab, {
      id: fab,
      inheritsFrom: MC,
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [],
    });
    const detail = await service.resolveVersion(fab);
    await service.launchGame(detail, { username: 'Steve', memory: '2G', gameDir: '' });
    expect(lastArgs.some((a) => a.startsWith('-Dfabric.dli.modDirs='))).toBe(true);
  });
});

describe('mods 目录跟着 gameDir 走', () => {
  it('缺省是 <baseDir>/game/<v>/mods', () => {
    expect(service.modsDir(MC)).toBe(join(baseDir, 'game', MC, 'mods'));
  });

  it('实例自定义了 gameDir 时，mods 跟着它走（装到 A、启动读 B 是最阴的错）', () => {
    const custom = join(baseDir, 'D-drive', MC);
    expect(service.modsDir(MC, custom)).toBe(join(custom, 'mods'));
  });

  it('自定义 gameDir 越界时被拒', () => {
    expect(() => service.modsDir(MC, join(tmpdir(), 'elsewhere'))).toThrow(
      /必须位于启动器数据目录内/,
    );
  });
});
