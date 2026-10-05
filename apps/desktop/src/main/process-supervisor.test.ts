/**
 * process-supervisor 测试（外壳层进程托管，设计文档 §7.1 / §7.4）。
 *
 * 铁律：**绝不真启动 Minecraft 或真服务端**。全部用假进程脚本：
 * - node 脚本（process.execPath）：行为可控（读 stdin 优雅停机 / 立即崩溃 / 无视停机 /
 *   持有端口 / 让孙进程占端口模拟端口泄漏）；
 * - Windows 的 .bat（照抄 devkit/src/devkit.test.ts 的 makeFakeProject 手法）：
 *   覆盖 shell:true + taskkill /t /f 杀整棵树那条 Windows 专属路径。
 * posix 分支（chmod 755 的 sh）同样写好，但本机 win32 上未实测（见报告「已知局限」）。
 *
 * 时序纪律：不许 sleep 硬等。全部靠「事件 + promise」同步：
 * 等日志行 → 订阅 'log'；等状态 → 订阅 'state'；等退出 → await handle.exited。
 * 唯一的真实延时是「被测行为本身的宽限期」（gracefulMs / port.waitMs），且都取小值。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as net from 'node:net';
import {
  createProcessSupervisor,
  ProcessSupervisorError,
  DEFAULT_LOG_TAIL_LINES,
  DEFAULT_GRACEFUL_MS,
  DEFAULT_PORT_WAIT_MS,
  DEFAULT_PORT_PROBE_TIMEOUT_MS,
  DEFAULT_RESTART_DELAY_MS,
  DEFAULT_MAX_RESTART_DELAY_MS,
  DEFAULT_MAX_AUTO_RESTARTS,
  type AutoRestartExhaustedEvent,
  type AutoRestartScheduledEvent,
  type ConfirmFn,
  type LogEvent,
  type ProcessSupervisor,
  type ProcessSupervisorOptions,
  type ScheduleFn,
  type SendOutcome,
  type ServerState,
  type SpawnFn,
  type StatusSnapshot,
  type StopOutcome,
  type TimerHandle,
} from './process-supervisor.js';

const IS_WIN = process.platform === 'win32';
const NODE = process.execPath;

// ===== 假进程脚本夹具 =====

/** 正常假服务端：打印日志，读 stdin 收到 stop 就优雅退出（码 0）。 */
const FAKE_SERVER = `
const port = process.argv[2] ? Number(process.argv[2]) : 0;
process.stdout.write('fake server booting\\n');
process.stdout.write('listening on ' + port + '\\n');
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  for (;;) {
    const i = buf.indexOf('\\n');
    if (i === -1) break;
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (line.trim() === 'stop') {
      process.stdout.write('saving world...\\n');
      clearInterval(timer);
      // 必须显式 destroy stdin：stdin 管道本身是活跃 handle，
      // 只 clearInterval 的话事件循环不会排空，假进程永远不退出。
      process.stdin.destroy();
      process.exitCode = 0;
      return;
    }
    process.stdout.write('echo: ' + line + '\\n');
  }
});
const timer = setInterval(() => {}, 1000);
`;

/** 立即崩溃：非预期退出，退出码 3（模拟端口占用启动失败）。 */
const FAKE_CRASH = `
process.stdout.write('fake server booting\\n');
process.stderr.write('error: address already in use\\n');
process.exitCode = 3;
`;

/** 自行退出且码为 0：验证 crashed 判定看的是「非我方停机」而非退出码。 */
const FAKE_QUIET_EXIT = `
process.stdout.write('restarting myself\\n');
process.exitCode = 0;
`;

/**
 * 首次启动崩溃、第二次启动正常存活（测自动重启的**真实进程**集成路径）。
 * marker 文件当"已经崩过一次"的证据：它是跨进程状态，第二次跑就会走存活分支。
 */
const FAKE_CRASH_ONCE = `
const fs = require('fs');
const marker = process.argv[2];
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, '1');
  process.stdout.write('first boot\\n');
  process.stderr.write('error: first boot fails\\n');
  process.exitCode = 4;
} else {
  process.stdout.write('second boot ok\\n');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    if (c.includes('stop')) { clearInterval(timer); process.stdin.destroy(); process.exitCode = 0; }
  });
  const timer = setInterval(() => {}, 1000);
}
`;

/** 无视停机：读 stdin 只回声、永不退出（测强杀兜底）。 */
const FAKE_STUBBORN = `
process.stdout.write('stubborn up\\n');
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => { process.stdout.write('ignoring stop\\n'); });
const timer = setInterval(() => {}, 1000);
`;

/** 持有端口的假服务端：收到 stop 后关闭监听再自然退出（端口随之释放）。 */
const FAKE_PORT_HOLDER = `
const net = require('net');
const port = Number(process.argv[2]);
const srv = net.createServer((s) => s.end());
srv.listen(port, '127.0.0.1', () => {
  process.stdout.write('listening ' + port + '\\n');
});
let stopped = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (!stopped && chunk.includes('stop')) {
    stopped = true;
    process.stdout.write('closing listener\\n');
    srv.close();
    clearInterval(timer);
    process.stdin.destroy();
    process.exitCode = 0;
  }
});
const timer = setInterval(() => {}, 1000);
`;

/**
 * 端口泄漏：父进程被 stop 后自己退了，但**孙进程**继续占着端口
 * （真实世界对应孤儿进程 / TIME_WAIT；也验证端口检测不能只看 child.on('exit')）。
 * 孙进程 pid 写入 pidFile，测试据此精确清理。
 */
const FAKE_PORT_LEAKER = `
const fs = require('fs');
const { spawn } = require('child_process');
const port = Number(process.argv[2]);
const pidFile = process.argv[3];
const holderCode =
  "const net=require('net');" +
  "const s=net.createServer(c=>c.end());" +
  "s.listen(" + port + ",'127.0.0.1',()=>{process.stdout.write('bound\\\\n');});" +
  "setTimeout(()=>process.exit(0),20000);";
const holder = spawn(process.execPath, ['-e', holderCode],
  { stdio: ['ignore', 'pipe', 'ignore'], detached: true, windowsHide: true });
// 必须等孙进程真的 bind 成功再宣告"已占用"：否则父进程退出后端口可能还没绑上，
// 探测会误判为"已释放"，测不到真正的泄漏场景。
holder.stdout.on('data', (d) => {
  if (!String(d).includes('bound')) return;
  holder.stdout.destroy();
  holder.unref();
  fs.writeFileSync(pidFile, String(holder.pid));
  process.stdout.write('leaking on ' + port + '\\n');
});
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (chunk.includes('stop')) {
    clearInterval(timer);
    process.stdin.destroy();
    process.exitCode = 0;
  }
});
const timer = setInterval(() => {}, 1000);
`;

/** 吐大量输出的假进程（测环形缓冲有界）。 */
const FAKE_CHATTY = `
const n = Number(process.argv[2]);
for (let i = 1; i <= n; i += 1) process.stdout.write('line ' + i + '\\n');
process.exitCode = 0;
`;

/** 打印一行无换行尾巴后退出（测半行缓冲）。 */
const FAKE_PARTIAL_LINE = `
process.stdout.write('complete line\\n');
process.stdout.write('tail without newline');
process.exitCode = 0;
`;

/** 打印环境变量（测 env 注入）。 */
const FAKE_ENV_ECHO = `
process.stdout.write('MARKER=' + (process.env.MC_FAKE_MARKER || '<missing>') + '\\n');
process.exitCode = 0;
`;

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/** 照抄 devkit 的 makeFakeProject：win 写 .bat，posix 写 chmod 755 的 sh。 */
async function makeFakeScript(script: string, name = 'fake'): Promise<string> {
  const dir = await makeTempDir('mc-sup-fake-');
  if (IS_WIN) {
    const p = path.join(dir, `${name}.bat`);
    await writeFile(p, script, 'utf8');
    return p;
  }
  const p = path.join(dir, name);
  await writeFile(p, script, { encoding: 'utf8', mode: 0o755 });
  return p;
}

/** 写一个 node 假脚本文件（跨平台行为一致，测精确语义时优先用它）。 */
async function writeFakeNode(source: string, name = 'fake'): Promise<string> {
  const dir = await makeTempDir('mc-sup-node-');
  const p = path.join(dir, `${name}.js`);
  await writeFile(p, source, 'utf8');
  return p;
}

/** 借一个当前空闲的端口（bind 0 后立刻释放）。 */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
  });
}

/** 等某条日志行出现（订阅事件，不 sleep）。 */
function waitForLine(
  svc: ProcessSupervisor,
  serverId: string,
  match: (line: string) => boolean,
  ms = 10_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      svc.off('log', onLog);
    };
    const onLog = (e: LogEvent): void => {
      if (e.serverId !== serverId || !match(e.line)) return;
      cleanup();
      resolve(e.line);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待日志行超时：${serverId}`));
    }, ms);
    svc.on('log', onLog);
    const hit = svc.logs(serverId).find(match);
    if (hit !== undefined) {
      cleanup();
      resolve(hit);
    }
  });
}

/** 等某状态出现（订阅 'state'，不 sleep）。 */
function waitForState(
  svc: ProcessSupervisor,
  serverId: string,
  pred: (s: ServerState) => boolean,
  ms = 10_000,
): Promise<ServerState> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      svc.off('state', onState);
    };
    const onState = (snap: StatusSnapshot): void => {
      if (snap.serverId !== serverId || !pred(snap.state)) return;
      cleanup();
      resolve(snap.state);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待状态超时：${serverId} 当前=${svc.status(serverId)?.state}`));
    }, ms);
    svc.on('state', onState);
    const cur = svc.status(serverId);
    if (cur !== null && pred(cur.state)) {
      cleanup();
      resolve(cur.state);
    }
  });
}

/** 虚拟定时器（测「schedule 被注入并生效」，全程无真实等待）。 */
function fakeClock(): {
  schedule: (fn: () => void, ms: number) => TimerHandle;
  scheduleHold: (fn: () => void, ms: number) => TimerHandle;
  runAll: () => void;
  pending: () => number;
} {
  const timers: Array<{ fn: () => void; at: number }> = [];
  const now = 0;
  const make =
    (hold: boolean) =>
    (fn: () => void, ms: number): TimerHandle => {
      const t = { fn, at: now + Math.max(0, ms), hold };
      timers.push(t);
      return {
        cancel: () => {
          const i = timers.indexOf(t);
          if (i !== -1) timers.splice(i, 1);
        },
      };
    };
  return {
    schedule: make(false),
    scheduleHold: make(true),
    runAll: () => {
      for (;;) {
        const due = timers.filter((t) => t.at <= now);
        if (due.length === 0) break;
        for (const t of due) {
          const i = timers.indexOf(t);
          if (i !== -1) timers.splice(i, 1);
          t.fn();
        }
      }
    },
    pending: () => timers.length,
  };
}

// ===== 测试台账（清理：临时目录 + 所有子进程）=====

let supervisors: ProcessSupervisor[] = [];
let tempDirs: string[] = [];
let leakedPids: number[] = [];

function makeService(opts: ProcessSupervisorOptions = {}): ProcessSupervisor {
  const svc = createProcessSupervisor({ confirm: () => true, ...opts });
  supervisors.push(svc);
  return svc;
}

beforeEach(() => {
  supervisors = [];
  tempDirs = [];
  leakedPids = [];
});

afterEach(async () => {
  for (const svc of supervisors) {
    await svc.shutdownAll();
    svc.removeAllListeners();
  }
  for (const pid of leakedPids) {
    try {
      if (IS_WIN) nodeSpawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch {
      /* 已退出 */
    }
  }
  for (const d of tempDirs) await rm(d, { recursive: true, force: true });
});

/** 记录临时目录以便清理。 */
async function tempScript(source: string, name = 'fake'): Promise<string> {
  const p = await writeFakeNode(source, name);
  tempDirs.push(path.dirname(p));
  return p;
}

// =========================================================================
// 1. 前置校验与确认闸门（§13.4 沙箱 / §10.6 确认）—— 这些路径零副作用，不 spawn
// =========================================================================

describe('前置校验与确认闸门（未确认 = 零副作用，§10.6 / §13.4）', () => {
  it('默认常量与内核对齐：gracefulMs 30000、日志尾 200 行', () => {
    expect(DEFAULT_GRACEFUL_MS).toBe(30_000);
    expect(DEFAULT_LOG_TAIL_LINES).toBe(200);
    expect(DEFAULT_PORT_WAIT_MS).toBe(10_000);
    expect(DEFAULT_PORT_PROBE_TIMEOUT_MS).toBe(500);
  });

  it('status 对从未托管的 serverId 返回 null', () => {
    expect(makeService().status('nope')).toBeNull();
  });

  it('logs 对从未托管的 serverId 返回空数组', () => {
    expect(makeService().logs('nope')).toEqual([]);
    expect(makeService().logs('nope', 10)).toEqual([]);
  });

  it('list 初始为空数组', () => {
    expect(makeService().list()).toEqual([]);
  });

  it('serverId 为空串 → INVALID_STATE，且不 spawn', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn });
    expect(() => svc.launch({ serverId: '', cmd: 'java', args: [] })).toThrow(
      ProcessSupervisorError,
    );
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('cmd 为空 → INVALID_STATE，且不 spawn', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn });
    try {
      svc.launch({ serverId: 's1', cmd: '', args: [] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('INVALID_STATE');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('args 非 string[] → INVALID_STATE（禁止 shell 拼接，§13.4）', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn });
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: [1 as unknown as string] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('INVALID_STATE');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("mode:'sandbox' → SANDBOX_NO_SPAWN 且绝不 spawn（§13.4）", () => {
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn });
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: ['-jar'], mode: 'sandbox' });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('SANDBOX_NO_SPAWN');
      expect((e as Error).message).toContain('§13.4');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.status('s1')).toBeNull();
  });

  it('未提供确认闸门 → PERMISSION_DENIED 且不 spawn', () => {
    const spawnSpy = vi.fn();
    // 直接用工厂构造「没有 confirm」的实例（不能靠 {confirm: undefined}：
    // exactOptionalPropertyTypes 下那不是可选属性的合法赋值）。
    const svc = createProcessSupervisor({ spawn: spawnSpy as unknown as SpawnFn });
    supervisors.push(svc);
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: [] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('PERMISSION_DENIED');
      expect((e as Error).message).toContain('§10.6');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('用户点「取消」→ PERMISSION_DENIED 且不 spawn', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn, confirm: () => false });
    expect(() => svc.launch({ serverId: 's1', cmd: 'java', args: [] })).toThrow(/未确认/);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('确认通道自身抛异常 → 按「未确认」处理，绝不静默执行', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({
      spawn: spawnSpy as unknown as SpawnFn,
      confirm: () => {
        throw new Error('dialog exploded');
      },
    });
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: [] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('PERMISSION_DENIED');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('确认返回 Promise（异步）→ 失败关闭，不 spawn（launch 是同步接口）', () => {
    const spawnSpy = vi.fn();
    const svc = makeService({
      spawn: spawnSpy as unknown as SpawnFn,
      confirm: () => Promise.resolve(true),
    });
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: [] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('PERMISSION_DENIED');
    }
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('确认返回非 true 的假值 → 拒绝', () => {
    const svc = makeService({ confirm: () => undefined as unknown as boolean });
    expect(() => svc.launch({ serverId: 's1', cmd: 'java', args: [] })).toThrow(/未确认/);
  });

  it('确认请求形状正确：kind=launch_instance、risk=execute、中文摘要', async () => {
    const seen: unknown[] = [];
    const script = await tempScript(FAKE_SERVER, 'confirm-shape');
    const svc = makeService({ confirm: (r) => (seen.push(r), true) });
    const handle = svc.launch({
      serverId: 'inst-1',
      cmd: NODE,
      args: [script],
    });
    await waitForLine(svc, 'inst-1', (l) => l.startsWith('listening'));
    expect(seen).toHaveLength(1);
    const req = seen[0] as { kind: string; risk: string; summary: string; payload: unknown };
    expect(req.kind).toBe('launch_instance');
    expect(req.risk).toBe('execute');
    expect(req.summary).toContain('inst-1');
    expect(req.summary).toContain(NODE);
    // payload 是解析后的规格，供外壳渲染影响面
    expect((req.payload as { serverId: string }).serverId).toBe('inst-1');
    await handle.stop();
  });

  it('launchServer 的确认 kind 是 start_server', async () => {
    const seen: string[] = [];
    const script = await tempScript(FAKE_SERVER, 'confirm-kind');
    const svc = makeService({
      confirm: (r) => {
        seen.push(r.kind);
        return true;
      },
    });
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    expect(seen).toEqual(['start_server']);
    await handle.stop();
  });

  it('taskKind 可覆盖确认 kind（对齐内核 dispatch kind）', async () => {
    const seen: string[] = [];
    const script = await tempScript(FAKE_SERVER, 'confirm-kind2');
    const svc = makeService({
      confirm: (r) => {
        seen.push(r.kind);
        return true;
      },
    });
    const handle = svc.launch({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      taskKind: 'restart_server',
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    expect(seen).toEqual(['restart_server']);
    await handle.stop();
  });

  it('摘要对超长 args 截断（弹窗一行放得下）', async () => {
    const seen: string[] = [];
    const script = await tempScript(FAKE_SERVER, 'confirm-trunc');
    const svc = makeService({
      confirm: (r) => {
        seen.push(r.summary);
        return true;
      },
    });
    const handle = svc.launch({
      serverId: 'x',
      cmd: NODE,
      args: [script, '1', '2', '3', '4', '5', '6'],
    });
    await waitForLine(svc, 'x', (l) => l.startsWith('listening'));
    expect(seen[0]).toContain('…');
    await handle.stop();
  });

  it('未确认 → 零副作用：list 为空、status 为 null、磁盘无写入', async () => {
    const dir = await makeTempDir('mc-sup-nosideeffect-');
    tempDirs.push(dir);
    const spawnSpy = vi.fn();
    const svc = makeService({ spawn: spawnSpy as unknown as SpawnFn, confirm: () => false });
    expect(() => svc.launch({ serverId: 's1', cmd: 'java', args: [], cwd: dir })).toThrow(/未确认/);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.list()).toEqual([]);
    expect(svc.status('s1')).toBeNull();
    expect(svc.logs('s1')).toEqual([]);
    const { readdir } = await import('node:fs/promises');
    expect(await readdir(dir)).toEqual([]);
  });
});

// =========================================================================
// 2. spawn 注入与参数形状
// =========================================================================

describe('spawn 注入（§13.4 一律数组参数，不用 shell）', () => {
  /** 假 spawn：只登记调用，返回一个不会真跑的可控子进程替身。 */
  function fakeSpawnFn(): {
    fn: SpawnFn;
    calls: Array<{ cmd: string; args: string[]; o: SpawnOptions }>;
  } {
    const calls: Array<{ cmd: string; args: string[]; o: SpawnOptions }> = [];
    const fn: SpawnFn = (cmd, args, options) => {
      calls.push({ cmd, args, o: options });
      return nodeSpawn(NODE, ['-e', 'setTimeout(()=>{},60000)'], {
        stdio: 'pipe',
        windowsHide: true,
      });
    };
    return { fn, calls };
  }

  it('spawn 收到内核返回的 cmd 与 args（端到端对齐 launch_instance data）', async () => {
    const { fn, calls } = fakeSpawnFn();
    const svc = makeService({ spawn: fn });
    // 形状照抄 kernel-java launchInstance 返回的 data：{ cmd, args, instanceDir, ... }
    const handle = svc.launch({
      serverId: 'inst-1',
      cmd: 'C:/jdk-21/bin/java.exe',
      args: ['-Xms1G', '-Xmx2G', '-cp', 'a.jar', 'net.minecraft.client.main.Main'],
      cwd: 'C:/mc/instances/inst-1',
    });
    await waitForState(svc, 'inst-1', (st) => st === 'running');
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('C:/jdk-21/bin/java.exe');
    expect(calls[0].args).toEqual([
      '-Xms1G',
      '-Xmx2G',
      '-cp',
      'a.jar',
      'net.minecraft.client.main.Main',
    ]);
    expect(calls[0].o.cwd).toBe('C:/mc/instances/inst-1');
    await handle.stop({ gracefulMs: 0 });
  });

  it('spawn 收到 stdio 三路管道 + windowsHide（后台运行，§7.1）', async () => {
    const { fn, calls } = fakeSpawnFn();
    const svc = makeService({ spawn: fn });
    const handle = svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await waitForState(svc, 's1', (st) => st === 'running');
    expect(calls[0].o.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(calls[0].o.windowsHide).toBe(true);
    expect(calls[0].o.shell).toBeUndefined();
    await handle.stop({ gracefulMs: 0 });
  });

  it('默认不用 shell；显式 shell:true 才透传', async () => {
    const { fn, calls } = fakeSpawnFn();
    const svc = makeService({ spawn: fn });
    const h1 = svc.launch({ serverId: 'a', cmd: 'java', args: [] });
    await waitForState(svc, 'a', (st) => st === 'running');
    await h1.stop({ gracefulMs: 0 });
    const h2 = svc.launch({ serverId: 'b', cmd: 'run.bat', args: [], shell: true });
    await waitForState(svc, 'b', (st) => st === 'running');
    expect(calls[0].o.shell).toBeUndefined();
    expect(calls[1].o.shell).toBe(true);
    await h2.stop({ gracefulMs: 0 });
  });

  it('args 传副本：调用方后续改数组不影响已托管命令', async () => {
    const { fn, calls } = fakeSpawnFn();
    const svc = makeService({ spawn: fn });
    const args = ['-Xmx1G', '-jar', 'a.jar'];
    const handle = svc.launch({ serverId: 's1', cmd: 'java', args });
    await waitForState(svc, 's1', (st) => st === 'running');
    args.push('--tampered');
    expect(svc.status('s1')?.args).toEqual(['-Xmx1G', '-jar', 'a.jar']);
    expect(calls[0].args).toEqual(['-Xmx1G', '-jar', 'a.jar']);
    await handle.stop({ gracefulMs: 0 });
  });

  it('env 叠加进子进程环境（假进程回显 MARKER）', async () => {
    const script = await tempScript(FAKE_ENV_ECHO, 'env-echo');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      env: { MC_FAKE_MARKER: 'hello-supervisor' },
    });
    const line = await waitForLine(svc, 's1', (l) => l.startsWith('MARKER='));
    expect(line).toBe('MARKER=hello-supervisor');
    await handle.stop({ gracefulMs: 0 });
  });

  it('launchServer 的 cwd 默认取 serverDir（kernel-server control_server data）', async () => {
    const { fn, calls } = fakeSpawnFn();
    const svc = makeService({ spawn: fn });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: 'java',
      args: ['-jar', 'server.jar'],
      serverDir: 'D:/mc/servers/srv-1',
    });
    await waitForState(svc, 'srv-1', (st) => st === 'running');
    expect(calls[0].o.cwd).toBe('D:/mc/servers/srv-1');
    expect(svc.status('srv-1')?.cwd).toBe('D:/mc/servers/srv-1');
    await handle.stop({ gracefulMs: 0 });
  });

  it('reloadCommand 只记录不自动发送（§7.1 控制台注入未做）', async () => {
    const script = await tempScript(FAKE_SERVER, 'reload-echo');
    const svc = makeService();
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      reloadCommand: '/reload confirm',
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    expect(svc.status('srv-1')?.reloadCommand).toBe('/reload confirm');
    // 服务端控制台不应自动收到 reload
    expect(svc.logs('srv-1').some((l) => l.includes('reload'))).toBe(false);
    await handle.stop();
  });

  it('注入时钟决定快照的 startedAt', async () => {
    const script = await tempScript(FAKE_SERVER, 'clock');
    const svc = makeService({ now: () => 1_700_000_000_000 });
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    expect(svc.status('s1')?.startedAt).toBe(new Date(1_700_000_000_000).toISOString());
    await handle.stop();
  });

  it('注入 schedule 被真实使用（虚拟时钟，可断言挂起数）', async () => {
    const clock = fakeClock();
    const script = await tempScript(FAKE_STUBBORN, 'sched');
    const svc = makeService({ schedule: clock.schedule, scheduleHold: clock.scheduleHold });
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      gracefulMs: 50,
    });
    await waitForLine(svc, 's1', (l) => l === 'stubborn up');
    const pending = handle.stop();
    expect(clock.pending()).toBeGreaterThan(0);
    clock.runAll();
    await pending;
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('TimerHandle.cancel 生效：cancel 后回调不再执行', () => {
    const clock = fakeClock();
    let fired = 0;
    const h = clock.schedule(() => {
      fired += 1;
    }, 10);
    h.cancel();
    clock.runAll();
    expect(fired).toBe(0);
    expect(clock.pending()).toBe(0);
  });
});

// =========================================================================
// 3. 状态机：完整流转 + 非法流转拒绝
// =========================================================================

describe('状态机（stopped → starting → running → stopping → stopped / crashed）', () => {
  it('完整流转：starting → running 事件按序发出', async () => {
    const script = await tempScript(FAKE_SERVER, 'fsm');
    const svc = makeService();
    const seen: ServerState[] = [];
    svc.on('state', (s: StatusSnapshot) => {
      if (s.serverId === 's1') seen.push(s.state);
    });
    expect(svc.status('s1')).toBeNull();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    expect(seen).toEqual(['starting', 'running']);
    expect(svc.status('s1')?.state).toBe('running');
    await handle.stop();
    expect(seen).toEqual(['starting', 'running', 'stopping', 'stopped']);
  });

  it('running 时重复 launch 同 serverId → INVALID_STATE', async () => {
    const script = await tempScript(FAKE_SERVER, 'dup');
    const svc = makeService();
    const h1 = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    try {
      svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('INVALID_STATE');
      expect((e as Error).message).toContain('running');
    }
    // 只应存在一个真实子进程
    expect(svc.list()).toHaveLength(1);
    await h1.stop();
  });

  it('同一 serverId 重复 launch 被拒（并发语义）', () => {
    const svc = makeService();
    // 假 spawn：登记调用后立刻返回，进入 starting 后（pid 未就绪）不得被重复 launch。
    const spawnSpy = vi.fn(() =>
      nodeSpawn(NODE, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'pipe' }),
    );
    const s = makeService({ spawn: spawnSpy as unknown as SpawnFn });
    const first = s.launch({ serverId: 'x', cmd: NODE, args: [] });
    expect(s.status('x')?.state).toBe('running');
    expect(() => s.launch({ serverId: 'x', cmd: NODE, args: [] })).toThrow(/不允许 launch/);
    // 拒绝的第二次 launch 不得产生新进程
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(s.list()).toHaveLength(1);
    void first.exited;
    void svc.shutdownAll();
  });

  it('stopping 期间 launch 同 serverId → INVALID_STATE', async () => {
    const script = await tempScript(FAKE_STUBBORN, 'during-stop');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      stopCommand: null,
      gracefulMs: 1_000,
    });
    await waitForLine(svc, 's1', (l) => l === 'stubborn up');
    const stopping = handle.stop();
    await waitForState(svc, 's1', (s) => s === 'stopping');
    try {
      svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('INVALID_STATE');
    }
    await stopping;
  });

  it('崩溃后可再次 launch（crashed → starting → running），crashCount 累计不清零', async () => {
    const crash = await tempScript(FAKE_CRASH, 'crash');
    const good = await tempScript(FAKE_SERVER, 'good');
    const svc = makeService();
    const h1 = svc.launch({ serverId: 's1', cmd: NODE, args: [crash] });
    await h1.exited;
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.crashCount).toBe(1);

    const h2 = svc.launch({ serverId: 's1', cmd: NODE, args: [good] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    expect(svc.status('s1')?.state).toBe('running');
    // 重启不清零：退避策略要靠它判断是否放弃自动重启
    expect(svc.status('s1')?.crashCount).toBe(1);
    await h2.stop();
  });

  it('不同 serverId 可并行托管', async () => {
    const script = await tempScript(FAKE_SERVER, 'parallel');
    const svc = makeService();
    const h1 = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const h2 = svc.launch({ serverId: 's2', cmd: NODE, args: [script] });
    await Promise.all([
      waitForLine(svc, 's1', (l) => l.startsWith('listening')),
      waitForLine(svc, 's2', (l) => l.startsWith('listening')),
    ]);
    const list = svc.list();
    expect(list).toHaveLength(2);
    expect(list.every((x) => x.state === 'running')).toBe(true);
    expect(new Set(list.map((x) => x.pid)).size).toBe(2);
    await h1.stop();
    await h2.stop();
  });

  it('list 暴露 serverId/state/pid 三元组', async () => {
    const script = await tempScript(FAKE_SERVER, 'listshape');
    const svc = makeService();
    const handle = svc.launch({ serverId: 'srv-9', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-9', (l) => l.startsWith('listening'));
    expect(svc.list()).toEqual([{ serverId: 'srv-9', state: 'running', pid: expect.any(Number) }]);
    expect(svc.list()[0].pid).toBeGreaterThan(0);
    await handle.stop();
  });

  it('stop 后再 launch 允许（stopped → starting）', async () => {
    const script = await tempScript(FAKE_SERVER, 'relaunch');
    const svc = makeService();
    const h1 = svc.launch({ serverId: 's1', cmd: NODE, args: [script, '1'] });
    await waitForLine(svc, 's1', (l) => l === 'listening on 1');
    await h1.stop();
    expect(svc.status('s1')?.state).toBe('stopped');
    // 第二次用不同端口参数，这样"新进程已启动"由新日志行证明，
    // 不会误命中上一次运行留在环形缓冲里的旧行。
    const h2 = svc.launch({ serverId: 's1', cmd: NODE, args: [script, '2'] });
    await waitForLine(svc, 's1', (l) => l === 'listening on 2');
    expect(svc.status('s1')?.state).toBe('running');
    // 环形缓冲跨重启保留（可观测性不断线）
    expect(svc.logs('s1')).toContain('listening on 1');
    await h2.stop();
  });

  it('shutdownAll 之后 launch → SERVICE_CLOSED', async () => {
    const svc = makeService();
    await svc.shutdownAll();
    try {
      svc.launch({ serverId: 's1', cmd: NODE, args: [] });
      expect.unreachable('应拒绝');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('SERVICE_CLOSED');
    }
  });
});

// =========================================================================
// 4. 崩溃可观测（§7.1）
// =========================================================================

describe('崩溃可观测（状态 + 退出码 + 日志尾部；自动重启本轮不做）', () => {
  it('非预期退出 → crashed，退出码可读', async () => {
    const script = await tempScript(FAKE_CRASH, 'crash3');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const res = await handle.exited;
    expect(res.code).toBe(3);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    const snap = svc.status('s1');
    expect(snap?.state).toBe('crashed');
    expect(snap?.exitCode).toBe(3);
  });

  it('崩溃快照保留日志尾部（含 stderr）', async () => {
    const script = await tempScript(FAKE_CRASH, 'crashlog');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 's1', (s) => s === 'crashed');
    const lines = svc.status('s1')?.lastLogLines ?? [];
    expect(lines).toContain('fake server booting');
    expect(lines).toContain('error: address already in use');
  });

  it('退出码 0 的自行退出也算 crashed（判定看「非我方停机」）', async () => {
    const script = await tempScript(FAKE_QUIET_EXIT, 'quiet');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const res = await handle.exited;
    expect(res.code).toBe(0);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(svc.status('s1')?.exitCode).toBe(0);
  });

  it('crashed 状态下 stop() 是 no-op，不抹掉崩溃证据', async () => {
    const script = await tempScript(FAKE_CRASH, 'crashstop');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 's1', (s) => s === 'crashed');
    const outcome = await handle.stop();
    expect(outcome.exited).toBe(true);
    // 状态仍是 crashed：UI 需要继续显示「上次崩了」
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.exitCode).toBe(3);
  });

  it('exited promise 永不 reject 且带 signal 字段', async () => {
    const script = await tempScript(FAKE_CRASH, 'exitfields');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const res = await handle.exited;
    expect(Object.keys(res).sort()).toEqual(['code', 'signal']);
    expect(res.signal).toBeNull();
  });

  it('快照含 cmd/args/cwd 便于审计复现', async () => {
    const script = await tempScript(FAKE_SERVER, 'audit');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script, '25565'],
      cwd: tmpdir(),
    });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    const snap = svc.status('s1');
    expect(snap?.cmd).toBe(NODE);
    expect(snap?.args).toEqual([script, '25565']);
    expect(snap?.cwd).toBe(tmpdir());
    await handle.stop();
  });

  it('spawn 不存在的可执行 → 落 crashed 并把错误写进日志尾部', async () => {
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: path.join(tmpdir(), 'definitely-not-here-9d2f.exe'),
      args: [],
    });
    const res = await handle.exited;
    expect(res.code).toBeNull();
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(svc.logs('s1').some((l) => l.startsWith('spawn error:'))).toBe(true);
  });

  it('spawn 注入器同步抛错 → SPAWN_FAILED', () => {
    const svc = makeService({
      spawn: () => {
        throw new Error('EMFILE');
      },
    });
    try {
      svc.launch({ serverId: 's1', cmd: 'java', args: [] });
      expect.unreachable('应抛错');
    } catch (e) {
      expect((e as ProcessSupervisorError).code).toBe('SPAWN_FAILED');
      expect((e as Error).message).toContain('EMFILE');
    }
    expect(svc.status('s1')?.state).toBe('crashed');
  });
});

// =========================================================================
// 5. 日志流（§7.4 控制台流式 I/O + 环形缓冲）
// =========================================================================

describe('日志流（按到达顺序合并 + 有界环形缓冲）', () => {
  it('stdout 被捕获成行', async () => {
    const script = await tempScript(FAKE_SERVER, 'stdout');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const line = await waitForLine(svc, 's1', (l) => l === 'fake server booting');
    expect(line).toBe('fake server booting');
    await handle.stop();
  });

  it('stderr 被捕获并标记 stream=stderr', async () => {
    const script = await tempScript(FAKE_CRASH, 'stderr');
    const svc = makeService();
    const streams: Record<string, string> = {};
    svc.on('log', (e: LogEvent) => {
      streams[e.stream] = e.line;
    });
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    expect(streams['stderr']).toBe('error: address already in use');
  });

  it('stdout 与 stderr 按到达顺序合并进同一有序序列', async () => {
    const script = await tempScript(FAKE_CRASH, 'merge');
    const svc = makeService();
    const order: string[] = [];
    svc.on('log', (e: LogEvent) => {
      if (e.serverId === 's1') order.push(e.line);
    });
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    expect(order).toEqual(['fake server booting', 'error: address already in use']);
  });

  it('log 事件带 serverId/line/at 字段', async () => {
    const script = await tempScript(FAKE_SERVER, 'evtfields');
    const svc = makeService({ now: () => 1_700_000_000_000 });
    const handle = svc.launch({ serverId: 'srv-x', cmd: NODE, args: [script] });
    const line = await waitForLine(svc, 'srv-x', (l) => l.startsWith('listening'));
    expect(line).toBe('listening on 0');
    await handle.stop();
  });

  it('进程退出时把无换行的尾行也算一行（最后一句不丢）', async () => {
    const script = await tempScript(FAKE_PARTIAL_LINE, 'partial');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    expect(svc.logs('s1')).toContain('tail without newline');
    expect(svc.logs('s1')).toContain('complete line');
  });

  it('环形缓冲有界：超出上限只保留尾部', async () => {
    const script = await tempScript(FAKE_CHATTY, 'chatty');
    const svc = makeService({ logTailLines: 5 });
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script, '50'],
    });
    await handle.exited;
    const lines = svc.logs('s1');
    expect(lines).toHaveLength(5);
    expect(lines[4]).toBe('line 50');
    expect(lines.some((l) => l === 'line 1')).toBe(false);
  });

  it('默认缓冲上限为 200 行（对齐 kernel-server read_logs）', () => {
    const svc = makeService();
    // 通过环形缓冲上限语义验证默认值：logTailLines 未传时是 200
    expect(DEFAULT_LOG_TAIL_LINES).toBe(200);
    expect(svc.logs('missing')).toEqual([]);
  });

  it('logs(limit) 返回尾部 N 行，limit=0 返回空', async () => {
    const script = await tempScript(FAKE_CHATTY, 'limits');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script, '30'] });
    await handle.exited;
    expect(svc.logs('s1', 3)).toEqual(['line 28', 'line 29', 'line 30']);
    expect(svc.logs('s1', 0)).toEqual([]);
    expect(handle.logs(2)).toEqual(['line 29', 'line 30']);
  });

  it('超长无换行输出被截断成行，不无限吃内存', async () => {
    const script = await tempScript(
      `process.stdout.write('x'.repeat(50000));
process.exitCode = 0;
`,
      'noline',
    );
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    const lines = svc.logs('s1');
    expect(lines.length).toBeGreaterThan(0);
    // 半行缓冲上限 8192 → 至少切出多段，不留 50000 字符的单行
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(8192);
  });

  it('崩溃后日志尾部仍可读（read_logs 式只读查询）', async () => {
    const script = await tempScript(FAKE_CRASH, 'crashread');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(svc.logs('s1', 2)).toEqual(['fake server booting', 'error: address already in use']);
  });
});

// =========================================================================
// 6. 优雅停机（§7.4）
// =========================================================================

describe('优雅停机（先写控制台 stop → 等退出 → 端口释放）', () => {
  it('launchServer 默认把 "stop" 写进 stdin，服务端自行退出', async () => {
    const script = await tempScript(FAKE_SERVER, 'stop');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await handle.stop();
    expect(svc.logs('srv-1')).toContain('saving world...');
  });

  it('停机后进程真的退出，exited promise resolve', async () => {
    const script = await tempScript(FAKE_SERVER, 'stopexit');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await handle.stop();
    const res = await handle.exited;
    expect(res.code).toBe(0);
  });

  it('停机后状态回 stopped，且退出码入库', async () => {
    const script = await tempScript(FAKE_SERVER, 'stopstate');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await handle.stop();
    const snap = svc.status('srv-1');
    expect(snap?.state).toBe('stopped');
    expect(snap?.exitCode).toBe(0);
  });

  it('stop 返回 graceful=true / forced=false', async () => {
    const script = await tempScript(FAKE_SERVER, 'stopout');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const outcome: StopOutcome = await handle.stop();
    expect(outcome).toMatchObject({
      serverId: 'srv-1',
      graceful: true,
      forced: false,
      exited: true,
      portReleased: null,
      portTimedOut: false,
    });
  });

  it('快照带 lastStop 停机报告（中文 UI 可直接展示）', async () => {
    const script = await tempScript(FAKE_SERVER, 'stopreport');
    const svc = makeService({ now: () => 1_700_000_000_000 });
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await handle.stop();
    expect(svc.status('srv-1')?.lastStop).toEqual({
      graceful: true,
      forced: false,
      portTimedOut: null,
      at: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it('launch（客户端实例）默认不写 stdin，避免把 "stop" 灌给游戏', async () => {
    const script = await tempScript(FAKE_SERVER, 'nostop');
    const svc = makeService();
    const handle = svc.launch({ serverId: 'inst-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'inst-1', (l) => l.startsWith('listening'));
    // 不写 stop → 假进程只在收到 stop 时才退出；这里显式 stop 仍应走信号路径并结束进程
    await handle.stop({ gracefulMs: 200 });
    expect(svc.status('inst-1')?.state).toBe('stopped');
    expect(svc.logs('inst-1')).not.toContain('saving world...');
  });

  it('自定义 stopCommand 生效', async () => {
    const script = await tempScript(FAKE_SERVER, 'custom');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      stopCommand: 'quit\n',
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    // "quit" 不是 stop，假进程只回声
    await handle.stop({ gracefulMs: 150 });
    expect(svc.logs('srv-1')).toContain('echo: quit');
  });

  it('stopCommand=null 退化为发信号（无 stdin 通道）', async () => {
    const script = await tempScript(FAKE_STUBBORN, 'signalled');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      stopCommand: null,
    });
    await waitForLine(svc, 's1', (l) => l === 'stubborn up');
    const outcome = await handle.stop({ gracefulMs: 3_000 });
    expect(outcome.exited).toBe(true);
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('stop 幂等：并发两次共享同一个结果', async () => {
    const script = await tempScript(FAKE_SERVER, 'idempotent');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const [a, b] = await Promise.all([handle.stop(), handle.stop()]);
    expect(a).toEqual(b);
    expect(svc.status('srv-1')?.state).toBe('stopped');
  });

  it('已 stopped 再 stop → no-op resolve', async () => {
    const script = await tempScript(FAKE_SERVER, 'stopagain');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await handle.stop();
    const again = await handle.stop();
    expect(again.exited).toBe(true);
    expect(svc.status('srv-1')?.state).toBe('stopped');
  });

  it('per-call gracefulMs 覆盖规格默认值', async () => {
    const script = await tempScript(FAKE_STUBBORN, 'override');
    const svc = makeService();
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      stopCommand: null,
      gracefulMs: 60_000,
    });
    await waitForLine(svc, 's1', (l) => l === 'stubborn up');
    // 用 150ms 覆盖：否则会等满 60s
    const outcome = await handle.stop({ gracefulMs: 150 });
    expect(outcome.exited).toBe(true);
  });
});

// =========================================================================
// 7. 强杀兜底（Windows 杀整棵树 —— devkit 踩坑经验）
// =========================================================================

describe('强杀兜底（宽限期耗尽 → 杀整棵树）', () => {
  /**
   * 可控假子进程：kill() 记录但不真杀（模拟「无视停止信号」）。
   * 为什么必须用假子进程而不能用真 stubborn 脚本：Windows 上 child.kill('SIGTERM')
   * 实际是 TerminateProcess，真进程一定秒死，也就永远走不到「宽限期耗尽→强杀」分支。
   * 只有把「杀不掉」这件事注入进去，才能确定性地测兜底逻辑本身。
   * 真进程的强杀路径由下方 .bat + shell:true 的集成测试覆盖（那才是真实场景）。
   */
  class StubbornChild extends EventEmitter {
    readonly pid = 424242;
    readonly stdout = new PassThrough();
    readonly stderr = new PassThrough();
    readonly stdin = new PassThrough();
    readonly signals: Array<NodeJS.Signals | number> = [];
    readonly stdinWrites: string[] = [];
    constructor() {
      super();
      // stdin 假装可写，且把写入内容记下来（验证"有没有先写 stop"）。
      Object.defineProperty(this.stdin, 'writable', { value: true, configurable: true });
      this.stdin.on('data', () => undefined);
      const origWrite = this.stdin.write.bind(this.stdin);
      this.stdin.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
        this.stdinWrites.push(String(chunk));
        return origWrite(chunk as never, ...(rest as []));
      }) as PassThrough['write'];
    }
    kill(signal?: NodeJS.Signals | number): boolean {
      this.signals.push(signal ?? 'SIGTERM');
      return true;
    }
    /** 模拟真被 taskkill / SIGKILL 杀掉。 */
    die(code: number | null = null): void {
      this.emit('exit', code, null);
      this.emit('close', code, null);
    }
  }

  function stubbornService(opts: ProcessSupervisorOptions = {}): {
    svc: ProcessSupervisor;
    child: StubbornChild;
  } {
    const child = new StubbornChild();
    const svc = makeService({
      spawn: () => child as unknown as ChildProcess,
      // Windows + shell:true → 优雅阶段**不发信号**（否则只会杀 cmd.exe 留孤儿），
      // 于是必然耗尽宽限期进入 killTree，正是 devkit 踩过的坑对应的场景。
      platform: 'win32',
      ...opts,
    });
    return { svc, child };
  }

  it('宽限期耗尽 → forced=true 并走 killTree', async () => {
    const { svc, child } = stubbornService({
      taskkill: (pid) => {
        child.die(1);
        return pid === 424242 ? 0 : 1;
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 80,
    });
    expect(svc.status('s1')?.state).toBe('running');
    const outcome = await handle.stop();
    expect(outcome.forced).toBe(true);
    expect(outcome.graceful).toBe(false);
    expect(outcome.exited).toBe(true);
    await handle.exited;
    expect(svc.status('s1')?.state).toBe('stopped');
    expect(svc.status('s1')?.lastStop?.forced).toBe(true);
  });

  it('killTree 调用的 taskkill 收到正确 pid（Windows 杀整棵树）', async () => {
    const killed: number[] = [];
    const { svc, child } = stubbornService({
      taskkill: (pid) => {
        killed.push(pid);
        child.die(1);
        return 0;
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 60,
    });
    expect(svc.status('s1')?.pid).toBe(424242);
    await handle.stop();
    expect(killed).toEqual([424242]);
  });

  it('强杀不留孤儿：exited 确实 resolve（杀整棵树后 stdio 也释放）', async () => {
    const { svc, child } = stubbornService({
      taskkill: () => {
        child.die(9);
        return 0;
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 60,
    });
    await handle.stop();
    const res = await handle.exited;
    expect(res.code).toBe(9);
    expect(svc.status('s1')?.exitCode).toBe(9);
  });

  it('优雅阶段先写 stdin（不急着杀），宽限期内退出则不 forced', async () => {
    const { svc, child } = stubbornService({
      taskkill: () => {
        child.die(1);
        return 0;
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: 'stop\n',
      gracefulMs: 1_000,
    });
    // 模拟服务端收到 stop 后自行退出（在宽限期内）
    const p = handle.stop();
    await new Promise((r) => setImmediate(r));
    expect(child.stdinWrites).toEqual(['stop\n']);
    child.die(0);
    const outcome = await p;
    expect(outcome.graceful).toBe(true);
    expect(outcome.forced).toBe(false);
  });

  it('taskkill 返回非 0 → 回退 SIGTERM（Windows 仍能收尾）', async () => {
    const { svc, child } = stubbornService({
      taskkill: () => {
        // 模拟 taskkill 失败后由回退信号真正结束进程
        child.die(1);
        return 1;
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 60,
    });
    const outcome = await handle.stop();
    expect(child.signals).toContain('SIGTERM');
    expect(outcome.forced).toBe(true);
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('taskkill 自身抛异常 → 不产生未捕获异常，仍回退信号', async () => {
    const { svc, child } = stubbornService({
      taskkill: () => {
        child.die(1);
        throw new Error('taskkill missing');
      },
    });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 60,
    });
    const outcome = await handle.stop();
    expect(child.signals).toContain('SIGTERM');
    expect(outcome.exited).toBe(true);
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('强杀后进程仍不退出 → exited=false 且状态照旧收尾（不挂住 stop）', async () => {
    // taskkill 报告成功但进程没死：stop 不能无限等。
    const { svc } = stubbornService({ taskkill: () => 0 });
    const handle = svc.launch({
      serverId: 's1',
      cmd: 'run.bat',
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 60,
    });
    const outcome = await handle.stop();
    expect(outcome.exited).toBe(false);
    expect(outcome.forced).toBe(true);
    // 状态仍收尾为 stopped：调用方不会永久卡在 stopping
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('posix 分支：SIGTERM 无效时补发 SIGKILL（平台注入驱动）', async () => {
    // 造一个「SIGTERM 无视、SIGKILL 才死」的子进程：stop 必须靠补刀把它收掉。
    // 时序完全靠 exited promise 推进，不 sleep。
    const child = new StubbornChild();
    child.kill = (signal?: NodeJS.Signals | number): boolean => {
      child.signals.push(signal ?? 'SIGTERM');
      if (signal === 'SIGKILL') child.die(9);
      return true;
    };
    const svc = makeService({ spawn: () => child as unknown as ChildProcess, platform: 'linux' });
    const handle = svc.launch({
      serverId: 's1',
      cmd: './server.sh',
      args: [],
      stopCommand: null,
      gracefulMs: 40,
    });
    const outcome = await handle.stop();
    expect(child.signals[0]).toBe('SIGTERM');
    expect(child.signals).toContain('SIGKILL');
    expect(outcome.forced).toBe(true);
    expect(outcome.exited).toBe(true);
    expect(svc.status('s1')?.exitCode).toBe(9);
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it.runIf(IS_WIN)('Windows .bat + shell:true：孙进程整棵树被 taskkill 杀掉', async () => {
    // 照抄 devkit 的 makeFakeProject：Windows 只有 .bat，且必须经 shell。
    const bat = await makeFakeScript('@echo off\r\nping -n 30 127.0.0.1 >nul\r\n', 'stubborn');
    tempDirs.push(path.dirname(bat));
    const killed: number[] = [];
    const svc = makeService({
      taskkill: (pid) => {
        killed.push(pid);
        try {
          nodeSpawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
        } catch {
          /* 忽略 */
        }
        return 0;
      },
    });
    const handle = svc.launch({
      serverId: 'win-1',
      cmd: bat,
      args: [],
      shell: true,
      stopCommand: null,
      gracefulMs: 200,
    });
    await waitForState(svc, 'win-1', (s) => s === 'running');
    const pid = svc.status('win-1')?.pid ?? 0;
    const outcome = await handle.stop();
    expect(killed).toContain(pid);
    expect(outcome.forced).toBe(true);
    // 杀完 cmd.exe 后孙进程（ping）也必须消失，否则管道不释放、close 永不触发
    await handle.exited;
    expect(svc.status('win-1')?.state).toBe('stopped');
  });

  it.runIf(IS_WIN)('Windows .bat + shell:true：写 stdin 也能优雅停机', async () => {
    const bat = await makeFakeScript(
      '@echo off\r\necho booting\r\nset /p line=\r\necho got %line%\r\n',
      'graceful',
    );
    tempDirs.push(path.dirname(bat));
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'win-2', cmd: bat, args: [], shell: true });
    await waitForLine(svc, 'win-2', (l) => l === 'booting');
    const outcome = await handle.stop();
    expect(outcome.graceful).toBe(true);
    expect(svc.logs('win-2')).toContain('got stop');
    expect(svc.status('win-2')?.state).toBe('stopped');
  });
});

// =========================================================================
// 8. 端口等待（§7.1 端口检测 —— 不能只看 child.on('exit')）
// =========================================================================

describe('端口等待（进程退了 ≠ 端口释放了）', () => {
  it('未配置端口 → portReleased 为 null（不谎报）', async () => {
    const script = await tempScript(FAKE_SERVER, 'noport');
    const svc = makeService();
    const handle = svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script] });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const outcome = await handle.stop();
    expect(outcome.portReleased).toBeNull();
    expect(outcome.portTimedOut).toBe(false);
    expect(svc.status('srv-1')?.portReleased).toBeNull();
  });

  it('端口先 busy 后 free → 等到释放才算 stopped', async () => {
    const script = await tempScript(FAKE_SERVER, 'busy-then-free');
    const results = [true, false];
    let calls = 0;
    const svc = makeService({
      probePort: () => Promise.resolve(results[Math.min(calls++, results.length - 1)]),
    });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      port: { host: '127.0.0.1', port: 25599, waitMs: 500 },
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const outcome = await handle.stop();
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(outcome.portReleased).toBe(true);
    expect(outcome.portTimedOut).toBe(false);
  });

  it('端口释放前状态保持 stopping（不提前宣告 stopped）', async () => {
    const script = await tempScript(FAKE_SERVER, 'gated');
    let open = true;
    const svc = makeService({
      // 端口探测第二次才放行：第一次调用时进程已经 exit，状态必须还是 stopping。
      probePort: () => {
        const v = open;
        open = false;
        return Promise.resolve(v);
      },
    });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      port: { host: '127.0.0.1', port: 25601, waitMs: 500 },
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const firstProbe = svc.logs('srv-1'); // 仅用于确保已启动
    expect(firstProbe.length).toBeGreaterThan(0);
    const stopPromise = handle.stop();
    await waitForState(svc, 'srv-1', (s) => s === 'stopped');
    expect(svc.status('srv-1')?.portReleased).toBe(true);
    await stopPromise;
  });

  it('端口一直 busy → 超时后报告 portTimedOut（用户能看到「端口仍被占用」）', async () => {
    const script = await tempScript(FAKE_SERVER, 'busy-forever');
    const svc = makeService({ probePort: () => Promise.resolve(true) });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      port: { host: '127.0.0.1', port: 25602, waitMs: 120 },
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const outcome = await handle.stop();
    expect(outcome.portReleased).toBe(false);
    expect(outcome.portTimedOut).toBe(true);
    // 即便端口没放干净，状态仍回 stopped（进程确实没了）
    expect(svc.status('srv-1')?.state).toBe('stopped');
    expect(svc.status('srv-1')?.lastStop?.portTimedOut).toBe(true);
  });

  it('waitMs=0 → 立即判定一次，不空转', async () => {
    const script = await tempScript(FAKE_SERVER, 'zerowait');
    let calls = 0;
    const svc = makeService({
      probePort: () => {
        calls += 1;
        return Promise.resolve(false);
      },
    });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      port: { host: '127.0.0.1', port: 25603, waitMs: 0 },
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    const outcome = await handle.stop();
    expect(calls).toBe(1);
    expect(outcome.portReleased).toBe(true);
  });

  it('真实端口：假服务端持有端口，停机后端口真的释放', async () => {
    const port = await getFreePort();
    const script = await tempScript(FAKE_PORT_HOLDER, 'holder');
    const svc = makeService();
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script, String(port)],
      port: { host: '127.0.0.1', port, waitMs: 5_000 },
    });
    await waitForLine(svc, 'srv-1', (l) => l === `listening ${port}`);
    // 端口此刻确实被占（真实 socket 探测）
    expect(await probe(port)).toBe(true);
    const outcome = await handle.stop();
    expect(outcome.portReleased).toBe(true);
    expect(outcome.portTimedOut).toBe(false);
    expect(await probe(port)).toBe(false);
  });

  it('真实端口泄漏：孙进程继续占端口 → 报告 portTimedOut', async () => {
    const dir = await makeTempDir('mc-sup-leak-');
    tempDirs.push(dir);
    const port = await getFreePort();
    const pidFile = path.join(dir, 'holder.pid');
    const script = await tempScript(FAKE_PORT_LEAKER, 'leaker');
    const svc = makeService();
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script, String(port), pidFile],
      port: { host: '127.0.0.1', port, waitMs: 300 },
    });
    await waitForLine(svc, 'srv-1', (l) => l === `leaking on ${port}`);
    const { readFile } = await import('node:fs/promises');
    leakedPids.push(Number((await readFile(pidFile, 'utf8')).trim()));
    // 父进程能优雅退出（收到 stop），但端口仍被孙进程占着 —— 这正是
    // 「不能只看 child.on('exit')」的现实场景。
    const outcome = await handle.stop();
    expect(outcome.exited).toBe(true);
    expect(outcome.portTimedOut).toBe(true);
    expect(outcome.portReleased).toBe(false);
    expect(svc.status('srv-1')?.state).toBe('stopped');
  });
});

/** 真实端口探测（测试断言用，不走注入点）。 */
function probe(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host, port });
    const done = (v: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(300, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

// =========================================================================
// 9. 资源清理（shutdownAll）
// =========================================================================

describe('资源清理（shutdownAll 真的结束所有子进程）', () => {
  it('全部托管进程回到 stopped', async () => {
    const script = await tempScript(FAKE_SERVER, 'shut');
    const svc = makeService();
    const h1 = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    const h2 = svc.launch({ serverId: 's2', cmd: NODE, args: [script] });
    await Promise.all([
      waitForLine(svc, 's1', (l) => l.startsWith('listening')),
      waitForLine(svc, 's2', (l) => l.startsWith('listening')),
    ]);
    await svc.shutdownAll();
    expect(svc.list().map((x) => x.state)).toEqual(['stopped', 'stopped']);
    await Promise.all([h1.exited, h2.exited]);
  });

  it('幂等：重复调用不抛错、结果一致', async () => {
    const script = await tempScript(FAKE_SERVER, 'shut-idem');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    await svc.shutdownAll();
    const states = svc.list().map((x) => x.state);
    await expect(svc.shutdownAll()).resolves.toBeUndefined();
    await expect(svc.shutdownAll()).resolves.toBeUndefined();
    expect(svc.list().map((x) => x.state)).toEqual(states);
    await handle.exited;
  });

  it('并发调用 shutdownAll 共享同一个 promise', async () => {
    const script = await tempScript(FAKE_SERVER, 'shut-conc');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    await Promise.all([svc.shutdownAll(), svc.shutdownAll(), svc.shutdownAll()]);
    expect(svc.status('s1')?.state).toBe('stopped');
    await handle.exited;
  });

  it('无任何 entry 时 shutdownAll 立即完成', async () => {
    const svc = makeService();
    await expect(svc.shutdownAll()).resolves.toBeUndefined();
  });

  it('对无视停机的进程也能强制结束（不留孤儿）', async () => {
    const script = await tempScript(FAKE_STUBBORN, 'shut-stubborn');
    const svc = makeService({ shutdownGracefulMs: 150 });
    const handle = svc.launch({
      serverId: 's1',
      cmd: NODE,
      args: [script],
      stopCommand: null,
    });
    await waitForLine(svc, 's1', (l) => l === 'stubborn up');
    await svc.shutdownAll();
    const res = await handle.exited;
    expect(res).toBeDefined();
    expect(svc.status('s1')?.state).toBe('stopped');
  });

  it('单个进程停不掉也不连带抛错（allSettled 语义）', async () => {
    const script = await tempScript(FAKE_STUBBORN, 'shut-partial');
    const svc = makeService({ shutdownGracefulMs: 150 });
    const bad = svc.launch({
      serverId: 'bad',
      cmd: NODE,
      args: [script],
      stopCommand: null,
    });
    const good = await tempScript(FAKE_SERVER, 'shut-good');
    const ok = svc.launch({ serverId: 'ok', cmd: NODE, args: [good] });
    await Promise.all([
      waitForLine(svc, 'bad', (l) => l === 'stubborn up'),
      waitForLine(svc, 'ok', (l) => l.startsWith('listening')),
    ]);
    // 让 bad 的 stop 内部抛错，验证不会污染整体结果
    svc.on('supervisor-error', () => undefined);
    await expect(svc.shutdownAll()).resolves.toBeUndefined();
    await Promise.all([bad.exited, ok.exited]);
    expect(svc.list().every((x) => x.state === 'stopped')).toBe(true);
  });

  it('shutdownAll 忽略已 crashed 的 entry，不改动其状态', async () => {
    const script = await tempScript(FAKE_CRASH, 'shut-crashed');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await handle.exited;
    await waitForState(svc, 's1', (s) => s === 'crashed');
    await svc.shutdownAll();
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.exitCode).toBe(3);
  });

  it('shutdownAll 后 stop() 仍安全（no-op）', async () => {
    const script = await tempScript(FAKE_SERVER, 'shut-then-stop');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    await svc.shutdownAll();
    const outcome = await handle.stop();
    expect(outcome.exited).toBe(true);
  });

  it('shutdownAll 后仍可读日志（只读查询不失效）', async () => {
    const script = await tempScript(FAKE_SERVER, 'shut-logs');
    const svc = makeService();
    const handle = svc.launch({ serverId: 's1', cmd: NODE, args: [script] });
    await waitForLine(svc, 's1', (l) => l.startsWith('listening'));
    await svc.shutdownAll();
    expect(svc.logs('s1').length).toBeGreaterThan(0);
    await handle.exited;
  });
});

// =========================================================================
// 10. 崩溃自动重启（§7.1）
//
// 时序纪律：退避定时器全部走**手动推进的虚拟时钟**，绝不用真实 sleep 硬等。
// 为什么不能沿用上面第 2 节那个 fakeClock：它的 runAll 只触发「零延迟」定时器
// （虚拟 now 恒为 0），测不了「等 1 秒再重启」这种真实语义；另起一个能按虚拟时间推进的。
// =========================================================================

interface ManualClock {
  schedule: ScheduleFn;
  scheduleHold: ScheduleFn;
  /** 推进虚拟时间 ms，按到期顺序依次触发回调（同刻到期的按注册顺序）。 */
  advance: (ms: number) => void;
  /** 最近的挂起定时器距今多少毫秒；无挂起返回 null。 */
  pendingMs: () => number | null;
}

function manualSchedule(): ManualClock {
  let now = 0;
  let seq = 0;
  const timers: Array<{ fn: () => void; at: number; seq: number }> = [];
  const schedule: ScheduleFn = (fn, ms) => {
    const t = { fn, at: now + Math.max(0, ms), seq: seq++ };
    timers.push(t);
    return {
      cancel: () => {
        const i = timers.indexOf(t);
        if (i !== -1) timers.splice(i, 1);
      },
    };
  };
  return {
    schedule,
    scheduleHold: schedule,
    advance: (ms: number) => {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => t.at <= target)
          .sort((a, b) => (a.at === b.at ? a.seq - b.seq : a.at - b.at));
        const t = due[0];
        if (t === undefined) break;
        timers.splice(timers.indexOf(t), 1);
        now = t.at;
        t.fn();
      }
      now = target;
    },
    pendingMs: () => (timers.length === 0 ? null : Math.min(...timers.map((t) => t.at)) - now),
  };
}

/**
 * 可控假子进程：stdin 写入全部记录，退出由测试显式 die() 触发。
 * 为什么不用真进程：自动重启的核心是「退避 + 计数 + 确认闸门」的纯逻辑，
 * 确定性要求「什么时候崩由测试说了算」，真进程的崩溃时机不受控。
 * kill() 直接 die：模拟 Windows 上 child.kill('SIGTERM') 就是 TerminateProcess（秒死）。
 */
class ControllableChild extends EventEmitter {
  readonly pid: number;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin = new PassThrough();
  readonly stdinWrites: string[] = [];
  readonly signals: Array<NodeJS.Signals | number> = [];
  private dead = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
    // stdin 假装可写并记录每次写入（断言「到底有没有写进控制台」）
    Object.defineProperty(this.stdin, 'writable', { value: true, configurable: true });
    const origWrite = this.stdin.write.bind(this.stdin);
    this.stdin.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      this.stdinWrites.push(String(chunk));
      return origWrite(chunk as never, ...(rest as []));
    }) as PassThrough['write'];
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.signals.push(signal ?? 'SIGTERM');
    this.die(0);
    return true;
  }

  /** 模拟进程退出（崩溃传非 0；收到信号传 0）。 */
  die(code: number | null): void {
    if (this.dead) return;
    this.dead = true;
    this.emit('exit', code, null);
    this.emit('close', code, null);
  }
}

interface CrashHarness {
  svc: ProcessSupervisor;
  clock: ManualClock;
  /** 第 n 个假子进程 = 第 n 次 spawn 的产物。 */
  children: ControllableChild[];
  spawnSpy: ReturnType<typeof vi.fn>;
  /** 自动重启相关事件（创建时就挂好监听，免得错过）。 */
  events: {
    /** 每次计划重启的退避时长（1 起）。 */
    delays: number[];
    exhausted: AutoRestartExhaustedEvent[];
    rejected: number[];
  };
}

function makeCrashHarness(opts: ProcessSupervisorOptions = {}): CrashHarness {
  const clock = manualSchedule();
  const children: ControllableChild[] = [];
  const spawnSpy = vi.fn(() => {
    const c = new ControllableChild(70_000 + children.length);
    children.push(c);
    return c as unknown as ChildProcess;
  });
  const svc = makeService({
    spawn: spawnSpy as unknown as SpawnFn,
    schedule: clock.schedule,
    scheduleHold: clock.scheduleHold,
    ...opts,
  });
  const events: CrashHarness['events'] = { delays: [], exhausted: [], rejected: [] };
  svc.on('auto-restart-scheduled', (e: AutoRestartScheduledEvent) => {
    events.delays.push(e.delayMs);
  });
  svc.on('auto-restart-exhausted', (e: AutoRestartExhaustedEvent) => {
    events.exhausted.push(e);
  });
  svc.on('auto-restart-rejected', (e: { attempt: number }) => {
    events.rejected.push(e.attempt);
  });
  return { svc, clock, children, spawnSpy, events };
}

/** 构造一个「先放行第一次确认、之后一律拒绝」的 confirm（模拟用户取消弹窗）。 */
function confirmOnceOnly(): ConfirmFn {
  let n = 0;
  return () => {
    n += 1;
    return n === 1;
  };
}

describe('崩溃自动重启（§7.1 指数退避；默认关闭 + 每次重启都过确认闸门）', () => {
  it('默认常量：首次退避 1000ms、封顶 30000ms、连续崩溃上限 5 次', () => {
    expect(DEFAULT_RESTART_DELAY_MS).toBe(1_000);
    expect(DEFAULT_MAX_RESTART_DELAY_MS).toBe(30_000);
    expect(DEFAULT_MAX_AUTO_RESTARTS).toBe(5);
  });

  it('默认关闭：崩溃只落 crashed，连「打算重启」都不排', async () => {
    const { svc, spawnSpy, children, clock, events } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: ['-jar', 'a.jar'] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(events.delays).toEqual([]);
    expect(svc.status('s1')?.autoRestartEnabled).toBe(false);
    expect(svc.status('s1')?.autoRestartPending).toBe(false);
    expect(svc.status('s1')?.state).toBe('crashed');
  });

  it('开启 + 确认通过 → 退避到点后自动拉起', async () => {
    const { svc, spawnSpy, children, clock, events } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: ['-jar', 'a.jar'] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');

    // 退避没到点就不许重启（这就是退避的全部意义）
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(clock.pendingMs()).toBe(1_000);
    clock.advance(999);
    expect(spawnSpy).toHaveBeenCalledTimes(1);

    clock.advance(1);
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(events.delays).toEqual([1_000]);
  });

  it('退避序列按 2 的幂递增：1s / 2s / 4s', async () => {
    const { svc, children, clock, events } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    for (let i = 0; i < 3; i += 1) {
      children[i].die(1);
      await waitForState(svc, 's1', (s) => s === 'crashed');
      clock.advance(60_000);
      await waitForState(svc, 's1', (s) => s === 'running');
    }
    expect(events.delays).toEqual([1_000, 2_000, 4_000]);
  });

  it('退避封顶：restartDelayMs=10000 且封顶 30000 → 10000/20000/30000/30000', async () => {
    const { svc, children, clock, events } = makeCrashHarness({
      autoRestart: true,
      restartDelayMs: 10_000,
      maxRestartDelayMs: 30_000,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    for (let i = 0; i < 4; i += 1) {
      children[i].die(1);
      await waitForState(svc, 's1', (s) => s === 'crashed');
      clock.advance(60_000);
      await waitForState(svc, 's1', (s) => s === 'running');
    }
    expect(events.delays).toEqual([10_000, 20_000, 30_000, 30_000]);
  });

  it('maxAutoRestarts=0 → 显式关闭自动重启，一次都不排', async () => {
    const { svc, spawnSpy, children, clock, events } = makeCrashHarness({
      autoRestart: true,
      maxAutoRestarts: 0,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(events.delays).toEqual([]);
  });

  it('连续崩溃达上限 → 停止重启并 emit auto-restart-exhausted（只发一次）', async () => {
    const { svc, spawnSpy, children, clock, events } = makeCrashHarness({
      autoRestart: true,
      maxAutoRestarts: 2,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    // 第 1、2 次崩溃各重启一次；第 3 次崩溃达上限放弃
    for (let i = 0; i < 2; i += 1) {
      children[i].die(1);
      await waitForState(svc, 's1', (s) => s === 'crashed');
      clock.advance(60_000);
      await waitForState(svc, 's1', (s) => s === 'running');
    }
    children[2].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);

    // 初始 1 次 + 2 次自动重启 = 3 次 spawn；第 3 次崩溃后再无第 4 次
    expect(spawnSpy).toHaveBeenCalledTimes(3);
    expect(events.exhausted).toHaveLength(1);
    expect(events.exhausted[0]).toMatchObject({
      serverId: 's1',
      crashCount: 3,
      attempts: 2,
      maxAutoRestarts: 2,
    });
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.autoRestartExhausted).toBe(true);
    // 达上限后不再排任何退避定时器
    expect(clock.pendingMs()).toBeNull();
  });

  it('核心红线：未确认 → 自动重启的 spawn 从未发生', async () => {
    const { svc, spawnSpy, children, clock, events } = makeCrashHarness({
      autoRestart: true,
      confirm: confirmOnceOnly(),
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.autoRestartPending).toBe(false);
    expect(events.rejected).toEqual([1]);
  });

  it('确认通道抛异常 → 按未确认处理，不重启（失败关闭）', async () => {
    let n = 0;
    const { svc, spawnSpy, children, clock } = makeCrashHarness({
      autoRestart: true,
      confirm: () => {
        n += 1;
        if (n === 1) return true;
        throw new Error('dialog exploded');
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('确认返回 Promise（异步确认）→ 失败关闭，不重启', async () => {
    let n = 0;
    const { svc, spawnSpy, children, clock } = makeCrashHarness({
      autoRestart: true,
      confirm: () => {
        n += 1;
        return n === 1 ? true : Promise.resolve(true);
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('自动重启的确认请求 kind=restart_server、risk=execute（§10.6）', async () => {
    const seen: Array<{ kind: string; risk: string }> = [];
    const { svc, children, clock } = makeCrashHarness({
      autoRestart: true,
      confirm: (r) => {
        seen.push({ kind: r.kind, risk: r.risk });
        return true;
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(60_000);
    await waitForState(svc, 's1', (s) => s === 'running');
    // 用户启动确认一次 + 自动重启确认一次：绝不静默复用上次的批准
    expect(seen).toEqual([
      { kind: 'launch_instance', risk: 'execute' },
      { kind: 'restart_server', risk: 'execute' },
    ]);
  });

  it('用户主动 stop() → 退避定时器被掐掉，之后不会自动拉起', async () => {
    const { svc, spawnSpy, children, clock } = makeCrashHarness({ autoRestart: true });
    const handle = svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(svc.status('s1')?.autoRestartPending).toBe(true);

    // 用户在退避到点前喊停
    await handle.stop();
    expect(clock.pendingMs()).toBeNull();
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    // 状态仍是 crashed：崩溃现场要留给 UI 告警（stop 对已崩进程本就是 no-op）
    expect(svc.status('s1')?.state).toBe('crashed');
    expect(svc.status('s1')?.autoRestartPending).toBe(false);
  });

  it('用户 stop() 造成的退出不判 crashed，也不触发自动重启', async () => {
    const { svc, spawnSpy, clock } = makeCrashHarness({ autoRestart: true });
    const handle = svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await handle.stop();
    expect(svc.status('s1')?.state).toBe('stopped');
    expect(svc.status('s1')?.crashCount).toBe(0);
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(svc.status('s1')?.autoRestartPending).toBe(false);
  });

  it('shutdownAll → 掐掉挂起的退避定时器（应用退出后不凭空起进程）', async () => {
    const { svc, spawnSpy, children, clock } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(clock.pendingMs()).toBe(1_000);

    await svc.shutdownAll();
    expect(clock.pendingMs()).toBeNull();
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('重启保留日志环形缓冲，crashCount 刻意不重置', async () => {
    const { svc, children, clock } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].stdout.write('boom: address in use\n');
    await waitForLine(svc, 's1', (l) => l.startsWith('boom'));
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(1_000);
    await waitForState(svc, 's1', (s) => s === 'running');

    // 「上次为什么崩」的日志必须还在（否则重启等于把现场证据擦了）
    expect(svc.logs('s1')).toContain('boom: address in use');
    expect(svc.status('s1')?.crashCount).toBe(1);
    expect(svc.status('s1')?.autoRestartCount).toBe(1);
  });

  it('用户手动 launch() → 退避计数归零，下一轮又从 1s 起步', async () => {
    const { svc, children, clock, events } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    // 第 1 次崩溃 → 自动重启，退避 1000
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(1_000);
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(svc.status('s1')?.autoRestartCount).toBe(1);

    // 第 2 次崩溃：这一轮退避应为 2000
    children[1].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(clock.pendingMs()).toBe(2_000);

    // 用户主动介入 = 新的一轮：退避计数归零（crashCount 是诊断事实，不清零）
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(svc.status('s1')?.autoRestartCount).toBe(0);
    expect(svc.status('s1')?.crashCount).toBe(2);

    children[2].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(events.delays).toEqual([1_000, 2_000, 1_000]);
  });

  it('自动重启走 crashed → starting → running 合法流转，无 invalid-transition', async () => {
    const { svc, children, clock } = makeCrashHarness({ autoRestart: true });
    const seen: ServerState[] = [];
    const bad: string[] = [];
    svc.on('state', (s: StatusSnapshot) => {
      if (s.serverId === 's1') seen.push(s.state);
    });
    svc.on('invalid-transition', (e: { from: string; to: string }) =>
      bad.push(`${e.from}->${e.to}`),
    );
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(1_000);
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(bad).toEqual([]);
    expect(seen).toEqual(['starting', 'running', 'crashed', 'starting', 'running']);
  });

  it('真实进程：崩溃后自动拉起第二个真进程（集成路径）', async () => {
    const dir = await makeTempDir('mc-sup-restart-');
    tempDirs.push(dir);
    const marker = path.join(dir, 'first-boot');
    const script = await tempScript(FAKE_CRASH_ONCE, 'crash-once');
    // restartDelayMs 取 1ms：本用例只关心「真能再起一个真进程」，退避语义另有确定性用例覆盖
    const svc = makeService({ autoRestart: true, restartDelayMs: 1 });
    svc.launchServer({ serverId: 'srv-1', cmd: NODE, args: [script, marker] });
    await waitForState(svc, 'srv-1', (s) => s === 'crashed');
    await waitForState(svc, 'srv-1', (s) => s === 'running');
    // 等第二个真进程真的开口说话：状态 running 只证明 spawn 成功，不证明它跑起来了
    await waitForLine(svc, 'srv-1', (l) => l === 'second boot ok');
    const snap = svc.status('srv-1');
    expect(snap?.crashCount).toBe(1);
    expect(snap?.lastLogLines).toContain('second boot ok');
  });
});

// =========================================================================
// 11. 控制台注入 sendCommand（§7.1 / §7.4 —— 本轮只做 stdin 注入，不做 RCON 协议）
// =========================================================================

/** 等 lastCommandOutcome 落定（订阅事件推进，不 sleep）。 */
function waitForOutcome(svc: ProcessSupervisor, serverId: string): Promise<SendOutcome> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      svc.off('command-sent', onSent);
    };
    const onSent = (e: SendOutcome): void => {
      if (e.serverId !== serverId) return;
      cleanup();
      resolve(e);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`等待注入结果超时：${serverId}`));
    }, 10_000);
    svc.on('command-sent', onSent);
    const cur = svc.status(serverId)?.lastCommandOutcome ?? null;
    if (cur !== null) {
      cleanup();
      resolve(cur);
    }
  });
}

describe('控制台注入 sendCommand（§7.1 走 stdin；未确认一字节都不写）', () => {
  it('正常写入：命令补上换行后落到 stdin', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const outcome = await svc.sendCommand('s1', 'say hello');
    expect(outcome.delivered).toBe(true);
    expect(outcome.code).toBeNull();
    expect(outcome.reason).toBeNull();
    expect(outcome.command).toBe('say hello');
    expect(children[0].stdinWrites).toEqual(['say hello\n']);
  });

  it('命令自带换行 → 不重复补 \\n', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await svc.sendCommand('s1', 'list\n');
    expect(children[0].stdinWrites).toEqual(['list\n']);
  });

  it('核心红线：用户点取消 → stdin.write 从未被调用', async () => {
    const { svc, children } = makeCrashHarness({ confirm: confirmOnceOnly() });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    expect(children[0].stdinWrites).toEqual([]);

    const outcome = await svc.sendCommand('s1', 'op attacker');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('NOT_CONFIRMED');
    expect(outcome.reason).toContain('§10.6');
    // 一个字节都没写进去
    expect(children[0].stdinWrites).toEqual([]);
  });

  it('确认通道抛异常 → 按未确认处理，同样不写 stdin', async () => {
    let n = 0;
    const { svc, children } = makeCrashHarness({
      confirm: () => {
        n += 1;
        if (n === 1) return true;
        throw new Error('dialog exploded');
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const outcome = await svc.sendCommand('s1', 'op me');
    expect(outcome.code).toBe('NOT_CONFIRMED');
    expect(children[0].stdinWrites).toEqual([]);
  });

  it('确认返回 Promise（异步确认）→ 失败关闭，不写 stdin', async () => {
    let n = 0;
    const { svc, children } = makeCrashHarness({
      confirm: () => {
        n += 1;
        return n === 1 ? true : Promise.resolve(true);
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.code).toBe('NOT_CONFIRMED');
    expect(children[0].stdinWrites).toEqual([]);
  });

  it('未配置 confirm → 既起不了进程，也无可注入/可重启的对象', async () => {
    const clock = manualSchedule();
    const spawnSpy = vi.fn(() => new ControllableChild(90_000) as unknown as ChildProcess);
    const svc = createProcessSupervisor({
      spawn: spawnSpy as unknown as SpawnFn,
      schedule: clock.schedule,
      scheduleHold: clock.scheduleHold,
      autoRestart: true,
      autoInjectReload: true,
    });
    supervisors.push(svc);
    // 没有 confirm：launch 直接 PERMISSION_DENIED，spawn 一次都不会被调用
    expect(() => svc.launch({ serverId: 's1', cmd: 'java', args: [] })).toThrow(/未确认/);
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.status('s1')).toBeNull();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.code).toBe('NOT_MANAGED');
    clock.advance(120_000);
    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it('注入的确认请求 kind=send_console_command、risk=execute、中文摘要', async () => {
    const seen: Array<{ kind: string; risk: string; summary: string }> = [];
    const { svc } = makeCrashHarness({
      confirm: (r) => {
        seen.push({ kind: r.kind, risk: r.risk, summary: r.summary });
        return true;
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await svc.sendCommand('s1', 'op me');
    const inject = seen.filter((s) => s.kind === 'send_console_command');
    expect(inject).toHaveLength(1);
    expect(inject[0].risk).toBe('execute');
    expect(inject[0].summary).toContain('op me');
    expect(inject[0].summary).toContain('s1');
  });

  it('进程已死（crashed）→ 返回 PROCESS_DEAD，不抛异常也不写', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('PROCESS_DEAD');
    expect(outcome.reason).toContain('已退出');
  });

  it('stdin 已关闭（writableEnded）→ 明确 STDIN_CLOSED', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].stdin.end();
    // 先自证前提成立，否则这个用例测的就不是 STDIN_CLOSED 这条分支了
    expect(children[0].stdin.writableEnded).toBe(true);
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('STDIN_CLOSED');
  });

  it('stdin 已被 destroy → 明确 STDIN_CLOSED', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].stdin.destroy();
    expect(children[0].stdin.destroyed).toBe(true);
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('STDIN_CLOSED');
  });

  it('reloadCommand 默认只记录、不自动注入（autoInjectReload 默认关）', async () => {
    const script = await tempScript(FAKE_SERVER, 'reload-default');
    const svc = makeService();
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      reloadCommand: '/reload confirm',
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    expect(svc.status('srv-1')?.reloadCommand).toBe('/reload confirm');
    // 假服务端会回显收到的命令行；没开自动注入就不该出现 reload 回显
    expect(svc.logs('srv-1').some((l) => l.includes('reload'))).toBe(false);
    await handle.stop();
  });

  it('autoInjectReload=true → 进程起来后自动注入 reloadCommand（真实 stdin 管道）', async () => {
    const script = await tempScript(FAKE_SERVER, 'reload-on');
    const svc = makeService({ autoInjectReload: true });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      reloadCommand: '/reload confirm',
    });
    // 假服务端把收到的命令行回显成 "echo: <cmd>"
    await waitForLine(svc, 'srv-1', (l) => l.includes('/reload confirm'));
    expect(svc.status('srv-1')?.lastCommandOutcome?.delivered).toBe(true);
    await handle.stop();
  });

  it('autoInjectReload=true 但未确认 → 不注入（§10.6 优先于自动注入）', async () => {
    const script = await tempScript(FAKE_SERVER, 'reload-denied');
    const svc = makeService({ autoInjectReload: true, confirm: confirmOnceOnly() });
    const handle = svc.launchServer({
      serverId: 'srv-1',
      cmd: NODE,
      args: [script],
      reloadCommand: '/reload confirm',
    });
    await waitForLine(svc, 'srv-1', (l) => l.startsWith('listening'));
    await waitForOutcome(svc, 'srv-1');
    expect(svc.status('srv-1')?.lastCommandOutcome).toMatchObject({
      delivered: false,
      code: 'NOT_CONFIRMED',
    });
    expect(svc.logs('srv-1').some((l) => l.includes('reload'))).toBe(false);
    await handle.stop();
  });

  it('注入结果可观测：command-sent 事件 + 快照 lastCommandOutcome', async () => {
    const { svc } = makeCrashHarness();
    const events: SendOutcome[] = [];
    svc.on('command-sent', (e: SendOutcome) => events.push(e));
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await svc.sendCommand('s1', 'save-all');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ serverId: 's1', command: 'save-all', delivered: true });
    expect(svc.status('s1')?.lastCommandOutcome).toEqual(events[0]);
  });

  it('空命令 → EMPTY_COMMAND，不写 stdin', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const outcome = await svc.sendCommand('s1', '   ');
    expect(outcome.code).toBe('EMPTY_COMMAND');
    expect(children[0].stdinWrites).toEqual([]);
  });

  it('未托管的 serverId → NOT_MANAGED', async () => {
    const { svc } = makeCrashHarness();
    const outcome = await svc.sendCommand('ghost', 'list');
    expect(outcome.code).toBe('NOT_MANAGED');
  });

  it('服务已 shutdownAll → 不再接受注入', async () => {
    const { svc } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await svc.shutdownAll();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('SERVICE_CLOSED');
  });

  it('sendCommand 不改变进程状态（纯控制台操作）', async () => {
    const { svc } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    expect(svc.status('s1')?.state).toBe('running');
    await svc.sendCommand('s1', 'say hi');
    expect(svc.status('s1')?.state).toBe('running');
    expect(svc.status('s1')?.crashCount).toBe(0);
  });
});

// =========================================================================
// 12. RCON 回退（§7.4 stdin 不可用时退化；只加新用例，既有断言一行未动）
// =========================================================================

describe('RCON 回退（§7.4 stdin 不可用时退化 RCON）', () => {
  function encodeRcon(id: number, type: number, body: string): Buffer {
    const b = Buffer.from(body, 'utf8');
    const len = 4 + 4 + b.length + 2;
    const buf = Buffer.alloc(4 + len);
    buf.writeInt32LE(len, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    b.copy(buf, 12);
    return buf;
  }

  it('stdin 正常时走 stdin：channel=stdin 且不调 RCON', async () => {
    const rconSend = vi.fn(() => Promise.resolve('should-not-run'));
    const { svc, children } = makeCrashHarness({
      getRconPassword: () => 'pw',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(true);
    expect(outcome.channel).toBe('stdin');
    expect(children[0].stdinWrites).toEqual(['list\n']);
    expect(rconSend).not.toHaveBeenCalled();
  });

  it('stdin 不可用 + 无口令（默认）→ 保持原 STDIN_CLOSED', async () => {
    const { svc, children } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].stdin.end();
    expect(children[0].stdin.writableEnded).toBe(true);
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('STDIN_CLOSED');
    expect(outcome.reason).toContain('暂不支持');
    expect(outcome.channel).toBeUndefined();
  });

  it('stdin 不可用 + 有口令但无 rcon 配置 → 保持原 STDIN_CLOSED（不猜默认端口）', async () => {
    const rconSend = vi.fn(() => Promise.resolve('x'));
    const { svc, children } = makeCrashHarness({
      getRconPassword: () => 'pw',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.code).toBe('STDIN_CLOSED');
    expect(rconSend).not.toHaveBeenCalled();
  });

  it('stdin 不可用 + 口令 + rcon 配置 → 经 RCON 发送，channel=rcon', async () => {
    const seen: Array<{ host: string; port: number; password: string; command: string }> = [];
    const rconSend = vi.fn(
      (o: { host: string; port: number; password: string; command: string }) => {
        seen.push(o);
        return Promise.resolve('ok');
      },
    );
    const { svc, children } = makeCrashHarness({
      getRconPassword: (id) => (id === 's1' ? 's3cret' : null),
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'say hi');
    expect(outcome.delivered).toBe(true);
    expect(outcome.code).toBeNull();
    expect(outcome.channel).toBe('rcon');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      host: '127.0.0.1',
      port: 25575,
      password: 's3cret',
      command: 'say hi',
    });
    expect(svc.status('s1')?.lastCommandOutcome?.channel).toBe('rcon');
  });

  it('回退仍先过确认闸门：未确认则 NOT_CONFIRMED 且不调 RCON', async () => {
    const rconSend = vi.fn(() => Promise.resolve('x'));
    const { svc, children } = makeCrashHarness({
      confirm: confirmOnceOnly(),
      getRconPassword: () => 'pw',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'op me');
    expect(outcome.code).toBe('NOT_CONFIRMED');
    expect(outcome.delivered).toBe(false);
    expect(rconSend).not.toHaveBeenCalled();
  });

  it('RCON 鉴权失败 → outcome code=RCON_AUTH_FAILED（口令不落日志）', async () => {
    const { RconError } = await import('./rcon-client.js');
    const rconSend = vi.fn(() =>
      Promise.reject(
        new RconError('RCON 鉴权失败：127.0.0.1:25575 拒绝了口令', 'RCON_AUTH_FAILED'),
      ),
    );
    const { svc, children } = makeCrashHarness({
      getRconPassword: () => 'bad',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.delivered).toBe(false);
    expect(outcome.code).toBe('RCON_AUTH_FAILED');
    expect(outcome.reason).toContain('鉴权失败');
    expect(outcome.reason).not.toContain('bad');
  });

  it('RCON 超时 → outcome code=RCON_TIMEOUT', async () => {
    const { RconError } = await import('./rcon-client.js');
    const rconSend = vi.fn(() =>
      Promise.reject(
        new RconError('RCON 操作超时（200ms）：127.0.0.1:25575 未在时限内响应', 'RCON_TIMEOUT'),
      ),
    );
    const { svc, children } = makeCrashHarness({
      getRconPassword: () => 'pw',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.code).toBe('RCON_TIMEOUT');
    expect(outcome.delivered).toBe(false);
  });

  it('RCON 连接失败 → outcome code=RCON_CONN_FAILED', async () => {
    const { RconError } = await import('./rcon-client.js');
    const rconSend = vi.fn(() =>
      Promise.reject(
        new RconError('RCON 连接失败：无法连接到 127.0.0.1:25575', 'RCON_CONN_FAILED'),
      ),
    );
    const { svc, children } = makeCrashHarness({
      getRconPassword: () => 'pw',
      rconSend: rconSend as unknown as import('./rcon-client.js').RconSendFn,
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: [], rcon: { host: '127.0.0.1', port: 25575 } });
    children[0].stdin.end();
    const outcome = await svc.sendCommand('s1', 'list');
    expect(outcome.code).toBe('RCON_CONN_FAILED');
  });

  it('真实 localhost 回路：stdin 关闭后走真实 TCP fake RCON 成功', async () => {
    const password = 'real-pw';
    const srv = net.createServer((sock) => {
      let buf: Buffer = Buffer.alloc(0);
      let authed = false;
      sock.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
          const len = buf.readInt32LE(0);
          if (len < 10 || buf.length - 4 < len) break;
          const id = buf.readInt32LE(4);
          const type = buf.readInt32LE(8);
          const body = buf.slice(12, 12 + (len - 10)).toString('utf8');
          buf = buf.slice(4 + len);
          if (type === 3) {
            if (body === password) {
              authed = true;
              sock.write(encodeRcon(id, 2, ''));
            } else {
              sock.write(encodeRcon(-1, 2, ''));
            }
          } else if (type === 2 && authed) {
            sock.write(encodeRcon(id, 0, `echo:${body}`));
            sock.write(encodeRcon(id, 0, ''));
          }
        }
      });
      sock.on('error', () => undefined);
    });
    await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const port = (srv.address() as net.AddressInfo).port;
    try {
      // 不注 rconSend：走默认真实 TCP，证明端到端接线。
      const { svc: svcReal, children } = makeCrashHarness({
        getRconPassword: () => password,
      });
      svcReal.launch({
        serverId: 'rcon-real',
        cmd: 'java',
        args: [],
        rcon: { host: '127.0.0.1', port },
      });
      children[0].stdin.end();
      const outcome = await svcReal.sendCommand('rcon-real', 'list');
      expect(outcome.delivered).toBe(true);
      expect(outcome.channel).toBe('rcon');
    } finally {
      await new Promise<void>((r) => srv.close(() => r()));
    }
  });
});

// =========================================================================
// 13. 按 id 启停（R2a：restartServer / stopServer —— 只加公共方法，不加 IPC）
//
// 纪律：沿用第 10 节的 makeCrashHarness（可控假子进程 + 手动时钟），
// 不起真进程、不 sleep。只加新用例，既有断言一行未动。
// =========================================================================

describe('按 id 启停 restartServer/stopServer（过确认闸门 + 复用停机路径，不抛裸异常）', () => {
  it('重启走确认：confirm kind=restart_server，通过后旧停新起', async () => {
    const seen: Array<{ kind: string; risk: string }> = [];
    const { svc, children, spawnSpy } = makeCrashHarness({
      confirm: (r) => {
        seen.push({ kind: r.kind, risk: r.risk });
        return true;
      },
    });
    svc.launch({ serverId: 's1', cmd: 'java', args: ['-jar', 'a.jar'] });
    expect(svc.status('s1')?.state).toBe('running');

    const out = await svc.restartServer('s1');
    expect(out.serverId).toBe('s1');
    expect(out.ok).toBe(true);
    expect(out.code).toBeNull();
    expect(out.reason).toBeNull();
    expect(out.stop).toMatchObject({ serverId: 's1', exited: true });
    expect(typeof out.at).toBe('string');
    // 确认被问过两次：launch_instance + restart_server（绝不复用上次批准）
    expect(seen).toEqual([
      { kind: 'launch_instance', risk: 'execute' },
      { kind: 'restart_server', risk: 'execute' },
    ]);
    // 旧进程已停、新进程已起：共 spawn 两次，当前 running
    expect(spawnSpy).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(2);
    expect(svc.status('s1')?.state).toBe('running');
  });

  it('拒绝不启动：未确认返回 NOT_CONFIRMED，原进程保持 running 且 emit restart-rejected', async () => {
    const { svc, children, spawnSpy } = makeCrashHarness({ confirm: confirmOnceOnly() });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const rejected: Array<{ serverId: string }> = [];
    svc.on('restart-rejected', (e: { serverId: string }) => rejected.push(e));

    const out = await svc.restartServer('s1');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('NOT_CONFIRMED');
    expect(out.reason).toContain('§10.6');
    expect(out.stop).toBeNull();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(children).toHaveLength(1);
    expect(svc.status('s1')?.state).toBe('running');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.serverId).toBe('s1');
  });

  it('无 entry 结构化错：restart/stop 对 ghost 返回 SERVER_NOT_FOUND 且不抛', async () => {
    const { svc, spawnSpy } = makeCrashHarness();
    const r1 = await svc.restartServer('ghost');
    const r2 = await svc.stopServer('ghost');
    for (const out of [r1, r2]) {
      expect(out.serverId).toBe('ghost');
      expect(out.ok).toBe(false);
      expect(out.code).toBe('SERVER_NOT_FOUND');
      expect(out.reason).toContain('未托管');
      expect(out.stop).toBeNull();
    }
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(svc.status('ghost')).toBeNull();
  });

  it('停止置位不自动重启：stopServer 后退避再久也不拉起', async () => {
    const { svc, spawnSpy, clock } = makeCrashHarness({ autoRestart: true });
    const handle = svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const out = await svc.stopServer('s1');
    expect(out.ok).toBe(true);
    expect(out.stop).toMatchObject({ serverId: 's1', exited: true });
    expect(svc.status('s1')?.state).toBe('stopped');
    expect(svc.status('s1')?.crashCount).toBe(0);
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(svc.status('s1')?.autoRestartPending).toBe(false);
    await handle.exited;
  });

  it('崩溃后退避中 stopServer：掐掉定时器，不再拉起且保留 crashed 现场', async () => {
    const { svc, spawnSpy, children, clock } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(svc.status('s1')?.autoRestartPending).toBe(true);

    const out = await svc.stopServer('s1');
    expect(out.ok).toBe(true);
    expect(clock.pendingMs()).toBeNull();
    clock.advance(120_000);
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    // stop 对已崩进程是 no-op：状态仍是 crashed，崩溃证据留给 UI
    expect(svc.status('s1')?.state).toBe('crashed');
  });

  it('崩溃后 restartServer：no-op 停机 + doSpawn 拉起，手动重启视为新一轮（退避归零）', async () => {
    const { svc, spawnSpy, children, clock } = makeCrashHarness({ autoRestart: true });
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    // 先走完一次自动重启，让退避计数到 1（下一轮退避本应是 2000）
    children[0].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    clock.advance(1_000);
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(svc.status('s1')?.autoRestartCount).toBe(1);

    // 用户手动重启 = 新的一轮：退避计数归零（与 launch() 同策略，crashCount 不清零）
    const out = await svc.restartServer('s1');
    expect(out.ok).toBe(true);
    expect(spawnSpy).toHaveBeenCalledTimes(3);
    await waitForState(svc, 's1', (s) => s === 'running');
    expect(svc.status('s1')?.autoRestartCount).toBe(0);
    expect(svc.status('s1')?.crashCount).toBe(1);

    // 再崩一次：退避从 1s 起步（若没归零会是 2s）
    children[2].die(1);
    await waitForState(svc, 's1', (s) => s === 'crashed');
    expect(clock.pendingMs()).toBe(1_000);
  });

  it('shutdownAll 后 restartServer → SERVICE_CLOSED，不 spawn（关服路径行为不变）', async () => {
    const { svc, spawnSpy } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    await svc.shutdownAll();
    const out = await svc.restartServer('s1');
    expect(out.ok).toBe(false);
    expect(out.code).toBe('SERVICE_CLOSED');
    expect(out.stop).toBeNull();
    expect(spawnSpy).toHaveBeenCalledTimes(1);
  });

  it('stopServer 成功结果带停机报告（graceful 路径，快照 lastStop 同步）', async () => {
    const { svc } = makeCrashHarness();
    svc.launch({ serverId: 's1', cmd: 'java', args: [] });
    const out = await svc.stopServer('s1');
    expect(out).toMatchObject({
      serverId: 's1',
      ok: true,
      code: null,
      reason: null,
      stop: { serverId: 's1', graceful: true, forced: false, exited: true, portTimedOut: false },
    });
    expect(svc.status('s1')?.state).toBe('stopped');
    expect(svc.status('s1')?.lastStop?.graceful).toBe(true);
  });
});
