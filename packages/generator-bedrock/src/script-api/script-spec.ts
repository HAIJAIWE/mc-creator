/**
 * Script API 生成规格（设计文档 §6.3）。
 *
 * ## 为什么规格定义在本包而不在 `@mc-creator/shared`
 * ──────────────────────────────────────────
 * `BehaviorPackSpec` 定义在 `packages/shared/src/schemas/behavior-pack-spec.ts`，
 * 本次改动的文件范围限定在 `packages/generator-bedrock/`，不外扩到 shared。
 * 故这里用「增量类型 + 局部校验函数」的方式扩展 spec：调用方照常传
 * `BehaviorPackSpec & { script?: ... }`，运行时由 {@link parseScriptSpec} 局部校验。
 * 后续若放开 shared 的改动范围，应把这里的字段合进 shared 的 BehaviorPackSpec，
 * 届时本文件可退化为纯类型重导出。
 *
 * ## 为什么手写校验而不用 zod
 * ────────────────────────
 * `zod` 不是 `@mc-creator/generator-bedrock` 的依赖（pnpm 严格 node_modules，
 * 直接 `import { z } from 'zod'` 在本包的 vitest/vite 下直接解析失败），
 * 而本次任务不允许改 `package.json` / 不允许 `pnpm install`。
 * 手写一个几十行的局部校验器是唯一能落地的选择：它只校验本包自己新增的字段，
 * 不重复校验 shared 已有的字段（那是 shared 的 zod schema 的职责）。
 *
 * ## 为什么 `script` 字段是「可选即启用」而不是 `script.enabled`
 * ──────────────────────────────────────────────────
 * BehaviorPackGenerator 现有的调用方（含 14 条既有用例）都不传 `script`。
 * 用「字段存在即启用」而不是再加一个 boolean，可以让「没传 script」的旧调用
 * 产物与今天**逐字节一致**（不多出 `scripts/`、manifest 里也不多出 script 模块
 * 与依赖），把「生成脚本」变成一次纯增量的能力引入，而不是行为变更。
 */

/** Script API 可用动作种类（每种映射到一段已核实的 API 调用） */
export const BP_SCRIPT_ACTION_KINDS = [
  'spawn_entity',
  'set_block',
  'add_tag',
  'remove_tag',
  'send_message',
  'add_effect',
  'play_sound',
  'give_item',
] as const;
export type BpScriptActionKind = (typeof BP_SCRIPT_ACTION_KINDS)[number];

/** 单个动作（实体/方块/物品的读写） */
export interface BpScriptActionSpec {
  kind: BpScriptActionKind;
  /** spawn_entity：实体类型 ID，如 'minecraft:fox' */
  entityType?: string | undefined;
  /** set_block：方块类型 ID，如 'minecraft:stone' */
  blockType?: string | undefined;
  /** add_tag / remove_tag：标签名，如 'mc_creator_marked' */
  tag?: string | undefined;
  /** send_message：消息正文 */
  text?: string | undefined;
  /** send_message：'all' → world.sendMessage；'player' → 定向给触发玩家 */
  audience: 'all' | 'player';
  /** add_effect：效果类型 ID，如 'minecraft:speed' */
  effectType?: string | undefined;
  /** add_effect：持续时间（秒，Script API 用秒不用 tick） */
  duration: number;
  /** add_effect：等级（0 起） */
  amplifier: number;
  /** play_sound：音效 ID，如 'random.orb' */
  soundType?: string | undefined;
  /** give_item：物品类型 ID，如 'minecraft:apple' */
  itemType?: string | undefined;
  /** give_item：数量 */
  count: number;
}

/** 事件绑定（world.afterEvents.* / world.beforeEvents.* / tick） */
export interface BpScriptEventSpec {
  /** 事件名：见 script-events.ts 白名单；'tick' 特判为 system.runInterval */
  event: string;
  /** after → world.afterEvents；before → world.beforeEvents */
  phase: 'after' | 'before';
  /** 仅 event='tick' 有效：间隔 tick 数（20 = 每秒） */
  interval: number;
  /** before 事件是否 `event.cancel = true`（after 事件传 true 会走 unsupported） */
  cancel: boolean;
  actions: BpScriptActionSpec[];
  /** 作者手写代码，原样插入处理器顶部 */
  code?: string | undefined;
}

/** system.runTimeout 延迟任务 */
export interface BpScriptTimeoutSpec {
  /** 逻辑标识，用于注释与查错 */
  id: string;
  /** 延迟 tick 数（20 = 1 秒） */
  delay: number;
  actions: BpScriptActionSpec[];
  code?: string | undefined;
}

/** @minecraft/server-ui 表单 */
export interface BpScriptFormSpec {
  /** modal → ModalFormData（双按钮确认框）；action → ActionFormData（按钮列表） */
  kind: 'modal' | 'action';
  id: string;
  title: string;
  body: string;
  /** modal：button1 文案（约定为「取消」侧） */
  button1: string;
  /** modal：button2 文案（约定为「确认」侧） */
  button2: string;
  /** action：按钮（可多个） */
  buttons: string[];
  /** 触发事件；缺省 playerJoin/after（玩家进入世界时弹一次） */
  on?: string | undefined;
  onPhase: 'after' | 'before';
}

/** 作者显式声明本次生成要用到的原生模块 */
export const BP_SCRIPT_MODULES = ['server', 'server-ui', 'server-admin', 'server-net'] as const;
export type BpScriptModule = (typeof BP_SCRIPT_MODULES)[number];

/** Script API 生成规格（挂在 BehaviorPackSpec.script 上） */
export interface BpScriptSpec {
  /**
   * 显式声明「本次生成用到了实验性 Script API」。
   *
   * 为什么不自动推断、也不硬编一份「实验性 API 名单」
   * ──────────────────────────────────────────────
   * - **无法离线核实**：哪些 API 在当前 MC 版本属于实验性逐版本变化，判定依据
   *   （世界侧 Beta APIs 开关 + 版本化 API 轨）不在本仓可枚举的数据里。硬编
   *   名单 = 必然过期，且过期方式是**静默失效**（包加载失败）。
   * - **推断不了**：用了 `world.afterEvents.*` 这类稳定 API 不代表没用实验性
   *   功能 —— 实验性可能体现在自定义组件、结构方块、Camera 等与 Script API
   *   模块正交的地方。内核无从判断。
   * - **失败方向不对称**：漏声明 → 游戏拒绝加载包，作者一眼能看出来；
   *   误声明 → 世界要求开 Beta APIs，作者能接受。故让调用方显式声明、
   *   内核如实写进 manifest，是唯一把错误方向定在「可见」一侧的做法。
   */
  experimentalApi: boolean;
  /** 显式指定 @minecraft/server 依赖版本，优先于 script-versions.ts 查表 */
  serverModuleVersion?: string | undefined;
  /** 显式指定 @minecraft/server-ui 依赖版本 */
  serverUiModuleVersion?: string | undefined;
  /** 作者声明用到的原生模块（unsupported 的会被登记而不是生成假 import） */
  modules: BpScriptModule[];
  events: BpScriptEventSpec[];
  timeouts: BpScriptTimeoutSpec[];
  forms: BpScriptFormSpec[];
}

/* ------------------------------------------------------------------ *
 * 局部校验（见文件头「为什么手写校验而不用 zod」）
 * ------------------------------------------------------------------ */

/** 校验失败时的累加器：收集全部问题而不是遇到第一个就抛，方便一次报全 */
class Issues {
  readonly list: string[] = [];
  add(path: string, message: string): void {
    this.list.push(`${path}: ${message}`);
  }
  get ok(): boolean {
    return this.list.length === 0;
  }
  get text(): string {
    return this.list.join('; ');
  }
}

/** 安全取对象字段（非对象一律返回 undefined，交由调用方给默认值） */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** 取字符串（缺省或类型不符时返回 fallback） */
function str(source: Record<string, unknown>, key: string, fallback: string): string {
  const v = source[key];
  return typeof v === 'string' ? v : fallback;
}

/** 取可选字符串 */
function optStr(source: Record<string, unknown>, key: string): string | undefined {
  const v = source[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 取正整数（缺省或非正整数时返回 fallback） */
function int(source: Record<string, unknown>, key: string, fallback: number): number {
  const v = source[key];
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback;
}

/** 取非负整数 */
function nonNegInt(source: Record<string, unknown>, key: string, fallback: number): number {
  const v = source[key];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback;
}

/** 取枚举值 */
function enumOf<T extends string>(
  source: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = source[key];
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function parseActions(raw: unknown, path: string, issues: Issues): BpScriptActionSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.add(path, '应为数组');
    return [];
  }
  const out: BpScriptActionSpec[] = [];
  raw.forEach((item, i) => {
    const o = obj(item);
    if (!o) {
      issues.add(`${path}[${i}]`, '应为对象');
      return;
    }
    const kind = o['kind'];
    if (typeof kind !== 'string' || !(BP_SCRIPT_ACTION_KINDS as readonly string[]).includes(kind)) {
      issues.add(
        `${path}[${i}].kind`,
        `未知动作类型（可选：${BP_SCRIPT_ACTION_KINDS.join(' / ')}）`,
      );
      return;
    }
    out.push({
      kind: kind as BpScriptActionKind,
      entityType: optStr(o, 'entityType'),
      blockType: optStr(o, 'blockType'),
      tag: optStr(o, 'tag'),
      text: optStr(o, 'text'),
      audience: enumOf(o, 'audience', ['all', 'player'] as const, 'all'),
      effectType: optStr(o, 'effectType'),
      duration: int(o, 'duration', 30),
      amplifier: nonNegInt(o, 'amplifier', 0),
      soundType: optStr(o, 'soundType'),
      itemType: optStr(o, 'itemType'),
      count: int(o, 'count', 1),
    });
  });
  return out;
}

function parseEvents(raw: unknown, issues: Issues): BpScriptEventSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.add('script.events', '应为数组');
    return [];
  }
  const out: BpScriptEventSpec[] = [];
  raw.forEach((item, i) => {
    const o = obj(item);
    const path = `script.events[${i}]`;
    if (!o) {
      issues.add(path, '应为对象');
      return;
    }
    const event = str(o, 'event', '');
    if (event.length === 0) {
      issues.add(`${path}.event`, '必填');
      return;
    }
    out.push({
      event,
      phase: enumOf(o, 'phase', ['after', 'before'] as const, 'after'),
      interval: int(o, 'interval', 20),
      cancel: o['cancel'] === true,
      actions: parseActions(o['actions'], `${path}.actions`, issues),
      code: optStr(o, 'code'),
    });
  });
  return out;
}

function parseTimeouts(raw: unknown, issues: Issues): BpScriptTimeoutSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.add('script.timeouts', '应为数组');
    return [];
  }
  const out: BpScriptTimeoutSpec[] = [];
  raw.forEach((item, i) => {
    const o = obj(item);
    const path = `script.timeouts[${i}]`;
    if (!o) {
      issues.add(path, '应为对象');
      return;
    }
    const id = str(o, 'id', '');
    if (id.length === 0) {
      issues.add(`${path}.id`, '必填（用于注释与查错）');
      return;
    }
    out.push({
      id,
      delay: int(o, 'delay', 20),
      actions: parseActions(o['actions'], `${path}.actions`, issues),
      code: optStr(o, 'code'),
    });
  });
  return out;
}

function parseForms(raw: unknown, issues: Issues): BpScriptFormSpec[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.add('script.forms', '应为数组');
    return [];
  }
  const out: BpScriptFormSpec[] = [];
  raw.forEach((item, i) => {
    const o = obj(item);
    const path = `script.forms[${i}]`;
    if (!o) {
      issues.add(path, '应为对象');
      return;
    }
    const id = str(o, 'id', '');
    if (id.length === 0) {
      issues.add(`${path}.id`, '必填（用于变量名与注释）');
      return;
    }
    const buttonsRaw = o['buttons'];
    const buttons = Array.isArray(buttonsRaw)
      ? buttonsRaw.filter((b): b is string => typeof b === 'string')
      : [];
    out.push({
      kind: enumOf(o, 'kind', ['modal', 'action'] as const, 'modal'),
      id,
      title: str(o, 'title', '提示'),
      body: str(o, 'body', ''),
      button1: str(o, 'button1', '取消'),
      button2: str(o, 'button2', '确认'),
      buttons,
      on: optStr(o, 'on'),
      onPhase: enumOf(o, 'onPhase', ['after', 'before'] as const, 'after'),
    });
  });
  return out;
}

function parseModules(raw: unknown, issues: Issues): BpScriptModule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    issues.add('script.modules', '应为数组');
    return [];
  }
  const out: BpScriptModule[] = [];
  raw.forEach((item, i) => {
    if (typeof item === 'string' && (BP_SCRIPT_MODULES as readonly string[]).includes(item)) {
      out.push(item as BpScriptModule);
      return;
    }
    issues.add(`script.modules[${i}]`, `未知模块（可选：${BP_SCRIPT_MODULES.join(' / ')}）`);
  });
  return out;
}

/**
 * 从宽松的原始 spec 中取出并校验 `script` 段。
 *
 * 为什么不整体 `parse`：`BehaviorPackGenerator` 历史上就没做 zod 校验
 * （`ctx.spec as unknown as BehaviorPackSpec`），非法 spec 走的是「尽力生成」。
 * 给它新加一层整体校验会把「spec 不合法」从「尽力生成」变成「直接抛错」，
 * 那是行为变更。故只对**新增的** script 段做局部校验；非法段退化为
 * `error`（由调用方转成 warning），既不炸掉既有调用方，也不静默吞错。
 */
export function parseScriptSpec(raw: unknown): { script?: BpScriptSpec; error?: string } {
  const root = obj(raw);
  if (!root) return {};
  const candidate = root['script'];
  if (candidate === undefined || candidate === null) return {};
  const s = obj(candidate);
  if (!s) return { error: 'script: 应为对象' };

  const issues = new Issues();
  const script: BpScriptSpec = {
    experimentalApi: s['experimentalApi'] === true,
    serverModuleVersion: optStr(s, 'serverModuleVersion'),
    serverUiModuleVersion: optStr(s, 'serverUiModuleVersion'),
    modules: parseModules(s['modules'], issues),
    events: parseEvents(s['events'], issues),
    timeouts: parseTimeouts(s['timeouts'], issues),
    forms: parseForms(s['forms'], issues),
  };
  if (!issues.ok) return { error: issues.text };
  return { script };
}
