/**
 * 内核宿主（主进程唯一的内核构造点，§4.2 / §10）。
 *
 * ## 为什么内核在主进程内构造，而不是起 MCP stdio/HTTP 子进程
 *
 * 设计文档 §2.3 把两条通道分得很清楚：
 * - 「客户端 ↔ 能力层」= Electron IPC（`invoke`/`handle`）+ `contextBridge` 白名单；
 * - 「智能体 ↔ 能力层」= MCP（Streamable HTTP 生产 / stdio 本地工具）。
 *
 * §10 的 MCP 工具面是给**外部 AI 客户端**用的，本仓的唯一消费者是
 * `packages/agent` 的 `createMcpServer()` —— 它至今只被测试调用。
 * 桌面应用自己要用内核，走的是 §2.3 的第一条：在主进程里构造内核，
 * 经 IPC 白名单暴露给渲染层。所以本模块是 kernel-java / kernel-server /
 * kernel-bedrock 在 desktop 里**唯一**的构造点。
 *
 * ## dataDir 怎么取（以及为什么不跟 `project-store.ts` 统一）
 *
 * 取值：`join(app.getPath('userData'), 'mc-creator', 'kernel')`
 * （见 `resolveKernelRoot`，刻意做成纯函数便于单测；本模块**不 import electron**，
 * 与 `startup-recovery.ts` / `build-cache-store.ts` 同一条纪律 —— 根目录由调用方传入，
 * 模块本身可脱离 Electron 单测）。
 *
 * 理由：
 * 1. `path-manager.ts` 的 `APP_DATA_DIR = 'mc-creator'` 是全局目录的既定前缀
 *    （`MC_LAUNCHER_DIR` / `GLOBAL_SERVERS_DIR` / `GLOBAL_MODPACKS_DIR` 全在
 *    `userData/mc-creator/` 下）。内核数据根跟它们同层，符合既有约定。
 * 2. 但**不能**直接把内核铺在 `userData/mc-creator/` 根下：kernel-java 会在
 *    根下建 `instances/`，kernel-server 会在根下建 `<serverId>/`。这两类目录名
 *    都是用户可控的（serverId 只在 kernel 内部拦了 `..`/`/`/`\`，拦不住
 *    `instances`），铺在根下就可能与既有的 `mods` / `servers` / `temp` 撞名。
 *    单独一级 `kernel/` 把内核数据整块隔开，撞名面从「与既有目录」缩到
 *    「与内核自身的一级目录」—— 而这两个的命名空间冲突由 `RESERVED_KERNEL_IDS`
 *    在 IPC 边界显式拒绝（见 shared/ipc/kernel.ts）。
 * 3. `project-store.ts` 的 `PROJECTS_DIR = 'projects'` 是**相对 userData** 的
 *    （即 `userData/projects`，不在 `mc-creator/` 下），与 1 里的全局目录不一致。
 *    这是既有的路径不一致，本次**刻意不顺手统一**（统一会牵动既有用户的磁盘布局，
 *    属于独立议题）。内核也不碰 `projects/` —— 内核的数据与 project-store 的项目
 *    元数据是两个不同的东西。
 *
 * ## kernelRoot 为什么必须等于本模块的 dataDir
 *
 * `runStartupRecovery({ kernelRoot })` 的 `scanInstanceRoot` 扫的是
 * `<kernelRoot>/instances/`（「有目录、无 instance.json」= create_instance 崩在
 * 写 manifest 之前）。而 kernel-java 的 `list_instances` / `create_instance` 读的
 * 正是 `<dataDir>/instances/`。两者一旦各算各的，启动扫描就会去扫一个内核永远不
 * 碰的目录：半成品实例照样出现在 UI 列表里、照样启动不了。所以 `index.ts` 传的是
 * `getKernelRuntime()?.dataDir`，**同一个字符串**，并有测试断言两者相等。
 *
 * ## §10.6 确认闸门
 *
 * 三个内核的 `KernelContext` 都接受 `confirm`（`packages/kernel-{java,server,
 * bedrock}/src/kernel.ts`），本模块把它接到 `main/kernel-confirm.ts` 的实现上：
 * Electron 原生 `dialog.showMessageBox`。
 *
 * 为什么要在这里说明「为什么用原生对话框」：任务书假设仓库里已有 ConfirmDialog
 * 的 IPC 通道 —— **实际上没有**。`ConfirmDialog.tsx` 只是渲染层组件，主进程侧
 * 从未有过对应的请求/应答通道（`src/main/ipc/` 下只有 process-supervisor 的
 * `ConfirmFn` 注入点）。这里选择原生 `dialog` 而不是新造一条「主进程 → 渲染层
 * 请求确认 → 渲染层应答」的通道，理由有三：
 *  1. 原生对话框不需要任何新 IPC 面，也就不给渲染层新增攻击面；
 *  2. 闸门的关键属性是「用户没拍板就不许有副作用」，原生对话框天然满足，
 *     而自造通道必须额外处理超时/窗口关闭/渲染层不响应等一堆失败路径；
 *  3. 想要产品化的确认 UI 时，把 `createKernelRuntime({ confirm })` 的注入点
 *     换成 UI 实现即可 —— 闸门接线点已经在这里，不需要再改内核。
 *
 * 注意：**不传 confirm 时内核一律拒绝 W/X**（内核自身的既定语义），所以
 * `initKernelRuntime()` 永远显式传 confirm，绝不省略。
 *
 * ## 进程状态事件（§7.4）
 *
 * 本模块**不新建任何事件通道**，也不自己 spawn。内核的 `launch_instance` /
 * `restart_server` 只返回 `controlCommand` / `cmd`+`args`（§13.4：沙箱内生成的
 * 代码永不自动加载），真正 spawn 与生命周期仍归 `src/main/process-supervisor.ts`，
 * 它已经通过既有的 `PROCESS_STATE_EVENT` 通道把状态推给渲染层。本模块只保证
 * 「内核产物 → 进程托管」的交接在类型层面可用（`LaunchHandoff`），
 * 不代替 process-supervisor 点火（§10.6）。
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { JavaKernel } from '@mc-creator/kernel-java';
import { ServerKernel } from '@mc-creator/kernel-server';
import { BedrockKernel } from '@mc-creator/kernel-bedrock';
import { MCP_TOOL_PERMISSIONS, type KernelContract, type TaskResult } from '@mc-creator/contract';
import {
  KERNEL_ALL_KINDS,
  KERNEL_READ_KINDS,
  KERNEL_WRITE_KINDS,
  type KernelPermissionT,
  type KernelReadKindT,
  type KernelRiskT,
  type KernelWriteKindT,
} from '../shared/ipc/kernel.js';

/**
 * 全局目录前缀。**必须**与 `path-manager.ts` 的 `APP_DATA_DIR` 相同。
 *
 * 这里刻意不复用那个常量：`path-manager.ts` 在模块顶层 `import { app } from 'electron'`，
 * 复用会把 electron 拖进本模块，破坏「可脱离 Electron 单测」的纪律。
 * 一致性由 `kernel-runtime.test.ts` 里一条对 `path-manager.APP_DATA_DIR` 的断言守住。
 */
export const KERNEL_APP_DIR_NAME = 'mc-creator';

/** 内核数据根在 `mc-creator/` 下的一级目录名。 */
export const KERNEL_ROOT_DIR_NAME = 'kernel';

/**
 * 内核数据根目录（= 传给 `runStartupRecovery({ kernelRoot })` 的那个 kernelRoot）。
 * 纯函数：userData 由调用方传入，模块自己不碰 electron。
 */
export function resolveKernelRoot(userDataDir: string): string {
  return join(userDataDir, KERNEL_APP_DIR_NAME, KERNEL_ROOT_DIR_NAME);
}

/** 确认请求：与三内核的 `ConfirmRequest` 同形（§10.2 / §10.6）。 */
export interface KernelConfirmRequest {
  kind: string;
  payload: unknown;
  /** 中文一行摘要，可直接作弹窗标题。 */
  summary: string;
  risk: KernelRiskT;
}

export type KernelConfirmFn = (req: KernelConfirmRequest) => Promise<boolean> | boolean;

/** 内核宿主构造选项。 */
export interface KernelRuntimeOptions {
  /** 数据根目录。必须与 `runStartupRecovery({ kernelRoot })` 传的是同一个字符串。 */
  dataDir: string;
  /**
   * §10.6 确认闸门。**生产路径必须给**（省略 = W/X 全部拒绝，这是内核的既定语义）。
   * 之所以是必填而不是可选：省略它只在测试里合理，而测试更应该显式传 `() => true`
   * 或 `() => false`，那样「闸门没接」这件事在代码里是看得见的。
   */
  confirm: KernelConfirmFn;
  /** 执行模式。默认 'live'（桌面应用是生产端）。'sandbox' 时产物只落 sandboxDir（§13.4）。 */
  mode?: 'sandbox' | 'live';
  /** mode='sandbox' 时的沙箱根目录。 */
  sandboxDir?: string;
  /**
   * 网络出站白名单（§10.6）。默认 `[]` = **禁止一切出站**（fail-closed）。
   *
   * 理由：desktop 目前的可达 kind 全是只读，`install_mod` / `install_modpack`
   * 这些要走下载的内核任务还没进任何通道。等它们接线时必须同时给出显式白名单，
   * 否则就会静默变成「全网可达」。
   */
  networkAllowlist?: string[];
}

/** kind → 内核路由（§10.2 的 kind → 内核 edition 映射）。 */
export type KernelRoute = 'java' | 'server' | 'bedrock';

/**
 * 每个 kind 归哪个内核。
 *
 * 依据 §10.2 清单里每个 kind 标注的内核（`install_mod` ← Java、`install_addon`
 * ← Bedrock、`deploy_plugin`/`restart_server` ← 服务端），加上三个内核 dispatch
 * 里实际实现该 kind 的那个：
 *  - java：get_capabilities / list_instances / get_context_pack(instanceId) +
 *    install_* / import_package / apply_skin / uninstall_content / launch_instance
 *    / create_instance / delete_instance；
 *  - server：get_capabilities / read_logs / read_config / get_context_pack(serverId)
 *    \+ build_project / deploy_plugin / restart_server / stop_server / rollback_build
 *    / create_instance / delete_instance；
 *  - bedrock：get_capabilities / get_target_state / validate_content / generate_content。
 *
 * `create_instance` / `delete_instance` 两个内核都实现了，按 `MCP_READ_ROUTES`
 * （agent 层同款约定）默认归 java；需要服务端语义时由调用方在 payload 里带
 * `edition: 'server'` 显式改道。
 *
 * `list_servers` 三内核都没实现（§10.2 列了但内核没做），由外壳侧按 kernel-server
 * 的目录事实推导，见 `main/ipc/kernel.ts`。
 */
const KIND_ROUTES: Record<string, KernelRoute> = {
  // 只读
  get_capabilities: 'java',
  list_instances: 'java',
  list_servers: 'server',
  read_logs: 'server',
  read_config: 'server',
  get_context_pack: 'java',
  get_target_state: 'bedrock',
  validate_content: 'bedrock',
  // W 类（内容装配）
  install_modpack: 'java',
  install_mod: 'java',
  install_addon: 'java',
  import_package: 'java',
  apply_skin: 'java',
  uninstall_content: 'java',
  // X 类（执行与运维 / 生成）
  launch_instance: 'java',
  create_instance: 'java',
  delete_instance: 'java',
  build_project: 'server',
  deploy_plugin: 'server',
  restart_server: 'server',
  stop_server: 'server',
  rollback_build: 'server',
  generate_content: 'bedrock',
  // §7.4 快照备份 + 定时任务（R2b-wiring，全 server 内核）
  backup_server: 'server',
  restore_backup: 'server',
  prune_backups: 'server',
  schedule_task: 'server',
  cancel_task: 'server',
  list_backups: 'server',
  list_tasks: 'server',
  run_due_tasks: 'server',
};

/**
 * `payload.edition` 可以改道的 kind。
 *
 * 前两个是 agent 层 `pickKernel` 同款约定（见 packages/agent/src/mcp-server.ts）：
 * `get_capabilities` 与 `get_context_pack` 在 §10.2 里跨内核存在，必须按
 * `edition` 改道，否则「问 Java 内核要服务端能力表」会得到一份看似合法的错答案。
 * 后两个是两个内核都实现了 create/delete_instance 的情形。
 *
 * 其余 kind 换 edition 会直接落到「不支持的任务」，与其那时才报错，
 * 不如现在就把改道面收窄。
 */
const EDITION_OVERRIDABLE: ReadonlySet<string> = new Set([
  'get_capabilities',
  'get_context_pack',
  'create_instance',
  'delete_instance',
]);

function routeOf(kind: string, payload: unknown): KernelRoute | null {
  const fallback = KIND_ROUTES[kind];
  if (fallback === undefined) return null;
  if (!EDITION_OVERRIDABLE.has(kind)) return fallback;
  const edition =
    typeof payload === 'object' && payload !== null
      ? (payload as Record<string, unknown>)['edition']
      : undefined;
  if (edition === 'java' || edition === 'server' || edition === 'bedrock') return edition;
  return fallback;
}

/** §10.6 权限等级（来自 contract 的唯一真相源）。 */
export function permissionOf(kind: string): KernelPermissionT | null {
  const level = MCP_TOOL_PERMISSIONS[kind];
  return level ?? null;
}

/** §10.6 风险：X 类恒为 execute，W 类恒为 write。 */
export function riskOf(kind: string, permission: KernelPermissionT | null): KernelRiskT {
  return permission === 'X' ? 'execute' : 'write';
}

function refused(kind: string, message: string, code: string): TaskResult {
  return {
    ok: false,
    error: { category: 'permission', message, retryable: false, code },
  };
}

/** 内核宿主句柄。 */
export interface KernelRuntime {
  /** 数据根目录；与 `runStartupRecovery({ kernelRoot })` 必须是同一个字符串。 */
  readonly dataDir: string;
  readonly java: JavaKernel;
  readonly server: ServerKernel;
  readonly bedrock: BedrockKernel;
  /** 执行模式（写入根在 sandbox 时是 sandboxDir，不是 dataDir）。 */
  readonly mode: 'sandbox' | 'live';

  /**
   * 跑一个 R 类 kind（§10.2 读现状）。非只读 kind 一律拒绝，不进内核。
   * `payload.edition` 对 `get_capabilities` / `get_context_pack` 可改道内核。
   */
  runRead(kind: string, payload?: unknown): Promise<TaskResult>;

  /**
   * 跑一个 W/X 类 kind（**只在主进程侧可达**，不进 preload 白名单）。
   * 非 W/X kind 一律拒绝。
   *
   * 与 runRead 的区别只是权限面，**同样经过内核的 confirm 闸门**（§10.6）。
   */
  runWrite(kind: string, payload?: unknown): Promise<TaskResult>;

  /** 已发出的确认请求（审计用；测试据此断言「闸门确实被问到」）。 */
  confirmLog(): readonly KernelConfirmRequest[];

  /**
   * X1 确认源切换入口（构造后替换，二选一里改动最小的：只加方法，不改既有逻辑）。
   * 默认仍是构造时传入的 confirm（生产是原生 dialog，`index.ts` 本任务不改仍传
   * native —— 切换成 UI 确认是 X2/接线任务的事）。替换前后所有请求照记
   * confirmLog，审计不受影响。
   */
  setConfirm(fn: KernelConfirmFn): void;

  /** 释放（will-quit）。释放后任何 dispatch 一律返回结构化的 unavailable，不抛。 */
  dispose(): void;

  /** 是否已释放。 */
  readonly disposed: boolean;
}

/** 构造内核宿主。三个内核共用同一个 `dataDir`（理由见文件头注释）。 */
export function createKernelRuntime(opts: KernelRuntimeOptions): KernelRuntime {
  const dataDir = opts.dataDir;
  const confirmLog: KernelConfirmRequest[] = [];
  let disposed = false;

  // 审计 + 转发：真正的弹窗由 activeConfirm 提供（默认是构造时传入的 confirm，
  // 生产是原生 dialog；X1 新增的 setConfirm 只换这个变量，不碰包装层）。
  // 包一层是为了「每一次确认请求都留下记录」—— §10.6 的闸门如果哪天被误改成
  // 直接 return true，测试会立刻因为 confirmLog 长度为 0 而变红。
  let activeConfirm: KernelConfirmFn = opts.confirm;
  const confirm: KernelConfirmFn = async (req) => {
    confirmLog.push({ ...req });
    return await activeConfirm(req);
  };

  const ctx = {
    dataDir,
    confirm,
    mode: opts.mode ?? 'live',
    ...(opts.sandboxDir === undefined ? {} : { sandboxDir: opts.sandboxDir }),
    networkAllowlist: opts.networkAllowlist ?? [],
  } as const;

  const java = new JavaKernel(ctx);
  const server = new ServerKernel(ctx);
  const bedrock = new BedrockKernel(ctx);
  const kernels: Record<KernelRoute, KernelContract> = { java, server, bedrock };

  function unavailable(kind: string): TaskResult {
    return {
      ok: false,
      error: {
        category: 'unknown',
        message: `内核宿主已释放，无法执行 ${kind}`,
        retryable: false,
        code: 'KERNEL_RUNTIME_DISPOSED',
      },
    };
  }

  async function dispatch(
    kind: string,
    payload: unknown,
    allowed: readonly string[],
  ): Promise<TaskResult> {
    if (disposed) return unavailable(kind);
    if (!allowed.includes(kind)) {
      return refused(
        kind,
        `kind 不在本宿主允许的集合内（只允许: ${allowed.join(', ')}）`,
        'KERNEL_KIND_NOT_ALLOWED',
      );
    }
    const route = routeOf(kind, payload);
    if (route === null) {
      return refused(kind, `未路由的 kind: ${kind}`, 'KERNEL_KIND_UNROUTED');
    }
    // create_instance / delete_instance 的目标目录会与内核数据根下的保留目录名撞名。
    // 内核自己的 serverIdOf / safeFileName 只拦 `..`/`/`/`\`/盘符，拦不住
    // `instances` 这种合法标识符，所以这层拦截必须留在宿主（唯一构造点）上。
    const reserved = hitsReservedId(kind, payload);
    if (reserved !== null) {
      return refused(
        kind,
        `目标 id "${reserved}" 是内核数据根下的保留目录名（${RESERVED_KERNEL_IDS.join(' / ')}）`,
        'KERNEL_ID_RESERVED',
      );
    }
    const handle = kernels[route].dispatch({ id: randomUUID(), kind, payload });
    // 进度流不外发（§10.1 进度经内核 Agent 层消费）。drain 掉以免内核侧的队列
    // 无限堆积：只读 kind 的队列至多一条，写 kind 的进度由未来接上进度通道时再取。
    void (async () => {
      try {
        for await (const _ of handle.progress) {
          // 刻意丢弃
        }
      } catch {
        // 进度流异常不得影响 result()
      }
    })();
    return await handle.result();
  }

  return {
    dataDir,
    java,
    server,
    bedrock,
    mode: opts.mode ?? 'live',
    get disposed(): boolean {
      return disposed;
    },
    runRead: (kind, payload = {}) => dispatch(kind, payload, KERNEL_READ_KINDS),
    runWrite: (kind, payload = {}) => dispatch(kind, payload, KERNEL_WRITE_KINDS),
    confirmLog: () => confirmLog.slice(),
    setConfirm: (fn: KernelConfirmFn): void => {
      activeConfirm = fn;
    },
    dispose(): void {
      disposed = true;
    },
  };
}

/**
 * 内核数据根下的保留一级目录名。
 *
 * kernel-server 的服务端目录是 `<dataDir>/<serverId>/`，而 kernel-java 的实例在
 * `<dataDir>/instances/` —— 两者共用同一个根，所以 `serverId` 不能取这些名字，
 * 否则 `list_servers` 会把内核自己的实例目录当成一个服务端列出来。
 * 内核自己的 `serverIdOf` 只拦 `..`/`/`/`\`/盘符，拦不住这些合法标识符，
 * 所以这层拦截必须留在 IPC 边界。
 */
export const RESERVED_KERNEL_IDS = ['instances'] as const;

/** 从 payload 里取需要做保留名检查的标识符（按 kind 决定取哪个字段）。 */
function reservedIdOf(kind: string, payload: unknown): string | null {
  if (kind !== 'create_instance' && kind !== 'delete_instance') return null;
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  const id = p['name'] ?? p['instanceId'] ?? p['serverId'];
  return typeof id === 'string' && id !== '' ? id : null;
}

/** 该 payload 的目标 id 是否撞上内核数据根下的保留目录名。 */
function hitsReservedId(kind: string, payload: unknown): string | null {
  const id = reservedIdOf(kind, payload);
  if (id === null) return null;
  return (RESERVED_KERNEL_IDS as readonly string[]).includes(id) ? id : null;
}

// ---------------------------------------------------------------------------
// 单例（主进程生命周期）
// ---------------------------------------------------------------------------

let instance: KernelRuntime | null = null;

/** 取内核宿主单例。未初始化时返回 null —— 刻意不在这里偷偷懒初始化：
 *  dataDir 需要 `app.getPath('userData')`，必须由 app.whenReady() 之后显式初始化
 *  （否则 userData 在某些平台尚未确定）。 */
export function getKernelRuntime(): KernelRuntime | null {
  return instance;
}

/** 初始化内核宿主（幂等：已初始化时直接返回既有实例）。 */
export function initKernelRuntime(opts: KernelRuntimeOptions): KernelRuntime {
  if (instance === null) instance = createKernelRuntime(opts);
  return instance;
}

/** 仅供测试 / 退出释放：替换或清空单例。 */
export function setKernelRuntime(rt: KernelRuntime | null): void {
  instance = rt;
}

/** `kernel:listKinds` 用的自描述表：kind → 内核 / 权限 / 风险 / 是否渲染层可达。 */
export interface KernelKindDescriptor {
  kind: string;
  edition: KernelRoute;
  permission: KernelPermissionT;
  risk: KernelRiskT;
  uiReachable: boolean;
}

/** 列出本宿主支持的全部 kind 及其权限分级（供 UI 自解释，避免前端硬编码）。 */
export function describeKernelKinds(): KernelKindDescriptor[] {
  return KERNEL_ALL_KINDS.map((kind) => {
    const edition = routeOf(kind, undefined) ?? 'java';
    const permission = permissionOf(kind) ?? 'R';
    return {
      kind,
      edition,
      permission,
      risk: riskOf(kind, permission),
      uiReachable: (KERNEL_READ_KINDS as readonly string[]).includes(kind),
    };
  });
}

export type { KernelReadKindT, KernelWriteKindT };
