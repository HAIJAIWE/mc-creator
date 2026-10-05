/**
 * Job Object 绑定的类型声明。
 *
 * 「可用性」是类型的一部分而不是运行时意外：available 为 false 时调用任一
 * 函数都会抛，因此调用方在类型层面就该先判 available。
 */

/** 子进程句柄（不透明）。必须用 closeChild 释放。 */
export type JobChild = unknown;

/** job 句柄（不透明）。必须用 closeJob 释放；关句柄会杀掉整棵树。 */
export type JobHandle = unknown;

export interface SpawnResult {
  child: JobChild;
  /** 子进程 pid，spawn 后立刻可读（上层记日志 / 按 pid 杀都要用）。 */
  pid: number;
}

export interface WaitResult {
  exited: boolean;
  /** 未退出时为 -1。 */
  exitCode: number;
  timedOut: boolean;
  pid: number;
}

export declare const available: boolean;
export declare const supportedPlatform: boolean;
/** 不可用的具体原因（中文，面向用户）；可用时为 null。 */
export declare const reason: string | null;
/** 实际加载到的 .node 路径；未加载时为 null。 */
export declare const binaryPath: string | null;
export declare const API: readonly string[];

/**
 * 建带硬上限的 job。
 * @param maxMemoryMb 每进程内存上限 MB；<=0 不设。
 * @param maxCpuCores CPU 配额（核数）；<=0 不设。
 */
export declare function createJob(maxMemoryMb: number, maxCpuCores: number): JobHandle;

/**
 * 在 job 内 suspended-create 子进程并立即返回（不等待）。
 *
 * @param inheritStdio true 时子进程继承本进程的 stdin/stdout/stderr。
 *   需要收日志（如 Gradle）时必须为 true，否则子进程会拿到一个全新控制台，
 *   输出永远不会进入上层管道。
 */
export declare function spawnInJob(
  job: JobHandle,
  file: string,
  args: string[],
  cwd?: string | null,
  inheritStdio?: boolean,
): SpawnResult;

/**
 * 带上限地等待退出；**不杀伤**。
 * @param timeoutMs `0` = 立即返回的轮询；`<0` = 无限等；`>0` = 等这么多毫秒。
 *   注意 `0` 是轮询而非「无限等」—— 反过来设计过一次，代价是调试时间。
 */
export declare function waitForExit(child: JobChild, timeoutMs: number): WaitResult;

/** 一次终止父进程及其全部后代时的诊断信息。 */
export interface TerminateResult {
  /** TerminateJobObject 是否返回成功。 */
  ok: boolean;
  /** 失败时的 GetLastError（成功时为 0）。 */
  lastError: number;
  /** 终止前 job 内的进程数。 */
  activeBefore: number;
  /** 终止后 job 内的进程数；-1 = 查询失败。 */
  activeProcesses: number;
}

/**
 * 一次终止父进程及其全部后代。
 *
 * 返回诊断对象而非裸 boolean：早先的裸 boolean 版本在进程明明还活着时
 * 返回 true —— 对一个「杀进程」的原语来说，那是最坏的失败形态（看起来成功了）。
 */
export declare function terminateTree(child: JobChild): TerminateResult;

/** 自检：子进程是否确实在 job 内。 */
export declare function isInJob(child: JobChild): boolean;

export declare function closeChild(child: JobChild): void;
export declare function closeJob(job: JobHandle): boolean;
