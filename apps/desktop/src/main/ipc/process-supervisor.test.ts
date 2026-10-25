/**
 * 进程托管 IPC 接线测试（§7.1 / §10.2 / §10.6）。
 *
 * 覆盖三件事：
 * 1. 只读通道确实注册、且**没有**任何 start/stop 通道（§10.6 闸门不被绕过）；
 * 2. 单例在没有 confirm 闸门时拒绝 spawn（误接线会显式报错而非悄悄起进程）；
 * 3. 快照/日志的 zod schema 与 main 侧实际返回值一致（防止契约漂移）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

// Mock electron：记录 ipcMain.handle 注册的通道与处理器，并提供 BrowserWindow 替身。
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();
const sentToWindows: Array<{ channel: string; payload: unknown }> = [];
let destroyedWindows = 0;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (c: string, p: unknown) => sentToWindows.push({ channel: c, payload: p }),
        },
      },
      {
        isDestroyed: () => (destroyedWindows++, true),
        webContents: {
          send: () => {
            throw new Error('不该发给已销毁窗口');
          },
        },
      },
    ],
  },
}));

// 必须在 mock 之后导入被测模块
import {
  registerProcessSupervisorHandlers,
  getProcessSupervisor,
  setProcessSupervisor,
} from './process-supervisor.js';
import { createProcessSupervisor, ProcessSupervisorError } from '../process-supervisor.js';
import {
  PROCESS_LIST,
  PROCESS_LAUNCH,
  PROCESS_STOP,
  PROCESS_STATUS,
  PROCESS_LOGS,
  PROCESS_LOG_EVENT,
  PROCESS_STATE_EVENT,
  ProcessStatusSchema,
  ProcessLogsRequest,
  ProcessStatusRequest,
} from '../../shared/ipc-channels.js';
import {
  LAUNCHER_LIST_SERVER_INSTANCES,
  LAUNCHER_DELETE_SERVER_INSTANCE,
} from '../../shared/ipc/launcher.js';

const NODE = process.execPath;
/** 打印一行后自然退出的假进程（绝不真启动 Minecraft）。 */
const FAKE_QUICK = `
process.stdout.write('line-a\\n');
process.stderr.write('warn-b\\n');
process.exitCode = 0;
`;
/** 一直活着直到收到 stop 的假进程。 */
const FAKE_ALIVE = `
process.stdout.write('up\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (c.includes('stop')) { clearInterval(t); process.stdin.destroy(); process.exitCode = 0; }
});
const t = setInterval(() => {}, 1000);
`;
/** 回显控制台命令行的假进程（验证 stdin 注入真的抵达服务端控制台）。 */
const FAKE_ECHO = `
process.stdout.write('up\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  if (c.includes('stop')) { clearInterval(t); process.stdin.destroy(); process.exitCode = 0; return; }
  for (const line of String(c).split('\\n')) {
    if (line.trim() !== '') process.stdout.write('echo: ' + line + '\\n');
  }
});
const t = setInterval(() => {}, 1000);
`;

let dirs: string[] = [];
let svc: ReturnType<typeof createProcessSupervisor> | null = null;

/**
 * 原生确认框在这里被替换成可编程的门。
 *
 * 本文件要验的是**契约**：「不确认就不许停、确认了才停」，
 * 而不是 Electron 对话框怎么画（那是 kernel-confirm.ts 的事）。
 */
const confirmGate = vi.hoisted(() => ({ fn: vi.fn(async (_req: unknown) => true) }));
vi.mock('../kernel-confirm.js', () => ({
  createNativeConfirm: () => confirmGate.fn,
}));

async function fakeScript(src: string, name: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mc-sup-ipc-'));
  dirs.push(dir);
  const p = path.join(dir, `${name}.js`);
  await writeFile(p, src, 'utf8');
  return p;
}

/** 等某个状态（同主测试文件的纪律：订阅事件，不 sleep）。 */
function waitForState(s: NonNullable<typeof svc>, serverId: string, want: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (s.status(serverId)?.state === want) {
        clearTimeout(timer);
        s.off('state', onState);
        resolve();
      }
    };
    const onState = (snap: { serverId: string }): void => {
      if (snap.serverId === serverId) check();
    };
    const timer = setTimeout(() => {
      s.off('state', onState);
      reject(new Error(`等待状态超时：${serverId}`));
    }, 10_000);
    s.on('state', onState);
    check();
  });
}

/** 等某条日志行出现。 */
function waitForLine(
  s: NonNullable<typeof svc>,
  serverId: string,
  match: (l: string) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      if (s.logs(serverId).some(match)) {
        clearTimeout(timer);
        s.off('log', onLog);
        resolve();
      }
    };
    const onLog = (e: { serverId: string; line: string }): void => {
      if (e.serverId === serverId) check();
    };
    const timer = setTimeout(() => {
      s.off('log', onLog);
      reject(new Error(`等待日志超时：${serverId}`));
    }, 10_000);
    s.on('log', onLog);
    check();
  });
}

beforeEach(() => {
  handlers.clear();
  sentToWindows.length = 0;
  destroyedWindows = 0;
  dirs = [];
  svc = null;
  setProcessSupervisor(null);
  confirmGate.fn.mockReset();
  confirmGate.fn.mockResolvedValue(true);
});

afterEach(async () => {
  if (svc !== null) await svc.shutdownAll();
  setProcessSupervisor(null);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('进程托管 IPC：通道面（§10.2 / §10.6）', () => {
  /**
   * 允许存在的**执行类通道**：启动与停止，且都**必经 §10.6**。
   *
   * - `PROCESS_LAUNCH`：从磁盘推导 cmd → 原生弹窗逐字展示 → 一次性令牌
   *   → supervisor 闸门消费；
   * - `PROCESS_STOP`：按 serverId 取托管进程 → 原生弹窗展示 PID/动作
   *   → 确认后才发送 `stop`。
   *
   * 两者都不接受渲染层传 cmd/PID，所以不是"裸 spawn / kill 通道"。
   * 除它们之外仍不得出现 start/stop/kill 等执行语义动词——
   * 以后有人加 `process:start` / `process:spawn` 照样会红。
   */
  const ALLOWED_EXEC_CHANNELS = new Set<string>([PROCESS_LAUNCH, PROCESS_STOP]);

  it('注册 PROCESS_LIST / PROCESS_STATUS / PROCESS_LOGS / PROCESS_LAUNCH / PROCESS_STOP', () => {
    registerProcessSupervisorHandlers();
    // 两个服务端实例管理通道也在此文件注册（launcher:listServerInstances / launcher:deleteServerInstance）
    expect([...handlers.keys()].sort()).toEqual(
      [
        PROCESS_LIST,
        PROCESS_LOGS,
        PROCESS_LAUNCH,
        PROCESS_STOP,
        PROCESS_STATUS,
        LAUNCHER_LIST_SERVER_INSTANCES,
        LAUNCHER_DELETE_SERVER_INSTANCE,
      ].sort(),
    );
  });

  it('除 PROCESS_LAUNCH / PROCESS_STOP 外不注册 start/stop/kill 通道：确认闸门不被绕过（§10.6）', () => {
    registerProcessSupervisorHandlers();
    for (const ch of handlers.keys()) {
      // launcher:* 通道属于另一层，不在此检查范围内
      if (!ch.startsWith('process:')) continue;
      if (ALLOWED_EXEC_CHANNELS.has(ch)) continue;
      expect(ch, `${ch} 是未经确认闸门的执行通道`).not.toMatch(
        /start|stop|kill|launch|restart|spawn/i,
      );
    }
  });

  it('单例的 confirm 是「一次性批准令牌」闸门：未批准一律拒绝（§10.6 兜底）', () => {
    // 这条守的是**漏接线 / 误接线 / 渲染层绕过通道直接调 launch** 三种情况：
    // 无论怎么走到 launchServer，没有用户批准过的令牌就必须是 PERMISSION_DENIED。
    setProcessSupervisor(null);
    const gate = getProcessSupervisor();
    // 通过公开 API 证明它拒绝未批准的启动，而不是"碰巧没人调"
    expect(() =>
      gate.launchServer({
        serverId: 'srv-x',
        cmd: 'java',
        args: ['-jar', 'server.jar', 'nogui'],
        cwd: 'C:/data/servers/srv-x',
      }),
    ).toThrow(/未确认|拒绝|PERMISSION/i);
  });

  it('PROCESS_LIST 返回被托管进程列表', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ALIVE, 'alive');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l === 'up');

    const res = handlers.get(PROCESS_LIST)?.({}) as { processes: Array<Record<string, unknown>> };
    expect(res.processes).toHaveLength(1);
    expect(res.processes[0]).toMatchObject({ serverId: 'srv-1', state: 'running' });
    await handle.stop();
  });

  it('PROCESS_STATUS 返回状态快照且符合 zod schema', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ALIVE, 'alive2');
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l === 'up');

    const res = handlers.get(PROCESS_STATUS)?.(
      {},
      ProcessStatusRequest.parse({ serverId: 'srv-1' }),
    ) as {
      status: unknown;
    };
    // schema 必须能吃下真实快照，防止契约漂移
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.serverId).toBe('srv-1');
    expect(parsed.state).toBe('running');
    expect(parsed.reloadCommand).toBeNull();
    await handle.stop();
  });

  it('PROCESS_STATUS 对未知 serverId 返回 null 而非抛错', () => {
    registerProcessSupervisorHandlers();
    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'ghost' }) as { status: unknown };
    expect(res.status).toBeNull();
  });

  it('PROCESS_LOGS 返回日志行', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ALIVE, 'alive3');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l === 'up');

    const res = handlers.get(PROCESS_LOGS)?.(
      {},
      ProcessLogsRequest.parse({ serverId: 'srv-1' }),
    ) as {
      lines: string[];
    };
    expect(res.lines).toContain('up');
    await handle.stop();
  });

  it('PROCESS_LOGS 支持 limit 取尾部 N 行', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_QUICK, 'quick');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;

    const all = handlers.get(PROCESS_LOGS)?.({}, { serverId: 'srv-1' }) as { lines: string[] };
    expect(all.lines).toEqual(['line-a', 'warn-b']);
    const tail = handlers.get(PROCESS_LOGS)?.({}, { serverId: 'srv-1', limit: 1 }) as {
      lines: string[];
    };
    expect(tail.lines).toEqual(['warn-b']);
  });

  it('PROCESS_LOGS 对未知 serverId 返回空数组', () => {
    registerProcessSupervisorHandlers();
    const res = handlers.get(PROCESS_LOGS)?.({}, { serverId: 'ghost' }) as { lines: string[] };
    expect(res.lines).toEqual([]);
  });

  it('控制台日志流式转发到渲染进程，且跳过已销毁窗口', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_QUICK, 'quick2');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    // 第一个窗口有效，第二个已销毁（不应抛错）
    expect(destroyedWindows).toBeGreaterThan(0);
    const payloads = sentToWindows
      .filter((m) => m.channel === PROCESS_LOG_EVENT)
      .map((m) => m.payload as { line: string; serverId: string });
    expect(payloads.map((p) => p.line)).toEqual(['line-a', 'warn-b']);
    expect(payloads[0].serverId).toBe('srv-1');
  });

  it('日志事件带上 stream 标注（stdout / stderr 可区分）', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_QUICK, 'quick3');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    const streams = sentToWindows
      .filter((m) => m.channel === PROCESS_LOG_EVENT)
      .map((m) => m.payload as { line: string; stream: string });
    expect(streams).toEqual([
      { serverId: 'srv-1', line: 'line-a', at: expect.any(String), stream: 'stdout' },
      { serverId: 'srv-1', line: 'warn-b', at: expect.any(String), stream: 'stderr' },
    ]);
  });
});

describe('进程托管单例：确认闸门不被绕过（§10.6）', () => {
  it('getProcessSupervisor 返回同一单例', () => {
    const a = getProcessSupervisor();
    const b = getProcessSupervisor();
    expect(a).toBe(b);
  });

  it('setProcessSupervisor(null) 可重置单例', () => {
    const a = getProcessSupervisor();
    setProcessSupervisor(null);
    expect(getProcessSupervisor()).not.toBe(a);
  });

  it('默认单例未注入确认闸门 → launch 被拒（误接线不会悄悄起进程）', () => {
    const s = getProcessSupervisor();
    try {
      s.launch({ serverId: 'srv-1', cmd: NODE, args: ['-e', 'setTimeout(()=>{},1000)'] });
      expect.unreachable('应当抛 PERMISSION_DENIED');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('PERMISSION_DENIED');
    }
  });

  it('默认单例的状态查询仍可用（只读不受闸门影响）', () => {
    const s = getProcessSupervisor();
    expect(s.status('srv-1')).toBeNull();
    expect(s.list()).toEqual([]);
    expect(s.logs('srv-1')).toEqual([]);
  });

  it("默认单例在 mode:'sandbox' 下同样不 spawn（§13.4）", () => {
    const s = getProcessSupervisor();
    try {
      s.launch({ serverId: 'srv-1', cmd: NODE, args: [], mode: 'sandbox' });
      expect.unreachable('应当抛 SANDBOX_NO_SPAWN');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('SANDBOX_NO_SPAWN');
    }
  });
});

describe('进程托管状态流转经 IPC 可观测（§3 status）', () => {
  it('崩溃后的状态与退出码能通过 PROCESS_STATUS 读到', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(
      "process.stdout.write('dying\\n');\nprocess.exitCode = 7;\n",
      'crash',
    );
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 'srv-1', 'crashed');

    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'srv-1' }) as { status: unknown };
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.state).toBe('crashed');
    expect(parsed.exitCode).toBe(7);
    expect(parsed.lastLogLines).toContain('dying');
  });

  it('停机后 portReleased=null 而非谎报 false（未配置端口）', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ALIVE, 'alive4');
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l === 'up');
    await handle.stop();

    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'srv-1' }) as { status: unknown };
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.state).toBe('stopped');
    expect(parsed.portReleased).toBeNull();
    expect(parsed.lastStop?.graceful).toBe(true);
  });
});

// =========================================================================
// §10.6 停止通道：确认是**前置条件**，不是装饰
// =========================================================================

describe('PROCESS_STOP 通道（确认后才停，§10.6）', () => {
  interface StopRes {
    ok: boolean;
    denied?: boolean;
    error: string | null;
    stop: { graceful: boolean; forced: boolean } | null;
  }

  async function startFakeServer(name: string): Promise<void> {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ALIVE, name);
    svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l === 'up');
  }

  it('用户取消 → denied，进程一个字节都没动', async () => {
    await startFakeServer('stop-denied');
    confirmGate.fn.mockResolvedValueOnce(false);

    const res = (await handlers.get(PROCESS_STOP)?.({}, { serverId: 'srv-1' })) as StopRes;

    expect(res.ok).toBe(false);
    expect(res.denied).toBe(true);
    expect(svc?.status('srv-1')?.state).toBe('running');
  });

  it('用户确认 → 走优雅停机并回报停机报告', async () => {
    await startFakeServer('stop-ok');
    confirmGate.fn.mockResolvedValueOnce(true);

    const res = (await handlers.get(PROCESS_STOP)?.({}, { serverId: 'srv-1' })) as StopRes;

    expect(res.ok).toBe(true);
    expect(res.stop?.graceful).toBe(true);
    expect(svc?.status('srv-1')?.state).toBe('stopped');
    // 停机也走确认闸门：弹窗内容带 serverId 与 PID
    expect(confirmGate.fn).toHaveBeenCalledTimes(1);
    const req = confirmGate.fn.mock.calls[0]?.[0] as { kind: string; summary: string };
    expect(req.kind).toBe('stop_server');
    expect(req.summary).toContain('srv-1');
  });

  it('实例本来就没在跑 → 直接成功，不打扰用户', async () => {
    registerProcessSupervisorHandlers();
    const res = (await handlers.get(PROCESS_STOP)?.({}, { serverId: 'ghost' })) as StopRes;
    expect(res).toMatchObject({ ok: true, stop: null });
    expect(confirmGate.fn).not.toHaveBeenCalled();
  });
});

// =========================================================================
// §7.1 新增两项能力（崩溃自动重启 / 控制台注入）的 IPC 边界
//
// 核心立场：渲染层只能**读**这两项能力的状态，**不能**点火。
// 一旦给出「重启一下」「往控制台发条命令」这类 IPC 通道，§10.6 的确认闸门
// 就被绕过去了——那正是本文件第一组用例一直在守的东西。
// =========================================================================

describe('§7.1 新增能力的 IPC 边界（只读状态，不暴露触发通道，§10.6）', () => {
  it('不注册 restart / reload / send / inject 触发通道：闸门不被绕过', () => {
    registerProcessSupervisorHandlers();
    // 两个服务端实例管理通道也在此文件注册（launcher:listServerInstances / launcher:deleteServerInstance）
    expect([...handlers.keys()].sort()).toEqual(
      [
        PROCESS_LIST,
        PROCESS_LOGS,
        PROCESS_LAUNCH,
        PROCESS_STOP,
        PROCESS_STATUS,
        LAUNCHER_LIST_SERVER_INSTANCES,
        LAUNCHER_DELETE_SERVER_INSTANCE,
      ].sort(),
    );
    // PROCESS_LAUNCH / PROCESS_STOP 不属于这些动词：重启/注入/发命令仍然**没有**通道
    for (const ch of handlers.keys()) {
      expect(ch).not.toMatch(/restart|reload|inject|send|command/i);
    }
  });

  it('自动重启状态可经 PROCESS_STATUS 只读查询（契约不漂移）', async () => {
    // maxAutoRestarts=0：状态可观测，但不真的重启（纯契约测试，不引入时序抖动）
    svc = createProcessSupervisor({ confirm: () => true, autoRestart: true, maxAutoRestarts: 0 });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(
      "process.stdout.write('dying\\n');\nprocess.exitCode = 7;\n",
      'crash-restart',
    );
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 'srv-1', 'crashed');

    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'srv-1' }) as { status: unknown };
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.state).toBe('crashed');
    expect(parsed.crashCount).toBe(1);
    expect(parsed.autoRestartEnabled).toBe(true);
    expect(parsed.autoRestartCount).toBe(0);
    expect(parsed.autoRestartExhausted).toBe(false);
    expect(parsed.autoRestartPending).toBe(false);
    expect(parsed.lastCommandOutcome).toBeNull();
  });

  // ---------------------------------------------------------------------
  // 状态事件转发（通知，非命令）
  // ---------------------------------------------------------------------

  /** 取转发出去的状态事件负载。 */
  const stateEvents = (): Array<{
    serverId: string;
    event: string;
    status: { state: string; autoRestartEnabled?: boolean };
  }> =>
    sentToWindows
      .filter((m) => m.channel === PROCESS_STATE_EVENT)
      .map(
        (m) =>
          m.payload as {
            serverId: string;
            event: string;
            status: { state: string; autoRestartEnabled?: boolean };
          },
      );

  it('状态流转经 PROCESS_STATE_EVENT 推给渲染进程', async () => {
    svc = createProcessSupervisor({ confirm: () => true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_QUICK, 'state-evt');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;

    const events = stateEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.serverId === 'srv-1')).toBe(true);
    // 至少能看到 starting 与最终态
    const states = events.map((e) => e.status.state);
    expect(states).toContain('starting');
    expect(states[states.length - 1]).toBe('crashed');
    expect(events[0]?.event).toBe('state');
  });

  it('自动重启达到上限时推 auto-restart-exhausted（UI 靠它弹告警，不靠轮询）', async () => {
    /*
     * 用可控的 fake schedule 推进退避，让「崩溃 → 重启 → 再崩 → 达上限」真的走完。
     * 注意 maxAutoRestarts 不能取 0：0 的语义是「彻底不自动重启」
     * （scheduleAutoRestart 在上限判断之前就 return 了），不是「立即耗尽」。
     */
    const fired: Array<() => void> = [];
    svc = createProcessSupervisor({
      confirm: () => true,
      autoRestart: true,
      maxAutoRestarts: 1,
      // 手动收集定时器回调，测试自己决定何时触发（绝不 sleep 硬等）
      schedule: (fn) => {
        fired.push(fn);
        return { cancel: () => undefined, unref: () => undefined } as unknown as {
          cancel: () => void;
          unref: () => void;
        };
      },
    });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript('process.exitCode = 9;\n', 'state-exhausted');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 'srv-1', 'crashed');

    // 第一次崩溃 → 排了一次重启；触发它（这次真的重启进程）
    expect(fired.length).toBeGreaterThan(0);
    fired.splice(0).forEach((fn) => fn());
    await waitForState(svc, 'srv-1', 'crashed');
    // 第二次崩溃时已用满 1 次配额 → exhausted
    expect(stateEvents().some((e) => e.event === 'auto-restart-exhausted')).toBe(true);
    expect(
      ProcessStatusSchema.parse(
        (
          sentToWindows.find(
            (m) =>
              m.channel === PROCESS_STATE_EVENT &&
              (m.payload as { event: string }).event === 'auto-restart-exhausted',
          )?.payload as { status: unknown }
        ).status,
      ).autoRestartExhausted,
    ).toBe(true);
  });

  it('自动重启被闸门拒绝时推 auto-restart-rejected', async () => {
    /*
     * 与 exhausted 同理：用 fake schedule 手动触发退避定时器。
     * confirm 采用「首次启动放行、之后拒绝」—— 只有这样才能构造出
     * 「启动过 → 崩溃 → 退避到点 → 重启被闸门拒绝」这条路径
     * （若 confirm 一律 false，连首次 launch 都会被拒，根本没有 entry）。
     */
    const fired: Array<() => void> = [];
    let confirmCalls = 0;
    svc = createProcessSupervisor({
      autoRestart: true,
      maxAutoRestarts: 3,
      confirm: () => {
        confirmCalls += 1;
        return confirmCalls === 1;
      },
      schedule: (fn) => {
        fired.push(fn);
        return { cancel: () => undefined, unref: () => undefined } as unknown as {
          cancel: () => void;
          unref: () => void;
        };
      },
    });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript('process.exitCode = 3;\n', 'state-rejected');
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 'srv-1', 'crashed');

    // 退避到点 → runAutoRestart → confirm 拒绝 → rejected
    expect(fired.length).toBeGreaterThan(0);
    fired.splice(0).forEach((fn) => fn());

    expect(stateEvents().some((e) => e.event === 'auto-restart-rejected')).toBe(true);
    // 被拒后仍保持 crashed（不静默变成 stopped，UI 才知道要告警）
    expect(svc.status('srv-1')?.state).toBe('crashed');
  });

  it('状态事件只是通知：不额外注册 start/stop 触发通道', () => {
    // 转发通道走 webContents.send 而非 ipcMain.handle —— 渲染层只能被动收通知；
    // 启动/停止另有显式通道，且都要过 §10.6 确认框。
    registerProcessSupervisorHandlers();
    expect([...handlers.keys()].sort()).toEqual(
      [
        PROCESS_LIST,
        PROCESS_LOGS,
        PROCESS_LAUNCH,
        PROCESS_STOP,
        PROCESS_STATUS,
        LAUNCHER_LIST_SERVER_INSTANCES,
        LAUNCHER_DELETE_SERVER_INSTANCE,
      ].sort(),
    );
    expect(PROCESS_STATE_EVENT).toBe('process:stateEvent');
  });

  it('控制台注入结果可经 PROCESS_STATUS 只读查询（含失败原因）', async () => {
    svc = createProcessSupervisor({ confirm: () => true, autoInjectReload: true });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(FAKE_ECHO, 'echo-inject');
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      reloadCommand: '/reload confirm',
    });
    // 假服务端回显注入的 reload 命令
    await waitForLine(svc, 'srv-1', (l) => l.includes('/reload confirm'));

    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'srv-1' }) as { status: unknown };
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.reloadCommand).toBe('/reload confirm');
    expect(parsed.lastCommandOutcome?.delivered).toBe(true);
    expect(parsed.lastCommandOutcome?.command).toBe('/reload confirm');
    expect(parsed.lastCommandOutcome?.reason).toBeNull();
    await handle.stop();
  });

  it('默认单例：sendCommand 一律拒绝（未配置闸门 = 无执行权）', async () => {
    const s = getProcessSupervisor();
    const outcome = await s.sendCommand('srv-1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('NOT_MANAGED');
    expect(outcome.reason).toContain('未托管');
  });

  it('默认配置：崩溃自动重启与自动注入都是关闭态（副作用行为不默认开）', async () => {
    // 只给 confirm，不给 autoRestart / autoInjectReload ⇒ 两项能力都取默认「关」
    let spawns = 0;
    svc = createProcessSupervisor({
      confirm: () => true,
      spawn: (cmd, args, options) => {
        spawns += 1;
        return nodeSpawn(cmd, args, options);
      },
    });
    setProcessSupervisor(svc);
    registerProcessSupervisorHandlers();
    const script = await fakeScript(
      "process.stdout.write('dying\\n');\nprocess.exitCode = 9;\n",
      'crash-default',
    );
    const handle = svc.launch({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 'srv-1', 'crashed');

    const res = handlers.get(PROCESS_STATUS)?.({}, { serverId: 'srv-1' }) as { status: unknown };
    const parsed = ProcessStatusSchema.parse(res.status);
    expect(parsed.state).toBe('crashed');
    // 默认关：崩溃后既没有第二次 spawn，也没有排任何退避
    expect(spawns).toBe(1);
    expect(parsed.autoRestartEnabled).toBe(false);
    expect(parsed.autoRestartCount).toBe(0);
    expect(parsed.autoRestartPending).toBe(false);
    expect(parsed.autoRestartExhausted).toBe(false);
    expect(parsed.lastCommandOutcome).toBeNull();
  });
});
