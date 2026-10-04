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
  PROCESS_STATUS,
  PROCESS_LOGS,
  PROCESS_LOG_EVENT,
  ProcessStatusSchema,
  ProcessLogsRequest,
  ProcessStatusRequest,
} from '../../shared/ipc-channels.js';

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

let dirs: string[] = [];
let svc: ReturnType<typeof createProcessSupervisor> | null = null;

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
});

afterEach(async () => {
  if (svc !== null) await svc.shutdownAll();
  setProcessSupervisor(null);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('进程托管 IPC：只读通道（§10.2）', () => {
  it('注册了 PROCESS_LIST / PROCESS_STATUS / PROCESS_LOGS 三个只读通道', () => {
    registerProcessSupervisorHandlers();
    expect([...handlers.keys()].sort()).toEqual(
      [PROCESS_LIST, PROCESS_LOGS, PROCESS_STATUS].sort(),
    );
  });

  it('不注册任何 start/stop/kill 通道：确认闸门不被绕过（§10.6）', () => {
    registerProcessSupervisorHandlers();
    for (const ch of handlers.keys()) {
      expect(ch.startsWith('process:')).toBe(true);
      expect(ch).not.toMatch(/start|stop|kill|launch|restart|spawn/i);
    }
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
