'use strict';

/**
 * Job Object launcher（设计文档 §8.3 进程级隔离的「实施者」）。
 *
 * ## 为什么需要这一层间接
 *
 * 原生模块的 CreateProcess 传 bInheritHandles=FALSE 且不重定向标准句柄 ——
 * 它**拿不到**子进程的输出管道。而 Gradle 构建必须要日志：
 * `findJarInLog` 的正则回退、失败时的错误文案、内核的 build_project 进度事件
 * 全都依赖 stdout/stderr。
 *
 * 如果让 addon 直接拉起 gradle，就得在 C++ 里造管道再把句柄塞回 Node，
 * 既难测又脆。所以改成：上层用**已有的、已被 4300 条测试覆盖的** spawn 逻辑
 * 拉起本脚本（本脚本的 stdio 就是上层的管道），本脚本在 job 内 suspended-create
 * 真正的目标进程并让它继承自己的 stdio —— 于是日志照常回到上层，
 * 而隔离由 job 保证。
 *
 * 顺带得到一个比 taskkill 更强的终止保证：本进程被杀 → job 句柄随进程关闭
 * → KILL_ON_JOB_CLOSE 触发 → 整棵树（含所有孙进程）被内核终止。
 * 不依赖 taskkill 是否存在，也不受 pid 复用影响。
 *
 * ## 协议
 *
 * argv[2] = JSON payload:
 *   { file, args[], cwd|null, maxMemoryMb, maxCpuCores, env{} }
 * 退出码 = 目标进程退出码（被信号/强杀时 Windows 上取不到真实码，见 EXIT_*）。
 * 退出码 78 = 隔离不可用（上层据此降级并如实标注 enforced=false）。
 */

const jobobject = require('./index.js');

/** 上层据此判定「没隔离上」，不要与真实退出码混淆。 */
const EXIT_UNAVAILABLE = 78;

function main() {
  const payload = JSON.parse(process.argv[2] ?? '{}');

  if (!jobobject.available) {
    process.stderr.write(`[jobobject] 隔离不可用：${jobobject.reason}\n`);
    process.exit(EXIT_UNAVAILABLE);
  }

  // 目标进程继承本进程的环境，所以**这里**按白名单过滤：只保留调用方显式
  // 允许的变量，父进程其余环境（含敏感 token）不外泄。
  //
  // SystemRoot 是**硬性必需**的，不是可选加固：实测逐一保留候选变量时，只有
  // 带上 SystemRoot 子进程才起得来（退 3），只留 windir/TEMP/ComSpec/PATHEXT
  // 一律退 134。原因是 CreateProcess 解析 DLL 搜索路径依赖 SystemRoot，
  // 缺它子进程连启动都做不到 —— 表现为 134 而不是一条能读懂的错误信息。
  // 该值由 Windows 自己提供，不含凭据。
  //
  // TEMP/TMP 同样保留：Gradle 需要可写临时目录，删掉会让构建在深处失败。
  const IMPLICIT_ALLOWLIST = ['SystemRoot', 'TEMP', 'TMP'];
  const allowed = new Set([
    ...Object.keys(payload.env ?? {}),
    ...IMPLICIT_ALLOWLIST.filter((k) => process.env[k] !== undefined),
  ]);
  for (const key of Object.keys(process.env)) {
    if (!allowed.has(key)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(payload.env ?? {})) {
    process.env[key] = String(value);
  }

  const job = jobobject.createJob(payload.maxMemoryMb ?? 0, payload.maxCpuCores ?? 0);
  let spawned;
  try {
    // inheritStdio=true：让目标进程继承**本 launcher 的** stdio，
    // 而 launcher 的 stdio 就是上层为它建的管道 —— 日志由此回到上层。
    spawned = jobobject.spawnInJob(
      job,
      payload.file,
      payload.args ?? [],
      payload.cwd ?? null,
      true,
    );
  } catch (err) {
    jobobject.closeJob(job);
    process.stderr.write(`[jobobject] 创建子进程失败：${err.message}\n`);
    process.exit(EXIT_UNAVAILABLE);
  }

  try {
    // timeoutMs=-1 = 等到子进程结束（0 是「立即返回」的轮询语义，别用错）。
    const result = jobobject.waitForExit(spawned.child, -1);
    jobobject.closeChild(spawned.child);
    // KILL_ON_JOB_CLOSE：此刻子进程已退出，这里只是释放句柄。
    jobobject.closeJob(job);
    process.exit(result.exited ? result.exitCode : EXIT_UNAVAILABLE);
  } catch (err) {
    jobobject.closeJob(job);
    process.stderr.write(`[jobobject] 等待子进程失败：${err.message}\n`);
    process.exit(EXIT_UNAVAILABLE);
  }
}

main();
