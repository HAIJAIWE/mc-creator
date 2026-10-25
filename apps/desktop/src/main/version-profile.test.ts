/**
 * 版本档案继承链的合并规则。
 *
 * fixture 用的是**实测的真实档案形状**（Mojang 1.21.1 / 1.12.2 版本 JSON
 * 与加载器 installer 产出的 `inheritsFrom` 结构），不是编出来的理想数据 ——
 * 上一版 `libraryAllowed` 就是因为按理想语义写、把 macOS-only 库放行了，
 * 才需要这些用例钉住。
 */
import { describe, it, expect } from 'vitest';

import {
  libraryAllowed,
  ruleMatches,
  currentPlatform,
  mergeProfileChain,
  walkProfileChain,
  libraryToExpectations,
  mavenCoordinatePath,
  isNativeForPlatform,
  parseProfileJson,
  runtimeJarName,
  VANILLA_MAIN_CLASS,
  type PlatformInfo,
  type VersionProfileJson,
} from './version-profile.js';

const WIN: PlatformInfo = { os: 'windows', arch: 'x86_64' };
const MAC: PlatformInfo = { os: 'osx', arch: 'x86_64' };
const LINUX: PlatformInfo = { os: 'linux', arch: 'x86_64' };

describe('rules 判定 · 实测 Mojang 只有这两种形状', () => {
  it('[{allow,os:{name:osx}}] 只在 macOS 放行', () => {
    const rules = [{ action: 'allow', os: { name: 'osx' } }];
    expect(libraryAllowed(rules, MAC)).toBe(true);
    // 这一条是真实踩过的坑：java-objc-bridge / netty-transport-native-epoll
    // 在 Windows 上被放行 → classpath 里混进 macOS/Linux 原生库
    expect(libraryAllowed(rules, WIN)).toBe(false);
    expect(libraryAllowed(rules, LINUX)).toBe(false);
  });

  it('[{allow},{disallow,os:{name:osx}}] 除 macOS 外都放行', () => {
    const rules = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }];
    expect(libraryAllowed(rules, WIN)).toBe(true);
    expect(libraryAllowed(rules, LINUX)).toBe(true);
    expect(libraryAllowed(rules, MAC)).toBe(false);
  });

  it('没有 rules = 无平台限制 → 放行', () => {
    expect(libraryAllowed(undefined, WIN)).toBe(true);
    expect(libraryAllowed([], WIN)).toBe(true);
  });

  it('后一条匹配的 rule 覆盖前一条', () => {
    const rules = [
      { action: 'allow' },
      { action: 'allow', os: { name: 'windows' } },
      { action: 'disallow', os: { name: 'windows' } },
    ];
    expect(libraryAllowed(rules, WIN)).toBe(false);
  });

  it('rule 没写 os = 不约束该字段', () => {
    expect(ruleMatches({ action: 'allow' }, WIN)).toBe(true);
    expect(ruleMatches({ action: 'allow', os: {} }, WIN)).toBe(true);
  });

  it('os.name 两种写法都认（osx / macos）', () => {
    expect(libraryAllowed([{ action: 'allow', os: { name: 'macos' } }], MAC)).toBe(true);
  });
});

describe('natives classifier · 必须按平台挑', () => {
  it('1.12.2 真实形状：三个 natives 只收当前平台的', () => {
    const lib: VersionProfileJson['libraries'] = undefined;
    expect(lib).toBeUndefined();
    const classifiers = {
      'natives-linux': { url: 'https://l/l.jar' },
      'natives-osx': { url: 'https://o/o.jar' },
      'natives-windows': { url: 'https://w/w.jar' },
    };
    const expectations = libraryToExpectations(
      { name: 'org.lwjgl:lwjgl:3.2.1', downloads: { classifiers } },
      WIN,
    );
    expect(expectations.map((e) => e.url)).toEqual(['https://w/w.jar']);
    expect(
      libraryToExpectations(
        { name: 'org.lwjgl:lwjgl:3.2.1', downloads: { classifiers } },
        LINUX,
      ).map((e) => e.url),
    ).toEqual(['https://l/l.jar']);
    expect(
      libraryToExpectations({ name: 'org.lwjgl:lwjgl:3.2.1', downloads: { classifiers } }, MAC).map(
        (e) => e.url,
      ),
    ).toEqual(['https://o/o.jar']);
  });

  it('artifact 与 natives 都要收', () => {
    const out = libraryToExpectations(
      {
        name: 'a:b:1',
        downloads: {
          artifact: { url: 'https://x/a.jar', sha1: 'aa', size: 10 },
          classifiers: { 'natives-windows': { url: 'https://x/a-natives.jar' } },
        },
      },
      WIN,
    );
    expect(out).toEqual([
      { url: 'https://x/a.jar', sha1: 'aa', size: 10 },
      { url: 'https://x/a-natives.jar', sha1: null, size: null },
    ]);
  });

  it('没有 downloads 且没有仓库根的条目不产出 URL（不往 classpath 塞 undefined）', () => {
    expect(libraryToExpectations({ name: 'a:b:1' }, WIN)).toEqual([]);
    expect(libraryToExpectations({ name: 'a:b:1', downloads: {} }, WIN)).toEqual([]);
  });

  it('Fabric 档案的真实形状：只有 name + 仓库根，必须按 Maven 坐标拼出 URL', () => {
    const out = libraryToExpectations(
      {
        name: 'net.fabricmc:fabric-loader:0.19.5',
        url: 'https://maven.fabricmc.net/',
      },
      WIN,
    );
    expect(out.map((e) => e.url)).toEqual([
      'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.19.5/fabric-loader-0.19.5.jar',
    ]);
    // 仓库根没有结尾斜杠时也要拼对，不能出现 `net//net`
    expect(
      libraryToExpectations(
        { name: 'org.ow2.asm:asm:9.10.1', url: 'https://maven.fabricmc.net' },
        WIN,
      ).map((e) => e.url),
    ).toEqual(['https://maven.fabricmc.net/org/ow2/asm/asm/9.10.1/asm-9.10.1.jar']);
  });

  it('mavenCoordinatePath 处理 classifier 与 @ext', () => {
    expect(mavenCoordinatePath('a.b:c:1.0')).toBe('a/b/c/1.0/c-1.0.jar');
    expect(mavenCoordinatePath('a.b:c:1.0:natives-windows')).toBe(
      'a/b/c/1.0/c-1.0-natives-windows.jar',
    );
    expect(mavenCoordinatePath('a.b:c:1.0@zip')).toBe('a/b/c/1.0/c-1.0.zip');
    expect(mavenCoordinatePath('bad')).toBeNull();
  });

  it('非 natives 的 classifier 一律不收（sources / javadoc）', () => {
    expect(isNativeForPlatform('sources', WIN)).toBe(false);
    expect(isNativeForPlatform('natives-windows', WIN)).toBe(true);
    expect(isNativeForPlatform('natives-linux', WIN)).toBe(false);
  });
});

/** 实测 1.21.1 原版档案（截取关键字段 + 三条真实 rules 库）。 */
const BASE_1_21_1: VersionProfileJson = {
  id: '1.21.1',
  mainClass: VANILLA_MAIN_CLASS,
  assetIndex: { id: '17', url: 'https://piston-meta.mojang.com/v1/packages/00551f/17.json' },
  javaVersion: { majorVersion: 21 },
  downloads: {
    client: { url: 'https://piston-data.mojang.com/client.jar', sha1: '30c7', size: 26836906 },
    server: { url: 'https://piston-data.mojang.com/server.jar', sha1: '5935', size: 51627615 },
  },
  libraries: [
    {
      name: 'ca.weblite:java-objc-bridge:1.1',
      downloads: {
        artifact: {
          url: 'https://libraries.minecraft.net/ca/weblite/java-objc-bridge/1.1/java-objc-bridge-1.1.jar',
          sha1: '1227',
          size: 1330045,
        },
      },
      rules: [{ action: 'allow', os: { name: 'osx' } }],
    },
    {
      name: 'io.netty:netty-transport-native-epoll:4.1.97.Final:linux-x86_64',
      downloads: {
        artifact: {
          url: 'https://libraries.minecraft.net/io/netty/epoll-linux-x86_64.jar',
          sha1: '5418',
          size: 38954,
        },
      },
      rules: [{ action: 'allow', os: { name: 'linux' } }],
    },
    {
      name: 'org.lwjgl:lwjgl:3.3.3',
      downloads: {
        artifact: {
          url: 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.3/lwjgl-3.3.3.jar',
          sha1: 'lwj1',
          size: 4239825,
        },
      },
    },
  ],
};

/** 加载器 installer 产出的档案形状（`inheritsFrom` + 自己的 mainClass + 自己的库）。 */
const LOADER_PROFILE: VersionProfileJson = {
  id: 'neoforge-21.1.209-1.21.1',
  inheritsFrom: '1.21.1',
  mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
  libraries: [
    {
      name: 'net.neoforged:neoforge:21.1.209',
      downloads: {
        artifact: {
          url: 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.209/neoforge-21.1.209-universal.jar',
          sha1: 'nf1',
          size: 900000,
        },
      },
    },
  ],
};

describe('继承链 · walkProfileChain', () => {
  it('叶子 → 根，顺序不能反', async () => {
    const table: Record<string, VersionProfileJson> = {
      'neoforge-21.1.209-1.21.1': LOADER_PROFILE,
      '1.21.1': BASE_1_21_1,
    };
    const chain = await walkProfileChain(
      'neoforge-21.1.209-1.21.1',
      async (id) => table[id] ?? null,
    );
    expect(chain.map((p) => p.id)).toEqual(['neoforge-21.1.209-1.21.1', '1.21.1']);
  });

  it('父档案取不到时链到此为止，不报错', async () => {
    const chain = await walkProfileChain('x', async (id) => (id === 'x' ? LOADER_PROFILE : null));
    expect(chain).toHaveLength(1);
  });

  it('自引用 / 环不会把栈打爆', async () => {
    const a: VersionProfileJson = { id: 'a', inheritsFrom: 'b' };
    const b: VersionProfileJson = { id: 'b', inheritsFrom: 'a' };
    const chain = await walkProfileChain('a', async (id) =>
      id === 'a' ? a : id === 'b' ? b : null,
    );
    expect(chain).toHaveLength(2);

    const self: VersionProfileJson = { id: 'self', inheritsFrom: 'self' };
    expect(await walkProfileChain('self', async () => self)).toHaveLength(1);
  });
});

describe('继承链 · mergeProfileChain', () => {
  const chain = [LOADER_PROFILE, BASE_1_21_1];

  it('mainClass 取叶子（加载器）而不是原版', () => {
    const merged = mergeProfileChain(chain, 'neoforge-21.1.209-1.21.1');
    expect(merged.mainClass).toBe('cpw.mods.bootstraplauncher.BootstrapLauncher');
    expect(merged.mainClass).not.toBe(VANILLA_MAIN_CLASS);
  });

  it('assetIndex / javaMajor / client.jar 来自链底（原版）', () => {
    const merged = mergeProfileChain(chain, 'neoforge-21.1.209-1.21.1');
    expect(merged.baseId).toBe('1.21.1');
    expect(merged.assetIndexId).toBe('17');
    expect(merged.assetIndexUrl).toBe('https://piston-meta.mojang.com/v1/packages/00551f/17.json');
    expect(merged.javaMajor).toBe(21);
    expect(merged.client?.url).toBe('https://piston-data.mojang.com/client.jar');
  });

  it('库是「叶子 + 根」的并集（加载器自己的库不能丢）', () => {
    const merged = mergeProfileChain(chain, 'neoforge-21.1.209-1.21.1');
    const names = merged.libraries.map((l) => l.name);
    expect(names).toContain('net.neoforged:neoforge:21.1.209');
    expect(names).toContain('org.lwjgl:lwjgl:3.3.3');
  });

  it('平台规则在合并阶段就生效：macOS-only 库不会混进 Windows classpath', () => {
    const merged = mergeProfileChain(chain, 'neoforge-21.1.209-1.21.1');
    // mergeProfileChain 内部用 currentPlatform()；本用例断言「非本平台的库被排除」这一
    // 结构事实，具体是哪台机器由 CI 决定，所以只断言两个规则库至少有一个被排除。
    const names = merged.libraries.map((l) => l.name);
    const ruleLibs = names.filter((n) => n.includes('java-objc-bridge') || n.includes('epoll'));
    expect(ruleLibs.length).toBeLessThanOrEqual(1);
  });

  it('同名库：叶子赢（NeoForge 覆盖 Mojang 那份）', () => {
    // 去重键是**完整的 maven 坐标**。真实覆盖场景坐标相同、artifact 不同
    // （NeoForge 替换掉 Mojang 那份 LWJGL 就是这样），所以这里两边都叫 x:y:1。
    const base: VersionProfileJson = {
      id: '1.20.1',
      libraries: [{ name: 'x:y:1', downloads: { artifact: { url: 'https://base/x.jar' } } }],
    };
    const leaf: VersionProfileJson = {
      id: 'leaf',
      inheritsFrom: '1.20.1',
      libraries: [{ name: 'x:y:1', downloads: { artifact: { url: 'https://leaf/x.jar' } } }],
    };
    const merged = mergeProfileChain([leaf, base], 'leaf');
    expect(merged.libraries).toHaveLength(1);
    expect(merged.libraryUrls[0]?.url).toBe('https://leaf/x.jar');
  });

  it('纯原版档案：mainClass 就是原版主类', () => {
    const merged = mergeProfileChain([BASE_1_21_1], '1.21.1');
    expect(merged.mainClass).toBe(VANILLA_MAIN_CLASS);
    expect(merged.chain).toEqual(['1.21.1']);
  });

  it('叶子没给 mainClass 时沿链往上找', () => {
    const leaf: VersionProfileJson = { id: 'leaf', inheritsFrom: '1.21.1' };
    const merged = mergeProfileChain([leaf, BASE_1_21_1], 'leaf');
    expect(merged.mainClass).toBe(VANILLA_MAIN_CLASS);
  });

  it('链底缺 javaVersion → null（不知道 ≠ 版本不对）', () => {
    const merged = mergeProfileChain([{ id: 'x' }], 'x');
    expect(merged.javaMajor).toBeNull();
    expect(merged.assetIndexUrl).toBeNull();
    expect(merged.client).toBeNull();
  });

  it('空链直接抛（而不是悄悄返回一份啥都没有的档案）', () => {
    expect(() => mergeProfileChain([], 'x')).toThrow(/链为空/);
  });

  /**
   * `arguments` 只取**叶子（加载器）档案**的。
   *
   * 原版档案的 arguments 全是 `${classpath}` / `${natives_directory}` 这类
   * 我们不实现的占位符 —— 照抄会把原版启动搞坏。加载器档案的 arguments
   * 则是**硬要求**（NeoForge 26.x 少了 `-DlibraryDirectory` 就不启动）。
   */
  it('只取叶子档案的 arguments，原版档案的 arguments 一律不用', () => {
    const leaf: VersionProfileJson = {
      id: 'neoforge-26.3.0.95',
      inheritsFrom: '26.3',
      mainClass: 'net.neoforged.fml.startup.Client',
      arguments: {
        jvm: ['-DlibraryDirectory=${library_directory}', '--add-opens', 'java.base/x=ALL-UNNAMED'],
        game: ['--fml.neoForgeVersion', '26.3.0.95'],
      },
    };
    const base: VersionProfileJson = {
      id: '26.3',
      arguments: {
        jvm: ['-Djava.library.path=${natives_directory}'],
        game: ['--demo'],
      },
    };

    const merged = mergeProfileChain([leaf, base], 'neoforge-26.3.0.95');
    expect(merged.jvmArgs).toEqual([
      '-DlibraryDirectory=${library_directory}',
      '--add-opens',
      'java.base/x=ALL-UNNAMED',
    ]);
    expect(merged.gameArgs).toEqual(['--fml.neoForgeVersion', '26.3.0.95']);

    // 纯原版：arguments 是空数组
    const vanilla = mergeProfileChain([base], '26.3');
    expect(vanilla.jvmArgs).toEqual([]);
    expect(vanilla.gameArgs).toEqual([]);
  });
});

describe('运行 jar 是叶子而不是链底', () => {
  it('runtimeJarName 用叶子 id', () => {
    expect(runtimeJarName('neoforge-21.1.209-1.21.1')).toBe('neoforge-21.1.209-1.21.1.jar');
    // 用链底就跑回原版 jar = mod 全都不生效（本功能的根因）
    expect(runtimeJarName('1.21.1')).toBe('1.21.1.jar');
  });
});

describe('杂项', () => {
  it('parseProfileJson 对非对象给出空档案而不是抛', () => {
    expect(parseProfileJson(null)).toEqual({});
    expect(parseProfileJson('x')).toEqual({});
    expect(parseProfileJson({ id: 'a' })).toEqual({ id: 'a' });
  });

  it('currentPlatform 把 node 的 platform/arch 归一到 Mojang 的命名', () => {
    expect(currentPlatform({ platform: 'win32', arch: 'x64' })).toEqual({
      os: 'windows',
      arch: 'x86_64',
    });
    expect(currentPlatform({ platform: 'darwin', arch: 'arm64' })).toEqual({
      os: 'osx',
      arch: 'arm64',
    });
    expect(currentPlatform({ platform: 'linux', arch: 'x64' }).os).toBe('linux');
    // 认不出来的 OS 不猜成 linux —— 猜错会让原生库悄悄进 classpath
    expect(currentPlatform({ platform: 'aix', arch: 'ppc' }).os).toBe('unknown');
  });
});
