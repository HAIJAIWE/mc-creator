// @vitest-environment node
/**
 * 写盘路径的**包含性**审计（实测，不靠推理）。
 *
 * 问题来自用户：「下载和安装的地方都是在本文件夹里面的吗？」
 * 答案不能靠读代码保证 —— 得**逐个打**。本文件对每个写盘点问同一个问题：
 * 把可控输入换成越界值，它会不会写到 baseDir 之外？
 *
 * 覆盖的可控输入有三个来源：
 *   1. 渲染层（IPC 请求体）：gameDir / memory / version
 *   2. 下载来的清单：version json 的 libraries[].url / assets.objects[].hash
 *   3. 渲染层的 mod 名
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

import { LauncherService, type VersionDetail } from './launcher-service.js';

/** 造一个受控的 baseDir，外加一个「不该被写」的兄弟目录 */
function sandbox(): { base: string; outside: string } {
  const root = mkdtempSync(join(tmpdir(), 'contain-'));
  const base = join(root, 'base');
  const outside = join(root, 'outside');
  mkdirSync(base, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { base, outside };
}

/** 递归列出某目录下所有文件（相对路径），用来判断「有没有写到别处」 */
function tree(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, n.name);
      if (n.isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const DETAIL: VersionDetail = {
  id: '26.2',
  assets: '26',
  assetsUrl: 'https://example.invalid/26.json',
  clientUrl: 'https://example.invalid/client.jar',
  libraryUrls: [],
  javaMajor: null,
  clientSha1: null,
  clientSize: null,
  serverUrl: null,
  serverSha1: null,
  serverSize: null,
};

describe('写盘包含性：所有产物都在 baseDir 内', () => {
  let sb: { base: string; outside: string };

  beforeEach(() => {
    sb = sandbox();
  });
  afterEach(() => {
    rmSync(resolve(sb.base, '..'), { recursive: true, force: true });
  });

  it('launchGame：渲染层给的 gameDir 越界时不应 mkdir 到 baseDir 之外', async () => {
    /**
     * 关键：必须**先放好 client.jar**。
     *
     * 首版这个用例在「客户端未下载」处就抛错了 —— 压根没走到 `mkdir(gameDir)`，
     * 于是绿了，但什么都没证明。那是假通过，不是安全。
     * 现在让 launchGame 一路走到第 4 步（jar 检查 → downloadLibraries → mkdir）。
     */
    const jar = join(sb.base, 'versions', DETAIL.id, `${DETAIL.id}.jar`);
    mkdirSync(join(sb.base, 'versions', DETAIL.id), { recursive: true });
    writeFileSync(jar, 'not-a-real-jar');

    const svc = new LauncherService(
      sb.base,
      (async () => {
        const b = Buffer.from('jar');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch,
      {
        probeJava: async () => 21,
        spawn: ((_cmd: string, _args: string[]) => {
          throw new Error('测试不需要真的 spawn');
        }) as never,
      },
    );

    await expect(
      svc.launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: join(sb.outside, 'escaped'),
      }),
    ).rejects.toThrow();

    expect(
      existsSync(join(sb.outside, 'escaped')),
      `gameDir 越界被 mkdir 了：${tree(sb.outside).join(', ') || '(空)'}`,
    ).toBe(false);
  });

  it('launchGame：gameDir 缺省时恒在 baseDir 内（这是当前唯一被允许的形态）', async () => {
    const jar = join(sb.base, 'versions', DETAIL.id, `${DETAIL.id}.jar`);
    mkdirSync(join(sb.base, 'versions', DETAIL.id), { recursive: true });
    writeFileSync(jar, 'not-a-real-jar');

    let seenGameDir: string | null = null;
    const svc = new LauncherService(
      sb.base,
      (async () => {
        const b = Buffer.from('jar');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch,
      {
        probeJava: async () => 21,
        spawn: ((_cmd: string, args: string[]) => {
          seenGameDir = args[args.indexOf('--gameDir') + 1] ?? null;
          throw new Error('到此为止');
        }) as never,
      },
    );

    await expect(
      svc.launchGame(DETAIL, { username: 'Steve', memory: '2G', gameDir: '' }),
    ).rejects.toThrow();

    expect(seenGameDir).toBe(join(sb.base, 'game', DETAIL.id));
  });

  it('downloadLibraries：清单里的 URL 带 .. 时不得写到 baseDir 之外', async () => {
    const svc = new LauncherService(sb.base, (async () => {
      const b = Buffer.from('jar');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);

    // 恶意清单：library 的 URL 路径里塞 ..
    await svc
      .downloadLibraries({
        ...DETAIL,
        libraryUrls: [
          {
            url: 'https://x.invalid/maven/../../../../escaped.jar',
            sha1: null,
            size: null,
          },
        ],
      })
      .catch(() => undefined);

    const escaped = existsSync(join(sb.base, '..', 'escaped.jar'));
    expect(escaped, 'libraries 的路径被 URL 里的 .. 带出了 baseDir').toBe(false);
    // 并且 baseDir 之外不该出现任何东西
    expect(tree(sb.outside)).toEqual([]);
  });

  it('downloadAssets：索引里的 hash 带 .. 时不得写到 baseDir 之外', async () => {
    const index = { objects: { x: { hash: '../../../../escaped-asset', size: 3 } } };
    const indexBuf = Buffer.from(JSON.stringify(index));
    const svc = new LauncherService(sb.base, (async (url: string) => {
      if (url.includes('26.json')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            indexBuf.buffer.slice(indexBuf.byteOffset, indexBuf.byteOffset + indexBuf.byteLength),
        } as Response;
      }
      const b = Buffer.from('abc');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);

    await svc.downloadAssets(DETAIL).catch(() => undefined);

    expect(existsSync(join(sb.base, '..', 'escaped-asset')), 'hash 里的 .. 带出了 baseDir').toBe(
      false,
    );
    expect(tree(sb.outside)).toEqual([]);
  });

  it('launchGame：baseDir 内的自定义 gameDir 仍然放行（能力没被砍掉）', async () => {
    const jar = join(sb.base, 'versions', DETAIL.id, `${DETAIL.id}.jar`);
    mkdirSync(join(sb.base, 'versions', DETAIL.id), { recursive: true });
    writeFileSync(jar, 'not-a-real-jar');

    let seen: string | null = null;
    const svc = new LauncherService(
      sb.base,
      (async () => {
        const b = Buffer.from('jar');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch,
      {
        probeJava: async () => 21,
        spawn: ((_cmd: string, args: string[]) => {
          seen = args[args.indexOf('--gameDir') + 1] ?? null;
          throw new Error('SPAWN_REACHED');
        }) as never,
      },
    );

    const custom = join(sb.base, 'game', '我的实例');
    await expect(
      svc.launchGame(DETAIL, { username: 'Steve', memory: '2G', gameDir: custom }),
      'baseDir 内的自定义 gameDir 被拒了 —— 守卫过宽，把能力一起砍了',
    ).rejects.toThrow(/SPAWN_REACHED/);
    expect(seen).toBe(custom);
    expect(existsSync(custom)).toBe(true);
  });

  it('launchGame：detail.id 带路径穿越时必须在碰磁盘前就被拒', async () => {
    const svc = new LauncherService(sb.base);

    /**
     * 这条是**补**出来的：守卫加了却一度没写用例，变异测试把它标成"存活"。
     * 少一条断言，看起来绿着的守卫其实没人盯。
     *
     * 断言点在 launchGame 的**第一条语句**，所以不需要先放 jar ——
     * 守卫要是没生效，后面的 `join(baseDir,'versions','../../..')` 才会跑。
     */
    for (const bad of ['../../..', '..', 'a/b', 'a\\b', '']) {
      await expect(
        svc.launchGame({ ...DETAIL, id: bad }, { username: 'Steve', memory: '2G', gameDir: '' }),
        `detail.id=${JSON.stringify(bad)} 没被 assertVersionId 拒掉`,
      ).rejects.toThrow(/非法的版本目录名/);
    }
    // 反证：正常版本号不该被这条守卫误伤（会走到"客户端未下载"）
    await expect(
      svc.launchGame(DETAIL, { username: 'Steve', memory: '2G', gameDir: '' }),
    ).rejects.toThrow(/客户端未下载/);
  });

  it('launchGame：内存参数只接受 JVM 认得的单一内存规格', async () => {
    const jar = join(sb.base, 'versions', DETAIL.id, `${DETAIL.id}.jar`);
    mkdirSync(join(sb.base, 'versions', DETAIL.id), { recursive: true });
    writeFileSync(jar, 'not-a-real-jar');

    const svc = new LauncherService(
      sb.base,
      (async () => {
        const b = Buffer.from('jar');
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
        } as Response;
      }) as unknown as typeof fetch,
      {
        probeJava: async () => 21,
        // 哨兵：证明合法值真的**走到了 spawn**，而不是撞上某个无关的下游错误。
        // 之前这里返回 undefined，于是 `attachErrorGuard(undefined)` 抛了个
        // 与被测行为毫无关系的错，反证等于没反。
        spawn: (() => {
          throw new Error('SPAWN_REACHED');
        }) as never,
      },
    );

    /**
     * 严重性要说准：这**不是** RCE。`memory` 落在 argv 的**一个元素**里，
     * 塞空格也分裂不成独立 JVM 选项，`-javaagent:` 因此无法生效。
     * 真实后果是游戏起来了却在 JVM 内部炸掉，报
     * `Invalid maximum heap size` 这种与用户操作无关的错 ——
     * 正是本会话一直在清的「静默失败」那一类。
     */
    for (const bad of [
      '2G -XX:+UseSerialGC',
      '-javaagent:evil.jar',
      '2G;calc',
      'abc',
      '',
      '99999999999G',
    ]) {
      await expect(
        svc.launchGame(DETAIL, { username: 'Steve', memory: bad, gameDir: '' }),
        `memory=${JSON.stringify(bad)} 被放行了`,
      ).rejects.toThrow(/非法的内存设置/);
    }

    // 反证：真实写法仍放行 —— 且必须一路走到 spawn，不能只断言"没抛内存错"
    for (const ok of ['2G', '4096M', '1024', '512m']) {
      await expect(
        svc.launchGame(DETAIL, { username: 'Steve', memory: ok, gameDir: '' }),
        `memory=${ok} 合法却在到达 spawn 前就被拒了`,
      ).rejects.toThrow(/SPAWN_REACHED/);
    }
  });

  it('installMod：mod 名带路径分隔符时必须留在 modsDir 内', async () => {
    const svc = new LauncherService(sb.base, (async () => {
      const b = Buffer.from('jar');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);

    const escaped = await svc
      .installMod('26.2', '../../../escaped.jar', 'https://x.invalid/a.jar')
      .then((p) => resolve(p))
      .catch(() => null);

    /**
     * 要求**被拒**，而不是"允许它写在 mods 目录外"。
     *
     * 注意首版这里断言的是「不逃出 baseDir」—— 那样会**假通过**：
     * `join(mods, '../../../x.jar')` 恰好落在 baseDir 根内（mods → 版本 → versions → base），
     * 于是测试绿了，但 mods 目录已经被逃出、能覆盖别处的文件。
     * 断言必须精确到 modsDir 这一层，洞才现形。
     */
    expect(
      escaped,
      'mod 名带路径穿越时应该直接被拒（assertModName 抛错），而不是写到别处',
    ).toBeNull();
  });

  it('modsDir 里的 version 带路径穿越时必须被 assertVersionId 拒掉', () => {
    const svc = new LauncherService(sb.base);
    const good = resolve(svc.modsDir('26.2'));
    for (const bad of ['../../..', '..', 'a/b', 'a\\b', '']) {
      expect(
        () => svc.modsDir(bad),
        `version=${JSON.stringify(bad)} 没有被拒 —— 它会指向 baseDir 之外`,
      ).toThrow(/非法的版本目录名/);
    }
    // 反证：守卫不是"一律拒绝"，正常版本仍给出正确路径
    expect(resolve(svc.modsDir('26.2'))).toBe(good);
  });

  it('toggleMod / removeMod 同样受 Mod 名守卫（共用同一个断言）', async () => {
    const svc = new LauncherService(sb.base);
    // 两个方法签名不同（toggleMod 多一个 enabled），所以逐个显式调用，
    // 不做循环套用 —— 否则签名一改，这条用例就变成在测类型而不是测守卫。
    await expect(
      svc.toggleMod('26.2', '../../../escaped.jar', true),
      'toggleMod 接受了带路径穿越的 mod 名',
    ).rejects.toThrow(/非法的 Mod 文件名/);
    await expect(
      svc.removeMod('26.2', '../../../escaped.jar'),
      'removeMod 接受了带路径穿越的 mod 名',
    ).rejects.toThrow(/非法的 Mod 文件名/);
  });

  it('installSkinSupport 的配置写在 gameDir 内（不在 baseDir 之外）', async () => {
    const svc = new LauncherService(sb.base, (async () => {
      const b = Buffer.from('x');
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength),
      } as Response;
    }) as unknown as typeof fetch);
    await svc.installSkinSupport('26.2', 'https://littleskin.cn/api').catch(() => undefined);
    expect(tree(sb.outside)).toEqual([]);
  });

  it('gameDir() 返回的实例目录恒在 baseDir 内', () => {
    const svc = new LauncherService(sb.base);
    for (const v of ['26.2', '1.21.11', '26.4-snapshot-3']) {
      const p = svc.gameDir(v);
      expect(relative(resolve(sb.base), resolve(p)).startsWith('..')).toBe(false);
      expect(isAbsolute(relative(resolve(sb.base), resolve(p)))).toBe(false);
    }
  });
});
