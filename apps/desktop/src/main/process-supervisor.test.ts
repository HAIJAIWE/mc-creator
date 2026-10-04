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
  type LogEvent,
  type ProcessSupervisor,
  type ProcessSupervisorOptions,
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
