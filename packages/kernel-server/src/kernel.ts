/**
 * 服务端内核（长期托管进程，§7）· KernelContract 实现。
 *
 * §7.1 本质差异：服务端是长期托管进程，需要进程保活、控制台流式 I/O、
 * 优雅停机、崩溃自动重启 —— 因此它是独立内核，不是 Java 内核的子功能。
 * dispatch 后续接管：启动/停止/重启/备份/定时任务等长任务经 TaskHandle
 * 暴露进度与取消。
 *
 * dispatch 只读任务（设计 §10.2 读现状类是闭环必需、§10.6 只读免确认，
 * 纯 node: 内置实现）：
 * - get_capabilities：data 透传 capabilities() 能力表（MCP 强制第一步）。
 * - read_logs：data 透传 { serverId, file, tail: string[] }（尾 200 行）；
 *   文件缺失 → validation 分类的 ok:false。
 * - read_config：data 透传 { serverId, file, text }（server.properties 全文）；
 *   缺失 → validation 分类的 ok:false。
 * - get_context_pack：§10.4 状态注入。扫 plugins/ 取已装插件、从 .deployed/
 *   部署账本取上次产物哈希、解析 server.properties 出配置摘要、并据 runtime
 *   判定 isFolia（§7.3 Folia 硬开关）。data 透传 { target, parts }；
 *   **只给事实不做预算截断**（截断与文案拼装归 agent 层 buildContextPack，
 *   内核不依赖 agent）。
 *
 * dispatch 执行类任务（§10.2 执行类须弹窗确认、§10.6 权限分级）：
 * create_instance / delete_instance / build_project / deploy_plugin /
 * restart_server / stop_server / rollback_build 均为 X 级，走
 * 「确认闸门 + 真实现」两级：
 * 1. 先构造 ConfirmRequest（中文一行 summary + risk）交 ctx.confirm；
 * 2. ctx.confirm 缺失或返回 falsy → 保持既有 permission 拒绝 + confirmRequired:true，
 *    **不执行任何副作用**；
 * 3. 返回 true → 真正执行，且每个副作用都在 progress 流里 yield 进度。
 * 关键边界（§7.1 / §13.4）：
 * - 本内核**不做进程托管**：restart_server / stop_server 只校验服务端存在性并返回
 *   控制指令，真实 SIGTERM / RCON 注入由外壳进程保活服务在确认后执行；
 * - build_project 优先走 devkit.runSandboxed（§8.3 进程级隔离：Windows Job Object
 *   施加内存/CPU 上限与整树终止 + env 白名单）；隔离不可用时降级到
 *   devkit.runGradleBuild，并把实际强制项（enforcedIsolation）如实回报，
 *   其中 network 恒为 false —— Job Object 管不到网络，不要假装已禁网。
 *   sandbox 模式产物留在 sandboxDir，**永不自动部署进正式服务端**；
 * - deploy_plugin 的热重载只返回建议命令，不自动发控制台命令。
 * - 未知 kind：ok:false + unknown 分类（保留 stub 语义）。
 */

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  capabilitiesFor,
  type ArtifactRef,
  type ClassifiedError,
  type EditionCapability,
  type KernelContract,
  type ProgressEvent,
  type StatusSnapshot,
  type TaskHandle,
  type TaskResult,
  type TaskSpec,
  MCP_TOOL_PERMISSIONS,
} from '@mc-creator/contract';
import { writeFileAtomic, ZipSafetyError } from '@mc-creator/shell';
import {
  assertWithinRoot,
  buildSandboxOptions,
  createBuildQueue,
  filterEnv,
  findBuiltJar,
  findJarInLog,
  makeArtifactRef,
  runGradleBuild,
  runSandboxed,
  sha256File,
  validateArtifact,
  type EnforcedReport,
} from '@mc-creator/devkit';

/**
 * §8.2 并发构建队列（模块级单例）：避免多个 Gradle 实例争抢内存。
 * job 内存上限默认 2048MB，两个并发构建就是 4GB+；默认 maxConcurrent=2
 * 是保守值（见 devkit/build-queue.ts），把最坏内存封顶在约 2×job 上限内。
 */
const buildQueue = createBuildQueue();

function acquireBuildSlot(): Promise<() => void> {
  return buildQueue.acquire();
}

/** 内核构造上下文。 */
export interface KernelContext {
  /** 数据根目录；不传则文件类只读任务返回 validation 错误，不抛裸异常。 */
  dataDir?: string;
  /**
   * 确认闸门：W/X 任务必须返回 true 才执行副作用（§10.6 必须弹窗确认）。
   * 不传则 W/X 永远拒绝（保持原「执行通道未开放」语义，agent MCP 通道依赖此行为）。
   */
  confirm?: (req: ConfirmRequest) => Promise<boolean> | boolean;
  /** 执行模式：sandbox=产物留在沙箱目录永不自动部署；live=允许写入用户目标（§13.4） */
  mode?: 'sandbox' | 'live';
  /** 沙箱根目录（mode='sandbox' 时所有写操作必须落在此目录内，assertWithinRoot 校验） */
  sandboxDir?: string;
  /** 网络出站白名单（§10.6 网络出站白名单域）；空 = 禁止所有出站 */
  networkAllowlist?: string[];
}

/** 确认请求：外壳据此弹窗，用户拍板后才允许内核产生副作用（§10.2 / §10.6）。 */
export interface ConfirmRequest {
  /** 任务 kind（与 TaskSpec.kind 一致）。 */
  kind: string;
  /** 原始 payload（外壳用于渲染影响面）。 */
  payload: unknown;
  /** 中文一行摘要，直接可作为弹窗标题。 */
  summary: string;
  /** 风险等级：write=写实例目录；execute=执行/改实例目录外。 */
  risk: 'write' | 'execute';
}

/** 运行时矩阵（§7.2）：Java 插件服务端 / Java Mod 服务端 + vanilla 基线。 */
const SUPPORTED_RUNTIMES = [
  'paper',
  'purpur',
  'folia',
  'spigot',
  'fabric',
  'neoforge',
  'forge',
  'vanilla',
] as const;

type ServerRuntime = (typeof SUPPORTED_RUNTIMES)[number];

/** 带分类的任务内部异常：抛出后由 result() 统一转 TaskResult.error。 */
class KernelTaskError extends Error {
  readonly classified: ClassifiedError;

  constructor(classified: ClassifiedError) {
    super(classified.message);
    this.name = 'KernelTaskError';
    this.classified = classified;
  }
}

function verr(message: string, code?: string): never {
  throw new KernelTaskError({
    category: 'validation',
    message,
    retryable: false,
    ...(code === undefined ? {} : { code }),
  });
}

function cerr(
  category: ClassifiedError['category'],
  message: string,
  code?: string,
): KernelTaskError {
  return new KernelTaskError({
    category,
    message,
    retryable: category === 'network',
    ...(code === undefined ? {} : { code }),
  });
}

/** 裸异常统一转 ClassifiedError：只读探测永不向外抛裸异常。 */
function toDiskError(e: unknown): ClassifiedError {
  const message = e instanceof Error ? e.message : String(e);
  return { category: 'disk', message: `文件系统访问失败: ${message}`, retryable: false };
}

function isClassifiedError(e: unknown): e is ClassifiedError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'category' in e &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  );
}

function validation(message: string): TaskResult {
  return { ok: false, error: { category: 'validation', message, retryable: false } };
}

function permissionDenied(_kind: string): TaskResult {
  // data 形状与升级前完全一致（{ confirmRequired: true }），保证既有调用方
  // 与 agent MCP 通道的断言不破。
  return {
    ok: false,
    error: {
      category: 'permission',
      message: '须弹窗确认，执行通道未开放',
      retryable: false,
    },
    data: { confirmRequired: true },
  };
}

/**
 * 从 payload 提取 serverId（兼容 serverId / server / id 键）。
 * 拒绝路径穿越写法，非法时返回 undefined 由调用方报 validation 错误。
 */
function serverIdOf(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['serverId', 'server', 'id']) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) continue;
    if (value.includes('..') || value.includes('/') || value.includes('\\')) continue;
    return value;
  }
  return undefined;
}

/**
 * §7.4 快照类 kind：contract 包尚无 backup 分级（MCP_TOOL_PERMISSIONS 无
 * backup_* key），按 W 级走「确认闸门 + 真实现」（risk=write）。不改 contract
 * 包（那是别人的文件），此处本地声明路由集合。
 */
const BACKUP_WRITE_KINDS = new Set([
  'backup_server',
  'list_backups',
  'restore_backup',
  'prune_backups',
]);

/** 递归列出目录下所有文件（相对路径，'/' 分隔，已排序）。读失败的条目直接跳过。 */
function listFilesRecursive(dir: string, prefix: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries.sort()) {
    const full = join(dir, entry);
    const rel = prefix === '' ? entry : `${prefix}/${entry}`;
    let st: ReturnType<typeof statSync> | undefined;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listFilesRecursive(full, rel));
    else if (st.isFile()) out.push(rel);
  }
  return out;
}

/** 快照排序键：manifest.createdAt 优先（ISO 字典序即时间序），缺失则退化为目录名；同键按名排。 */
function backupSortKey(listRoot: string, id: string): [string, string] {
  try {
    const m = JSON.parse(readFileSync(join(listRoot, id, 'manifest.json'), 'utf8')) as {
      createdAt?: unknown;
    };
    if (typeof m.createdAt === 'string' && m.createdAt !== '') return [m.createdAt, id];
  } catch {
    /* 读不到 manifest 就按目录名排，调用方再跳过坏条目 */
  }
  return [id, id];
}

function compareBackupIds(listRoot: string, a: string, b: string): number {
  const [ca, na] = backupSortKey(listRoot, a);
  const [cb, nb] = backupSortKey(listRoot, b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * payload 解析
 * ------------------------------------------------------------------ */

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
}

function reqString(source: Record<string, unknown>, key: string, label: string): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    verr(`缺少参数 payload.${key}（${label}）`);
  }
  return value.trim();
}

function optString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function optNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optStringArray(source: Record<string, unknown>, key: string): string[] | undefined {
  const value = source[key];
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  return out.length > 0 ? out : undefined;
}

function optBoolean(source: Record<string, unknown>, key: string): boolean | undefined {
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}

/** server.properties 值转义：properties 是 key=value 行格式，值里的换行/等号需防注入。 */
/**
 * §10.4 状态注入的事实形状（与 agent/context-pack.ts 的 ContextTarget/ContextParts
 * 结构兼容）。刻意在此**重新声明**而非从 agent import：§2.2 分层规定 agent 依赖
 * 内核，内核绝不反向依赖 agent —— 这里是结构兼容的契约形状，不是类型共享。
 */
interface ContextTarget {
  edition?: string;
  instanceId?: string;
  serverId?: string;
  mcVersion?: string;
  runtime?: string;
}

interface ContextParts {
  mods?: string[];
  plugins?: string[];
  lastBuildHash?: string;
  lastFailure?: string;
  isFolia?: boolean;
  serverConfigSummary?: string;
}

interface ContextState {
  target: ContextTarget;
  parts: ContextParts;
}

/** server.properties 摘要白名单：只取影响插件行为的项，避免把整份配置灌进上下文。 */
const CONTEXT_PROP_KEYS = [
  'server-port',
  'gamemode',
  'difficulty',
  'max-players',
  'online-mode',
  'white-list',
  'enforce-whitelist',
  'level-name',
  'view-distance',
  'simulation-distance',
  'enable-rcon',
  'sync-chunk-writes',
  'prevent-proxy-connections',
  'resource-pack',
] as const;

/** 生成 server.properties 摘要（白名单项逐行 key=value，按白名单顺序稳定输出）。 */
function summarizeServerProps(props: Record<string, string>): string {
  const lines: string[] = [];
  for (const key of CONTEXT_PROP_KEYS) {
    const value = props[key];
    if (value !== undefined && value !== '') lines.push(`${key}=${value}`);
  }
  return lines.join('\n');
}

function propertiesEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([=:#])/g, '\\$1');
}

/**
 * 启动脚本参数转义：移除 shell 元字符（§13 命令注入防护）。
 * 与 kernel-java/content/server/server-generator.ts 同思路，此处独立实现
 * 避免服务端内核反向依赖 Java 内核的内容生成器（跨内核禁依赖）。
 */
function shellEscape(value: string): string {
  return value.replace(/[;&|`$"<>!\n\r*?()[\]{}~#]/g, '');
}

/* ------------------------------------------------------------------ *
 * 进度总线（progress 消费流与 result() 执行流共享事件队列）
 * ------------------------------------------------------------------ */

class ProgressBus {
  private readonly queue: ProgressEvent[] = [];
  private waiters: Array<() => void> = [];
  private resultStarted = false;
  private resultFinished = false;

  push(event: ProgressEvent): void {
    // 去重：dispatch 预置的首步事件与执行器 step(0) stage+message 一致。
    const last = this.queue[this.queue.length - 1];
    if (last !== undefined && last.stage === event.stage && last.message === event.message) {
      this.queue[this.queue.length - 1] = event;
      this.wake();
      return;
    }
    this.queue.push(event);
    this.wake();
  }

  markResultStarted(): void {
    this.resultStarted = true;
  }

  close(): void {
    this.resultFinished = true;
    this.wake();
  }

  private wake(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const fn of pending) fn();
  }

  async *drain(): AsyncGenerator<ProgressEvent> {
    let cursor = 0;
    for (;;) {
      while (cursor < this.queue.length) {
        const event = this.queue[cursor];
        cursor++;
        if (event !== undefined) yield event;
      }
      if (this.resultFinished || !this.resultStarted) return;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }
}

/** 阶段名沿用既有 stepDefs（§进度语义对外稳定）。 */
const STEP_DEFS: Record<string, { stage: string; message: string }[]> = {
  build_project: [
    { stage: 'validating', message: '校验工程目录与参数' },
    { stage: 'building', message: '执行 Gradle 构建 (devkit/runGradleBuild)' },
    { stage: 'artifact', message: '定位构建产物并计算 SHA256' },
    { stage: 'complete', message: '构建完成' },
  ],
  deploy_plugin: [
    { stage: 'validating', message: '校验服务端与产物路径' },
    { stage: 'copying', message: '复制 JAR 到 plugins/ 目录' },
    { stage: 'reloading', message: '可选：热重载插件' },
  ],
  restart_server: [
    { stage: 'stopping', message: '发送停止信号并等待端口释放' },
    { stage: 'starting', message: '重新启动服务端进程' },
    { stage: 'running', message: '服务端已重启' },
  ],
  stop_server: [
    { stage: 'stopping', message: '发送优雅停止信号' },
    { stage: 'stopped', message: '服务端已停止' },
  ],
  rollback_build: [
    { stage: 'validating', message: '校验项目与历史产物哈希' },
    { stage: 'restoring', message: '从构建缓存恢复上一版 JAR' },
    { stage: 'redeploying', message: '重新部署并可选重载' },
  ],
  create_instance: [
    { stage: 'validating', message: '校验名称与重名' },
    { stage: 'writing', message: '创建目录结构、server.properties、eula.txt、启动脚本' },
    { stage: 'complete', message: '服务端实例创建完成' },
  ],
  delete_instance: [
    { stage: 'validating', message: '校验服务端存在性' },
    { stage: 'deleting', message: '删除服务端目录' },
  ],
  backup_server: [
    { stage: 'validating', message: '校验服务端存在性' },
    { stage: 'snapshotting', message: '复制 world/ 与配置文件到快照目录' },
    { stage: 'complete', message: '快照完成并写入 manifest' },
  ],
  list_backups: [
    { stage: 'validating', message: '校验服务端存在性' },
    { stage: 'listing', message: '列出已有快照' },
  ],
  restore_backup: [
    { stage: 'validating', message: '校验服务端与快照存在性' },
    { stage: 'restoring', message: '从快照拷回服务端目录' },
  ],
  prune_backups: [
    { stage: 'validating', message: '校验服务端与保留数' },
    { stage: 'pruning', message: '按 keepN 裁剪旧快照' },
  ],
};

function confirmSummary(kind: string, payload: unknown): string {
  const p = asRecord(payload);
  const id = serverIdOf(payload) ?? optString(p, 'name') ?? '未命名';
  switch (kind) {
    case 'create_instance':
      return `创建服务端「${id}」并写入 server.properties / eula.txt / 启动脚本`;
    case 'delete_instance':
      return `删除服务端「${id}」的整个目录（世界与日志一并丢失，不可逆）`;
    case 'build_project':
      return `执行 Gradle 构建 ${optString(p, 'projectDir') ?? optString(p, 'projectRef') ?? ''}（X 级：会产生编译进程）`;
    case 'deploy_plugin':
      return `把 JAR 部署到服务端「${id}」的 plugins/ 目录并记录部署哈希`;
    case 'restart_server':
      return `重启服务端「${id}」（控制指令，实际进程生命周期由外壳服务管理）`;
    case 'stop_server':
      return `优雅停止服务端「${id}」（控制指令，实际进程生命周期由外壳服务管理）`;
    case 'rollback_build':
      return `把服务端「${id}」的插件回滚到上一版产物（按 sha256 匹配）`;
    case 'backup_server':
      return `为服务端「${id}」创建世界/配置快照（写入 backups/ 目录）`;
    case 'list_backups':
      return `列出服务端「${id}」的已有快照（只读快照目录）`;
    case 'restore_backup':
      return `把快照恢复到服务端「${id}」（覆盖世界与配置，建议随后重启）`;
    case 'prune_backups':
      return `裁剪服务端「${id}」的旧快照（只保留最近 N 个）`;
    default:
      return `执行 ${kind}（写入或改动用户目标）`;
  }
}

function riskOf(kind: string): 'write' | 'execute' {
  return MCP_TOOL_PERMISSIONS[kind] === 'X' ? 'execute' : 'write';
}

export class ServerKernel implements KernelContract {
  readonly edition = 'server' as const;
  private readonly dataDir: string | undefined;
  private readonly confirm: ((req: ConfirmRequest) => Promise<boolean> | boolean) | undefined;
  private readonly mode: 'sandbox' | 'live';
  private readonly sandboxDir: string | undefined;

  constructor(ctx: KernelContext = {}) {
    this.dataDir = ctx.dataDir;
    this.confirm = ctx.confirm;
    this.mode = ctx.mode ?? 'live';
    this.sandboxDir = ctx.sandboxDir;
    // 网络出站白名单当前未被服务端内核的任务用到（构建走 Gradle 自身依赖仓库策略，
    // §8.1#3），保留字段以便外壳统一注入而不必改内核构造签名。
    void ctx.networkAllowlist;
  }

  capabilities(): EditionCapability[] {
    return capabilitiesFor('server');
  }

  status(): StatusSnapshot {
    return { edition: this.edition, healthy: true, updatedAt: new Date().toISOString() };
  }

  private writeRoot(): string {
    if (this.mode === 'sandbox') {
      if (this.sandboxDir === undefined || this.sandboxDir === '') {
        verr(
          'mode=sandbox 但未配置 sandboxDir，拒绝写入（§13.4 沙箱隔离）',
          'SANDBOX_ROOT_MISSING',
        );
      }
      return this.sandboxDir;
    }
    if (this.dataDir === undefined || this.dataDir === '') {
      verr('未配置 dataDir，拒绝写入用户目标目录', 'DATA_DIR_MISSING');
    }
    return this.dataDir;
  }

  private guard(root: string, target: string): string {
    try {
      return assertWithinRoot(root, target);
    } catch (e) {
      throw cerr(
        'validation',
        `目标路径越界（${root} 之外）: ${target}（${(e as Error).message}）`,
        'SANDBOX_ESCAPE',
      );
    }
  }

  private serverDir(root: string, serverId: string): string {
    if (serverId.includes('..') || /[\\/]/.test(serverId) || /^[a-zA-Z]:/.test(serverId)) {
      verr(`serverId 非法（含路径穿越或分隔符）: ${serverId}`, 'PATH_TRAVERSAL');
    }
    return this.guard(root, serverId);
  }

  /**
   * §10.4 状态注入：读服务端现状，产出 { target, parts } 供 agent 层拼装上下文包。
   *
   * 只负责**事实**：已装插件（plugins/*.jar）、上次部署产物哈希（.deployed/ 账本）、
   * 配置摘要（server.properties 关键项）、是否 Folia（§7.3 硬开关）。
   * 刻意不做预算截断 —— 那是 agent/context-pack.ts buildContextPack 的职责
   * （分层：§2.2 内核绝不反向依赖 agent）。
   * 任一子源缺失都退化为空值，不让状态注入因局部缺失而整体失败。
   */
  private readContextParts(root: string, serverId: string): ContextState {
    const dir = this.serverDir(root, serverId);
    const target: ContextTarget = { edition: 'server', serverId };

    const propsPath = join(dir, 'server.properties');
    let props: Record<string, string> = {};
    if (existsSync(propsPath)) {
      try {
        const text = readFileSync(propsPath, 'utf8');
        for (const line of text.split('\n')) {
          const trimmed = line.trim();
          if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
          const eq = trimmed.indexOf('=');
          if (eq <= 0) continue;
          props[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
        }
      } catch {
        props = {};
      }
    }

    const pluginsDir = join(dir, 'plugins');
    let plugins: string[] = [];
    if (existsSync(pluginsDir)) {
      try {
        plugins = readdirSync(pluginsDir)
          .filter((f) => f.toLowerCase().endsWith('.jar'))
          .sort();
      } catch {
        plugins = [];
      }
    }

    // 上次部署哈希（§0.5 产物哈希对外可见）：取账本里最新的部署记录。
    const recordDir = join(pluginsDir, '.deployed');
    let lastBuildHash: string | undefined;
    if (existsSync(recordDir)) {
      try {
        const records = readdirSync(recordDir)
          .filter((f) => f.endsWith('.json'))
          .map((f) => ({ f, mtimeMs: statSync(join(recordDir, f)).mtimeMs }))
          .sort((a, b) => b.mtimeMs - a.mtimeMs);
        const newest = records[0];
        if (newest !== undefined) {
          const parsed = JSON.parse(readFileSync(join(recordDir, newest.f), 'utf8')) as {
            sha256?: unknown;
          };
          if (typeof parsed.sha256 === 'string' && parsed.sha256 !== '')
            lastBuildHash = parsed.sha256;
        }
      } catch {
        lastBuildHash = undefined;
      }
    }

    const parts: ContextParts = {};
    if (plugins.length > 0) parts.plugins = plugins;
    if (lastBuildHash !== undefined) parts.lastBuildHash = lastBuildHash;
    const summary = summarizeServerProps(props);
    if (summary !== '') parts.serverConfigSummary = summary;

    return { target, parts };
  }

  /* -------------------- X 真实现 -------------------- */

  private async createInstance(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const name = reqString(p, 'name', '服务端名称');
    const runtime = reqString(p, 'runtime', `运行时（${SUPPORTED_RUNTIMES.join('/')}）`);
    if (!(SUPPORTED_RUNTIMES as readonly string[]).includes(runtime)) {
      verr(`payload.runtime 不支持: ${runtime}（可选: ${SUPPORTED_RUNTIMES.join('/')}）`);
    }
    const versionId = optString(p, 'versionId') ?? 'latest';
    const port = optNumber(p, 'port') ?? 25565;
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      verr(`payload.port 非法（需1..65535 整数）: ${port}`);
    }
    // EULA 必须由用户显式接受：Minecraft EULA 要求不得代替用户勾选。
    if (optBoolean(p, 'acceptEula') !== true) {
      verr(
        '未接受 EULA：创建服务端需 payload.acceptEula === true（不得代用户同意）',
        'EULA_NOT_ACCEPTED',
      );
    }
    step(0);
    if (name.includes('..') || /[\\/]/.test(name)) {
      verr(`服务端名非法（含路径穿越或分隔符）: ${name}`, 'PATH_TRAVERSAL');
    }
    const dir = this.serverDir(root, name);
    if (existsSync(dir)) verr(`服务端已存在: ${name}（${dir}）`, 'SERVER_EXISTS');

    step(1);
    for (const sub of ['plugins', 'world', 'logs', 'config']) {
      const subDir = this.guard(root, join(name, sub));
      await writeFileAtomic(join(subDir, '.gitkeep'), '');
    }

    const motd = optString(p, 'motd') ?? `${name} Server`;
    const gamemode = optString(p, 'gamemode') ?? 'survival';
    if (!['survival', 'creative', 'adventure', 'spectator'].includes(gamemode)) {
      verr(`payload.gamemode 非法: ${gamemode}`);
    }
    const maxPlayers = optNumber(p, 'maxPlayers') ?? 20;
    const onlineMode = optBoolean(p, 'onlineMode') ?? true;
    const allowQuery = optBoolean(p, 'enableQuery') ?? false;

    const props: Record<string, string> = {
      'server-name': name,
      motd,
      'server-port': String(port),
      gamemode,
      difficulty: optString(p, 'difficulty') ?? 'easy',
      'max-players': String(maxPlayers),
      'online-mode': String(onlineMode),
      'white-list': String(optBoolean(p, 'whitelist') ?? false),
      'enforce-whitelist': String(optBoolean(p, 'enforceWhitelist') ?? false),
      'level-name': 'world',
      'enable-query': String(allowQuery),
      'enable-rcon': String(optBoolean(p, 'enableRcon') ?? false),
      'spawn-protection': String(optNumber(p, 'spawnProtection') ?? 16),
      'view-distance': String(optNumber(p, 'viewDistance') ?? 10),
      'simulation-distance': String(optNumber(p, 'simulationDistance') ?? 10),
      'allow-flight': String(optBoolean(p, 'allowFlight') ?? false),
      'allow-nether': String(optBoolean(p, 'allowNether') ?? true),
      'sync-chunk-writes': String(optBoolean(p, 'syncChunkWrites') ?? true),
      'use-native-transport': 'true',
      'prevent-proxy-connections': String(optBoolean(p, 'preventProxyConnections') ?? false),
      'resource-pack': String(optString(p, 'resourcePack') ?? ''),
      'server-ip': optString(p, 'serverIp') ?? '',
    };
    const propsText = `${Object.entries(props)
      .map(([k, v]) => `${k}=${propertiesEscape(v)}`)
      .join('\n')}\n`;

    const jvmArgs = optStringArray(p, 'jvmArgs') ?? [];
    const xms = optString(p, 'xms') ?? '1G';
    const xmx = optString(p, 'xmx') ?? '2G';
    const jarName = optString(p, 'jarName') ?? 'server.jar';
    const javaBin = optString(p, 'javaPath') ?? 'java';
    const jvmTail = jvmArgs.map(shellEscape).join(' ');

    const files: { rel: string; content: string }[] = [
      { rel: 'server.properties', content: propsText },
      // eula=true 只在 acceptEula===true 时才写（上面已强校验）。
      { rel: 'eula.txt', content: 'eula=true\n' },
      {
        rel: 'start.bat',
        content: `@echo off\r\nREM 由 MC Creator 服务端内核生成（§7）。启动前请确认 server.properties。\r\n"${shellEscape(javaBin)}" -Xms${shellEscape(xms)} -Xmx${shellEscape(xmx)} ${jvmTail} -jar "${shellEscape(jarName)}" nogui\r\npause\r\n`,
      },
      {
        rel: 'start.sh',
        content: `#!/bin/sh\n# 由 MC Creator 服务端内核生成（§7）\nexec "${shellEscape(javaBin)}" -Xms${shellEscape(xms)} -Xmx${shellEscape(xmx)} ${jvmTail} -jar "${shellEscape(jarName)}" nogui\n`,
      },
      { rel: 'ops.json', content: '[]\n' },
      { rel: 'whitelist.json', content: '[]\n' },
    ];

    const artifacts: ArtifactRef[] = [];
    for (const file of files) {
      const dest = this.guard(root, join(name, file.rel));
      await writeFileAtomic(dest, file.content);
      if (file.rel === 'server.properties' || file.rel === 'eula.txt') {
        artifacts.push(await makeArtifactRef(dest, 'server-config'));
      }
    }

    step(2);
    return {
      ok: true,
      artifacts,
      data: {
        serverId: name,
        dir,
        runtime: runtime as ServerRuntime,
        versionId,
        port,
        maxPlayers,
        onlineMode,
        motd,
        files: files.map((f) => f.rel),
        mode: this.mode,
      },
    };
  }

  private async deleteInstance(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    step(1);
    rmSync(dir, { recursive: true });
    return { ok: true, data: { deleted: true, serverId, path: dir } };
  }

  /**
   * 跑 Gradle 构建，优先走 §8.3 的进程级隔离执行器。
   *
   * 隔离可用时经 @mc-creator/jobobject（Windows Job Object）施加内存/CPU 上限
   * 与整树终止；不可用时降级为 runGradleBuild，并把「实际强制了什么」放进
   * enforcedIsolation 回报给上层 —— 不静默假装已隔离（MEMORY §2-④）。
   */
  private async runBuild(
    projectDir: string,
    javaHome: string | undefined,
    timeoutMs: number | undefined,
  ): Promise<{
    success: boolean;
    jarPath: string | null;
    log: string;
    exitCode: number | null;
    timedOut: boolean;
    enforcedIsolation: EnforcedReport;
  }> {
    // §8.2：整个 runBuild 都在槽内（隔离+降级两条路径都不例外）。
    const release = await acquireBuildSlot();
    try {
      const limits = {
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      };
      // env 交给 filterEnv 按白名单裁剪。来源必须是完整 process.env ——
      // 只塞 JAVA_HOME 会让 PATH 实际缺失，.bat 里的 node 找不到，
      // 构建「成功」却什么都没跑（实测 alloc.js 从未执行、build_project ok=true）。
      const env: Record<string, string | undefined> = { ...process.env };
      if (javaHome !== undefined) env['JAVA_HOME'] = javaHome;
      // PATH 缺失 = 构建会静默空转（.bat 里的 node/gradle 找不到，而退出码仍是 0）。
      // 与其产出一个空的「成功」，不如响。用 filterEnv 判定而不是 env['PATH']：
      // 本机 process.env 存的是 `Path`，直接读 'PATH' 会误判为缺失。
      if (filterEnv(['PATH'], env).PATH === undefined) {
        return {
          success: false,
          jarPath: null,
          log: '',
          exitCode: null,
          timedOut: false,
          enforcedIsolation: {
            source: 'unisolated',
            memory: false,
            cpu: false,
            network: false,
            treeKill: false,
            reason: '当前进程环境缺少 PATH',
          },
        };
      }
      // 沙箱 cwd 就是工程目录：cwd jail 已由 guard(root, projectDir) 保证。
      const sandbox = buildSandboxOptions(projectDir, {
        cwd: projectDir,
        limits,
        envAllowlist: ['PATH', 'JAVA_HOME', 'GRADLE_USER_HOME', 'GRADLE_OPTS'],
      });

      // Windows 上只有 gradlew.bat，必须经 shell 启动（core 的 C-2 修复踩过
      // `./gradlew` ENOENT）。但**不能**用 spawn 的 shell:true —— 那会引入一个
      // 不受 job 约束的 cmd.exe，且 .bat 拉起的 java/gradle 是孙进程，
      // 正是 §8.3 要消除的情形。改为显式拼 shell 命令行：cmd.exe 自身仍由
      // CreateProcess 纳入 job，其后代随之继承，隔离不破。
      const isWin = process.platform === 'win32';
      const gradlew = isWin ? 'gradlew.bat' : './gradlew';
      const gradleArgs = ['build', '--quiet'];
      const shell = isWin
        ? (process.env['ComSpec'] ?? 'cmd.exe')
        : (process.env['SHELL'] ?? '/bin/sh');
      // 引号：Windows 的 cmd 对 - 前缀参数不能加引号，路径类必须加；
      // posix 用单引号并转义内嵌单引号。
      const tail = gradleArgs
        .map((a) => (isWin ? (a.startsWith('-') ? a : `"${a}"`) : `'${a.replace(/'/g, `'\\''`)}'`))
        .join(' ');
      const script = isWin ? `/c ${gradlew} ${tail}` : `-c './${gradlew} ${tail}'`;

      const run = await runSandboxed({
        sandbox,
        file: shell,
        args: [script],
        env,
      });

      if (run.enforced.source === 'unisolated') {
        // 隔离不可用：退回原有实现（含 Windows shell:true 与 taskkill 杀树逻辑），
        // 避免为了「统一」而丢掉 gradlew.bat 的启动兼容性。
        const legacy = await runGradleBuild(projectDir, {
          ...(javaHome === undefined ? {} : { javaHome }),
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        });
        return { ...legacy, enforcedIsolation: run.enforced };
      }

      const jarPath = run.success
        ? ((await findBuiltJar(projectDir)) ?? findJarInLog(projectDir, run.log))
        : null;
      return {
        success: run.success,
        jarPath,
        log: run.log,
        exitCode: run.exitCode,
        timedOut: run.timedOut,
        enforcedIsolation: run.enforced,
      };
    } finally {
      release();
    }
  }

  private async buildProject(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const projectDirRaw = optString(p, 'projectDir') ?? optString(p, 'projectRef');
    if (projectDirRaw === undefined) verr('缺少参数 payload.projectDir（Gradle 工程目录）');
    step(0);
    const projectDir = this.guard(root, projectDirRaw);
    if (!existsSync(projectDir)) verr(`工程目录不存在: ${projectDir}`, 'PROJECT_DIR_NOT_FOUND');
    const javaHome = optString(p, 'javaHome');
    const timeoutMs = optNumber(p, 'timeoutMs');

    step(1);
    const build = await this.runBuild(projectDir, javaHome, timeoutMs);
    if (!build.success) {
      // 构建失败归 validation（可读日志摘要）并带稳定 code，便于上层回灌修复（§10.3）。
      const tail = build.log.trim().split('\n').slice(-20).join(' | ');
      const detail = build.timedOut
        ? `构建超时（timeoutMs=${timeoutMs ?? '默认'}）`
        : `退出码 ${build.exitCode ?? '未知'}`;
      verr(`构建失败: ${detail}; 日志摘要: ${tail || '(空)'}`, 'BUILD_FAILED');
    }

    step(2);
    const jarName = optString(p, 'jarName');
    const jarPath =
      jarName === undefined ? build.jarPath : join(projectDir, 'build', 'libs', jarName);
    if (jarPath === null || jarPath === undefined || !existsSync(jarPath)) {
      verr('构建成功但未找到 build/libs/*.jar 产物', 'ARTIFACT_NOT_FOUND');
    }
    const sha256 = await sha256File(jarPath);
    // step(2.5): 产物隔离加载验证（devkit.validateArtifact，只读冒烟不执行 jar）。
    // 验证失败不推翻构建成功（ok 仍 true），只把 validation.ok=false 如实带给上层；
    // sandboxDir 保留供审计，由上层清理，内核不删。
    let validation: {
      ok: boolean;
      timedOut: boolean;
      log: string;
      enforced: EnforcedReport;
      sandboxDir: string;
    };
    try {
      const v = await validateArtifact({
        workdir: root,
        artifactPath: jarPath,
        env: { ...process.env },
      });
      const trimmed = v.log.trim();
      validation = {
        ok: v.ok,
        timedOut: v.timedOut,
        log: trimmed === '' ? '' : trimmed.split('\n').slice(-20).join('\n'),
        enforced: {
          source: v.enforced.source,
          memory: v.enforced.memory,
          cpu: v.enforced.cpu,
          network: v.enforced.network,
          treeKill: v.enforced.treeKill,
          reason: v.enforced.reason,
        },
        sandboxDir: v.sandboxDir,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      validation = {
        ok: false,
        timedOut: false,
        log: `validateArtifact failed: ${message}`,
        enforced: {
          source: 'unisolated',
          memory: false,
          cpu: false,
          network: false,
          treeKill: false,
          reason: message,
        },
        sandboxDir: root,
      };
    }
    step(3);
    const artifact = await makeArtifactRef(jarPath, 'build-artifact');
    return {
      ok: true,
      artifacts: [artifact],
      data: {
        projectDir,
        jarPath,
        sha256,
        exitCode: build.exitCode,
        sandboxed: this.mode === 'sandbox',
        // §8.3：把「实际强制了哪些隔离项」如实带给上层。
        // network 恒为 false（Job Object 管不到网络）—— 上层据此提示用户，
        // 而不是显示一个「已沙箱化」的错误绿灯。
        isolation: {
          source: build.enforcedIsolation.source,
          memory: build.enforcedIsolation.memory,
          cpu: build.enforcedIsolation.cpu,
          network: build.enforcedIsolation.network,
          treeKill: build.enforcedIsolation.treeKill,
          reason: build.enforcedIsolation.reason,
        },
        note:
          this.mode === 'sandbox'
            ? '沙箱模式：产物留在沙箱目录，永不自动部署进正式服务端（§13.4）'
            : '产物已留在 build/libs；部署需另一次 deploy_plugin 确认（§10.6）',
        // step(2.5) 产物验证回报：ok=false 也不推翻构建成功，上层据此决定是否部署。
        validation,
      },
    };
  }

  private async deployPlugin(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    const artifactPath = optString(p, 'artifactPath') ?? optString(p, 'projectRef');
    if (artifactPath === undefined) verr('缺少参数 payload.artifactPath（插件 JAR 路径）');
    const hotReload = optBoolean(p, 'hotReload') ?? false;
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    if (!existsSync(artifactPath)) verr(`插件产物不存在: ${artifactPath}`, 'SOURCE_NOT_FOUND');
    if (!artifactPath.toLowerCase().endsWith('.jar')) {
      verr(`插件产物必须是 .jar: ${artifactPath}`, 'UNSUPPORTED_FORMAT');
    }
    const pluginsDir = this.guard(root, join(serverId, 'plugins'));
    if (!existsSync(pluginsDir))
      verr(`服务端缺少 plugins/ 目录: ${pluginsDir}`, 'PLUGINS_DIR_MISSING');

    const jarName = artifactPath.split(/[\\/]/).pop() as string;
    const dest = this.guard(root, join(serverId, 'plugins', jarName));
    const recordDir = this.guard(root, join(serverId, 'plugins', '.deployed'));
    const recordPath = join(recordDir, `${jarName}.json`);
    step(1);

    // 部署哈希账本：与上次部署对比（§0.5 产物哈希对外可见）。
    let previousSha256: string | undefined;
    if (existsSync(recordPath)) {
      try {
        const prev = JSON.parse(readFileSync(recordPath, 'utf8')) as { sha256?: unknown };
        if (typeof prev.sha256 === 'string') previousSha256 = prev.sha256;
      } catch {
        previousSha256 = undefined;
      }
    }

    const bytes = readFileSync(artifactPath);
    const sha256 = await sha256File(artifactPath);

    // 覆盖前先把线上版备份进 .deployed/，rollback_build 才有可回滚的上一版产物。
    if (existsSync(dest)) {
      const liveSha = await sha256File(dest);
      if (liveSha !== sha256) {
        await writeFileAtomic(
          join(recordDir, `${jarName}.${liveSha.slice(0, 12)}.jar`),
          readFileSync(dest),
        );
      }
    }
    await writeFileAtomic(dest, bytes);
    await writeFileAtomic(
      recordPath,
      `${JSON.stringify({ jar: jarName, sha256, previousSha256: previousSha256 ?? null, deployedAt: new Date().toISOString() }, null, 2)}\n`,
    );

    if (hotReload) {
      step(2);
      // §7.1：控制台 / RCON 命令注入属进程托管职责，由外壳在确认后发送；
      // 本内核只给建议命令，绝不自动执行。
      return {
        ok: true,
        artifacts: [await makeArtifactRef(dest, 'server-plugin')],
        data: {
          serverId,
          jarName,
          path: dest,
          sha256,
          previousSha256: previousSha256 ?? null,
          changed: previousSha256 !== sha256,
          hotReload,
          reloadCommand: '/reload confirm',
          note: '热重载命令未自动发送：RCON/控制台注入由外壳进程托管服务在确认后执行（§7.1）',
        },
      };
    }

    const artifact = await makeArtifactRef(dest, 'server-plugin');
    return {
      ok: true,
      artifacts: [artifact],
      data: {
        serverId,
        jarName,
        path: dest,
        sha256,
        previousSha256: previousSha256 ?? null,
        changed: previousSha256 !== sha256,
        hotReload,
      },
    };
  }

  private async controlServer(
    root: string,
    payload: unknown,
    action: 'restart_server' | 'stop_server',
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    const gracefulMs = optNumber(p, 'gracefulMs') ?? 30000;
    if (!Number.isFinite(gracefulMs) || gracefulMs < 0) {
      verr(`payload.gracefulMs 非法（需≥ 0）: ${gracefulMs}`);
    }
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    const propsPath = join(dir, 'server.properties');
    if (!existsSync(propsPath)) {
      verr(
        `服务端缺少 server.properties，无法确认其为合法服务端: ${propsPath}`,
        'SERVER_CONFIG_MISSING',
      );
    }
    if (action === 'restart_server') {
      step(1);
      step(2);
    } else {
      step(1);
    }
    // §7.1 本内核不托管长驻进程：只校验存在性并返回控制指令。
    return {
      ok: true,
      data: {
        action,
        serverId,
        gracefulMs,
        serverDir: dir,
        controlCommand: action === 'stop_server' ? 'stop' : 'restart',
        note: '进程生命周期由外壳服务管理，本内核仅校验服务端存在并返回控制指令',
      },
    };
  }

  private async rollbackBuild(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    const projectRef = optString(p, 'projectRef') ?? optString(p, 'jarName');
    if (projectRef === undefined) verr('缺少参数 payload.projectRef（插件 JAR 名）');
    const previousSha256 = optString(p, 'previousSha256');
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    const jarName = projectRef.split(/[\\/]/).pop() as string;
    const recordDir = this.guard(root, join(serverId, 'plugins', '.deployed'));
    const recordPath = join(recordDir, `${jarName}.json`);
    if (!existsSync(recordPath)) {
      verr(`无部署记录可回滚: ${jarName}（${recordPath} 不存在）`, 'NO_HISTORY');
    }
    let record: { sha256?: unknown; previousSha256?: unknown };
    try {
      record = JSON.parse(readFileSync(recordPath, 'utf8')) as typeof record;
    } catch (e) {
      verr(`部署记录解析失败: ${(e as Error).message}`, 'RECORD_INVALID');
    }
    const targetSha =
      previousSha256 ??
      (typeof record.previousSha256 === 'string' ? record.previousSha256 : undefined);
    if (targetSha === undefined || targetSha === null || targetSha === '') {
      verr(`无历史产物可回滚: ${jarName}（部署记录中没有上一版 sha256）`, 'NO_HISTORY');
    }
    const backupPath = join(recordDir, `${jarName}.${String(targetSha).slice(0, 12)}.jar`);
    if (!existsSync(backupPath)) {
      verr(`无历史产物可回滚: ${jarName}（备份文件缺失 ${backupPath}）`, 'NO_HISTORY');
    }
    step(1);
    // 回滚前先把当前版备份一份，保证回滚本身可逆。
    const dest = this.guard(root, join(serverId, 'plugins', jarName));
    if (existsSync(dest)) {
      const currentSha = await sha256File(dest);
      await writeFileAtomic(
        join(recordDir, `${jarName}.${currentSha.slice(0, 12)}.jar`),
        readFileSync(dest),
      );
    }
    const restoredBytes = readFileSync(backupPath);
    await writeFileAtomic(dest, restoredBytes);
    const restoredSha = await sha256File(dest);
    await writeFileAtomic(
      recordPath,
      `${JSON.stringify({ jar: jarName, sha256: restoredSha, previousSha256: targetSha, rolledBackAt: new Date().toISOString() }, null, 2)}\n`,
    );
    step(2);
    const artifact = await makeArtifactRef(dest, 'server-plugin');
    return {
      ok: true,
      artifacts: [artifact],
      data: {
        serverId,
        jarName,
        path: dest,
        sha256: restoredSha,
        restoredFrom: backupPath,
        previousSha256: targetSha,
        reloadCommand: '/reload confirm',
        note: '回滚已完成；热重载命令未自动发送（RCON 注入由外壳管理，§7.1）',
      },
    };
  }

  /* -------------------- §7.4 快照备份（定时快照中的“快照”一半） -------------------- */
  /* 快照内容：<serverDir> 下 world/（递归）+ 顶层 *.properties / *.yml / *.yaml。
   * 只取这两类 → logs/ 与 backups 自身天然排除。存放：<root>/backups/<serverId>/<ts>/。
   * sandbox 模式下 root 即 sandboxDir，快照读写全走沙箱（与既有 .deployed 备份
   * 同一套 root/guard 语义，§13.4）。 */

  /** 快照源相对路径：world/ 递归 + 顶层 *.properties / *.yml / *.yaml（已排序）。 */
  private collectSnapshotFiles(serverDirPath: string): string[] {
    const rels: string[] = [];
    const worldDir = join(serverDirPath, 'world');
    if (existsSync(worldDir)) {
      for (const rel of listFilesRecursive(worldDir, '')) rels.push(`world/${rel}`);
    }
    let entries: string[];
    try {
      entries = readdirSync(serverDirPath);
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      const full = join(serverDirPath, entry);
      let isFile = false;
      try {
        isFile = statSync(full).isFile();
      } catch {
        continue;
      }
      if (isFile && /\.(properties|ya?ml)$/i.test(entry)) rels.push(entry);
    }
    return rels.sort();
  }

  /** 快照 manifest 的 files 条目形状（与 manifest.json 落盘形状一致）。 */
  private async snapshotFileEntries(
    serverDirPath: string,
    rels: string[],
  ): Promise<{ path: string; sha256: string; size: number }[]> {
    const files: { path: string; sha256: string; size: number }[] = [];
    for (const rel of rels) {
      const src = join(serverDirPath, ...rel.split('/'));
      files.push({ path: rel, sha256: await sha256File(src), size: statSync(src).size });
    }
    return files;
  }

  private async backupServer(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    const rels = this.collectSnapshotFiles(dir);
    step(1);
    const createdAt = new Date().toISOString();
    const stamp = createdAt.replace(/[:.]/g, '-');
    const listRoot = this.guard(root, join('backups', serverId));
    // 同一毫秒连打两份快照时加 -N 后缀，保证目录名唯一且仍按字典序即时间序。
    let backupId = stamp;
    for (let n = 1; existsSync(join(listRoot, backupId)); n++) backupId = `${stamp}-${n}`;
    const destRoot = this.guard(root, join('backups', serverId, backupId));
    mkdirSync(destRoot, { recursive: true });
    const files = await this.snapshotFileEntries(dir, rels);
    for (const file of files) {
      const dest = this.guard(root, join('backups', serverId, backupId, ...file.path.split('/')));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(join(dir, ...file.path.split('/')), dest);
    }
    const body = { serverId, createdAt, files };
    const sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    await writeFileAtomic(
      this.guard(root, join('backups', serverId, backupId, 'manifest.json')),
      `${JSON.stringify({ ...body, sha256 }, null, 2)}\n`,
    );
    step(2);
    return {
      ok: true,
      data: { serverId, backupId, path: destRoot, createdAt, files, sha256 },
    };
  }

  private async listBackups(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    step(1);
    const listRoot = this.guard(root, join('backups', serverId));
    if (!existsSync(listRoot)) return { ok: true, data: { serverId, backups: [] } };
    const ids = readdirSync(listRoot)
      .sort()
      .filter((entry) => {
        try {
          return statSync(join(listRoot, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => compareBackupIds(listRoot, a, b));
    const backups: {
      backupId: string;
      path: string;
      createdAt?: string;
      files?: { path: string; sha256: string; size: number }[];
      sha256?: string;
    }[] = [];
    for (const entry of ids) {
      const full = join(listRoot, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      let manifest:
        | {
            createdAt?: unknown;
            files?: unknown;
            sha256?: unknown;
          }
        | undefined;
      try {
        manifest = JSON.parse(readFileSync(join(full, 'manifest.json'), 'utf8')) as typeof manifest;
      } catch {
        manifest = undefined;
      }
      backups.push({
        backupId: entry,
        path: full,
        ...(typeof manifest?.createdAt === 'string' ? { createdAt: manifest.createdAt } : {}),
        ...(Array.isArray(manifest?.files) ? { files: manifest.files } : {}),
        ...(typeof manifest?.sha256 === 'string' ? { sha256: manifest.sha256 } : {}),
      });
    }
    return { ok: true, data: { serverId, backups } };
  }

  private async restoreBackup(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    const backupId =
      optString(p, 'backupId') ?? optString(p, 'snapshotId') ?? optString(p, 'snapshot');
    if (backupId === undefined) verr('缺少参数 payload.backupId（快照名）');
    if (backupId.includes('..') || /[\\/]/.test(backupId)) {
      verr(`快照名非法（含路径穿越或分隔符）: ${backupId}`, 'PATH_TRAVERSAL');
    }
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    const snapRoot = this.guard(root, join('backups', serverId, backupId));
    const manifestPath = join(snapRoot, 'manifest.json');
    if (!existsSync(snapRoot) || !existsSync(manifestPath)) {
      verr(`快照不存在: ${serverId}/${backupId}`, 'BACKUP_NOT_FOUND');
    }
    let manifest: { files?: unknown };
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof manifest;
    } catch (e) {
      verr(`快照 manifest 解析失败: ${(e as Error).message}`, 'BACKUP_INVALID');
    }
    if (!Array.isArray(manifest.files))
      verr(`快照 manifest 缺 files 列表: ${manifestPath}`, 'BACKUP_INVALID');
    step(1);
    const restoredFiles: string[] = [];
    for (const entry of manifest.files) {
      const rel = (entry as { path?: unknown } | undefined)?.path;
      if (
        typeof rel !== 'string' ||
        rel === '' ||
        rel.startsWith('/') ||
        rel.includes('..') ||
        rel.includes('\\') ||
        /^[a-zA-Z]:/.test(rel)
      ) {
        verr(`快照 manifest 含非法路径: ${String(rel)}`, 'BACKUP_INVALID');
      }
      const src = this.guard(root, join('backups', serverId, backupId, ...rel.split('/')));
      if (!existsSync(src)) verr(`快照文件缺失: ${rel}`, 'BACKUP_INVALID');
      const dest = this.guard(root, join(serverId, ...rel.split('/')));
      mkdirSync(dirname(dest), { recursive: true });
      cpSync(src, dest);
      restoredFiles.push(rel);
    }
    return {
      ok: true,
      data: {
        serverId,
        backupId,
        restoredFiles,
        serverDir: dir,
        controlCommand: 'restart',
        note: '快照已拷回服务端目录，未自动重启：重启由外壳进程托管服务在确认后执行（§7.1 controlServer 惯例）',
      },
    };
  }

  private async pruneBackups(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const serverId = serverIdOf(payload);
    if (serverId === undefined) verr('缺少合法 serverId（payload.serverId）');
    const keepN = optNumber(p, 'keepN') ?? optNumber(p, 'keep') ?? 5;
    if (!Number.isInteger(keepN) || keepN < 0) {
      verr(`payload.keepN 非法（需≥ 0 整数）: ${String(keepN)}`);
    }
    step(0);
    const dir = this.serverDir(root, serverId);
    if (!existsSync(dir)) verr(`服务端不存在: ${serverId}（${dir}）`, 'SERVER_NOT_FOUND');
    step(1);
    const listRoot = this.guard(root, join('backups', serverId));
    if (!existsSync(listRoot)) {
      return { ok: true, data: { serverId, keepN, kept: [], pruned: [] } };
    }
    const ids = readdirSync(listRoot)
      .sort()
      .filter((entry) => {
        try {
          return statSync(join(listRoot, entry)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort((a, b) => compareBackupIds(listRoot, a, b));
    const pruned: string[] = [];
    while (ids.length > keepN) {
      const victim = ids.shift() as string;
      rmSync(this.guard(root, join('backups', serverId, victim)), { recursive: true });
      pruned.push(victim);
    }
    return { ok: true, data: { serverId, keepN, kept: ids, pruned } };
  }

  /** X 派发：确认闸门 + 真实现。 */
  private async executeWrite(
    taskId: string,
    kind: string,
    payload: unknown,
    bus: ProgressBus,
  ): Promise<TaskResult> {
    if (this.confirm === undefined) return permissionDenied(kind);
    let approved = false;
    try {
      approved = Boolean(
        await this.confirm({
          kind,
          payload,
          summary: confirmSummary(kind, payload),
          risk: riskOf(kind),
        }),
      );
    } catch {
      approved = false;
    }
    if (!approved) return permissionDenied(kind);

    const steps = STEP_DEFS[kind] ?? [];
    const total = Math.max(steps.length, 1);
    const step = (index: number, message?: string): void => {
      const def = steps[index];
      if (def === undefined) return;
      bus.push({
        taskId,
        progress: Math.min(1, (index + 1) / total),
        stage: def.stage,
        message: message ?? def.message,
      });
    };

    try {
      const root = this.writeRoot();
      switch (kind) {
        case 'create_instance':
          return await this.createInstance(root, payload, step);
        case 'delete_instance':
          return await this.deleteInstance(root, payload, step);
        case 'build_project':
          return await this.buildProject(root, payload, step);
        case 'deploy_plugin':
          return await this.deployPlugin(root, payload, step);
        case 'restart_server':
          return await this.controlServer(root, payload, 'restart_server', step);
        case 'stop_server':
          return await this.controlServer(root, payload, 'stop_server', step);
        case 'rollback_build':
          return await this.rollbackBuild(root, payload, step);
        case 'backup_server':
          return await this.backupServer(root, payload, step);
        case 'list_backups':
          return await this.listBackups(root, payload, step);
        case 'restore_backup':
          return await this.restoreBackup(root, payload, step);
        case 'prune_backups':
          return await this.pruneBackups(root, payload, step);
        default:
          verr(`不支持的任务: ${kind}`, 'UNKNOWN_KIND');
      }
    } catch (e) {
      if (e instanceof KernelTaskError) return { ok: false, error: e.classified };
      if (e instanceof ZipSafetyError) {
        return {
          ok: false,
          error: {
            category: 'validation',
            message: e.message,
            code: `ZIP_${e.code}`,
            retryable: false,
          },
        };
      }
      if (isClassifiedError(e)) return { ok: false, error: e };
      return { ok: false, error: toDiskError(e) };
    }
  }

  dispatch(task: TaskSpec): TaskHandle {
    // result() 内this 指向 handle 而非 kernel，此处提前捕获。
    const kernel = this;
    const id = task.id;
    const kind = task.kind;
    const payload = task.payload;
    const dataDir = this.dataDir;
    const capabilities = this.capabilities();

    const permLevel = MCP_TOOL_PERMISSIONS[kind] as 'R' | 'W' | 'X' | undefined;
    const isWriteOrExecute = permLevel === 'W' || permLevel === 'X';

    const bus = new ProgressBus();
    const steps = STEP_DEFS[kind] ?? [];
    if (isWriteOrExecute && steps[0] !== undefined) {
      const first = steps[0];
      bus.push({ taskId: id, progress: 0, stage: first.stage, message: first.message });
    }

    return {
      id,
      progress: bus.drain(),
      cancel(): void {
        bus.close();
      },
      async result(): Promise<TaskResult> {
        bus.markResultStarted();
        try {
          // §7.4 快照类：MCP_TOOL_PERMISSIONS 无 backup_* key（isWriteOrExecute
          // 为 false），此处按 W 级直走确认闸门；既有分支一行未改。
          if (BACKUP_WRITE_KINDS.has(kind)) {
            return await kernel.executeWrite(id, kind, payload, bus);
          }
          if (isWriteOrExecute) {
            return await kernel.executeWrite(id, kind, payload, bus);
          }

          switch (kind) {
            case 'get_capabilities':
              return { ok: true, data: { capabilities } };
            case 'read_logs': {
              const serverId = serverIdOf(payload);
              if (!serverId)
                return validation('缺少合法 serverId（payload.serverId），无法定位日志');
              if (!dataDir)
                return validation(`数据目录未配置，日志不可读: ${serverId}/logs/latest.log`);
              const file = join(dataDir, serverId, 'logs', 'latest.log');
              if (!existsSync(file)) return validation(`日志文件不存在: ${file}`);
              const tail = readFileSync(file, 'utf8').split('\n').slice(-200);
              return { ok: true, data: { serverId, file, tail } };
            }
            case 'read_config': {
              const serverId = serverIdOf(payload);
              if (!serverId)
                return validation('缺少合法 serverId（payload.serverId），无法定位配置');
              if (!dataDir)
                return validation(`数据目录未配置，配置不可读: ${serverId}/server.properties`);
              const file = join(dataDir, serverId, 'server.properties');
              if (!existsSync(file)) return validation(`配置文件不存在: ${file}`);
              const text = readFileSync(file, 'utf8');
              return { ok: true, data: { serverId, file, text } };
            }
            case 'get_context_pack': {
              const serverId = serverIdOf(payload);
              if (serverId === undefined) {
                return validation(
                  '缺少合法 serverId（payload.serverId），无法定位状态注入目标（§10.4）',
                );
              }
              const root = dataDir;
              if (root === undefined || root === '') {
                return validation(`数据目录未配置，状态注入不可读: ${serverId}（§10.4）`);
              }
              const dir = kernel.serverDir(root, serverId);
              if (!existsSync(dir)) {
                return validation(`服务端不存在: ${serverId}（${dir}）`);
              }
              return { ok: true, data: kernel.readContextParts(root, serverId) };
            }
            default:
              return {
                ok: false,
                error: { category: 'unknown', message: `不支持的任务: ${kind}`, retryable: false },
              };
          }
        } catch (e) {
          if (e instanceof KernelTaskError) return { ok: false, error: e.classified };
          return { ok: false, error: toDiskError(e) };
        } finally {
          bus.close();
        }
      },
    };
  }
}
