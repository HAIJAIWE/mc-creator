/**
 * Java 内核（客户端实例，§5）· KernelContract 实现。
 *
 * 职责：文件系统管理者 + 进程启动器（版本/运行时、实例、模组、整合包、
 * 资源包/光影、数据包、账户/皮肤）。
 * 外壳永不 import 本文件，只依赖 @mc-creator/contract（§2.2）；
 * Java 必装，其余内核可选（§2.2）。
 *
 * dispatch 只读任务（设计 §10.2 读现状类是闭环必需、§10.6 只读免确认，
 * 纯 node: 内置实现）：
 * - get_capabilities：data 透传 capabilities() 能力表（MCP 强制第一步，
 *   §10.2）。
 * - list_instances：data 透传 { instances: string[] }（<root>/instances/
 *   子目录名，排序后；未传根目录或目录不存在时为空数组，不报错）。
 * - get_context_pack：§10.4 状态注入。读实例 instance.json 取运行时版本/加载器，
 *   扫 mods/ 目录取已装模组，data 透传 { target, parts }；**只给事实不做预算截断**
 *   （截断与文案拼装归 agent 层 buildContextPack，内核不依赖 agent）。
 *
 * dispatch 执行类任务（§10.2 执行类须弹窗确认、§10.6 权限分级）：
 * launch_instance / create_instance / delete_instance / install_mod /
 * install_modpack / install_addon / import_package / apply_skin /
 * uninstall_content 均为 W/X 级，走「确认闸门 + 真实现」两级：
 * 1. 先构造 ConfirmRequest（中文一行 summary + risk 标记）交 ctx.confirm；
 * 2. ctx.confirm 缺失或返回 falsy → 保持既有 permission 拒绝 + confirmRequired:true，
 *    **不执行任何副作用**（不传 confirm 即永远拒绝，与 MCP stdio 通道一致）；
 * 3. 返回 true → 真正执行副作用，且每个副作用都在 progress 流里 yield 进度。
 * 其余安全约束：
 * - 落盘前一律 assertWithinRoot(root, target) 越界防护（§8.3 沙箱 jail）；
 * - mode='sandbox' 时产物只写 sandboxDir，永不自动部署进正式实例（§13.4）；
 * - 解压前 assertSafeEntries + checkZipLimits（§13.1 zip-slip / 压缩炸弹）；
 * - 下载先过 networkAllowlist 白名单（§10.6 网络出站），再走 engine.downloadFile；
 * - 产物一律 makeArtifactRef（§0.5 产物哈希对外可见）；
 * - install_modpack 走 §5.4 增量更新：目标文件已是计划期望内容（流式 sha512 一致）
 *   则跳过下载只登记产物，无 sha512（CurseForge 未回填哈希）时仍下载（见
 *   content/modpack/incremental.ts 的判定口径）；
 * - launch_instance **只生成命令不 spawn**（§13.4 沙箱内生成的代码永不自动加载）。
 * - 未知 kind：ok:false + unknown 分类（保留 stub 语义）。
 */

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
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
import {
  assertSafeEntries,
  checkZipLimits,
  isSymlinkUnixMode,
  writeFileAtomic,
  ZipSafetyError,
  type ZipEntryLike,
} from '@mc-creator/shell';
import { assertWithinRoot, javaVersionFor, makeArtifactRef } from '@mc-creator/devkit';
import { downloadFile, fetchVersionManifest } from '@mc-creator/engine';
import { MC_VERSIONS } from '@mc-creator/shared';
import { checkLocalFile, sameDigest, type DownloadReason } from './content/modpack/incremental.js';
import {
  checkShaderSetup,
  hasBlockingShaderIssue,
  summarizeShaderSetup,
} from './content/shader/shader-compat.js';

/** 内核构造上下文。 */
export interface KernelContext {
  /** 数据根目录；不传则只读任务返回空结果，W/X 任务返回 validation，不报错。 */
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

/** 裸异常统一转 ClassifiedError：内核永不向外抛裸异常。 */
function toDiskError(e: unknown): ClassifiedError {
  const message = e instanceof Error ? e.message : String(e);
  return { category: 'disk', message: `文件系统访问失败: ${message}`, retryable: false };
}

/** 已分类错误形状判定（engine 下载层抛的就是这个形状，直接透传）。 */
function isClassifiedError(e: unknown): e is ClassifiedError {
  return (
    typeof e === 'object' &&
    e !== null &&
    'category' in e &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  );
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

/* ------------------------------------------------------------------ *
 * payload 解析（全部走 unknown 收窄，缺失即 validation）
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

/**
 * exactOptionalPropertyTypes 下构造「可选字段存在则带上」的对象。
 * 直接 `cond ? {} : {k: v}` 无法收窄 v 为 string，故此处统一走此helper。
 */
function withString<T extends object, K extends string>(
  target: T,
  key: K,
  value: string | undefined,
): T & Record<K, string> {
  return (value === undefined ? target : { ...target, [key]: value }) as T & Record<K, string>;
}

/** 单段标识符：不含路径分隔符、不含 `..`、不含盘符（路径穿越 / 层级逃逸防护）。 */
function assertSingleSegment(value: string, label: string): string {
  if (value.includes('..')) verr(`${label} 非法（含 .. 路径穿越）: ${value}`, 'PATH_TRAVERSAL');
  if (/[\\/]/.test(value)) verr(`${label} 非法（含路径分隔符）: ${value}`, 'PATH_TRAVERSAL');
  if (/^[a-zA-Z]:/.test(value)) verr(`${label} 非法（含盘符）: ${value}`, 'PATH_TRAVERSAL');
  if (value.includes('\0')) verr(`${label} 非法（含 NUL 字节）`, 'PATH_TRAVERSAL');
  return value;
}

function safeFileName(name: string, label: string): string {
  const value = name.trim();
  if (value === '') verr(`${label} 为空`, 'INVALID_NAME');
  if (value === '.' || value === '..') verr(`${label} 非法: ${value}`, 'INVALID_NAME');
  assertSingleSegment(value, label);
  return value;
}

/** basename（跨平台分隔符）。 */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

/**
 * 从 url 推导落盘文件名。
 *
 * 为什么不能直接 baseName(url)：签名直链普遍带 query
 * （CDN `?token=` / S3 `?X-Amz-Signature=` / CurseForge `?curseforgeFile=`），
 * 直接切分会把 `mod.jar?token=abc` 整个当文件名 —— Windows 上 `?` 是非法
 * 文件名字符，downloadFile 打开 `.part` 时直接 ENOENT，且被误归类成 network
 * 错误而白白重试。故先取 URL 的 pathname（已不含 query/hash），再解码，
 * 并对空/非法结果回退到调用方给的 fileName 或固定名。
 */
function fileNameFromUrl(url: string, fallback: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return fallback;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  const name = baseName(decoded).trim();
  // 空（url 以 / 结尾）或解码后只剩非法字符时都不采用，回退。
  if (name === '' || name === '.' || name === '..') return fallback;
  return name;
}

/* ------------------------------------------------------------------ *
 * 最小 zip 读取器（central directory + stored/deflate，零第三方依赖）
 * 解压前必须先过 shell.assertSafeEntries + checkZipLimits（§13.1）。
 * ------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

interface RawZipEntry extends ZipEntryLike {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  isDirectory: boolean;
  isSymlink: boolean;
  localHeaderOffset: number;
}

/** zip 读失败（结构损坏 / 不支持的压缩方法）→ validation。 */
function zipFail(message: string): never {
  verr(message, 'ZIP_INVALID');
}

function findEocd(buf: Buffer): number {
  const floor = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

function readZipDirectory(buf: Buffer): RawZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) zipFail('压缩包结构损坏：未找到 EOCD 记录');
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const entries: RawZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== CEN_SIG) {
      zipFail('压缩包中央目录损坏');
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const externalAttrs = buf.readUInt32LE(offset + 38);
    const localHeaderOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    const unixMode = (externalAttrs >>> 16) & 0xffff;
    entries.push({
      name,
      size,
      compressedSize,
      method,
      isDirectory: name.endsWith('/'),
      isSymlink: isSymlinkUnixMode(unixMode),
      localHeaderOffset,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryData(buf: Buffer, entry: RawZipEntry): Buffer {
  const offset = entry.localHeaderOffset;
  if (offset + 30 > buf.length || buf.readUInt32LE(offset) !== LOC_SIG) {
    zipFail('压缩包本地文件头损坏');
  }
  const nameLen = buf.readUInt16LE(offset + 26);
  const extraLen = buf.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw);
  zipFail(`不支持的压缩方法 ${entry.method}（仅支持 store/deflate）`);
}

/* ------------------------------------------------------------------ *
 * 进度总线：progress 消费流与 result() 执行流共享同一条事件队列。
 * - result() 未被调用时，progress 排空初始事件即结束（不挂起）；
 * - result() 被调用后，事件实时推入，result() 结束即关闭。
 * ------------------------------------------------------------------ */

class ProgressBus {
  private readonly queue: ProgressEvent[] = [];
  private waiters: Array<() => void> = [];
  private resultStarted = false;
  private resultFinished = false;

  push(event: ProgressEvent): void {
    // 去重：dispatch 时预置的「第一步」与执行器step(0) 的 stage+message 完全相同，
    // 不去重会对外重复上报同一阶段（stage 名对外稳定，见 STEP_DEFS）。
    const last = this.queue[this.queue.length - 1];
    if (last !== undefined && last.stage === event.stage && last.message === event.message) {
      // 仅更新进度数值，不新增事件。
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
  launch_instance: [
    { stage: 'starting', message: '准备启动参数' },
    { stage: 'spawned', message: '沙箱模式不执行 spawn（§13.4）' },
    { stage: 'running', message: '启动命令已就绪，交外壳 process-supervisor 在确认后执行' },
  ],
  create_instance: [
    { stage: 'validating', message: '校验参数与重名' },
    { stage: 'writing', message: '创建目录结构与 instance.json' },
  ],
  delete_instance: [
    { stage: 'validating', message: '校验实例存在性' },
    { stage: 'deleting', message: '删除实例目录' },
  ],
  install_mod: [
    { stage: 'validating', message: '校验实例与模组路径' },
    { stage: 'downloading', message: '下载/复制模组到 mods/' },
    { stage: 'verifying', message: '校验 SHA256 并原子写入' },
  ],
  install_modpack: [
    { stage: 'parsing', message: '解析 mrpack/CF manifest' },
    { stage: 'downloading', message: '并发下载 mods 文件' },
    { stage: 'overrides', message: '应用 overrides 覆盖层' },
    { stage: 'server-overrides', message: '分发 server-overrides' },
    { stage: 'complete', message: '整合包安装完成' },
  ],
  install_addon: [
    { stage: 'validating', message: '校验实例与 addon 路径' },
    { stage: 'writing', message: '存放到 behavior_packs/resource_packs' },
  ],
  import_package: [
    { stage: 'validating', message: '校验 zip 安全性' },
    { stage: 'extracting', message: '解压到实例 overrides/' },
    { stage: 'complete', message: '包导入完成' },
  ],
  apply_skin: [
    { stage: 'validating', message: '校验实例与皮肤文件' },
    { stage: 'writing', message: '复制到实例皮肤目录' },
  ],
  uninstall_content: [
    { stage: 'validating', message: '校验实例与内容标识' },
    { stage: 'deleting', message: '从对应目录删除' },
  ],
};

/** 汇总一行中文摘要（§10.2 弹窗确认要求可读的影响面）。 */
function confirmSummary(kind: string, payload: unknown): string {
  const p = asRecord(payload);
  const id =
    optString(p, 'instanceId') ?? optString(p, 'name') ?? optString(p, 'serverId') ?? '未命名';
  switch (kind) {
    case 'create_instance':
      return `创建 Java 实例「${id}」并写入 mods/resourcepacks/config 等目录与 instance.json`;
    case 'delete_instance':
      return `删除 Java 实例「${id}」的整个实例目录（不可逆）`;
    case 'install_mod':
      return `向实例「${id}」的 mods/ 写入模组文件`;
    case 'install_modpack':
      return `向实例「${id}」批量安装整合包（下载 mods + 解包 overrides）`;
    case 'install_addon':
      return `把 addon 包存入实例「${id}」的 packs 目录（仅存放不导入，§5）`;
    case 'import_package':
      return `把 zip 包解压进实例「${id}」的 overrides/ 目录`;
    case 'apply_skin':
      return `把皮肤 PNG 写入皮肤库「${optString(p, 'name') ?? id}」`;
    case 'uninstall_content':
      return `从实例「${id}」删除 ${optString(p, 'kind') ?? '内容'}「${optString(p, 'identifier') ?? ''}」`;
    case 'launch_instance':
      return `生成实例「${id}」的 Java 启动命令（沙箱模式不执行 spawn，§13.4）`;
    default:
      return `执行 ${kind}（写入或改动用户目标）`;
  }
}

/** concurrency-limited runner（整合包并发下载，上限 4）。 */
async function runWithLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      if (item !== undefined) await fn(item, index);
    }
  });
  await Promise.all(workers);
}

/* ------------------------------------------------------------------ *
 * 实例几何与越界防护
 * ------------------------------------------------------------------ */

interface InstanceJson {
  name: string;
  edition: 'java';
  versionId: string;
  loader: string;
  javaPath: string;
  requiredJavaMajor: number;
  createdAt: string;
}

const OFFLINE_UUID_NAMESPACE = '6ba7b8109dad11d180b400c04fd430c8';

/**
 * §10.4 状态注入的事实形状（与 agent/context-pack.ts 的 ContextTarget/ContextParts
 * 结构兼容）。刻意在此**重新声明**而非从 agent import：§2.2 分层规定外壳/agent
 * 依赖内核，内核绝不反向依赖 agent —— 这里是结构兼容的契约形状，不是类型共享。
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

function offlineUuid(name: string): string {
  const digest = createHash('md5').update(`${OFFLINE_UUID_NAMESPACE}${name}`).digest();
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x30;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class JavaKernel implements KernelContract {
  readonly edition = 'java' as const;
  private readonly dataDir: string | undefined;
  private readonly confirm: ((req: ConfirmRequest) => Promise<boolean> | boolean) | undefined;
  private readonly mode: 'sandbox' | 'live';
  private readonly sandboxDir: string | undefined;
  private readonly networkAllowlist: readonly string[];

  constructor(ctx: KernelContext = {}) {
    this.dataDir = ctx.dataDir;
    this.confirm = ctx.confirm;
    this.mode = ctx.mode ?? 'live';
    this.sandboxDir = ctx.sandboxDir;
    this.networkAllowlist = ctx.networkAllowlist ?? [];
  }

  capabilities(): EditionCapability[] {
    return capabilitiesFor('java');
  }

  status(): StatusSnapshot {
    return { edition: this.edition, healthy: true, updatedAt: new Date().toISOString() };
  }

  /**
   * 写入根目录：sandbox 模式取 sandboxDir（§13.4 产物永不自动进正式环境），
   * 否则取 dataDir。两者都没有 → validation（不抛裸异常）。
   */
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

  /** 读根目录（只读任务允许缺失）。 */
  private readRoot(): string | undefined {
    return this.mode === 'sandbox' ? this.sandboxDir : this.dataDir;
  }

  /** 越界防护：所有落盘目标必须落在 root 内（§8.3 cwd jail / §13.1 zip-slip 落位）。 */
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

  private instancesDir(root: string): string {
    return this.guard(root, join('instances'));
  }

  /**
   * §10.4 状态注入：读实例现状，产出 { target, parts } 供 agent 层拼装上下文包。
   *
   * 内核只负责**事实**：运行时版本号（instance.json，运行时拉取，不臆造）、
   * 已装模组文件名（mods/ 目录扫描）。刻意不读 mods 文件内容、不做预算截断
   * —— 那是 agent/context-pack.ts buildContextPack 的职责（分层：内核不依赖 agent）。
   * 任一子源读不到就退化为空数组，不让状态注入因局部缺失而整体失败。
   */
  private readContextParts(root: string, instanceId: string): ContextState {
    const dir = this.instanceDir(root, instanceId);
    const target: ContextTarget = { edition: 'java', instanceId };

    const metaPath = join(dir, 'instance.json');
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Partial<InstanceJson>;
        if (typeof meta.versionId === 'string' && meta.versionId !== '')
          target.mcVersion = meta.versionId;
        if (typeof meta.loader === 'string' && meta.loader !== '') target.runtime = meta.loader;
      } catch {
        // instance.json 损坏不阻断状态注入：版本/加载器缺失只是精度下降。
      }
    }

    const modsDir = join(dir, 'mods');
    let mods: string[] = [];
    if (existsSync(modsDir)) {
      try {
        mods = readdirSync(modsDir)
          .filter((f) => f.toLowerCase().endsWith('.jar'))
          .sort();
      } catch {
        mods = [];
      }
    }
    return { target, parts: { mods } };
  }

  private instanceDir(root: string, instanceId: string): string {
    const safe = assertSingleSegment(instanceId, 'instanceId');
    return this.guard(root, join('instances', safe));
  }

  /** 网络出站白名单校验（§10.6）：未配置白名单 = 禁止所有出站。 */
  private assertUrlAllowed(url: string): void {
    let host: string;
    try {
      host = new URL(url).hostname.toLowerCase();
    } catch {
      throw cerr('validation', `下载 URL 非法: ${url}`, 'URL_INVALID');
    }
    if (host === '') throw cerr('validation', `下载 URL 缺少主机名: ${url}`, 'URL_INVALID');
    if (this.networkAllowlist.length === 0) {
      throw cerr(
        'permission',
        `网络出站被拒（§10.6 未配置 networkAllowlist，默认禁止所有出站）: ${host}`,
        'NETWORK_DENIED',
      );
    }
    const allowed = this.networkAllowlist.some((entry) => {
      const domain = entry.trim().toLowerCase();
      if (domain === '') return false;
      // IP 字面量只走全等：后缀匹配是给域名准备的子域语义，
      // 而 `'127.0.0.1'.endsWith('.0.0.1')` 为真会让 '0.0.1'/'0.1'/'1' 这类
      // 标签碎片意外放行本机 IP（§10.6 白名单必须是精确授权，不是字符串巧合）。
      if (isIP(host) !== 0) return host === domain;
      return host === domain || host.endsWith(`.${domain}`);
    });
    if (!allowed) {
      throw cerr(
        'permission',
        `域名不在网络出站白名单内（§10.6）: ${host}（白名单: ${this.networkAllowlist.join(', ')}）`,
        'NETWORK_DENIED',
      );
    }
  }

  /* -------------------- W/X 真实现 -------------------- */

  private async createInstance(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const name = safeFileName(reqString(p, 'name', '实例名'), '实例名');
    const versionId = optString(p, 'versionId') ?? 'unknown';
    const loader = optString(p, 'loader') ?? 'vanilla';
    const javaPath = optString(p, 'javaPath') ?? 'java';
    step(0);
    const dir = this.instanceDir(root, name);
    if (existsSync(dir)) {
      verr(`实例已存在: ${name}（${dir}）`, 'INSTANCE_EXISTS');
    }
    step(1);
    const meta: InstanceJson = {
      name,
      edition: 'java',
      versionId,
      loader,
      javaPath,
      requiredJavaMajor: javaVersionFor(versionId),
      createdAt: new Date().toISOString(),
    };
    for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves']) {
      const dirPath = this.guard(root, join('instances', name, sub));
      // mkdir 由 writeFileAtomic / 显式 mkdir 承担；此处用 writeFileAtomic 建占位以复用 §14 原子写。
      await writeFileAtomic(join(dirPath, '.gitkeep'), '');
    }
    const metaPath = this.guard(root, join('instances', name, 'instance.json'));
    await writeFileAtomic(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    const artifact = await makeArtifactRef(metaPath, 'instance');
    return {
      ok: true,
      artifacts: [artifact],
      data: {
        instanceId: name,
        dir,
        name,
        versionId,
        loader,
        javaPath,
        requiredJavaMajor: meta.requiredJavaMajor,
        mode: this.mode,
      },
    };
  }

  private async deleteInstance(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'name') ?? optString(p, 'id');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    step(1);
    rmSync(dir, { recursive: true });
    return { ok: true, data: { deleted: true, instanceId, path: dir } };
  }

  private async installMod(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    const mod = asRecord(p['mod']);
    const url = optString(mod, 'url');
    const localPath = optString(mod, 'path');
    if (url === undefined && localPath === undefined) {
      verr('payload.mod 至少需要 path（本地文件）或 url（下载地址）之一');
    }
    // 显式 fileName 优先；否则 url 走 pathname 推导（剥掉 query，见 fileNameFromUrl），
    // 本地路径才直接切分隔符。
    const explicitName = optString(mod, 'fileName');
    const derived =
      explicitName ??
      (url !== undefined && localPath === undefined
        ? fileNameFromUrl(url, 'download.bin')
        : baseName(localPath ?? url ?? ''));
    const fileName = safeFileName(derived, '模组文件名');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    const dest = this.guard(root, join('instances', instanceId, 'mods', fileName));
    step(1);
    if (url !== undefined) {
      this.assertUrlAllowed(url);
      // engine.downloadFile 自带断点续传 / 超时重试 / sha256+sha512 校验 / 原子落盘。
      await downloadFile(
        url,
        dest,
        withString(
          withString({}, 'sha256', optString(mod, 'sha256')),
          'sha512',
          optString(mod, 'sha512'),
        ),
      );
    } else {
      // localPath 已由上面的联合判定收窄为 string。
      const source = localPath as string;
      if (!existsSync(source)) verr(`本地模组文件不存在: ${source}`, 'SOURCE_NOT_FOUND');
      const bytes = readFileSync(source);
      const expect = optString(mod, 'sha256');
      if (expect !== undefined) {
        const actual = createHash('sha256').update(bytes).digest('hex');
        if (actual.toLowerCase() !== expect.toLowerCase()) {
          verr(`sha256 校验失败（期望 ${expect}，实际 ${actual}）: ${source}`, 'HASH_MISMATCH');
        }
      }
      await writeFileAtomic(dest, bytes);
    }
    step(2);
    const artifact = await makeArtifactRef(dest, 'mod');
    return {
      ok: true,
      artifacts: [artifact],
      data: { instanceId, fileName, path: dest, source: url !== undefined ? 'url' : 'local' },
    };
  }

  private async installModpack(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    const modpack = asRecord(p['modpack']);
    const source = optString(modpack, 'source') ?? 'modrinth';
    if (source !== 'modrinth' && source !== 'curseforge') {
      verr(`payload.modpack.source 仅支持 modrinth / curseforge，收到: ${source}`);
    }
    const packPath = optString(modpack, 'path');
    if (packPath === undefined) verr('缺少参数 payload.modpack.path（整合包 zip 路径）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    if (!existsSync(packPath)) verr(`整合包文件不存在: ${packPath}`, 'SOURCE_NOT_FOUND');

    const zipBuf = readFileSync(packPath);
    const entries = readZipDirectory(zipBuf);
    const safeNames = assertSafeEntries(entries);
    const limits = checkZipLimits(entries, {
      maxEntries: 10000,
      maxTotalSize: 2 * 1024 * 1024 * 1024,
      maxRatio: 100,
    });

    const indexName = source === 'modrinth' ? 'modrinth.index.json' : 'manifest.json';
    const indexEntryIndex = entries.findIndex((e) => e.name === indexName);
    if (indexEntryIndex < 0) {
      verr(`整合包缺少 ${indexName}（source=${source}）: ${packPath}`, 'PACK_INDEX_MISSING');
    }
    const indexEntry = entries[indexEntryIndex];
    if (indexEntry === undefined) zipFail('整合包索引条目丢失');
    let index: Record<string, unknown>;
    try {
      index = JSON.parse(readZipEntryData(zipBuf, indexEntry).toString('utf8')) as Record<
        string,
        unknown
      >;
    } catch (e) {
      if (isClassifiedError(e)) throw e;
      throw cerr(
        'validation',
        `${indexName} 解析失败: ${(e as Error).message}`,
        'PACK_INDEX_INVALID',
      );
    }

    // 期望哈希一律 sha512（§13.3 供应链）：mrpack 原生给 sha512，CF 由上层解析时回填。
    type FilePlan = { path: string; urls: string[]; sha512: string | undefined };
    const plans: FilePlan[] = [];
    if (source === 'modrinth') {
      const files = Array.isArray(index['files']) ? (index['files'] as unknown[]) : [];
      files.forEach((raw, i) => {
        const f = asRecord(raw);
        const rel = typeof f['path'] === 'string' ? (f['path'] as string) : '';
        const downloads = Array.isArray(f['downloads'])
          ? (f['downloads'] as unknown[]).filter((d): d is string => typeof d === 'string')
          : [];
        const hashes = asRecord(f['hashes']);
        if (rel === '' || downloads.length === 0) {
          verr(`modrinth.index.json files[${i}] 缺少 path 或 downloads`, 'PACK_INDEX_INVALID');
        }
        plans.push({
          path: rel,
          urls: downloads,
          sha512: typeof hashes['sha512'] === 'string' ? hashes['sha512'] : undefined,
        });
      });
    } else {
      // CurseForge manifest 只含 projectID/fileID，直链需上层 API 解析后回填 files。
      const resolved = Array.isArray(p['files']) ? (p['files'] as unknown[]) : null;
      const files = Array.isArray(index['files']) ? (index['files'] as unknown[]) : [];
      if (files.length > 0 && resolved === null) {
        verr(
          'CurseForge manifest 只含 projectID/fileID，需上层先经 CurseForge API 解析直链并回填 payload.files（§5.3）',
          'PACK_NEEDS_URL_RESOLUTION',
        );
      }
      files.forEach((_raw, i) => {
        const provided = asRecord(resolved?.[i]);
        const rel = optString(provided, 'path') ?? optString(provided, 'fileName');
        const urls = Array.isArray(provided['downloads'])
          ? (provided['downloads'] as unknown[]).filter((d): d is string => typeof d === 'string')
          : [];
        if (rel === undefined || urls.length === 0) {
          verr(`payload.files[${i}] 缺少 path 或 downloads（直链未解析）`, 'PACK_INDEX_INVALID');
        }
        plans.push({ path: rel, urls, sha512: optString(provided, 'sha512') });
      });
    }

    // §5.4 增量更新：先把 plans 折叠成「每个目标路径一个安装单元」。
    // 去重的理由不只是省下载 —— 同一目标被两个并发 worker 同时写会互相踩
    // dest.part（断点续传临时文件），先去重就从根上消掉这个竞争。
    type InstallUnit = { dest: string; url: string; sha512: string | undefined };
    const units: InstallUnit[] = [];
    const seenUnit = new Map<string, InstallUnit>();
    plans.forEach((plan) => {
      const rel = plan.path.replace(/^[./]+/, '');
      if (rel.startsWith('overrides/') || rel.startsWith('server-overrides/')) {
        // 覆盖层文件走下面的 overrides 解包，不重复下载。
        return;
      }
      const dest = this.guard(root, join('instances', instanceId, rel));
      const seen = seenUnit.get(dest);
      if (seen !== undefined) {
        // 同一路径两条计划：sha512 一致 → 就是同一份文件，只装一次（大小写不敏感）。
        // 两条都声明 sha512 却不同 → 无法判定该落哪一份，直接拒绝而不是猜。
        if (seen.sha512 !== undefined && plan.sha512 !== undefined) {
          if (!sameDigest(seen.sha512, plan.sha512)) {
            verr(
              `整合包内 ${rel} 出现两条 sha512 不同的计划（${seen.sha512} / ${plan.sha512}），无法判定应落哪一份`,
              'PACK_PLAN_CONFLICT',
            );
          }
        } else if (plan.sha512 !== undefined) {
          // 首条没给哈希、后条给了：补上，让增量判定能用上更强的信号。
          seen.sha512 = plan.sha512;
        }
        return;
      }
      const unit: InstallUnit = { dest, url: plan.urls[0] as string, sha512: plan.sha512 };
      seenUnit.set(dest, unit);
      units.push(unit);
    });

    step(1);
    const refs: Array<ArtifactRef | undefined> = new Array<ArtifactRef | undefined>(units.length);
    const skipped = { count: 0 };
    const downloaded = { count: 0 };
    // 按原因计数：排障时能立刻分清「用户改了文件」/「包没给哈希」/「本地读不出来」。
    const reasons = new Map<DownloadReason, number>();
    await runWithLimit(units, 4, async (unit, index) => {
      this.assertUrlAllowed(unit.url);
      // 增量判定：目标已存在且 sha512 与计划一致 → 一个字节都不下载（§5.4）。
      const verdict = await checkLocalFile(unit.dest, unit.sha512);
      if (verdict.kind === 'unchanged') {
        // sha512 相同意味着本地文件与「下载后应有的那份」逐字节一致，跳过是安全的；
        // 产物引用照常产出（复用同一次读取算出的 sha256），不产生空洞。
        skipped.count++;
        refs[index] = { path: unit.dest, sha256: verdict.sha256, kind: 'mod' };
        return;
      }
      // 目标不存在 / 内容不同 / 计划无 sha512（CurseForge 常见）：下载并覆盖。
      // 无 sha512 时 withString 不带该键 → engine 不做哈希校验（保持原行为）。
      reasons.set(verdict.reason, (reasons.get(verdict.reason) ?? 0) + 1);
      await downloadFile(unit.url, unit.dest, withString({}, 'sha512', unit.sha512));
      downloaded.count++;
      refs[index] = await makeArtifactRef(unit.dest, 'mod');
    });
    const artifacts = refs.filter((r): r is ArtifactRef => r !== undefined);

    const extractPrefix = (prefix: string, destSub: string): Promise<number> => {
      let count = 0;
      return (async () => {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const safeName = safeNames[i];
          if (entry === undefined || safeName === undefined) continue;
          if (!safeName.startsWith(`${prefix}/`)) continue;
          const rel = safeName.slice(prefix.length + 1);
          if (rel === '' || entry.isDirectory) continue;
          const dest = this.guard(root, join('instances', instanceId, destSub, rel));
          await writeFileAtomic(dest, readZipEntryData(zipBuf, entry));
          count++;
        }
        return count;
      })();
    };

    step(2);
    const overrideCount = await extractPrefix('overrides', 'overrides');
    step(3);
    const serverOverrideCount = await extractPrefix('server-overrides', 'server-overrides');
    step(4);

    return {
      ok: true,
      artifacts,
      data: {
        instanceId,
        source,
        packPath,
        mods: artifacts.length,
        overrideFiles: overrideCount,
        serverOverrideFiles: serverOverrideCount,
        zipEntries: limits.count,
        zipTotalSize: limits.totalSize,
        mode: this.mode,
        // §5.4 增量更新的可观测口径：本次实际下了几个 / 跳过几个。
        // 全量重下时先看这里，能立刻区分「用户改了文件」与「包本身没给哈希」。
        downloaded: downloaded.count,
        skipped: skipped.count,
        downloadReasons: Object.fromEntries(reasons),
      },
    };
  }

  private async installAddon(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    const source = optString(p, 'path') ?? optString(p, 'source');
    if (source === undefined) verr('缺少参数 payload.path（.mcaddon / .mcpack 路径）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    if (!existsSync(source)) verr(`addon 包不存在: ${source}`, 'SOURCE_NOT_FOUND');
    const lower = source.toLowerCase();
    const isAddon = lower.endsWith('.mcaddon');
    const isPack = lower.endsWith('.mcpack');
    if (!isAddon && !isPack) {
      verr(`仅支持 .mcaddon / .mcpack，收到: ${source}`, 'UNSUPPORTED_FORMAT');
    }
    const fileName = safeFileName(baseName(source), 'addon 文件名');
    const bytes = readFileSync(source);
    step(1);
    // §5 Java 内核只存放不导入：.mcaddon 是行为+资源成对，落两个目录。
    const targets = isAddon ? ['behavior_packs', 'resource_packs'] : ['behavior_packs'];
    const artifacts: ArtifactRef[] = [];
    for (const target of targets) {
      const dest = this.guard(root, join('instances', instanceId, target, fileName));
      await writeFileAtomic(dest, bytes);
      artifacts.push(await makeArtifactRef(dest, 'addon'));
    }
    return {
      ok: true,
      artifacts,
      data: {
        instanceId,
        fileName,
        storedIn: targets,
        note: 'Java 内核仅存放 addon 包，不执行游戏内导入（§5 职责边界）',
        mode: this.mode,
      },
    };
  }

  private async importPackage(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    const source = optString(p, 'path');
    if (source === undefined) verr('缺少参数 payload.path（zip 包路径）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    if (!existsSync(source)) verr(`待导入包不存在: ${source}`, 'SOURCE_NOT_FOUND');

    const zipBuf = readFileSync(source);
    const entries = readZipDirectory(zipBuf);
    const safeNames = assertSafeEntries(entries);
    const limits = checkZipLimits(entries, {
      maxEntries: 10000,
      maxTotalSize: 2 * 1024 * 1024 * 1024,
      maxRatio: 100,
    });
    step(1);
    const artifacts: ArtifactRef[] = [];
    let files = 0;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const rel = safeNames[i];
      if (entry === undefined || rel === undefined || entry.isDirectory) continue;
      const dest = this.guard(root, join('instances', instanceId, 'overrides', rel));
      await writeFileAtomic(dest, readZipEntryData(zipBuf, entry));
      files++;
      if (files <= 50) artifacts.push(await makeArtifactRef(dest, 'mod'));
    }
    step(2);
    return {
      ok: true,
      artifacts,
      data: {
        instanceId,
        source,
        files,
        zipEntries: limits.count,
        zipTotalSize: limits.totalSize,
        artifactTruncated: files > artifacts.length,
        mode: this.mode,
      },
    };
  }

  private async applySkin(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const name = safeFileName(optString(p, 'name') ?? 'skin', '皮肤名');
    const source = optString(p, 'path');
    if (source === undefined) verr('缺少参数 payload.path（皮肤 PNG 路径）');
    step(0);
    if (!existsSync(source)) verr(`皮肤文件不存在: ${source}`, 'SOURCE_NOT_FOUND');
    const bytes = readFileSync(source);
    const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (bytes.length < 24 || !PNG_SIG.every((b, i) => bytes[i] === b)) {
      verr(`皮肤文件不是合法 PNG（PNG 头校验失败）: ${source}`, 'INVALID_PNG');
    }
    if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') {
      verr(`皮肤 PNG 缺少 IHDR 块: ${source}`, 'INVALID_PNG');
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width !== 64 || height !== 64) {
      verr(`皮肤尺寸必须为 64×64，实际 ${width}×${height}（§5.9）`, 'INVALID_SKIN_SIZE');
    }
    step(1);
    const dest = this.guard(root, join('skins', `${name}.png`));
    await writeFileAtomic(dest, bytes);
    const artifact = await makeArtifactRef(dest, 'skin');
    return { ok: true, artifacts: [artifact], data: { name, path: dest, width, height } };
  }

  private async uninstallContent(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    const contentKind = optString(p, 'kind') ?? 'mod';
    const identifier = optString(p, 'identifier');
    if (identifier === undefined) verr('缺少参数 payload.identifier（内容标识）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    if (!existsSync(dir)) verr(`实例不存在: ${instanceId}（${dir}）`, 'INSTANCE_NOT_FOUND');
    assertSingleSegment(identifier, 'identifier');

    const targets: string[] = [];
    if (contentKind === 'mod') {
      targets.push(this.guard(root, join('instances', instanceId, 'mods', identifier)));
    } else if (contentKind === 'resourcepack') {
      targets.push(this.guard(root, join('instances', instanceId, 'resourcepacks', identifier)));
    } else if (contentKind === 'shader') {
      targets.push(this.guard(root, join('instances', instanceId, 'shaderpacks', identifier)));
    } else if (contentKind === 'datapack') {
      const worldsRoot = this.guard(root, join('instances', instanceId, 'saves'));
      if (!existsSync(worldsRoot)) {
        verr(`实例没有 saves/ 世界目录，无法定位数据包: ${instanceId}`, 'WORLD_DIR_MISSING');
      }
      for (const world of readdirSync(worldsRoot, { withFileTypes: true })) {
        if (!world.isDirectory()) continue;
        targets.push(
          this.guard(
            root,
            join('instances', instanceId, 'saves', world.name, 'datapack', identifier),
          ),
        );
      }
      if (targets.length === 0) verr(`实例没有世界目录: ${instanceId}`, 'WORLD_DIR_MISSING');
    } else {
      verr(`payload.kind 仅支持 mod / resourcepack / shader / datapack，收到: ${contentKind}`);
    }

    const existing = targets.filter((t) => existsSync(t));
    if (existing.length === 0) {
      verr(`内容不存在: ${contentKind}/${identifier}（实例 ${instanceId}）`, 'CONTENT_NOT_FOUND');
    }
    step(1);
    for (const target of existing) rmSync(target, { recursive: true });

    // §5.6 光影：卸载后若仍有其它光影包，连同加载器组合一起复查。
    // 「装了光影包但没加载器」会让光影**静默不生效且无任何报错**，
    // 用户看不出原因 —— 故在改动光影内容后主动给结论，而不是等用户发现。
    let shaderSetup: { issues: unknown[]; blocking: boolean; summary: string } | undefined;
    if (contentKind === 'shader') {
      const dir = this.instanceDir(root, instanceId);
      const shaderDir = join(dir, 'shaderpacks');
      const remaining = existsSync(shaderDir)
        ? readdirSync(shaderDir).filter((n) => !n.startsWith('.'))
        : [];
      const modsDir = join(dir, 'mods');
      const installedMods = existsSync(modsDir)
        ? readdirSync(modsDir)
            .filter((n) => n.endsWith('.jar'))
            // mod id 取文件名主干（不含版本号与扩展名），小写比较。
            .map((n) => n.replace(/\.jar$/i, '').toLowerCase())
        : [];
      const issues = checkShaderSetup(
        remaining.map((n) => ({ name: n })),
        installedMods.map((id) => ({ id })),
      );
      shaderSetup = {
        issues,
        blocking: hasBlockingShaderIssue(issues),
        summary: summarizeShaderSetup(issues),
      };
    }

    return {
      ok: true,
      data: {
        instanceId,
        kind: contentKind,
        identifier,
        removed: existing.length,
        path: existing[0],
        ...(shaderSetup === undefined ? {} : { shaderSetup }),
      },
    };
  }

  private async launchInstance(
    root: string,
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
    if (instanceId === undefined) verr('缺少参数 payload.instanceId（实例标识）');
    step(0);
    const dir = this.instanceDir(root, instanceId);
    const metaPath = join(dir, 'instance.json');
    if (!existsSync(metaPath)) {
      verr(`实例 instance.json 缺失: ${metaPath}`, 'INSTANCE_META_MISSING');
    }
    let meta: InstanceJson;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as InstanceJson;
    } catch (e) {
      throw cerr(
        'validation',
        `instance.json 解析失败: ${(e as Error).message}`,
        'INSTANCE_META_INVALID',
      );
    }

    const cmd = optString(p, 'javaPath') ?? meta.javaPath ?? 'java';
    const natives = this.guard(root, join('instances', instanceId, 'natives'));
    const assetsDir = optString(p, 'assetsDir') ?? this.guard(root, join('assets'));
    const assetIndex = optString(p, 'assetIndex') ?? meta.versionId;
    const username = optString(p, 'username') ?? 'Player';
    const userType = optString(p, 'userType') ?? 'legacy';
    const uuid = optString(p, 'uuid') ?? offlineUuid(username);
    const accessToken = optString(p, 'accessToken') ?? '0';
    const classpathRaw = optStringArray(p, 'classpath');
    const classpath = (classpathRaw ?? [dir]).join(delimiter);
    const memoryMb = optNumber(p, 'memory') ?? 2048;
    const memoryRecord = asRecord(p['memory']);
    const xms = optString(memoryRecord, 'min') ?? `${Math.max(256, Math.floor(memoryMb / 2))}M`;
    const xmx = optString(memoryRecord, 'max') ?? `${memoryMb}M`;
    const extraJvmArgs = optStringArray(p, 'jvmArgs') ?? [];

    const args: string[] = [
      `-Xms${xms}`,
      `-Xmx${xmx}`,
      `-Djava.library.path=${natives}`,
      `-Dorg.lwjgl.librarypath=${natives}`,
      '-cp',
      classpath,
      'net.minecraft.client.main.Main',
      '--username',
      username,
      '--version',
      meta.versionId,
      '--gameDir',
      dir,
      '--assetsDir',
      assetsDir,
      '--assetIndex',
      assetIndex,
      '--uuid',
      uuid,
      '--accessToken',
      accessToken,
      '--userType',
      userType,
      '--versionType',
      'release',
      ...extraJvmArgs,
    ];

    step(1);
    step(2);
    // §13.4：沙箱模式永不自动 spawn。真实 spawn 归 desktop 层 process-supervisor
    // （apps/desktop/src/main/process-supervisor.ts），在用户二次确认后执行；
    // 本内核只返回命令供审计（spawn 一律数组参数，无 shell:true）。
    // 注意：desktop 下另有一个 **launcher-service.ts**，那是 PCL2/HMCL 客户端
    // 下载器（downloadClient / launchGame），与这里的进程托管不是同一件事，别混。
    return {
      ok: true,
      data: {
        cmd,
        args,
        instanceDir: dir,
        versionId: meta.versionId,
        loader: meta.loader,
        mode: this.mode,
        note: '沙箱模式仅生成启动命令，不执行 spawn（§13.4 生成的代码永不自动加载进正式环境）',
      },
    };
  }

  /** W/X 派发：确认闸门 + 真实现。 */
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
      // 确认通道自身异常按「未确认」处理：宁可拒绝，绝不静默执行（§10.6）。
      approved = false;
    }
    if (!approved) return permissionDenied(kind);

    const steps = STEP_DEFS[kind] ?? [];
    const total = Math.max(steps.length, 1);
    const step = (index: number, message?: string): void => {
      const def = steps[index];
      if (def === undefined) return;
      // message 恒定有值（默认取 stepDefs 文案），保证与 dispatch 预置的首条事件
      // stage+message 完全一致，可在 ProgressBus 内被正确去重。
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
        case 'install_mod':
          return await this.installMod(root, payload, step);
        case 'install_modpack':
          return await this.installModpack(root, payload, step);
        case 'install_addon':
          return await this.installAddon(root, payload, step);
        case 'import_package':
          return await this.importPackage(root, payload, step);
        case 'apply_skin':
          return await this.applySkin(root, payload, step);
        case 'uninstall_content':
          return await this.uninstallContent(root, payload, step);
        case 'launch_instance':
          return await this.launchInstance(root, payload, step);
        default:
          verr(`不支持的任务: ${kind}`, 'UNKNOWN_KIND');
      }
    } catch (e) {
      if (e instanceof KernelTaskError) return { ok: false, error: e.classified };
      if (e instanceof ZipSafetyError) {
        // §13.1 压缩包安全：zip-slip / 压缩炸弹 / 符号链接统一归 validation。
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
    const id = task.id;
    const kind = task.kind;
    const payload = task.payload;
    const capabilities = this.capabilities();
    // result() 是箭头函数，this 仍指向 kernel 实例 —— 无需把 this 存进局部变量
    // （存了反而触发 @typescript-eslint/no-this-alias）。
    const executeWrite = (
      writeId: string,
      writeKind: string,
      writePayload: unknown,
      bus: ProgressBus,
    ) => this.executeWrite(writeId, writeKind, writePayload, bus);
    const readRoot = () => this.readRoot();
    const instancesDir = (root: string) => this.instancesDir(root);
    const instanceDir = (root: string, instanceId: string) => this.instanceDir(root, instanceId);
    const readContextParts = (root: string, instanceId: string) =>
      this.readContextParts(root, instanceId);

    const permLevel = MCP_TOOL_PERMISSIONS[kind] as 'R' | 'W' | 'X' | undefined;
    const isWriteOrExecute = permLevel === 'W' || permLevel === 'X';

    const bus = new ProgressBus();
    const steps = STEP_DEFS[kind] ?? [];
    if (isWriteOrExecute && steps[0] !== undefined) {
      // 与既有语义一致：W/X 任务先 yield 第一步（尚未产生任何副作用）。
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
          if (isWriteOrExecute) {
            return await executeWrite(id, kind, payload, bus);
          }

          switch (kind) {
            case 'get_capabilities':
              return { ok: true, data: { capabilities } };
            case 'list_instances': {
              const root = readRoot();
              if (root === undefined || root === '') return { ok: true, data: { instances: [] } };
              const dir = instancesDir(root);
              if (!existsSync(dir)) return { ok: true, data: { instances: [] } };
              const names = readdirSync(dir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => entry.name)
                .sort();
              return { ok: true, data: { instances: names } };
            }
            case 'get_context_pack': {
              const p = asRecord(payload);
              const instanceId = optString(p, 'instanceId') ?? optString(p, 'instance');
              if (instanceId === undefined) {
                return {
                  ok: false,
                  error: {
                    category: 'validation',
                    message: '缺少参数 payload.instanceId（状态注入需定位目标实例，§10.4）',
                    retryable: false,
                  },
                };
              }
              const root = readRoot();
              if (root === undefined || root === '') {
                return {
                  ok: false,
                  error: {
                    category: 'validation',
                    message: '未配置数据根目录，无法读取实例现状（§10.4）',
                    retryable: false,
                  },
                };
              }
              const dir = instanceDir(root, instanceId);
              if (!existsSync(dir)) {
                return {
                  ok: false,
                  error: {
                    category: 'validation',
                    message: `实例不存在: ${instanceId}（${dir}）`,
                    code: 'INSTANCE_NOT_FOUND',
                    retryable: false,
                  },
                };
              }
              return { ok: true, data: readContextParts(root, instanceId) };
            }
            case 'list_versions': {
              const p = asRecord(payload);
              const typeFilter = optString(p, 'type');
              const root = readRoot();
              const cachePath =
                root === undefined || root === '' ? undefined : join(root, 'version_manifest.json');
              try {
                const manifest = await fetchVersionManifest({
                  fallbackIds: [...MC_VERSIONS],
                  ...(cachePath === undefined ? {} : { cachePath }),
                });
                const entries =
                  typeFilter === 'release' || typeFilter === 'snapshot'
                    ? manifest.entries.filter((e) => e.type === typeFilter)
                    : manifest.entries;
                return {
                  ok: true,
                  data: {
                    ids: entries.map((e) => e.id),
                    entries,
                    latestRelease: manifest.latestRelease,
                    source: manifest.source,
                  },
                };
              } catch {
                const ids = [...MC_VERSIONS];
                return {
                  ok: true,
                  data: {
                    ids,
                    entries: ids.map((id) => ({ id, type: 'release' })),
                    latestRelease: ids[0] ?? null,
                    source: 'fallback' as const,
                  },
                };
              }
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

function riskOf(kind: string): 'write' | 'execute' {
  return MCP_TOOL_PERMISSIONS[kind] === 'X' ? 'execute' : 'write';
}
