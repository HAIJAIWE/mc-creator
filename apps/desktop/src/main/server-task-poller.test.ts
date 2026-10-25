/**
 * 定时轮询器测试（backlog R2c，§7.4 定时另一半）。
 *
 * fake runtime + fake supervisor，不碰 Electron / 真内核 / 磁盘：
 * 1. 各 action 分发正确（backup 只记录不调 supervisor；restart/stop/broadcast
 *    分别走到对应方法；未知 action 记 unknown 跳过）；
 * 2. 失败隔离（一条炸了其余照跑，pollOnce 不抛）；
 * 3. stop 后不再 poll（重复 stop 安全）；
 * 4. 无 runtime 安全空操作；runRead 失败返回 { ran:false }。
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { TaskResult } from '@mc-creator/contract';
import {
  createTaskPoller,
  type TaskPollerRuntime,
  type TaskPollerSupervisor,
} from './server-task-poller.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function okDue(fired: unknown[]): TaskResult {
  return { ok: true, data: { fired } };
}

function makeRuntime(fired: unknown[] = []): TaskPollerRuntime & {
  runRead: ReturnType<typeof vi.fn>;
} {
  return {
    runRead: vi.fn(async (_kind: string, _payload?: unknown): Promise<TaskResult> => okDue(fired)),
  };
}

function okControl(serverId: string): {
  serverId: string;
  ok: boolean;
  code: null;
  reason: null;
  stop: null;
  at: string;
} {
  return {
    serverId,
    ok: true,
    code: null,
    reason: null,
    stop: null,
    at: new Date(0).toISOString(),
  };
}

function makeSupervisor(): TaskPollerSupervisor & {
  restartServer: ReturnType<typeof vi.fn>;
  stopServer: ReturnType<typeof vi.fn>;
  sendCommand: ReturnType<typeof vi.fn>;
} {
  return {
    restartServer: vi.fn(async (serverId: string) => okControl(serverId)),
    stopServer: vi.fn(async (serverId: string) => okControl(serverId)),
    sendCommand: vi.fn(async (serverId: string, command: string) => ({
      serverId,
      delivered: true,
      command,
      reason: null,
      code: null,
      at: new Date(0).toISOString(),
    })),
  };
}

describe('server-task-poller（R2c 定时轮询器）', () => {
  it('各 action 分发正确：backup 记录不执行，restart/stop/broadcast 各走其道，未知跳过', async () => {
    const fired = [
      { taskId: 't-backup', serverId: 'srv-bk', action: 'backup', result: { backupId: 'b1' } },
      { taskId: 't-restart', serverId: 'srv-rs', action: 'restart', controlCommand: 'restart' },
      { taskId: 't-stop', serverId: 'srv-st', action: 'stop', controlCommand: 'stop' },
      { taskId: 't-bc', serverId: 'srv-bc', action: 'broadcast', message: 'say hi' },
      { taskId: 't-??', serverId: 'srv-x', action: 'defrag' },
    ];
    const rt = makeRuntime(fired);
    const svc = makeSupervisor();
    const seen: unknown[] = [];
    const poller = createTaskPoller({
      getRuntime: () => rt,
      supervisor: svc,
      onFired: (out) => {
        seen.push(out);
      },
    });

    const res = await poller.pollOnce();

    expect(rt.runRead).toHaveBeenCalledTimes(1);
    expect(rt.runRead).toHaveBeenCalledWith('run_due_tasks', {});
    expect(res.ran).toBe(true);
    expect(res.fired).toHaveLength(5);

    // backup：只记录结果，不调 supervisor 任何方法
    expect(res.fired?.[0]).toMatchObject({ taskId: 't-backup', action: 'backup', ok: true });
    expect(svc.restartServer).not.toHaveBeenCalledWith('srv-bk');
    expect(svc.stopServer).not.toHaveBeenCalledWith('srv-bk');
    expect(svc.sendCommand).not.toHaveBeenCalledWith('srv-bk', expect.anything());

    // restart / stop / broadcast 各走其道
    expect(svc.restartServer).toHaveBeenCalledTimes(1);
    expect(svc.restartServer).toHaveBeenCalledWith('srv-rs');
    expect(res.fired?.[1]).toMatchObject({ taskId: 't-restart', action: 'restart', ok: true });
    expect(svc.stopServer).toHaveBeenCalledTimes(1);
    expect(svc.stopServer).toHaveBeenCalledWith('srv-st');
    expect(res.fired?.[2]).toMatchObject({ taskId: 't-stop', action: 'stop', ok: true });
    expect(svc.sendCommand).toHaveBeenCalledTimes(1);
    expect(svc.sendCommand).toHaveBeenCalledWith('srv-bc', 'say hi');
    expect(res.fired?.[3]).toMatchObject({ taskId: 't-bc', action: 'broadcast', ok: true });

    // 未知 action：记 unknown 跳过
    expect(res.fired?.[4]).toMatchObject({
      taskId: 't-??',
      action: 'defrag',
      ok: false,
      skipped: true,
    });
    expect(String((res.fired?.[4] as { reason?: unknown })?.reason)).toContain('unknown');

    // onFired 收到同一批结果
    expect(seen).toHaveLength(1);
    expect((seen[0] as unknown[]).length).toBe(5);
  });

  it('backup 的内核 error 条目记为失败但不二次执行', async () => {
    const rt = makeRuntime([
      {
        taskId: 't-bad-bk',
        serverId: 'srv-bk',
        action: 'backup',
        error: { category: 'disk', message: '磁盘满' },
      },
    ]);
    const svc = makeSupervisor();
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(true);
    expect(res.fired?.[0]).toMatchObject({ taskId: 't-bad-bk', ok: false });
    expect(svc.restartServer).not.toHaveBeenCalled();
    expect(svc.stopServer).not.toHaveBeenCalled();
    expect(svc.sendCommand).not.toHaveBeenCalled();
  });

  it('失败隔离：一条炸了（抛错）其余照跑，pollOnce 不抛', async () => {
    const rt = makeRuntime([
      { taskId: 't-rs', serverId: 'srv-rs', action: 'restart' },
      { taskId: 't-st', serverId: 'srv-st', action: 'stop' },
      { taskId: 't-bc', serverId: 'srv-bc', action: 'broadcast', message: 'hi' },
    ]);
    const svc = makeSupervisor();
    svc.restartServer.mockRejectedValueOnce(new Error('boom'));
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(true);
    expect(res.fired?.[0]).toMatchObject({ taskId: 't-rs', ok: false });
    // 后两条不受影响照跑
    expect(svc.stopServer).toHaveBeenCalledWith('srv-st');
    expect(svc.sendCommand).toHaveBeenCalledWith('srv-bc', 'hi');
    expect(res.fired?.[1]).toMatchObject({ taskId: 't-st', ok: true });
    expect(res.fired?.[2]).toMatchObject({ taskId: 't-bc', ok: true });
  });

  it('supervisor 结构化失败（ok=false）记错但不中断同轮', async () => {
    const rt = makeRuntime([
      { taskId: 't-rs', serverId: 'srv-rs', action: 'restart' },
      { taskId: 't-st', serverId: 'srv-st', action: 'stop' },
    ]);
    const svc = makeSupervisor();
    svc.restartServer.mockResolvedValueOnce({
      serverId: 'srv-rs',
      ok: false,
      code: 'NOT_CONFIRMED',
      reason: '用户未确认',
      stop: null,
      at: new Date(0).toISOString(),
    });
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(true);
    expect(res.fired?.[0]).toMatchObject({ taskId: 't-rs', ok: false });
    expect(svc.stopServer).toHaveBeenCalledWith('srv-st');
    expect(res.fired?.[1]).toMatchObject({ taskId: 't-st', ok: true });
  });

  it('onFired 抛错不影响 pollOnce 结果', async () => {
    const rt = makeRuntime([{ taskId: 't-rs', serverId: 'srv-rs', action: 'restart' }]);
    const svc = makeSupervisor();
    const poller = createTaskPoller({
      getRuntime: () => rt,
      supervisor: svc,
      onFired: () => {
        throw new Error('observer boom');
      },
    });

    const res = await poller.pollOnce();
    expect(res.ran).toBe(true);
    expect(res.fired).toHaveLength(1);
  });

  it('stop 后不再 poll，重复 stop 安全；fired 为 [] 是常态', async () => {
    vi.useFakeTimers();
    const rt = makeRuntime([]);
    const svc = makeSupervisor();
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc, intervalMs: 1000 });

    poller.start();
    await vi.advanceTimersByTimeAsync(3500);
    const callsAfterStart = (rt.runRead as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterStart).toBeGreaterThanOrEqual(3);

    poller.stop();
    poller.stop(); // 重复 stop 安全，不抛
    await vi.advanceTimersByTimeAsync(5000);
    expect((rt.runRead as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterStart);
    expect(svc.restartServer).not.toHaveBeenCalled();
  });

  it('无 runtime 安全空操作：返回 { ran:false }，不碰 supervisor', async () => {
    const svc = makeSupervisor();
    const poller = createTaskPoller({ getRuntime: () => null, supervisor: svc });

    const res = await poller.pollOnce();

    expect(res).toMatchObject({ ran: false });
    expect(res.reason).toBe('no-runtime');
    expect(svc.restartServer).not.toHaveBeenCalled();
    expect(svc.stopServer).not.toHaveBeenCalled();
    expect(svc.sendCommand).not.toHaveBeenCalled();
  });

  it('runRead 返回 ok=false → { ran:false, error }，不调 supervisor', async () => {
    const rt: TaskPollerRuntime = {
      runRead: async () => ({
        ok: false,
        error: { category: 'disk', message: '账本坏了', retryable: false },
      }),
    };
    const svc = makeSupervisor();
    let firedCalls = 0;
    const poller = createTaskPoller({
      getRuntime: () => rt,
      supervisor: svc,
      onFired: () => {
        firedCalls += 1;
      },
    });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(false);
    expect(res.error).toBeDefined();
    expect(svc.restartServer).not.toHaveBeenCalled();
    expect(firedCalls).toBe(0);
  });

  it('runRead 抛错 → { ran:false, error }，不抛', async () => {
    const rt: TaskPollerRuntime = {
      runRead: async () => {
        throw new Error('kernel boom');
      },
    };
    const svc = makeSupervisor();
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(false);
    expect(String(res.error)).toContain('kernel boom');
  });

  it('now 注入时作为 ISO 传给 run_due_tasks', async () => {
    const rt = makeRuntime([]);
    const svc = makeSupervisor();
    const poller = createTaskPoller({
      getRuntime: () => rt,
      supervisor: svc,
      now: () => 0,
    });

    const res = await poller.pollOnce();

    expect(res.ran).toBe(true);
    expect(rt.runRead).toHaveBeenCalledWith('run_due_tasks', {
      now: new Date(0).toISOString(),
    });
  });
});

/**
 * 「算了就丢」的回归。
 *
 * 修复前 `onFired` 是可选的，而生产接线（index.ts）压根没传 ——
 * 每 60 秒算出来的 `fired[]`（**包括失败**）被直接丢弃。
 *
 * 真实可达的失败链：用户经内核 `schedule_task` 建一个 restart 任务
 * → 轮询器取到 `fired` → `restartServer()` 返回 `SERVER_NOT_FOUND`
 * （生产里没有任何代码调 `launchServer`）→ 零痕迹。
 */
describe('createTaskPoller · 到期任务不得无声消失', () => {
  it('任务失败时把原因打进 console.warn（含 action@serverId）', async () => {
    const rt = makeRuntime([
      { taskId: 't1', serverId: 'srv-x', action: 'restart', error: { message: '未托管 srv-x' } },
    ]);
    const svc = makeSupervisor();
    svc.restartServer.mockResolvedValue({ ok: false, reason: 'SERVER_NOT_FOUND' } as never);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });
    await poller.pollOnce();

    // 注意：在 restore **之后**再读 mock.calls 是读不到的 —— mockRestore() 会清空它。
    // 恢复交给本文件顶部的全局 afterEach(vi.restoreAllMocks)。
    const said = warn.mock.calls.map((c) => String(c[0])).join('\n');
    expect(said, '失败原因一个字都没进日志').toContain('restart@srv-x');
    expect(said).toContain('SERVER_NOT_FOUND');
  });

  it('全部成功时打 console.log 而不是 warn', async () => {
    const rt = makeRuntime([{ taskId: 't1', serverId: 'srv-1', action: 'stop' }]);
    const svc = makeSupervisor();
    svc.stopServer.mockResolvedValue({ ok: true } as never);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });
    await poller.pollOnce();

    expect(log.mock.calls.map((c) => String(c[0])).join('\n')).toContain('stop@srv-1');
    expect(warn, '成功的一轮不该 warn').not.toHaveBeenCalled();
  });

  it('空轮次保持安静（每 60 秒刷屏没人受得了）', async () => {
    const rt = makeRuntime([]);
    const svc = makeSupervisor();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });
    await poller.pollOnce();

    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('只记第一次，之后的轮次不再刷', async () => {
    const rt = makeRuntime([
      { taskId: 't1', serverId: 'srv-x', action: 'restart', error: '未托管' },
    ]);
    const svc = makeSupervisor();
    svc.restartServer.mockResolvedValue({ ok: false, reason: 'SERVER_NOT_FOUND' } as never);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const poller = createTaskPoller({ getRuntime: () => rt, supervisor: svc });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();

    expect(warn, `刷了 ${warn.mock.calls.length} 次`).toHaveBeenCalledTimes(1);
  });
});
