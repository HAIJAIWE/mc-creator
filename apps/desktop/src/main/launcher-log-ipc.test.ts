/**
 * L7「游戏日志」在**主进程侧**的接线测试。
 *
 * 覆盖三层：
 *  1. `LauncherService` 的日志文件读取（latest.log / crash-reports）——含目录不存在
 *     时必须返回空而不是抛，以及**路径穿越必须被拒**；
 *  2. `launchGame` 的 `onLog` 逐行转发——重点是**跨 chunk 的半行**，
 *     这是真实管道按 64KB 切块时最常见的错法；
 *  3. `main/ipc/launcher.ts` 的 4 个 handler 接线（通道、字段、requestId、done 标记）。
 *
 * spawn 一律经 `LauncherServiceDeps.spawn` 注入（不 `vi.mock('node:child_process')`：
 * 本仓 vitest 2.1 上它会静默失效，真的去起 java）。
 */
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { spawn } from 'node:child_process';

/** vi.mock 的工厂是懒执行的，但 import 是提升的 —— 用 hoisted 兜住 TDZ。 */
const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  listeners: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => {
      h.handlers.set(ch, fn);
    },
    on: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => {
      h.listeners.set(ch, fn);
    },
    removeHandler: (ch: string) => {
      h.handlers.delete(ch);
    },
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getPath: () => h.userData, on: () => undefined },
}));

import { registerLauncherHandlers } from './ipc/launcher.js';
import { InstanceRegistry } from './instance-registry.js';
import { LauncherService, type VersionDetail } from './launcher-service.js';
import { LAUNCHER_GAME_EXIT } from '../shared/ipc/launcher.js';
import {
  LAUNCHER_LAUNCH,
  LAUNCHER_LIST_CRASH_REPORTS,
  LAUNCHER_LOG_STREAM,
  LAUNCHER_LOG_STREAM_CHUNK,
  LAUNCHER_READ_CRASH_REPORT,
  LAUNCHER_READ_LATEST_LOG,
} from '../shared/ipc-channels.js';

const VER = '26.2';
const DETAIL: VersionDetail = {
  id: VER,
  assets: '26',
  assetsUrl: '',
  clientUrl: 'https://example.invalid/client.jar',
  libraryUrls: [],
  clientSha1: null,
  clientSize: null,
  // 本文件只关心日志流转发，不设 Java 版本要求 → launchGame 跳过预检
  javaMajor: null,
  serverUrl: null,
  serverSha1: null,
  serverSize: null,
};

/** 不联网的假 fetch：只认 client.jar。 */
const offlineFetch = (async (url: string) => {
  if (url.endsWith('client.jar')) return new Response(Buffer.from('jar'), { status: 200 });
  return new Response(null, { status: 404 });
}) as unknown as typeof fetch;

// ===== 假子进程 =====

/** 够用的 stdio 流桩：EventEmitter + 可断言的 destroy/resume。 */
function makeStream(): EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
} {
  const ee = new EventEmitter() as EventEmitter & {
    destroy: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
  };
  ee.destroy = vi.fn();
  ee.resume = vi.fn();
  return ee;
}

type FakeChild = EventEmitter & {
  pid: number;
  stdout: ReturnType<typeof makeStream>;
  stderr: ReturnType<typeof makeStream>;
};

function makeChild(pid = 4242): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.pid = pid;
  child.stdout = makeStream();
  child.stderr = makeStream();
  return child;
}

/** 记录最近一次 spawn 出来的假子进程。 */
let lastChild: FakeChild | null = null;
const fakeSpawn = (() => {
  lastChild = makeChild();
  // 真实 ChildProcess 成功 spawn 后会发一次 'spawn'，launchGame 等这个事件
  // 才能区分「起来了」与「二进制不存在」。替身不发，launchGame 会永远挂住。
  queueMicrotask(() => lastChild?.emit('spawn'));
  return lastChild;
}) as unknown as typeof spawn;

function serviceAt(baseDir: string): LauncherService {
  return new LauncherService(baseDir, offlineFetch, { spawn: fakeSpawn });
}

let tmpDir: string;
let baseDir: string;

/**
 * 测试用的实例名。
 *
 * 多实例之后 game 目录的键是**实例名**而不是 MC 版本号（见 `InstanceRecord.id`
 * 的注释）。这里刻意让它 ≠ `VER`，免得测试因为「两者恰好相等」而掩盖了
 * 「用版本号当目录键」这类错误。
 */
const INST = '测试实例';

/** `baseDir/game/<实例名>` —— 与 launchGame / readLatestLog 同一处。 */
function gameDir(instance = INST): string {
  return join(baseDir, 'game', instance);
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'launcher-log-'));
  baseDir = join(tmpDir, 'mc-launcher');
  mkdirSync(baseDir, { recursive: true });
  lastChild = null;
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ===========================================================================
// 1. 日志文件读取：目录不存在必须返回空，不能抛
// ===========================================================================
describe('L7 日志文件读取 · 空状态（没玩过 / 目录不存在）', () => {
  it('readLatestLog：logs/ 目录不存在 → []（不抛）', async () => {
    await expect(serviceAt(baseDir).readLatestLog(VER)).resolves.toEqual([]);
  });

  it('readLatestLog：版本目录存在但 latest.log 不存在 → []', async () => {
    mkdirSync(join(gameDir(), 'logs'), { recursive: true });
    await expect(serviceAt(baseDir).readLatestLog(VER)).resolves.toEqual([]);
  });

  it('listCrashReports：crash-reports/ 目录不存在 → []（不抛）', async () => {
    await expect(serviceAt(baseDir).listCrashReports(VER)).resolves.toEqual([]);
  });

  it('readCrashReport：文件不存在 → ""（不抛）', async () => {
    mkdirSync(join(gameDir(), 'crash-reports'), { recursive: true });
    await expect(serviceAt(baseDir).readCrashReport(VER, 'crash-none.txt')).resolves.toBe('');
  });
});

describe('L7 日志文件读取 · 正常路径', () => {
  it('readLatestLog 逐行返回，且不把尾部换行切成空行', async () => {
    mkdirSync(join(gameDir(), 'logs'), { recursive: true });
    writeFileSync(join(gameDir(), 'logs', 'latest.log'), '[12:00:00] a\n[12:00:01] b\n', 'utf-8');
    // 第一个参数是**实例名**（`game/<实例>/logs/`），不是 MC 版本号
    await expect(serviceAt(baseDir).readLatestLog(INST)).resolves.toEqual([
      '[12:00:00] a',
      '[12:00:01] b',
    ]);
  });

  it('listCrashReports 只收 crash-*.txt，按新→旧排', async () => {
    const dir = join(gameDir(), 'crash-reports');
    mkdirSync(dir, { recursive: true });
    for (const f of ['crash-2026-01-01.txt', 'crash-2026-03-03.txt', 'notes.txt', 'latest.log']) {
      writeFileSync(join(dir, f), 'x', 'utf-8');
    }
    await expect(serviceAt(baseDir).listCrashReports(INST)).resolves.toEqual([
      'crash-2026-03-03.txt',
      'crash-2026-01-01.txt',
    ]);
  });

  it('readCrashReport 读出实例目录内的报告', async () => {
    const dir = join(gameDir(), 'crash-reports');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'crash-2026-03-03.txt'), 'boom stack', 'utf-8');
    await expect(serviceAt(baseDir).readCrashReport(INST, 'crash-2026-03-03.txt')).resolves.toBe(
      'boom stack',
    );
  });

  it('⚠️ 实例名带路径穿越 → 被拒（它直接参与 game/<name>/ 拼接）', async () => {
    await expect(serviceAt(baseDir).readLatestLog('../../..')).rejects.toThrow(/非法的版本目录名/);
    await expect(serviceAt(baseDir).listCrashReports('../../..')).rejects.toThrow(
      /非法的版本目录名/,
    );
  });
});

// ===========================================================================
// 2. 路径穿越（变异测试目标：把 resolveInside 去掉，本组必须变红）
// ===========================================================================
describe('L7 路径穿越守卫', () => {
  /**
   * 按「**去掉守卫的朴素实现**会落到哪」精确放置诱饵文件。
   *
   * 不能随便找个地方放：朴素实现走的是 `join(root, filename)`，
   * `../../evil.txt` 落到的是 `game/evil.txt` 而不是 `tmp/evil.txt`。
   * 放错位置时「读不到诱饵」会**因为文件不存在**而假性通过 ——
   * 那条断言就形同虚设（实测踩过：变异测试第一轮就是这么漏过去的，
   * 守卫拿掉后诱饵内容照样没外泄，只是断言「碰巧」没红）。
   */
  function plantDecoy(filename: string): string {
    const naiveTarget = join(baseDir, 'game', VER, 'crash-reports', filename);
    mkdirSync(dirname(naiveTarget), { recursive: true });
    writeFileSync(naiveTarget, 'TOP-SECRET-OUTSIDE-INSTANCE', 'utf-8');
    return naiveTarget;
  }

  it('⚠️ readCrashReport("../../evil.txt") 被拒：既抛错，也绝不返回实例目录外的内容', async () => {
    plantDecoy('../../evil.txt');
    const svc = serviceAt(baseDir);
    const p = svc.readCrashReport(VER, '../../evil.txt');
    // 守卫抛错（不能静默返回空串，否则 UI 上「越权」和「文件没了」长得一样）
    await expect(p).rejects.toThrow(/路径越界/);
    // 真正要命的断言：诱饵就摆在朴素实现能读到的地方，任何情况下都不许外泄
    await expect(p.catch(() => '')).resolves.not.toContain('TOP-SECRET');
  });

  it('⚠️ 绝对路径的 filename 也被拒', async () => {
    plantDecoy('../../evil.txt');
    await expect(serviceAt(baseDir).readCrashReport(VER, join(tmpDir, 'evil.txt'))).rejects.toThrow(
      /路径越界/,
    );
  });

  it('⚠️ 中段穿越（a/b/../../../evil.txt）同样被拒，且诱饵不外泄', async () => {
    plantDecoy('a/b/../../../evil.txt');
    const p = serviceAt(baseDir).readCrashReport(VER, 'a/b/../../../evil.txt');
    await expect(p).rejects.toThrow(/路径越界/);
    await expect(p.catch(() => '')).resolves.not.toContain('TOP-SECRET');
  });

  it('⚠️ 空 filename 被拒（否则会退化成读目录本身）', async () => {
    await expect(serviceAt(baseDir).readCrashReport(VER, '')).rejects.toThrow(/路径越界/);
  });

  it('⚠️ 只守 filename 不够：versionId 越界同样被拒', async () => {
    // 只对 filename 做 resolveInside 时，versionId='../../..' 会把 root 本身
    // 挪出实例目录，后面的守卫形同虚设。
    await expect(serviceAt(baseDir).readCrashReport('../../..', 'evil.txt')).rejects.toThrow(
      /非法的版本目录名/,
    );
    await expect(serviceAt(baseDir).readLatestLog('../../..')).rejects.toThrow(/非法的版本目录名/);
    await expect(serviceAt(baseDir).listCrashReports('a/b')).rejects.toThrow(/非法的版本目录名/);
  });
});

// ===========================================================================
// 3. launchGame 的 onLog 逐行转发
// ===========================================================================
describe('L7 launchGame · onLog 逐行转发', () => {
  /** 下载 client.jar，让 launchGame 能走到 spawn。 */
  async function seed(dir: string): Promise<void> {
    await serviceAt(dir).downloadClient(DETAIL);
  }

  async function launch(dir: string, onLog?: (line: string) => void): Promise<FakeChild> {
    await serviceAt(dir).launchGame(DETAIL, {
      username: 'Steve',
      memory: '2G',
      gameDir: join(dir, 'game', VER),
      ...(onLog ? { onLog } : {}),
    });
    if (!lastChild) throw new Error('spawn 未被调用');
    return lastChild;
  }

  it('一个 chunk 里的多行被拆成多次回调，内容逐行对应', async () => {
    const dir = join(tmpDir, 'multi');
    await seed(dir);
    const lines: string[] = [];
    const child = await launch(dir, (l) => lines.push(l));
    child.stdout.emit('data', Buffer.from('[main] boot\n[main] render\n[main] done\n', 'utf-8'));
    expect(lines).toEqual(['[main] boot', '[main] render', '[main] done']);
  });

  it('⚠️ 跨 chunk 的半行被拼回**一行**（不是劈成两段）', async () => {
    const dir = join(tmpDir, 'split');
    await seed(dir);
    const lines: string[] = [];
    const child = await launch(dir, (l) => lines.push(l));
    // 管道按块切，一行完全可能横跨两个 data
    child.stdout.emit('data', Buffer.from('[WARN] half-', 'utf-8'));
    expect(lines).toEqual([]); // 还没换行：一条都不该发
    child.stdout.emit('data', Buffer.from('line message\n', 'utf-8'));
    expect(lines).toEqual(['[WARN] half-line message']);
  });

  it('stderr 走同一个回调（Minecraft 崩溃信息大量在 stderr）', async () => {
    const dir = join(tmpDir, 'stderr');
    await seed(dir);
    const lines: string[] = [];
    const child = await launch(dir, (l) => lines.push(l));
    child.stderr.emit('data', Buffer.from('FATAL: java.lang.NoSuchMethodError\n', 'utf-8'));
    expect(lines).toEqual(['FATAL: java.lang.NoSuchMethodError']);
  });

  it('stdout / stderr 各自维护半行缓冲（互不串行）', async () => {
    const dir = join(tmpDir, 'separate');
    await seed(dir);
    const lines: string[] = [];
    const child = await launch(dir, (l) => lines.push(l));
    child.stdout.emit('data', Buffer.from('out-part', 'utf-8'));
    child.stderr.emit('data', Buffer.from('err-full\n', 'utf-8'));
    child.stdout.emit('data', Buffer.from('-rest\n', 'utf-8'));
    expect(lines).toEqual(['err-full', 'out-part-rest']);
  });

  it('流 end 时补发没有换行符的最后一行（崩溃前最后一条信息不能丢）', async () => {
    const dir = join(tmpDir, 'flush');
    await seed(dir);
    const lines: string[] = [];
    const child = await launch(dir, (l) => lines.push(l));
    child.stdout.emit('data', Buffer.from('last line without newline', 'utf-8'));
    expect(lines).toEqual([]);
    child.stdout.emit('end');
    expect(lines).toEqual(['last line without newline']);
  });

  it('读完的流被 destroy（否则父进程攥着管道 fd 不退出）', async () => {
    const dir = join(tmpDir, 'destroy');
    await seed(dir);
    const child = await launch(dir, () => undefined);
    child.stdout.emit('end');
    child.stderr.emit('end');
    expect(child.stdout.destroy).toHaveBeenCalled();
    expect(child.stderr.destroy).toHaveBeenCalled();
  });

  it('不传 onLog：两条流都被消费掉（管道写满会让游戏卡死），且不抛', async () => {
    const dir = join(tmpDir, 'noop');
    await seed(dir);
    const child = await launch(dir);
    expect(child.stdout.resume).toHaveBeenCalled();
    expect(child.stderr.resume).toHaveBeenCalled();
  });

  it('子进程 close 时触发 onExit（IPC 据此推 done 结束标记）', async () => {
    const dir = join(tmpDir, 'exit');
    await seed(dir);
    const exits: { code: number | null; signal: NodeJS.Signals | null }[] = [];
    await serviceAt(dir).launchGame(DETAIL, {
      username: 'Steve',
      memory: '2G',
      gameDir: join(dir, 'game', VER),
      onExit: (info) => exits.push(info),
    });
    expect(exits).toEqual([]);
    lastChild!.emit('close', 1, null);
    expect(exits).toEqual([{ code: 1, signal: null }]);
  });

  it('spawn 缺少 stdout/stderr 时不崩（注入的轻量假进程）', async () => {
    const dir = join(tmpDir, 'bare');
    await seed(dir);
    // 真实 ChildProcess 既有 on 也有 once，且启动后会发 'spawn'。
    // 只给 {pid, on} 的替身会让 launchGame 等不到 'spawn' 而永远挂住。
    const bareSpawn = (() => {
      const c = new EventEmitter() as unknown as ReturnType<typeof spawn>;
      (c as unknown as { pid: number }).pid = 7;
      queueMicrotask(() => c.emit('spawn'));
      return c;
    }) as unknown as typeof spawn;
    const svc = new LauncherService(dir, offlineFetch, { spawn: bareSpawn });
    await expect(
      svc.launchGame(DETAIL, {
        username: 'Steve',
        memory: '2G',
        gameDir: join(dir, 'game', VER),
        onLog: () => undefined,
      }),
    ).resolves.toEqual({ pid: 7 });
  });
});

// ===========================================================================
// 4. IPC handler 接线
// ===========================================================================
describe('L7 IPC handler 接线（main/ipc/launcher.ts）', () => {
  const sent: { channel: string; payload: unknown }[] = [];
  const fakeSender = {
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    isDestroyed: () => false,
  };

  function invoke(channel: string, raw: unknown): Promise<unknown> {
    const fn = h.handlers.get(channel);
    if (!fn) throw new Error(`${channel} handler 未注册`);
    // Electron 传给 handler 的是 IpcMainInvokeEvent，真正要用的渲染层在 `.sender`
    return Promise.resolve(fn({ sender: fakeSender }, raw));
  }

  /** 同 invoke，但可指定 sender（用于模拟渲染层已销毁的窗口）。 */
  function invokeWithSender(channel: string, raw: unknown, sender: unknown): Promise<unknown> {
    const fn = h.handlers.get(channel);
    if (!fn) throw new Error(`${channel} handler 未注册`);
    return Promise.resolve(fn({ sender }, raw));
  }

  beforeEach(() => {
    sent.length = 0;
    h.handlers.clear();
    h.listeners.clear();
    h.userData = tmpDir;
    registerLauncherHandlers();

    /**
     * 建一个实例再调这些通道。
     *
     * 多实例之后日志/存档是**实例作用域**的（`<gameDir>/logs/`），handler
     * 会先 `requireInstance(instance)` —— 查不到就报错。所以这里必须先注册一条，
     * 否则测的就不是「读日志」而是「实例不存在」了。
     *
     * 实例 id 用 `INST`，与 `gameDir()` 默认算出的路径一致。
     */
    mkdirSync(gameDir(INST), { recursive: true });
    new InstanceRegistry(join(tmpDir, 'mc-launcher')).create({ versionId: VER, id: INST });
  });

  it('4 个通道都注册了（READ_LATEST_LOG / LIST_CRASH_REPORTS / READ_CRASH_REPORT / LOG_STREAM）', () => {
    expect(h.handlers.has(LAUNCHER_READ_LATEST_LOG)).toBe(true);
    expect(h.handlers.has(LAUNCHER_LIST_CRASH_REPORTS)).toBe(true);
    expect(h.handlers.has(LAUNCHER_READ_CRASH_REPORT)).toBe(true);
    // LOG_STREAM 走 `handle`（渲染层 invoke），与 CHAT_STREAM / BUILD_STREAM 同一惯例。
    // 不再额外挂 `ipcMain.on`：两个注册表都挂只会掩盖「preload 到底用哪种接线」的判断。
    expect(h.handlers.has(LAUNCHER_LOG_STREAM)).toBe(true);
    expect(h.listeners.has(LAUNCHER_LOG_STREAM)).toBe(false);
  });

  it('READ_LATEST_LOG 返回 { lines }', async () => {
    mkdirSync(join(gameDir(), 'logs'), { recursive: true });
    writeFileSync(join(gameDir(), 'logs', 'latest.log'), 'a\nb\n', 'utf-8');
    await expect(invoke(LAUNCHER_READ_LATEST_LOG, { instance: INST })).resolves.toEqual({
      lines: ['a', 'b'],
      error: null,
    });
  });

  it('实例不存在 → 报错，不静默返回空（主键拼错最坑人）', async () => {
    const res = (await invoke(LAUNCHER_READ_LATEST_LOG, { instance: '不存在的实例' })) as {
      lines: string[];
      error: string | null;
    };
    expect(res.lines).toEqual([]);
    expect(res.error).toMatch(/实例不存在/);
  });

  it('LIST_CRASH_REPORTS 返回 { files }', async () => {
    mkdirSync(join(gameDir(), 'crash-reports'), { recursive: true });
    writeFileSync(join(gameDir(), 'crash-reports', 'crash-x.txt'), 'x', 'utf-8');
    await expect(invoke(LAUNCHER_LIST_CRASH_REPORTS, { instance: INST })).resolves.toEqual({
      files: ['crash-x.txt'],
      error: null,
    });
  });

  it('READ_CRASH_REPORT 返回 { content }', async () => {
    mkdirSync(join(gameDir(), 'crash-reports'), { recursive: true });
    writeFileSync(join(gameDir(), 'crash-reports', 'crash-x.txt'), 'stack here', 'utf-8');
    await expect(
      invoke(LAUNCHER_READ_CRASH_REPORT, { instance: INST, filename: 'crash-x.txt' }),
    ).resolves.toEqual({ content: 'stack here', error: null });
  });

  it('⚠️ READ_CRASH_REPORT 越界 → content 空 **且 error 非空**（不能静默吞掉）', async () => {
    // 诱饵摆在朴素 `join` 能读到的地方：handler 拿掉守卫就会真的把它读出来
    const naiveTarget = join(baseDir, 'game', INST, 'crash-reports', '../../evil.txt');
    mkdirSync(dirname(naiveTarget), { recursive: true });
    writeFileSync(naiveTarget, 'TOP-SECRET-OUTSIDE-INSTANCE', 'utf-8');

    const res = (await invoke(LAUNCHER_READ_CRASH_REPORT, {
      instance: INST,
      filename: '../../evil.txt',
    })) as { content: string; error: string | null };
    expect(res.content).toBe('');
    expect(res.error).toMatch(/路径越界/);
    expect(res.content).not.toContain('TOP-SECRET');
  });

  it('非法请求体 → 返回 error 而不是抛穿 IPC', async () => {
    const res = (await invoke(LAUNCHER_READ_LATEST_LOG, { instance: 123 })) as {
      lines: string[];
      error: string | null;
    };
    expect(res.lines).toEqual([]);
    expect(res.error).toBeTruthy();
  });

  /**
   * 走真实的 `LAUNCHER_LAUNCH` 建立日志会话，返回手动推日志/退出的句柄。
   *
   * 这是本轮修复的核心：日志 tab 以前自己调 `launchGame`，结果点一下
   * 「日志」就多开一个 Minecraft。现在只允许「开始游戏」建立会话，
   * LOG_STREAM 必须只订阅它。
   */
  async function startGame(): Promise<{
    launchSpy: MockInstance;
    log: (line: string) => void;
    exit: (code?: number) => void;
  }> {
    let emitLog: (line: string) => void = () => undefined;
    let emitExit: (code?: number) => void = () => undefined;
    const launchSpy = vi
      .spyOn(LauncherService.prototype, 'launchGame')
      .mockImplementation(async (_d, opts) => {
        emitLog = (line: string) => opts?.onLog?.(line);
        emitExit = (code = 0) => opts?.onExit?.({ code, signal: null });
        return { pid: 999 };
      });
    vi.spyOn(LauncherService.prototype, 'resolveVersion').mockResolvedValue(DETAIL);

    await expect(invoke(LAUNCHER_LAUNCH, { instance: INST })).resolves.toMatchObject({ pid: 999 });
    return { launchSpy, log: (line) => emitLog(line), exit: (code) => emitExit(code) };
  }

  /** 只取日志分片，忽略同一条 sender 上的 LAUNCHER_GAME_EXIT。 */
  function logChunks(): unknown[] {
    return sent.filter((s) => s.channel === LAUNCHER_LOG_STREAM_CHUNK).map((s) => s.payload);
  }

  it('LOG_STREAM 只订阅运行中的会话，不会再次 launchGame', async () => {
    const { launchSpy, log } = await startGame();

    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-42' });
    expect(launchSpy).toHaveBeenCalledTimes(1);

    log('line-1');
    log('line-2');
    expect(logChunks()).toEqual([
      { requestId: 'r-42', source: 'live', line: 'line-1', done: false },
      { requestId: 'r-42', source: 'live', line: 'line-2', done: false },
    ]);
  });

  it('订阅前的日志从缓冲区重放，订阅后继续追加', async () => {
    const { log } = await startGame();
    log('boot-1');
    log('boot-2');

    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-replay' });
    log('later');

    expect(logChunks()).toEqual([
      { requestId: 'r-replay', source: 'live', line: 'boot-1', done: false },
      { requestId: 'r-replay', source: 'live', line: 'boot-2', done: false },
      { requestId: 'r-replay', source: 'live', line: 'later', done: false },
    ]);
  });

  it('进程退出推 done；退出后再订阅仍能回放最后几行', async () => {
    const { log, exit } = await startGame();
    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-live' });
    log('last-line');
    exit(0);

    expect(logChunks()).toEqual([
      { requestId: 'r-live', source: 'live', line: 'last-line', done: false },
      { requestId: 'r-live', source: 'live', line: '', done: true },
    ]);
    expect(sent.some((s) => s.channel === LAUNCHER_GAME_EXIT)).toBe(true);

    sent.length = 0;
    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-after' });
    expect(logChunks()).toEqual([
      { requestId: 'r-after', source: 'live', line: 'last-line', done: false },
      { requestId: 'r-after', source: 'live', line: '', done: true },
    ]);
  });

  it('没有运行中的会话 → done + 明确提示，且绝不 launchGame', async () => {
    const launchSpy = vi
      .spyOn(LauncherService.prototype, 'launchGame')
      .mockResolvedValue({ pid: 1 });

    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-none' });

    expect(launchSpy).not.toHaveBeenCalled();
    expect(logChunks()).toEqual([
      {
        requestId: 'r-none',
        source: 'live',
        line: '当前实例没有正在运行的游戏，请先点「开始游戏」',
        done: true,
      },
    ]);
  });

  it('实例不存在 → done + 错误（不能静默空流）', async () => {
    await invoke(LAUNCHER_LOG_STREAM, { instance: '不存在的实例', requestId: 'r-missing' });
    expect(logChunks()).toHaveLength(1);
    expect(logChunks()[0]).toMatchObject({ requestId: 'r-missing', done: true });
    expect((logChunks()[0] as { line: string }).line).toMatch(/实例不存在/);
  });

  it('同一实例重复启动被拒绝，不会出现两个进程抢 latest.log', async () => {
    const { launchSpy } = await startGame();
    await expect(invoke(LAUNCHER_LAUNCH, { instance: INST })).resolves.toMatchObject({
      pid: 0,
      error: expect.stringContaining('已经在运行'),
    });
    expect(launchSpy).toHaveBeenCalledTimes(1);
  });

  it('LAUNCHER_LAUNCH 解析加载器档案并沿用实例 Java 路径（旧 LOG_STREAM 用例迁移）', async () => {
    new InstanceRegistry(join(tmpDir, 'mc-launcher')).update(INST, {
      loader: 'fabric',
      javaPath: 'D:\\Java\\jdk-25\\bin\\java.exe',
    });
    const findSpy = vi
      .spyOn(LauncherService.prototype, 'findLoaderProfile')
      .mockResolvedValue('fabric-loader-0.19.5-26.2');
    const resolveSpy = vi
      .spyOn(LauncherService.prototype, 'resolveVersion')
      .mockResolvedValue(DETAIL);
    const launchSpy = vi
      .spyOn(LauncherService.prototype, 'launchGame')
      .mockImplementation(async () => ({ pid: 1234 }));

    await invoke(LAUNCHER_LAUNCH, { instance: INST });

    expect(findSpy).toHaveBeenCalledWith(VER, 'fabric');
    expect(resolveSpy).toHaveBeenCalledWith('fabric-loader-0.19.5-26.2');
    expect(launchSpy.mock.calls[0]![1]).toMatchObject({
      javaPath: 'D:\\Java\\jdk-25\\bin\\java.exe',
      loader: 'fabric',
    });
  });

  it('LAUNCHER_LAUNCH 启动失败 → 返回 error，并给晚订阅者 done + 失败原因', async () => {
    vi.spyOn(LauncherService.prototype, 'resolveVersion').mockRejectedValue(
      new Error('版本不存在: 26.2'),
    );
    await expect(invoke(LAUNCHER_LAUNCH, { instance: INST })).resolves.toMatchObject({
      pid: 0,
      error: '版本不存在: 26.2',
    });

    await invoke(LAUNCHER_LOG_STREAM, { instance: INST, requestId: 'r-fail' });
    expect(logChunks()).toEqual([
      {
        requestId: 'r-fail',
        source: 'live',
        line: '启动失败：版本不存在: 26.2',
        done: false,
      },
      { requestId: 'r-fail', source: 'live', line: '', done: true },
    ]);
  });

  it('LOG_STREAM：渲染层已销毁时不再 send（否则抛 "Object has been destroyed"）', async () => {
    const { log } = await startGame();
    const deadSender = {
      send: (_channel: string, _payload: unknown) => sent.push({ channel: 'BAD', payload: null }),
      isDestroyed: () => true,
    };
    // LOG_STREAM 走 handle（渲染层 invoke），因此从 handlers 表取
    await invokeWithSender(
      LAUNCHER_LOG_STREAM,
      { instance: INST, requestId: 'r-dead' },
      deadSender,
    );
    log('x');
    expect(sent.filter((s) => s.channel === 'BAD')).toHaveLength(0);
  });

  it('LOG_STREAM：请求体非法 → 带兜底 requestId 推一条 done 错误，不产生未处理 rejection', async () => {
    await invoke(LAUNCHER_LOG_STREAM, { instance: INST }); // 缺 requestId
    expect(sent).toHaveLength(1);
    expect((sent[0]!.payload as { done: boolean }).done).toBe(true);
    expect((sent[0]!.payload as { line: string }).line).toMatch(/请求无效/);
  });
});
