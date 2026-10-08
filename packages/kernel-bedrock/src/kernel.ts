/**
 * Bedrock 内核（内容网关，§6）· KernelContract 实现。
 *
 * 职责：导入网关 + 包生成器，不做通用文件管理。
 *
 * §6.1 关键约束：游戏安装目录位于 UWP 受保护目录（Program Files\WindowsApps\）下，
 * 即使管理员账户也可能无权访问 —— 不得依赖直接读写，必须做名称探测 + 多路径回退，
 * 权限不足时降级为「生成合法包 + 引导用户双击导入」（官方深链协议优先）。
 * 因此本内核**永不写入 com.mojang**：generate_content 只把包写进沙箱/工作目录，
 * 由用户在确认后自行导入（§6.1 降级策略 + §13.4 沙箱隔离）。
 *
 * dispatch 只读任务（设计 §10.2 读现状类是闭环必需、§10.6 只读免确认，
 * 纯 node: 内置实现）：
 * - get_capabilities：data 透传 capabilities() 能力表（MCP 强制第一步）。
 * - get_target_state：探测 com.mojang 内容目录 —— 先读显式环境变量覆盖
 *   （COM_MOJANG_DIR / BEDROCK_COM_MOJANG_DIR），再回退到 %LOCALAPPDATA%
 *   默认路径做存在性检查；data 透传 { comMojangDir, candidates }（命中的
 *   内容目录 + 全部候选路径）；dataDir 保留仅为三内核构造签名统一。
 * - validate_content：R 类免确认。读包根目录 manifest.json 做结构校验
 *   （uuid / version / min_engine_version / modules 齐全性与格式），
 *   返回 { errors: 中文清单 }（§6.2 导入前校验）。
 *
 * dispatch 执行类任务（§10.2 执行类须弹窗确认、§10.6 权限分级）：
 * - generate_content 为 X 级，走「确认闸门 + 真实现」两级：
 *   1. 先构造 ConfirmRequest（中文一行 summary + risk）交 ctx.confirm；
 *   2. ctx.confirm 缺失或返回 falsy → 保持既有 permission 拒绝 + confirmRequired:true，
 *      **不执行任何副作用**；
 *   3. 返回 true → 调 @mc-creator/generator-bedrock 的真实生成器，把 FileNode[]
 *      原子落盘到沙箱目录，PNG 等二进制内容 base64 解码为字节，
 *      逐文件产出 ArtifactRef（§0.5 产物哈希对外可见）。
 *   缺 spec（本内核无 LLM 调用能力）→ validation 明确「需先由上层生成 spec」。
 * - 未知 kind：ok:false + unknown 分类（保留 stub 语义）。
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
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
import { writeFileAtomic } from '@mc-creator/shell';
import { assertWithinRoot, makeArtifactRef } from '@mc-creator/devkit';
import {
  BehaviorEntityGenerator,
  BehaviorItemGenerator,
  BehaviorPackGenerator,
  SkinPackGenerator,
} from '@mc-creator/generator-bedrock';
import type { FileNode, GeneratorContext } from '@mc-creator/shared';

/** 内核构造上下文（目标探测只看游戏安装位置，dataDir 保留仅为三内核构造签名统一）。 */
export interface KernelContext {
  /** 数据根目录；Bedrock 目标探测不依赖它，仅用于给沙箱一个默认落位。 */
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

/**
 * generate_content 支持的产物种类（§6.3 Add-on / §6.4 材质与皮肤）。
 *
 * `entity` 对应 BehaviorEntityGenerator：它在 contract 里映射为 `addon` kind
 * （与 behavior_pack 同类），但**必须**在这里单列 —— 否则该生成器会成为
 * 无人能调用的孤儿（2026-10 补 skinpack 独立生成器时才暴露出来）。
 */
const GENERATE_KINDS = ['addon', 'skinpack', 'texturepack', 'entity'] as const;
type GenerateKind = (typeof GENERATE_KINDS)[number];

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

/** 裸异常统一转 ClassifiedError：只读探测永不向外抛裸异常。 */
function toDiskError(e: unknown): ClassifiedError {
  const message = e instanceof Error ? e.message : String(e);
  return { category: 'disk', message: `文件系统访问失败: ${message}`, retryable: false };
}

/** com.mojang 内容目录候选路径：显式环境变量覆盖优先，默认 %LOCALAPPDATA% 回退。 */
function comMojangCandidates(): string[] {
  const candidates: string[] = [];
  const override = process.env['COM_MOJANG_DIR'] ?? process.env['BEDROCK_COM_MOJANG_DIR'];
  if (override) candidates.push(override);
  const localAppData = process.env['LOCALAPPDATA'];
  if (localAppData) {
    candidates.push(
      join(
        localAppData,
        'Packages',
        'Microsoft.MinecraftUWP_8wekyb3d8bbwe',
        'LocalState',
        'games',
        'com.mojang',
      ),
    );
  }
  return candidates;
}

function exists(path: string): boolean {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
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

/* ------------------------------------------------------------------ *
 * 进度总线（progress 消费流与 result() 执行流共享事件队列）
 * ------------------------------------------------------------------ */

class ProgressBus {
  private readonly queue: ProgressEvent[] = [];
  private waiters: Array<() => void> = [];
  private resultStarted = false;
  private resultFinished = false;

  push(event: ProgressEvent): void {
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
  generate_content: [
    { stage: 'validating', message: '校验生成参数与版本' },
    { stage: 'generating', message: '调用生成器产出包文件' },
    { stage: 'verifying', message: '结构校验与 ArtifactRef 计算' },
  ],
  validate_content: [
    { stage: 'validating', message: '校验 manifest 与结构' },
    { stage: 'checking', message: '验证 uuid 与 min_engine_version' },
  ],
};

function confirmSummary(kind: string, payload: unknown): string {
  const p = asRecord(payload);
  if (kind === 'generate_content') {
    const prompt = optString(p, 'prompt') ?? '';
    const target = optString(p, 'kind') ?? 'addon';
    return `生成基岩版 ${target} 包（prompt: ${prompt.slice(0, 40)}），产物写入沙箱目录，需用户自行导入游戏`;
  }
  return `执行 ${kind}（写入或改动用户目标）`;
}

function riskOf(kind: string): 'write' | 'execute' {
  return MCP_TOOL_PERMISSIONS[kind] === 'X' ? 'execute' : 'write';
}

/* ------------------------------------------------------------------ *
 * 生成器选择与落盘
 * ------------------------------------------------------------------ */

/**
 * kind → 生成器（§6.3/§6.4）。
 * - addon → BehaviorPackGenerator：产出 manifest + entities/recipes/loot_tables，行为包主战场（§11阶梯 1）；
 * - texturepack → BehaviorItemGenerator：产出 items/ + textures/ + lang，材质与自定义物品；
 * - skinpack → SkinPackGenerator：**独立生成器**（2026-10 补上，§6.4 / §21 #1）。
 *   此前此处**兜底到 BehaviorEntityGenerator**，产出的是 BP+RP 成对的自定义实体包，
 *   并不是皮肤包 —— 也就是说此前生成「皮肤包」得到的东西根本不含 skins.json。
 *   现按官方 schema 产出 manifest(skin_pack) + skins.json + textures/*.png + texts/*.lang，
 *   并落实官方 CSPJ101/103/105/106/107/110/111/113/115/116 各条强制规则。
 *   HD / Persona 字段**刻意不做**（官方 CSPJ108「Creator Only」限制，公开文档未给字段定义）。
 */
/** 基岩各生成器共用的最小面（GeneratorContext 由调用方按 spec 现构造）。 */
interface MinimalBedrockGenerator {
  generate(ctx: GeneratorContext): Promise<{ files: FileNode[]; warnings: string[] }>;
}

function pickGenerator(kind: GenerateKind): {
  generator: MinimalBedrockGenerator;
  generatorName: 'behavior_pack' | 'behavior_item' | 'behavior_entity' | 'skinpack';
  note: string | undefined;
} {
  switch (kind) {
    case 'addon':
      return {
        generator: new BehaviorPackGenerator(),
        generatorName: 'behavior_pack',
        note: undefined,
      };
    case 'texturepack':
      return {
        generator: new BehaviorItemGenerator(),
        generatorName: 'behavior_item',
        note: undefined,
      };
    case 'skinpack':
      return {
        generator: new SkinPackGenerator(),
        generatorName: 'skinpack',
        note: undefined,
      };
    case 'entity':
      return {
        generator: new BehaviorEntityGenerator(),
        generatorName: 'behavior_entity',
        note: undefined,
      };
  }
}

/** 生成产物文件名 → 目录安全名（拒绝路径分隔与 ..）。 */
function safeRelPath(rel: string): string {
  const unified = rel.replace(/\\/g, '/').replace(/^\.\//, '');
  const segments = unified.split('/').filter((s) => s !== '' && s !== '.');
  if (segments.length === 0) verr(`生成器返回了空文件路径: ${rel}`, 'INVALID_FILE_PATH');
  for (const seg of segments) {
    if (seg === '..' || /^[a-zA-Z]:$/.test(seg)) {
      verr(`生成器返回了越界文件路径（路径穿越防护）: ${rel}`, 'PATH_TRAVERSAL');
    }
  }
  return segments.join('/');
}

/** 二进制扩展名：FileNode.content 为 base64，落盘前必须解码为字节。 */
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.tga',
  '.mcpack',
  '.mcaddon',
  '.mcworld',
  '.mctemplate',
  '.zip',
  '.nbt',
  '.mcstructure',
]);

/* ------------------------------------------------------------------ *
 * manifest 校验（§6.2 导入前校验 / §6.3 manifest 字段）
 * ------------------------------------------------------------------ */

const UUID_RE = /^[0-9a-fA-F-]{32,36}$/;

function isVersionTriple(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
  );
}

function isSemverString(value: unknown): boolean {
  return typeof value === 'string' && /^\d+(\.\d+){0,2}$/.test(value.trim());
}

/** [a,b,c] 与 'x.y.z' 归一为三元组，无法归一时返回 null。 */
function toTriple(value: unknown): [number, number, number] | null {
  if (isVersionTriple(value)) return value as [number, number, number];
  if (isSemverString(value)) {
    const parts = String(value)
      .trim()
      .split('.')
      .map((n) => Number.parseInt(n, 10));
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  }
  return null;
}

function compareTriple(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class BedrockKernel implements KernelContract {
  readonly edition = 'bedrock' as const;
  private readonly dataDir: string | undefined;
  private readonly confirm: ((req: ConfirmRequest) => Promise<boolean> | boolean) | undefined;
  private readonly mode: 'sandbox' | 'live';
  private readonly sandboxDir: string | undefined;

  constructor(ctx: KernelContext = {}) {
    this.dataDir = ctx.dataDir;
    this.confirm = ctx.confirm;
    this.mode = ctx.mode ?? 'sandbox';
    this.sandboxDir = ctx.sandboxDir;
    // 网络出站白名单当前未被本内核任务用到（包生成纯本地，无 HTTP 请求），
    // 保留字段以便外壳统一注入而不必改内核构造签名。
    void ctx.networkAllowlist;
  }

  capabilities(): EditionCapability[] {
    return capabilitiesFor('bedrock');
  }

  status(): StatusSnapshot {
    return { edition: this.edition, healthy: true, updatedAt: new Date().toISOString() };
  }

  /** 写入根目录：sandbox 优先sandboxDir，其次 dataDir，都没有则 validation。 */
  private writeRoot(): string {
    if (this.mode === 'sandbox') {
      if (this.sandboxDir !== undefined && this.sandboxDir !== '') return this.sandboxDir;
      // 未显式给沙箱目录时退到 dataDir 承载产物（仍不写 com.mojang，§6.1）。
      if (this.dataDir !== undefined && this.dataDir !== '') return this.dataDir;
      verr('未配置 sandboxDir 或 dataDir，拒绝写入（§13.4 沙箱隔离）', 'SANDBOX_ROOT_MISSING');
    }
    if (this.dataDir !== undefined && this.dataDir !== '') return this.dataDir;
    verr('未配置 dataDir，拒绝写入用户目标目录', 'DATA_DIR_MISSING');
  }

  private guard(root: string, target: string): string {
    try {
      return assertWithinRoot(root, target);
    } catch (e) {
      throw new KernelTaskError({
        category: 'validation',
        message: `目标路径越界（${root} 之外）: ${target}（${(e as Error).message}）`,
        code: 'SANDBOX_ESCAPE',
        retryable: false,
      });
    }
  }

  /** 包名：payload.name 优先，其次 spec.packId，最后由 prompt 生成安全 slug。 */
  private packDirName(payload: Record<string, unknown>, spec: Record<string, unknown>): string {
    const explicit = optString(payload, 'name');
    if (explicit !== undefined) {
      if (explicit.includes('..') || /[\\/]/.test(explicit)) {
        verr(`包名非法（含路径穿越或分隔符）: ${explicit}`, 'INVALID_NAME');
      }
      return explicit;
    }
    const packId = optString(spec, 'packId');
    if (packId !== undefined) {
      if (packId.includes('..') || /[\\/]/.test(packId)) {
        verr(`spec.packId 非法（含路径穿越或分隔符）: ${packId}`, 'INVALID_NAME');
      }
      return packId;
    }
    const prompt = optString(payload, 'prompt') ?? 'pack';
    const slug = prompt
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return slug === '' ? 'pack' : slug;
  }

  /** spec 缺失时给上层的形状示例（本内核无 LLM 能力，§10.0推理在 agent 层）。 */
  private specShapeHint(kind: GenerateKind): Record<string, unknown> {
    const base = {
      packId: 'my_pack（仅小写字母/数字/下划线）',
      packName: '我的包',
      description: '包描述',
      packFormat: 2,
      mcVersion: [1, 21, 0],
      header: {
        name: 'My Pack',
        description: 'desc',
        uuid: '可省略（自动生成 v4）',
        version: [1, 0, 0],
        min_engine_version: [1, 21, 0],
      },
      dependencies: [],
    };
    switch (kind) {
      case 'addon':
        return {
          ...base,
          entities: [{ identifier: 'my_pack:zombie', components: {}, events: {} }],
          recipes: [
            {
              identifier: 'my_pack:recipe',
              type: 'shaped_crafting',
              result: 'minecraft:stick',
              count: 1,
            },
          ],
          lootTables: [
            {
              path: 'entities/zombie',
              pools: [{ rolls: 1, entries: [{ name: 'minecraft:rotten_flesh' }] }],
            },
          ],
        };
      case 'texturepack':
        return {
          ...base,
          items: [
            {
              id: 'ruby_sword',
              name: '红宝石剑',
              category: 'weapons',
              maxStackSize: 1,
              attackDamage: 7,
              primaryColor: '#c0392b',
              secondaryColor: '#7b241c',
            },
          ],
          lang: { zh_CN: { 'item.my_pack:ruby_sword': '红宝石剑' } },
        };
      case 'skinpack':
        // 这段此前返回的是**实体包形状**（my_beast）—— skinpack 兜底到
        // behavior_entity 时代的遗留。补上独立 SkinPackGenerator 后必须改成
        // 真正的 SkinPackSpec 形状，否则「specShape 示例」会把用户/智能体
        // 引到错误的 spec 上 —— 而这个示例的唯一用途就是「不臆造 spec」。
        return {
          serializeName: 'my_pack',
          packName: 'My Skin Pack',
          description: '基岩皮肤包示例',
          packFormat: 2,
          textureSize: 64,
          skins: [
            {
              skinKey: 'Knight',
              displayName: '骑士铠甲',
              geometry: 'custom',
              primaryColor: '#334455',
            },
          ],
          lang: { zh_CN: { Knight: '骑士铠甲' } },
        };
      case 'entity':
        // behavior_entity 曾只能经由 skinpack 兜底触达；skinpack 独立后
        // 若不补这个 kind，BehaviorEntityGenerator 会变成**无人能调用的孤儿**。
        return {
          ...base,
          entities: [
            {
              id: 'my_beast',
              name: '我的怪物',
              hostile: true,
              geometry: 'zombie',
              mainColor: '#6f7a4f',
              goals: [{ type: 'melee', priority: 1 }],
              drops: [{ item: 'minecraft:rotten_flesh', count: 1 }],
            },
          ],
          lang: { zh_CN: { 'entity.my_pack:my_beast': '我的怪物' } },
        };
    }
  }

  /** R 类：manifest 结构校验（§6.2 导入前校验、§6.3 manifest 字段）。 */
  private validateContent(
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): TaskResult {
    const p = asRecord(payload);
    const path = optString(p, 'path');
    if (path === undefined) verr('缺少参数 payload.path（包根目录）');
    step(0);
    if (!exists(path)) verr(`包目录不存在: ${path}`, 'PACK_DIR_NOT_FOUND');
    if (!statSync(path).isDirectory())
      verr(`payload.path 必须是目录（包根目录）: ${path}`, 'PACK_DIR_NOT_FOUND');

    const errors: string[] = [];
    const manifestPath = join(path, 'manifest.json');
    if (!exists(manifestPath)) {
      // §5.7 目录层级陷阱：根目录必须直接含 manifest.json，禁止多套一层。
      const children = readdirSync(path, { withFileTypes: true }).filter((e) => e.isDirectory());
      const nested = children.filter((c) => exists(join(path, c.name, 'manifest.json')));
      if (nested.length > 0) {
        verr(
          `包根目录缺少 manifest.json，但子目录 ${nested.map((c) => c.name).join('/')} 内含manifest.json：` +
            '§5.7 目录层级陷阱，根目录必须直接含 manifest.json，禁止多套一层',
          'MANIFEST_MISSING',
        );
      }
      verr(
        `包根目录缺少 manifest.json: ${manifestPath}（§6.3 导入前必须有 manifest）`,
        'MANIFEST_MISSING',
      );
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      verr(`manifest.json 不是合法 JSON: ${(e as Error).message}`, 'MANIFEST_INVALID_JSON');
    }

    const header =
      typeof manifest['header'] === 'object' && manifest['header'] !== null
        ? (manifest['header'] as Record<string, unknown>)
        : {};

    const uuid = header['uuid'];
    if (typeof uuid !== 'string' || uuid === '') errors.push('manifest.header.uuid 缺失');
    else if (!UUID_RE.test(uuid))
      errors.push(`manifest.header.uuid 格式非法: ${uuid}（应为 32/36 位十六进制或带连字符 UUID）`);

    const version = header['version'];
    if (version === undefined) errors.push('manifest.header.version 缺失');
    else if (toTriple(version) === null) {
      errors.push(
        `manifest.header.version 格式非法: ${JSON.stringify(version)}（需 [int,int,int] 数组或语义化字符串）`,
      );
    }

    const minEngine = header['min_engine_version'];
    if (minEngine === undefined)
      errors.push('manifest.header.min_engine_version 缺失（§6.2 兼容性校验需要）');
    else if (toTriple(minEngine) === null) {
      errors.push(`manifest.header.min_engine_version 格式非法: ${JSON.stringify(minEngine)}`);
    }

    const modules = manifest['modules'];
    if (!Array.isArray(modules) || modules.length === 0) {
      errors.push('manifest.modules 缺失或为空（§6.3 行为包/资源包必须声明 module）');
    } else {
      modules.forEach((raw, i) => {
        const m = asRecord(raw);
        if (typeof m['uuid'] !== 'string' || !UUID_RE.test(m['uuid'])) {
          errors.push(`manifest.modules[${i}].uuid 缺失或格式非法`);
        }
        if (m['version'] !== undefined && toTriple(m['version']) === null) {
          errors.push(`manifest.modules[${i}].version 格式非法`);
        }
        if (typeof m['type'] !== 'string' || m['type'] === '') {
          errors.push(`manifest.modules[${i}].type 缺失（data / resource / script）`);
        }
      });
    }

    step(1);
    const data: Record<string, unknown> = {
      path,
      manifestPath,
      manifest,
      uuid: typeof uuid === 'string' ? uuid : null,
      version: toTriple(version),
      minEngineVersion: toTriple(minEngine),
      modules: Array.isArray(modules) ? modules.length : 0,
      errors,
    };

    // payload.version 允许 [int,int,int] 数组或语义化字符串两种写法。
    const requestedRaw = p['version'];
    if (requestedRaw !== undefined && requestedRaw !== null && requestedRaw !== '') {
      const want = toTriple(requestedRaw);
      const min = toTriple(minEngine);
      if (want === null) {
        errors.push(
          `payload.version 格式非法: ${JSON.stringify(requestedRaw)}（需 [int,int,int] 或语义化字符串）`,
        );
      } else if (min !== null && compareTriple(want, min) < 0) {
        // 简单大小比较提示不兼容（§6.2 兼容性）。
        const msg = `目标版本 ${want.join('.')} 低于包min_engine_version ${min.join('.')}，可能不兼容（§6.2）`;
        errors.push(msg);
        data['compatWarning'] = msg;
      } else {
        data['compatWarning'] = null;
      }
      data['requestedVersion'] = want;
    }

    if (errors.length > 0) {
      return {
        ok: false,
        error: {
          category: 'validation',
          message: `manifest 校验失败（${errors.length} 项）: ${errors.join('；')}`,
          code: 'MANIFEST_INVALID',
          retryable: false,
        },
        data,
      };
    }
    return { ok: true, data };
  }

  /** X 级：generate_content 真实现。 */
  private async generateContent(
    payload: unknown,
    step: (index: number, message?: string) => void,
  ): Promise<TaskResult> {
    const p = asRecord(payload);
    reqString(p, 'prompt', '生成提示词');
    const kindRaw = reqString(p, 'kind', `产物种类（${GENERATE_KINDS.join('/')}）`);
    if (!(GENERATE_KINDS as readonly string[]).includes(kindRaw)) {
      verr(`payload.kind 仅支持 ${GENERATE_KINDS.join('/')}，收到: ${kindRaw}`, 'UNSUPPORTED_KIND');
    }
    const kind = kindRaw as GenerateKind;
    const specRaw = p['spec'];
    if (
      specRaw === undefined ||
      specRaw === null ||
      typeof specRaw !== 'object' ||
      Array.isArray(specRaw)
    ) {
      // 本内核无 LLM 能力：spec 必须由上层（agent 推理层，§10.0）先生成。
      // 拒绝时把形状示例放进 data，上层可直接据此让 LLM 补齐（§10.0 闭环）。
      return {
        ok: false,
        error: {
          category: 'validation',
          message:
            `generate_content 需先由上层生成 spec（本内核不含 LLM 调用能力，§10.0）：payload.spec 缺失或非对象；` +
            `kind=${kind} 所需 spec 形状见 data.specShape`,
          code: 'SPEC_REQUIRED',
          retryable: false,
        },
        data: {
          kind,
          specShape: this.specShapeHint(kind),
          generator: pickGenerator(kind).generatorName,
        },
      };
    }
    const spec = specRaw as Record<string, unknown>;
    step(0);

    const root = this.writeRoot();
    const dirName = this.packDirName(p, spec);
    const outDir = this.guard(root, join('packs', dirName));

    step(1);
    const picked = pickGenerator(kind);
    // GeneratorContext：loader 固定 vanilla（基岩内容与 Java 加载器无关）。
    const ctx: GeneratorContext = {
      loader: 'vanilla',
      mcVersion: optString(spec, 'mcVersionText') ?? '1.21.11',
      modId: optString(spec, 'packId') ?? dirName,
      spec: spec as unknown as GeneratorContext['spec'],
      projectPath: outDir,
    };
    const result = await picked.generator.generate(ctx);

    const files = result.files
      .map((raw) => asRecord(raw))
      .filter((f) => typeof f['path'] === 'string' && typeof f['content'] === 'string');
    if (files.length === 0) {
      verr('生成器未产出任何文件（spec 可能为空）', 'EMPTY_GENERATION');
    }

    // 先全部校验落位路径，再写盘：任何一条越界就整体拒绝（§8.3 / §13.1）。
    const planned = files.map((f) => {
      const rel = safeRelPath(String(f['path']));
      const dest = this.guard(root, join('packs', dirName, rel));
      const content = String(f['content']);
      const isBinary = BINARY_EXT.has(extname(rel).toLowerCase());
      return { rel, dest, content, isBinary };
    });

    step(2);
    const artifacts: ArtifactRef[] = [];
    for (const item of planned) {
      // FileNode.content 对二进制是 base64（见 generator-bedrock/utils/png-encoder）。
      const bytes = item.isBinary ? Buffer.from(item.content, 'base64') : item.content;
      await writeFileAtomic(item.dest, bytes);
      artifacts.push(await makeArtifactRef(item.dest, 'addon'));
    }

    // 结构自检：包根目录必须直接含 manifest.json（§5.7 层级陷阱 / §6.3）。
    const manifestDirect = exists(join(outDir, 'manifest.json'));
    const filesList = artifacts.map((a) => ({ path: a.path, sha256: a.sha256, kind: a.kind }));

    return {
      ok: true,
      artifacts,
      data: {
        kind,
        generator: picked.generatorName,
        dir: outDir,
        files: filesList,
        warnings: result.warnings,
        manifestPresent: manifestDirect,
        mode: this.mode,
        note:
          picked.note ??
          '产物已写入沙箱目录，需用户在确认后自行导入游戏（§6.1 UWP 受保护目录不可直写）',
      },
    };
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
    let summary = confirmSummary(kind, payload);
    // spec 缺失时把形状示例挂进摘要，避免上层拿到拒绝却不知缺什么。
    if (kind === 'generate_content') {
      const p = asRecord(payload);
      if (
        p['spec'] === undefined &&
        (GENERATE_KINDS as readonly string[]).includes(String(p['kind']))
      ) {
        summary = `${summary}（缺 payload.spec，需上层先生成）`;
      }
    }
    try {
      approved = Boolean(await this.confirm({ kind, payload, summary, risk: riskOf(kind) }));
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
      switch (kind) {
        case 'generate_content':
          return await this.generateContent(payload, step);
        case 'validate_content':
          // validate_content 是 R 级，正常不会走到这里；保留分支仅为防御。
          return this.validateContent(payload, step);
        default:
          verr(`不支持的任务: ${kind}`, 'UNKNOWN_KIND');
      }
    } catch (e) {
      if (e instanceof KernelTaskError) return { ok: false, error: e.classified };
      return { ok: false, error: toDiskError(e) };
    }
  }

  dispatch(task: TaskSpec): TaskHandle {
    // result() 内 this 指向 handle 而非 kernel，此处提前捕获。
    const kernel = this;
    const id = task.id;
    const kind = task.kind;
    const payload = task.payload;
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
        // 只读/短任务无后台工作；关闭进度流让消费者立即结束。
        bus.close();
      },
      async result(): Promise<TaskResult> {
        bus.markResultStarted();
        try {
          if (isWriteOrExecute) {
            return await kernel.executeWrite(id, kind, payload, bus);
          }

          switch (kind) {
            case 'get_capabilities':
              return { ok: true, data: { capabilities } };
            case 'get_target_state': {
              if (process.platform !== 'win32') {
                return {
                  ok: false,
                  error: {
                    category: 'unknown',
                    message: 'get_target_state 仅支持 Windows（com.mojang 内容目录探测）',
                    retryable: false,
                  },
                };
              }
              const candidates = comMojangCandidates();
              const found = candidates.find((p) => exists(p));
              if (found) return { ok: true, data: { comMojangDir: found, candidates } };
              return {
                ok: false,
                error: {
                  category: 'validation',
                  message:
                    `未探测到 com.mojang 内容目录（已检查: ${candidates.join('; ') || '无候选路径'}；` +
                    `§6.1 降级策略：生成合法包 + 引导用户双击导入，官方深链协议优先）`,
                  retryable: false,
                },
              };
            }
            case 'validate_content': {
              const stepsForRead = STEP_DEFS['validate_content'] ?? [];
              const readStep = (index: number): void => {
                const def = stepsForRead[index];
                if (def === undefined) return;
                bus.push({
                  taskId: id,
                  progress: Math.min(1, (index + 1) / Math.max(stepsForRead.length, 1)),
                  stage: def.stage,
                  message: def.message,
                });
              };
              return kernel.validateContent(payload, readStep);
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
