/**
 * 服务端启动规格的构造（纯函数，只读文件系统，**不 spawn**）。
 *
 * ## 为什么需要这个文件
 *
 * `kernel-server` 刻意**不托管长驻进程** —— `controlServer()` 的原话是
 * 「§7.1 本内核不托管长驻进程：只校验存在性并返回控制指令」。
 * 于是「进程生命周期由外壳服务管理」，而**这个外壳一直缺着**：
 *
 *   - 全仓没有任何地方构造服务端的 cmd/args
 *   - `ProcessSupervisor.launchServer()` 只有测试在调
 *   - 单例 supervisor 没有 confirm，`spawnManaged` 永远 fail-closed
 *   - 定时任务的 `restart` 因此必然走到 `SERVER_NOT_FOUND`
 *
 * 本文件补的正是缺的那一块：**从服务端目录推导出可执行的启动规格**。
 *
 * ## 为什么渲染层不能直接传 cmd
 *
 * `supervisor` 以当前用户权限 spawn 进程。若 IPC 允许渲染层直接给
 * `cmd: 'C:\\Windows\\System32\\calc.exe'`，等于把任意程序执行权交给前端 ——
 * §10.6 确认闸门存在的意义正是堵这个口子。
 *
 * 所以本通道**只接受 serverId**，cmd 由主进程从磁盘推导后，
 * **逐字展示在确认弹窗里**，用户看到什么就批准什么。
 *
 * ## 校验规则与 kernel-server 对齐
 *
 * `serverDir()` 的 serverId 规则（拒绝 `..` / 分隔符 / 盘符）与
 * `controlServer()` 要求的 `server.properties` 存在性，都照抄内核，
 * 避免「内核说合法、外壳说非法」的双标。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** 与 `process-supervisor` 的 `LaunchSpec` 对齐的最小形状。 */
export interface ServerLaunchSpec {
  serverId: string;
  cmd: string;
  args: string[];
  cwd: string;
}

export interface BuildServerLaunchSpecOptions {
  /** Java 可执行文件；缺省 `java`（走 PATH）。 */
  javaPath?: string;
  /** JVM 初始/最大堆，如 `2G`；缺省 `2G`。 */
  memory?: string;
}

export type BuildServerLaunchSpecResult =
  { ok: true; spec: ServerLaunchSpec } | { ok: false; error: string };

/**
 * serverId 合法性：与 `kernel-server` 的 `serverDir()` 同规则。
 *
 * 那一层用 `verr(...)` 抛错，这里返回 `{ok:false}` —— 两边返回形态不同，
 * 但**判定的集合是同一套**，注释互相指认。
 */
export function isValidServerId(serverId: unknown): serverId is string {
  return (
    typeof serverId === 'string' &&
    serverId.length > 0 &&
    !serverId.includes('..') &&
    !/[\\/]/.test(serverId) &&
    !/^[a-zA-Z]:/.test(serverId)
  );
}

/**
 * 在服务端目录里找服务端 jar。
 *
 * 优先 `server.jar`（内核 `createInstance` 的默认 `jarName`）；
 * 否则退而取目录下的唯一一个 `.jar`。`plugins/` 是子目录，不参与。
 */
function findServerJar(dir: string): string | null {
  const preferred = join(dir, 'server.jar');
  if (existsSync(preferred)) return preferred;
  let jars: string[] = [];
  try {
    jars = readdirSync(dir).filter(
      (n) => n.toLowerCase().endsWith('.jar') && statSync(join(dir, n)).isFile(),
    );
  } catch {
    return null;
  }
  if (jars.length !== 1) {
    // 0 个：没装。>1 个：挑不出来 —— 不猜，报给用户去改 jarName。
    return null;
  }
  return join(dir, jars[0]!);
}

/**
 * 构造启动规格。**纯函数**：只读磁盘，不 spawn，不写任何东西。
 *
 * @param serverDir 已由调用方用 `assertWithinRoot` 之类守住边界的绝对路径
 */
export function buildServerLaunchSpec(
  serverDir: string,
  serverId: string,
  opts: BuildServerLaunchSpecOptions = {},
): BuildServerLaunchSpecResult {
  if (!isValidServerId(serverId)) {
    return { ok: false, error: `serverId 非法（含路径穿越或分隔符）: ${String(serverId)}` };
  }
  if (!existsSync(serverDir)) {
    return { ok: false, error: `服务端不存在: ${serverId}（${serverDir}）` };
  }
  // 与 kernel-server controlServer 同一条判据：缺它就无法确认这是合法服务端。
  if (!existsSync(join(serverDir, 'server.properties'))) {
    return {
      ok: false,
      error: `服务端缺少 server.properties，无法确认其为合法服务端: ${join(serverDir, 'server.properties')}`,
    };
  }
  const jar = findServerJar(serverDir);
  if (jar === null) {
    return {
      ok: false,
      error:
        `服务端目录里找不到服务端 jar（${serverDir}）。` +
        `请放入 server.jar，或确保目录下恰好有一个 .jar。`,
    };
  }

  const memory = opts.memory ?? '2G';
  // 内存串会原样进 JVM 参数。白名单化而不是靠"反正不走 shell" ——
  // args 数组确实不受 shell 注入影响，但一个 `-Xmx8G` 拼错成
  // `-Xmx8G -XX:+UseSerialGC` 就不是"内存设置"了。
  if (!/^\d+[GgMm]$/.test(memory)) {
    return { ok: false, error: `内存参数非法（需形如 2G / 2048M）: ${memory}` };
  }

  const javaBin = opts.javaPath ?? 'java';
  if (typeof javaBin !== 'string' || javaBin.trim() === '') {
    return { ok: false, error: 'javaPath 非法（空字符串）' };
  }

  return {
    ok: true,
    spec: {
      serverId,
      cmd: javaBin,
      args: ['-Xms' + memory, '-Xmx' + memory, '-jar', basename(jar), 'nogui'],
      cwd: serverDir,
    },
  };
}

/** 给确认弹窗用的一行摘要：把**将要执行的命令**原样摊开给用户看。 */
export function describeServerLaunch(spec: ServerLaunchSpec): string {
  const shown = [spec.cmd, ...spec.args].join(' ');
  return `即将启动服务端「${spec.serverId}」：\n${shown}\n\n工作目录：${spec.cwd}`;
}
