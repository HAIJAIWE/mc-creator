/**
 * 智能体独立进程拉起（设计文档 §10.1）。
 *
 * §10.1 要求：智能体跑在独立进程，长任务不随窗口关闭终止。
 * 「独立」在这里的意思是：智能体不在主进程里构造、不在渲染层里跑，
 * 而是一个单独的 `node` 子进程（`@mc-creator/agent` 的 `main(['--http'])`），
 * 由主进程的 process-supervisor 托管 —— 窗口关了主进程还在，智能体就不死；
 * 应用退出时走 stop()/shutdownAll() 收尾。
 *
 * 本模块只做两件事，不多做：
 * 1. `buildAgentCommand()` 把拉起命令拼好（`node --input-type=module -e "…"`,
 *    `--http/--port/--host/--path/--data-dir` 全部显式传参）；
 * 2. `createAgentHost()` 把「起 / 停 / 重启」接到一个 supervisor 上。
 * 真正的 spawn、保活、优雅停机、崩溃重启、taskkill 杀整棵树，
 * 全是 `process-supervisor.ts` 的既有机制，本模块不重写（只复用它的注入点，
 * 测试时 fake 一个 supervisor 即可，绝不真拉起子进程）。
 *
 * 纪律（与 startup-recovery / kernel-runtime 同一条）：
 * - **不 import electron**：`userData` 由调用方传入，本模块可脱离 Electron 单测；
 * - **import 无副作用**：只导出符号，绝不自启动；`start()` 必须显式调用；
 * - **dataDir 默认与内核同根**：`join(userData, 'mc-creator', 'agent')`，
 *   与内核的 `join(userData, 'mc-creator', 'kernel')` 同层并列。
 *   目录存在语义由 agent 侧 `resolveHostDataDir` 负责（`mkdirSync recursive`），
 *   这里只传参，不建目录、不读盘。
 */

import { join } from 'node:path';
import type {
  LaunchedProcess,
  ProcessSupervisor,
  StatusSnapshot,
  StopOutcome,
} from './process-supervisor.js';

/** 全局目录前缀。**必须**与 path-manager 的 `APP_DATA_DIR` 相同（理由见 kernel-runtime）。 */
export const AGENT_APP_DIR_NAME = 'mc-creator';

/** 智能体数据在 `mc-creator/` 下的一级目录名（与内核的 `kernel/` 并列）。 */
export const AGENT_ROOT_DIR_NAME = 'agent';

/** 智能体进程在 supervisor 里的托管键。 */
export const AGENT_SERVER_ID = 'mc-agent';

/** 默认监听端口（与 `packages/agent/src/host.ts` 的 `main(['--http'])` 缺省一致）。 */
export const DEFAULT_AGENT_PORT = 3001;

/** 默认监听地址：只绑本地回环（与 `serveHttp` 缺省一致）。 */
export const DEFAULT_AGENT_HOST = '127.0.0.1';

/** 默认 MCP 路径（与 `DEFAULT_MCP_PATH` 一致）。 */
export const DEFAULT_AGENT_PATH = '/mcp';

/**
 * 智能体数据根目录。纯函数：userData 由调用方传入，模块自己不碰 electron。
 */
export function resolveAgentDataDir(userDataDir: string): string {
  return join(userDataDir, AGENT_APP_DIR_NAME, AGENT_ROOT_DIR_NAME);
}

/** 拉起命令的装配选项。 */
export interface BuildAgentCommandOptions {
  /** 调用方传入的 userData（`app.getPath('userData')`），用于推导默认 dataDir。 */
  userDataDir: string;
  /** 显式 dataDir；缺省为 `resolveAgentDataDir(userDataDir)`。只传参，不建目录。 */
  dataDir?: string;
  /** 缺省 DEFAULT_AGENT_PORT。 */
  port?: number;
  /** 缺省 DEFAULT_AGENT_HOST。 */
  host?: string;
  /** 缺省 DEFAULT_AGENT_PATH。 */
  path?: string;
}

/**
 * 拼出 `node` 拉起命令。形状（见 `packages/agent/src/host.ts` 文件头）：
 * `node --input-type=module -e "import('@mc-creator/agent').then(m=>m.main([...]))"`，
 * 其中 argv 数组含 `--http --port N --host H --path P --data-dir D`，全部显式。
 */
export function buildAgentCommand(opts: BuildAgentCommandOptions): {
  command: string;
  args: string[];
} {
  if (typeof opts.userDataDir !== 'string' || opts.userDataDir === '') {
    throw new Error('buildAgentCommand: userDataDir 不能为空（由调用方传入 userData）');
  }
  const dataDir = opts.dataDir ?? resolveAgentDataDir(opts.userDataDir);
  const port = opts.port ?? DEFAULT_AGENT_PORT;
  const host = opts.host ?? DEFAULT_AGENT_HOST;
  const path = opts.path ?? DEFAULT_AGENT_PATH;
  const argv = [
    '--http',
    '--port',
    String(port),
    '--host',
    host,
    '--path',
    path,
    '--data-dir',
    dataDir,
  ];
  // JSON 数组字面量即合法 JS 数组字面量；argv 全是普通字符串，无转义风险。
  const script = `import('@mc-creator/agent').then(m=>m.main(${JSON.stringify(argv)}))`;
  return { command: 'node', args: ['--input-type=module', '-e', script] };
}

/**
 * 开机自启专用的**窄**确认闸门（§10.6 的例外，且是最小例外）。
 *
 * ## 为什么不是 `() => true`
 *
 * 自启确实没有「用户逐次发起的意图」可确认（窗口还没建），但把它实现成
 * 恒真，等于给那个 supervisor 实例开了一张**永久通行证**：今后任何人复用它
 * launch 任何命令都会被无条件放行。这正是 §10.6 拒绝 `kernel:execute` 时
 * 守的那条线，不能因为「是自启」就开口子。
 *
 * ## 本函数的边界
 *
 * 只放行**用同一组参数拼出来的那一条命令**（`buildAgentCommand` 的输出），
 * 逐字节比对 cmd 与全部 args（含内联脚本与 dataDir）。命令一变、端口一改、
 * dataDir 一漂移，期望值随之重算，因此不存在「旧期望值放过新命令」。
 * 其余任何请求（含 payload 缺失/形状不符/参数被改一个字符）一律 false。
 *
 * 注意闸门本身仍遵守 supervisor 的 fail-closed：确认函数抛错按未确认处理，
 * 返回 thenable 也按未确认处理（`process-supervisor.ts` 的既有语义）。
 */
export function createAgentSelfStartConfirm(
  opts: BuildAgentCommandOptions,
): (req: unknown) => boolean {
  const expected = buildAgentCommand(opts);
  return (req: unknown): boolean => {
    if (typeof req !== 'object' || req === null) return false;
    const payload = (req as { payload?: unknown }).payload;
    if (typeof payload !== 'object' || payload === null) return false;
    const { cmd, args } = payload as { cmd?: unknown; args?: unknown };
    if (cmd !== expected.command) return false;
    if (!Array.isArray(args) || args.length !== expected.args.length) return false;
    return args.every((a, i) => a === expected.args[i]);
  };
}

/** `createAgentHost` 的装配选项（supervisor 本体由第一个参数注入）。 */
export interface AgentHostOptions {
  /** 调用方传入的 userData，用于推导默认 dataDir。 */
  userDataDir: string;
  /** 显式 dataDir；缺省为 `resolveAgentDataDir(userDataDir)`。 */
  dataDir?: string;
  /** 缺省 DEFAULT_AGENT_PORT。 */
  port?: number;
  /** 缺省 DEFAULT_AGENT_HOST。 */
  host?: string;
  /** 缺省 DEFAULT_AGENT_PATH。 */
  path?: string;
  /** 在 supervisor 里的托管键；缺省 AGENT_SERVER_ID。 */
  serverId?: string;
}

/** 智能体独立进程的显式句柄：只有 start/stop/restart，没有任何自启动。 */
export interface AgentHost {
  /** 在 supervisor 里的托管键。 */
  readonly serverId: string;
  /** 显式拉起（经 supervisor.launch，受其 §10.6 确认闸门约束）。 */
  start(): LaunchedProcess;
  /**
   * 显式停止。从未启动时是安全的空操作（不抛，返回 exited 的 StopOutcome，
   * 且不碰 supervisor）—— 调用方无需先查状态。
   */
  stop(options?: { gracefulMs?: number }): Promise<StopOutcome>;
  /** 显式重启 = 先停（未启动则空操作）再起。 */
  restart(): Promise<LaunchedProcess>;
  /** 只读：supervisor 里的当前快照；从未托管返回 null。 */
  status(): StatusSnapshot | null;
}

/** 未启动时的空操作停机报告（与 supervisor.stopPublic 的「进程已死 no-op」同形）。 */
function idleStopOutcome(serverId: string): StopOutcome {
  return {
    serverId,
    graceful: true,
    forced: false,
    exited: true,
    portReleased: null,
    portTimedOut: false,
  };
}

/**
 * 创建智能体宿主。`supervisor` 注入（生产传真正的 process-supervisor，
 * 测试传 fake）—— spawn/taskkill 可注入点全在 supervisor 那边，本模块不碰。
 */
export function createAgentHost(supervisor: ProcessSupervisor, opts: AgentHostOptions): AgentHost {
  const serverId = opts.serverId ?? AGENT_SERVER_ID;
  let current: LaunchedProcess | null = null;

  function start(): LaunchedProcess {
    const { command, args } = buildAgentCommand({
      userDataDir: opts.userDataDir,
      ...(opts.dataDir === undefined ? {} : { dataDir: opts.dataDir }),
      ...(opts.port === undefined ? {} : { port: opts.port }),
      ...(opts.host === undefined ? {} : { host: opts.host }),
      ...(opts.path === undefined ? {} : { path: opts.path }),
    });
    current = supervisor.launch({ serverId, cmd: command, args });
    return current;
  }

  async function stop(options?: { gracefulMs?: number }): Promise<StopOutcome> {
    const handle = current;
    current = null;
    // 从未 start：安全空操作（要求：import 后无子进程、stop 未启动不抛）。
    if (handle === null || supervisor.status(serverId) === null) {
      return idleStopOutcome(serverId);
    }
    return handle.stop(options);
  }

  async function restart(): Promise<LaunchedProcess> {
    await stop();
    return start();
  }

  function status(): StatusSnapshot | null {
    return supervisor.status(serverId);
  }

  return { serverId, start, stop, restart, status };
}
