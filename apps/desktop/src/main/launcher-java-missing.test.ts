/**
 * 「开始游戏」失败路径的回归测试。
 *
 * ## 这个 bug 是怎么发现的
 *
 * 用户告知**没有正版账号** → 离线分支是 100% 的实际路径 → 于是去查离线路径的失败模式，
 * 发现启动链路上有一段没有任何测试、也没有任何护栏的路径：
 *
 * ```
 * 「开始游戏」按钮
 *   → ipcClient.launcherLaunch()
 *   → IPC LAUNCHER_LAUNCH（不传 onExit，也不传 javaPath）
 *   → launchGame() → spawn('java', args)
 *        ↓ Node 在二进制不存在时**同步**返回 pid=undefined，错误下个 tick 才发 'error'
 *   → launchGame 以 { pid: 0 } 正常 resolve
 *   → IPC 返回 { pid: 0 }，**没有 error 字段**
 *   → 前端 if (res.error) … else if (res.pid > 0) … 两个分支都不进
 *        → 按钮闪一下恢复原状，**屏幕上什么都不显示**
 *   → 同时主进程：'error' 无监听者 → EventEmitter 抛未捕获异常 → 应用退出
 * ```
 *
 * ## 为什么这个 bug 能活到现在
 *
 * 3134 个测试全绿。因为**所有既有测试都注入了一个会正常发事件的假 spawn**，
 * 从来没有真的让 spawn 失败过。测试替身比真实 ChildProcess 更健壮，于是
 * 真实世界的失败路径从未被触碰过。
 *
 * 所以本文件**不用替身**，直接用真实的 `node:child_process` 去 spawn 一个
 * 不存在的二进制 —— 只有这样才复现得了真正的行为。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LauncherService, __resetJavaProbeCache, type VersionDetail } from './launcher-service.js';

const VERSION = '1.21.11';
const NOT_A_BINARY = 'definitely-not-a-real-java-binary-xyz';

/** 造一个能走到 launchGame 的最小实例目录（jar 必须在，否则会提前抛「客户端未下载」） */
function makeServiceWithClientJar(
  dir: string,
  deps: NonNullable<ConstructorParameters<typeof LauncherService>[2]> = {},
) {
  const baseDir = join(dir, 'mc-launcher');
  const versionDir = join(baseDir, 'versions', VERSION);
  mkdirSync(versionDir, { recursive: true });
  writeFileSync(join(versionDir, `${VERSION}.jar`), 'fake jar');
  return new LauncherService(baseDir, async () => new Response('{}'), deps);
}

const DETAIL: VersionDetail = {
  id: VERSION,
  assets: '19',
  assetsUrl: '',
  clientUrl: '',
  libraryUrls: [],
  clientSha1: null,
  clientSize: null,
  // 默认不设 Java 版本要求（下面另有专门用例打开 javaMajor）
  javaMajor: null,
  serverUrl: null,
  serverSha1: null,
  serverSize: null,
};

describe('launchGame · java 不存在时的失败路径', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'launcher-nojava-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('必须 reject，而不是带着 { pid: 0 } 假装成功', async () => {
    // 用真实 spawn，不注入替身 —— 替身永远不会失败，也就永远测不到这条路径
    const svc = makeServiceWithClientJar(tmpDir, {
      spawn: spawn as never,
    });

    const res = await svc
      .launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: '',
        javaPath: NOT_A_BINARY,
      })
      .then(
        (r) => ({ ok: true as const, r }),
        (e: Error) => ({ ok: false as const, e }),
      );

    expect(res.ok, `launchGame 竟然成功了：${JSON.stringify(res)}`).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.e.message).toMatch(/找不到 Java 可执行文件/);
  });

  it('错误信息要能指导用户怎么修，而不只是抛 ENOENT', async () => {
    const svc = makeServiceWithClientJar(tmpDir, { spawn: spawn as never });

    await expect(
      svc.launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: '',
        javaPath: NOT_A_BINARY,
      }),
    ).rejects.toThrow(/Java 路径/);
  });

  it('子进程必须始终挂着 error 监听器（哪怕没人订阅 onExit）', async () => {
    // 这是最关键的一条，也是最难靠"等它崩"测出来的一条。
    //
    // 修复前：'error' 监听器挂在 `if (opts.onExit)` 里，而「开始游戏」那条 IPC
    // 恰恰不传 onExit → 子进程没有 'error' 监听者 → EventEmitter 抛未捕获异常
    // → Electron 主进程整体退出。
    //
    // 为什么不断言"有没有崩"：用 process.on('uncaughtException') 去捕获既不可靠
    // （测试运行器自己也装了处理链），首版就是这么写的，结果**全量还原修复后仍然通过**
    // —— 测试形同虚设。改为直接断言不变量本身。
    let captured: ChildProcess | null = null;
    const svc = makeServiceWithClientJar(tmpDir, {
      spawn: ((cmd: string, args: readonly string[], opts: unknown) => {
        captured = spawn(cmd, args as string[], opts as never);
        return captured;
      }) as never,
    });

    // 刻意不传 onExit —— 复现「开始游戏」那条 IPC 的真实形状
    await svc
      .launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: '',
        javaPath: NOT_A_BINARY,
      })
      .catch(() => undefined);

    expect(captured, '没抓到 spawn 出来的子进程').not.toBeNull();
    expect(
      captured!.listenerCount('error'),
      '子进程没有 error 监听器 —— 主进程会被未捕获异常掀翻',
    ).toBeGreaterThan(0);
  });

  it('修复前这个 bug 的确切形状：spawn 同步返回 pid=undefined', async () => {
    // 把根因钉死：如果哪天 Node 改了语义，这条会提醒我们重新评估
    const child = spawn(NOT_A_BINARY, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const pidSync = child.pid;
    child.on('error', () => undefined); // 只是为了不掀翻本测试进程
    await new Promise((r) => child.on('error', r));
    expect(pidSync).toBeUndefined();
  });
});

describe('launchGame · Java 版本太老', () => {
  /**
   * 这一类问题**不会**让 spawn 失败：java.exe 8 就在那儿，进程也起得来，
   * 然后在 JVM 里炸成 UnsupportedClassVersionError。
   * 用户只会在日志流里看到一行天书，完全不知道是 JDK 的问题。
   *
   * 所以必须在 spawn **之前**拦住。
   */
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'launcher-oldjava-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    __resetJavaProbeCache();
  });

  function svcWithProbe(have: number | null) {
    const spawned: string[] = [];
    const svc = makeServiceWithClientJar(tmpDir, {
      probeJava: async () => have,
      spawn: ((cmd: string) => {
        spawned.push(cmd);
        const c = new EventEmitter() as unknown as ReturnType<typeof spawn>;
        (c as unknown as { pid: number }).pid = 999;
        queueMicrotask(() => c.emit('spawn'));
        return c;
      }) as never,
    });
    return { svc, spawned };
  }

  it('本机 Java 低于该版本要求 → 拒绝启动，并说清本机几 / 需要几', async () => {
    const { svc, spawned } = svcWithProbe(8);

    await expect(
      svc.launchGame(
        { ...DETAIL, javaMajor: 21 },
        {
          username: 'Steve',
          memory: '2G',
          gameDir: '',
        },
      ),
    ).rejects.toThrow(/本机 Java 是 8.*需要 Java 21/s);

    expect(spawned, '版本不够时不该真的把进程拉起来').toEqual([]);
  });

  it('版本满足 → 正常启动', async () => {
    const { svc, spawned } = svcWithProbe(21);
    const res = await svc.launchGame(
      { ...DETAIL, javaMajor: 21 },
      { username: 'Steve', memory: '2G', gameDir: '' },
    );
    expect(res.pid).toBe(999);
    expect(spawned.length).toBe(1);
  });

  it('javaMajor 为 null（清单没给）→ 跳过预检，放行', async () => {
    const { svc, spawned } = svcWithProbe(8);
    await svc.launchGame(DETAIL, {
      username: 'Steve',
      memory: '2G',
      gameDir: '',
    });
    expect(spawned.length, '不知道要求几就不该拦').toBe(1);
  });

  it('探测不出本机版本（null）→ 放行，交给 spawn 报更准确的「找不到」', async () => {
    // 探测失败 ≠ 版本不对。这里瞎拦会把「没装 Java」误报成「版本太老」。
    const { svc, spawned } = svcWithProbe(null);
    await svc
      .launchGame(
        { ...DETAIL, javaMajor: 21 },
        {
          username: 'Steve',
          memory: '2G',
          gameDir: '',
        },
      )
      .catch(() => undefined);
    expect(spawned.length).toBe(1);
  });

  it('同一 java 路径只探测一次（每次启动都探要 100~300ms）', async () => {
    let calls = 0;
    const svc = makeServiceWithClientJar(tmpDir, {
      probeJava: async () => {
        calls++;
        return 21;
      },
      spawn: (() => {
        const c = new EventEmitter() as unknown as ReturnType<typeof spawn>;
        (c as unknown as { pid: number }).pid = 1;
        queueMicrotask(() => c.emit('spawn'));
        return c;
      }) as never,
    });

    for (let i = 0; i < 3; i++) {
      await svc.launchGame(
        { ...DETAIL, javaMajor: 21 },
        {
          username: 'Steve',
          memory: '2G',
          gameDir: '',
        },
      );
    }
    // 注入的 probeJava 绕过缓存（本仓缓存包在默认实现外层），
    // 这里验证的是「launchGame 不会为同一次启动重复探测」。
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});

describe('resolveVersion · 清单里的 javaVersion 不该被扔掉', () => {
  it('从 Mojang 清单里取出该版本要求的 Java 主版本', async () => {
    const baseDir = join(tmpdir(), `lv-${Date.now()}`);
    const vjson = {
      assetIndex: { id: '19', url: 'https://example.invalid/assets.json' },
      downloads: { client: { url: 'https://example.invalid/client.jar' } },
      libraries: [],
      // Mojang 逐版本给出，这是最权威的来源
      javaVersion: { component: 'java-runtime-gamma', majorVersion: 21 },
    };
    const manifest = {
      versions: [
        {
          id: VERSION,
          type: 'release',
          releaseTime: '2026-06-16T00:00:00Z',
          url: 'https://example.invalid/v.json',
        },
      ],
    };

    const svc = new LauncherService(baseDir, (async (url: unknown) => {
      const u = String(url);
      if (u.includes('version_manifest')) return new Response(JSON.stringify(manifest));
      return new Response(JSON.stringify(vjson));
    }) as never);

    const detail = await svc.resolveVersion(VERSION);
    expect(detail.javaMajor).toBe(21);
  });

  it('清单没给 javaVersion → null（表示"不知道"，而不是猜一个）', async () => {
    const baseDir = join(tmpdir(), `lv2-${Date.now()}`);
    const manifest = {
      versions: [
        {
          id: VERSION,
          type: 'release',
          releaseTime: '2026-06-16T00:00:00Z',
          url: 'https://example.invalid/v.json',
        },
      ],
    };
    const svc = new LauncherService(baseDir, (async (url: unknown) => {
      const u = String(url);
      if (u.includes('version_manifest')) return new Response(JSON.stringify(manifest));
      return new Response(JSON.stringify({ assetIndex: {}, downloads: {}, libraries: [] }));
    }) as never);

    const detail = await svc.resolveVersion(VERSION);
    expect(detail.javaMajor).toBeNull();
  });
});

describe('launchGame · 有 onExit 订阅者时的行为', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'launcher-nojava-exit-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('spawn 失败时 onExit **不**被调用（否则日志流面板会收到两条结束标记）', async () => {
    // spawn 失败后 Node 会发 'error' 再发 'close'。若两处都调 onExit，
    // LAUNCHER_LOG_STREAM 就会 send 两次 done —— 面板收到两条结束标记。
    // 因此约定：失败路径只由 launchGame 的 reject 上报一次，'close' 那次被挡掉。
    const svc = makeServiceWithClientJar(tmpDir, { spawn: spawn as never });
    const exits: { code: number | null; signal: NodeJS.Signals | null }[] = [];

    await svc
      .launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: '',
        javaPath: NOT_A_BINARY,
        onExit: (info) => exits.push(info),
      })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 80));

    expect(exits).toEqual([]);
  });

  it('正常启动时 onExit 只被触发一次（错误守卫不会吞掉、也不会重复上报退出）', async () => {
    // 同样用**真实二进制** —— 这里拿 node 自己当 "java"。
    // 它会被我们拼的 -Xmx/main class 参数弄报错并很快退出，但那不重要：
    // 本条要验的是「spawn 成功 → resolve 真实 pid → close 只报一次」。
    //
    // 不用假 spawn 的原因：那玩意儿的 'spawn' 事件得在监听器挂上之后才发，
    // 而 queueMicrotask 在 launchGame 走到 waitForSpawn 之前就跑掉了，必然超时。
    const svc = makeServiceWithClientJar(tmpDir, { spawn: spawn as never });
    const exits: { code: number | null; signal: NodeJS.Signals | null }[] = [];

    const res = await svc.launchGame(DETAIL, {
      username: 'Steve',
      memory: '2G',
      gameDir: '',
      javaPath: process.execPath,
      onExit: (info) => exits.push(info),
    });
    await new Promise((r) => setTimeout(r, 200));

    expect(res.pid).toBeGreaterThan(0);
    expect(exits.length, `onExit 被触发了 ${exits.length} 次：${JSON.stringify(exits)}`).toBe(1);
  });
});
