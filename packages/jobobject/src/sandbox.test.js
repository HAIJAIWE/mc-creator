/**
 * 真隔离能力测试 —— 仅在二进制可用时运行（Windows + 已编译）。
 *
 * 覆盖 §8.3 真正买到的东西：
 *  1. 子进程确实被纳入 job（不是「以为隔离了」）
 *  2. spawn 非阻塞（Gradle 要跑 10 分钟，不能在此阻塞）
 *  3. 内存上限真被强制（不是声明式）
 *  4. 超时查询不误杀
 *  5. job 记账归零（证明整树被清空，而非只杀父）
 *
 * 变异测试实测（还原 C++ 再改再跑，见 MEMORY §4.9）：
 *  - 去掉内存上限 flag        → 被本文件杀死 ✅
 *  - 去掉 KILL_ON_JOB_CLOSE   → 被本文件杀死 ✅
 *  - spawnInJob 不返回 pid    → 被本文件杀死 ✅
 *  - terminateTree 退化成只杀父 → 被本文件杀死 ✅（靠 job 记账断言）
 *  - **去掉 CREATE_SUSPENDED  → 存活（测不到）** ⚠️
 *
 * 最后一条是**已知且无法用单测覆盖**的：它消除的是「分配 job 之前」那个
 * 微秒级 TOCTOU 窗口，构造该窗口需要让子进程在自己启动的第一条指令里就
 * spawn 孙进程，这本质上不可确定性地复现。它的正确性依据是 Win32 语义
 * （后代由内核自动继承进 job），不是测试。改动 spawnInJob 的创建标志时，
 * 请把这条当作设计约束而不是「测试覆盖了所以安全」。
 *
 * 另外两个踩过的坑也固化在这里：
 *  - liveness 必须用 tasklist，且**先自检方法本身**（process.kill(pid,0)
 *    在 Windows 上不是有效的存在性检查，会给出「进程已死」的假象）
 *  - 存活断言前要给子进程起跑时间，否则测的是「还没启动」
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const jobobject = require('../index.js');

const EXE = process.execPath;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Windows 上可靠的存活检查。
 * tasklist 在无匹配时返回 exit 1 并打印 "No tasks are running..."，
 * 那是确定的「已死」，不是测量错误。
 */
function alive(pid) {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
    encoding: 'utf8',
  });
  if (r.status === 1) return false;
  if (r.status !== 0) throw new Error(`tasklist failed: ${r.status} ${r.stdout}`);
  return r.stdout.includes(`"${pid}"`);
}

/**
 * 等文件出现并返回其内容（用于跨进程传回退出码）。
 * 传 parse=number 时返回值转数字，否则返回原始字符串。
 */
async function waitForFile(file, timeoutMs, parse = 'number') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const raw = readFileSync(file, 'utf8').trim();
      if (raw !== '') return parse === 'number' ? Number(raw) : raw;
    }
    await sleep(50);
  }
  throw new Error(`等待 ${file} 超时（${timeoutMs}ms）`);
}

const describeIfAvailable = jobobject.available ? describe : describe.skip;

if (jobobject.available) {
  beforeAll(() => {
    // 先验证测量方法本身：它必须能看见我们自己。否则下面所有
    // 「alive === false」都是测量假象，而不是被测行为。
    expect(alive(process.pid), 'liveness 检查看不见自身，方法无效').toBe(true);
  });
}

describeIfAvailable('Job Object 真隔离（需要已编译的二进制）', () => {
  it('子进程确实在 job 内，且 spawn 不阻塞', () => {
    const job = jobobject.createJob(512, 2);
    const t0 = Date.now();
    const spawned = jobobject.spawnInJob(job, EXE, ['-e', 'process.exit(7)']);
    const elapsed = Date.now() - t0;

    // 非阻塞是硬需求：Gradle 能跑 10 分钟，上层要流式日志 + 自己的超时。
    expect(elapsed).toBeLessThan(2000);
    expect(jobobject.isInJob(spawned.child)).toBe(true);

    const r = jobobject.waitForExit(spawned.child, 10000);
    expect(r.exited).toBe(true);
    expect(r.exitCode).toBe(7);
    jobobject.closeChild(spawned.child);
    jobobject.closeJob(job);
  });

  it('waitForExit 超时只报告、不杀伤', () => {
    const job = jobobject.createJob(512, 0);
    const slow = jobobject.spawnInJob(job, EXE, ['-e', 'setTimeout(()=>{},60000)']);
    const r = jobobject.waitForExit(slow.child, 500);
    expect(r.timedOut).toBe(true);
    expect(r.exited).toBe(false);
    expect(r.exitCode).toBe(-1);
    // 确认它其实还活着 —— 超时不该变成一次隐式终止。
    expect(alive(slow.pid)).toBe(true);

    jobobject.terminateTree(slow.child);
    jobobject.waitForExit(slow.child, 5000);
    jobobject.closeChild(slow.child);
    jobobject.closeJob(job);
  });

  it('内存上限被真正强制：200MB 上限下 400MB 的单次分配失败', () => {
    const job = jobobject.createJob(200, 0);
    const child = jobobject.spawnInJob(job, EXE, [
      '-e',
      // 单次分配，且刻意只用 400MB —— 必须远小于本机物理内存。否则
      // 「无上限」时它也会因耗尽系统内存而失败，于是两条用例都绿，
      // 测不出上限到底生不生效。
      // （第一版就是踩了这个坑：用 while(true) 狂分配时，去掉内存上限的
      // 变异体依然拿到 exit 9，测试毫无鉴别力。）
      'try{const b=Buffer.alloc(400*1024*1024,1);b[0]=1;process.exit(0);}catch(e){process.exit(9);}',
    ]);
    const r = jobobject.waitForExit(child.child, 30000);
    // 9 = 分配被拒（上限生效）。0 = 分配成功 = 上限没生效。
    expect(r.exitCode).toBe(9);
    jobobject.closeChild(child.child);
    jobobject.closeJob(job);
  });

  it('对照实验：同一分配在无内存上限的 job 下成功（证明上一条确由上限导致）', () => {
    const job = jobobject.createJob(0, 0);
    const child = jobobject.spawnInJob(job, EXE, [
      '-e',
      'try{const b=Buffer.alloc(400*1024*1024,1);b[0]=1;process.exit(0);}catch(e){process.exit(9);}',
    ]);
    const r = jobobject.waitForExit(child.child, 30000);
    expect(r.exitCode).toBe(0);
    jobobject.closeChild(child.child);
    jobobject.closeJob(job);
  });

  it('孙进程继承 job：内存上限对「孙子辈」同样生效', async () => {
    // 这是「后代继承 job」的决定性证据，也是 CREATE_SUSPENDED 存在的意义：
    // 若分配发生在被纳入 job 之前，恶意脚本能在此窗口内 spawn 一个
    // 不受上限约束的孙进程。
    //
    // 为什么不用「杀掉孙进程」来验证继承：实测在 Windows 上父进程被终止时
    // 其非 detached 子进程会一并消失，所以那种写法无法区分
    // TerminateJobObject（杀整树）与 TerminateProcess（只杀父）——
    // 变异测试里这个 mutants 确实存活了下来。改用「上限是否传到孙进程」，
    // 它对「孙进程是否在 job 内」是确定性的。
    const dir = mkdtempSync(path.join(tmpdir(), 'jobobject-inherit-'));
    const resultFile = path.join(dir, 'r.txt');
    const job = jobobject.createJob(200, 0);

    const parent = jobobject.spawnInJob(job, EXE, [
      '-e',
      `const{spawn}=require('child_process');const fs=require('fs');
       spawn(process.execPath,['-e',
         'try{const b=Buffer.alloc(400*1024*1024,1);b[0]=1;process.exit(0);}catch(e){process.exit(9);}'
       ],{stdio:'ignore'}).on('exit',c=>fs.writeFileSync(${JSON.stringify(resultFile)},String(c)));
       setTimeout(()=>{},120000);`,
    ]);

    const code = await waitForFile(resultFile, 60000);
    // 9 = 孙进程的分配被拒 → 它确实在 job 内且继承了内存上限。
    expect(code, '孙进程未受内存上限约束，说明后代没有继承 job').toBe(9);

    jobobject.terminateTree(parent.child);
    jobobject.waitForExit(parent.child, 10000);
    jobobject.closeChild(parent.child);
    jobobject.closeJob(job);
  });

  it('内存上限对「孙进程辈」同样生效（.bat -> node 的形状，同 Gradle 的 .bat -> java）', async () => {
    // 这是 §8.3 真正要管的那一层：JOB_OBJECT_LIMIT_PROCESS_MEMORY 若只约束
    // job 的**直接子进程**，那对 Gradle 构建毫无意义（真正吃内存的是
    // .bat 拉起的 java，是孙进程）。实测确认它对孙进程同样生效。
    const dir = mkdtempSync(path.join(tmpdir(), 'jobobject-gc-'));
    const resultFile = path.join(dir, 'm.txt');
    const job = jobobject.createJob(200, 0);

    if (process.platform === 'win32') {
      // cmd.exe 是 job 的直接子进程，node alloc.js 是它的子进程。
      writeFileSync(
        path.join(dir, 'go.bat'),
        '@echo off\r\nnode alloc.js\r\nexit /b 0\r\n',
        'utf8',
      );
      writeFileSync(
        path.join(dir, 'alloc.js'),
        `require('fs').writeFileSync(${JSON.stringify(resultFile)},'start');
         try{var b=Buffer.alloc(400*1024*1024,1);b[0]=1;require('fs').writeFileSync(${JSON.stringify(resultFile)},'ok')}catch(e){require('fs').writeFileSync(${JSON.stringify(resultFile)},'refused')}`,
        'utf8',
      );
      jobobject.spawnInJob(job, process.env.ComSpec ?? 'cmd.exe', ['/c', 'go.bat'], dir, true);
    } else {
      jobobject.spawnInJob(job, '/bin/sh', ['-c', 'node alloc.js'], dir, true);
      writeFileSync(
        path.join(dir, 'alloc.js'),
        `require('fs').writeFileSync(${JSON.stringify(resultFile)},'start');
         try{var b=Buffer.alloc(400*1024*1024,1);b[0]=1;require('fs').writeFileSync(${JSON.stringify(resultFile)},'ok')}catch(e){require('fs').writeFileSync(${JSON.stringify(resultFile)},'refused')}`,
        'utf8',
      );
    }

    const got = await waitForFile(resultFile, 60000, 'string');
    // refused = 上限真的传到了孙进程；ok = 只约束了直接子进程（那就毫无意义）。
    expect(got, '内存上限没有作用到孙进程 —— 对 Gradle 构建等于没设限').toBe('refused');
    jobobject.closeJob(job);
  }, 90000);

  it('对照实验：同一个孙进程在无上限 job 下分配成功', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'jobobject-inherit-ctrl-'));
    const resultFile = path.join(dir, 'r.txt');
    const job = jobobject.createJob(0, 0);

    const parent = jobobject.spawnInJob(job, EXE, [
      '-e',
      `const{spawn}=require('child_process');const fs=require('fs');
       spawn(process.execPath,['-e',
         'try{const b=Buffer.alloc(400*1024*1024,1);b[0]=1;process.exit(0);}catch(e){process.exit(9);}'
       ],{stdio:'ignore'}).on('exit',c=>fs.writeFileSync(${JSON.stringify(resultFile)},String(c)));
       setTimeout(()=>{},120000);`,
    ]);

    expect(await waitForFile(resultFile, 60000)).toBe(0);

    jobobject.terminateTree(parent.child);
    jobobject.waitForExit(parent.child, 10000);
    jobobject.closeChild(parent.child);
    jobobject.closeJob(job);
  });

  it('closeJob 即杀树（KILL_ON_JOB_CLOSE）：不调 terminateTree 也能杀掉长跑子进程', async () => {
    // launcher 的终止保证依赖这条：launcher 一死 → job 句柄随进程关闭 →
    // 内核终止整棵树。变异测试里把 KILL_ON_JOB_CLOSE 去掉，本条必须变红。
    const job = jobobject.createJob(512, 0);
    const child = jobobject.spawnInJob(job, EXE, ['-e', 'setTimeout(()=>{},120000)']);
    await sleep(300);
    expect(alive(child.pid), '子进程未存活，无法测关句柄杀树').toBe(true);

    jobobject.closeJob(job);
    await sleep(800);
    expect(alive(child.pid), '关掉 job 句柄后子进程仍在 —— KILL_ON_JOB_CLOSE 未生效').toBe(false);
    jobobject.closeChild(child.child);
  });

  it('terminateTree 清空 job 里的全部进程（含已成孤儿的孙进程）', async () => {
    // 这条断言的是 job 记账，而不是「进程还在不在 tasklist 里」。
    //
    // 为什么必须看 job 记账：实测在 Windows 上父进程被终止时，其非 detached
    // 子进程会一并消失，所以「杀掉孙进程」这个观察**无法**区分
    // TerminateJobObject（杀整树）与 TerminateProcess（只杀父）—— 变异测试
    // 里那个 mutants 正是这样活下来的。
    //
    // 但两者有一处确定差异：孙进程被收养后**仍然留在 job 里**。于是
    // activeProcesses 是唯一能判别「整树已清空」的权威指标。
    const dir = mkdtempSync(path.join(tmpdir(), 'jobobject-tree-'));
    const pidFile = path.join(dir, 'g.pid');
    const job = jobobject.createJob(512, 0);

    const parent = jobobject.spawnInJob(job, EXE, [
      '-e',
      `const{spawn}=require('child_process');const fs=require('fs');
       const g=spawn(process.execPath,['-e','setTimeout(()=>{},120000)'],{stdio:'ignore'});
       fs.writeFileSync(${JSON.stringify(pidFile)},String(g.pid));
       setTimeout(()=>{},120000);`,
    ]);

    let gpid = null;
    for (let i = 0; i < 100 && gpid === null; i++) {
      await sleep(50);
      if (existsSync(pidFile)) gpid = Number(readFileSync(pidFile, 'utf8'));
    }
    expect(gpid, '孙进程未报出 pid').not.toBeNull();
    await sleep(400);
    expect(alive(parent.pid)).toBe(true);
    expect(alive(gpid)).toBe(true);

    const diag = jobobject.terminateTree(parent.child);
    expect(diag.ok).toBe(true);
    expect(diag.lastError).toBe(0);
    // 父 + 孙 = 至少 2 个。
    expect(diag.activeBefore, 'job 里应至少有两个进程（父+孙）').toBeGreaterThanOrEqual(2);
    // 终止后必须归零：孤立的孙进程仍留在 job 内，只有整树终止才会清空它。
    expect(diag.activeProcesses, 'terminateTree 后 job 未清空 —— 只杀了父进程？').toBe(0);

    await sleep(500);
    expect(alive(parent.pid)).toBe(false);
    expect(alive(gpid), '孙进程未被终止').toBe(false);

    jobobject.closeChild(parent.child);
    jobobject.closeJob(job);
  });
});
