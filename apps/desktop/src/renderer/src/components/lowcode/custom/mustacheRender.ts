/**
 * 渲染层 Mustache 渲染器（**兜底路径专用**，与主进程 `ipc/sandboxed-mustache.ts` 对齐）。
 *
 * ============================ 它现在只服务什么场景 ============================
 * `compileCustomNode.ts` 的调用顺序是：
 * 1. 优先走 `window.sandboxedMustache.renderMustache()`（**主进程 = 唯一真相来源**）；
 * 2. 主进程**明确拒绝**（`ok:false`）→ **抛错，绝不回退到本文件**；
 * 3. 仅当 contextBridge 通道根本不存在（非 Electron 上下文：jsdom 单测 / bench）时，
 *    才用本文件兜底。
 *
 * 也就是说：修漏洞前这里是「主进程拒绝 → 无上限渲染」的放大器；
 * 现在主进程拒绝会直接失败，而兜底路径本身也带全套预算，攻击面已经闭合。
 *
 * ============================ 为什么兜底路径必须自己带防线 ============================
 * 不能写成「反正主进程会先挡」。理由：
 * - 本文件会在主进程**根本没参与**渲染的情况下独立执行，防线不能是「别人会挡」；
 * - 两份实现的**上限必须逐个相等**（见下方常量注释）：只要这份比主进程宽松，
 *   「主进程放过 / 渲染层炸掉」的分裂就又回来了 —— 那是同一个 bug 的小号版本。
 * 因此这里的常量、错误码、容错语义都与 `ipc/sandboxed-mustache.ts` **逐条镜像**，
 *   改动必须两边同时改。
 *
 * ============================ 真实威胁与对应防线 ============================
 * | 攻击输入                                   | 修之前                                  | 修之后                              |
 * |-------------------------------------------|-----------------------------------------|-------------------------------------|
 * | `{{field:constructor}}` / `{{field:__proto__}}` | `key in fields` 命中原型链，泄出 `Object` 构造函数 | `readOwn` 只读自有属性 + 禁用键 → 判为「缺失」 |
 * | `{{#each __proto__}}` / `{{#if constructor}}`  | 遍历 / 读取原型链成员                  | 同上 → 不遍历 / 判为 falsy           |
 * | 小模板 + 100MB 字段值                      | 输出无上限 → 堆耗尽                    | `MAX_OUTPUT_LENGTH` 增量预算，超限立刻中断 |
 * | 数千层 `{{#if}}`                            | `findBlockEnd` O(n²) → CPU 打满         | 栈式预扫描 O(n) + `MAX_BLOCK_DEPTH`  |
 * | 超大数组 `{{#each}}`                         | 无上限 → CPU/内存双杀                  | `MAX_EACH_ITERATIONS` / `MAX_TOTAL_ITERATIONS` |
 * | 深层嵌套 / 环形 fields 对象                  | `JSON.stringify` 爆栈                   | 迭代式预校验（深度/节点数/环检测）     |
 *
 * ============================ 语义兼容承诺 ============================
 * 对**合法**输入，输出与加固前逐字节一致（`mustacheRender.test.ts` 里 40+ 条既有
 * 期望值一条没改，全部仍然通过）。差异只有两处，都是刻意的安全收紧：
 * 1. 原型链键不再可读（视为「缺失」→ 保留原占位符，与字段缺失行为一致）；
 * 2. 超预算的输入抛结构化错误，而不是继续拼字符串。
 */

import { escapeJavaStringLiteral } from '../../../lib/javaEscape.js';

// ============================================================
// 上限常量 —— 与主进程 apps/desktop/src/main/ipc/sandboxed-mustache.ts **逐条相等**
// 改这边必须同时改那边，否则兜底路径会比主进程宽松，分裂即漏洞。
// ============================================================

/** 模板长度上限。与主进程常量相等，也与 `shared/ipc/sandbox.ts` 的 zod `.max(50000)` 对齐。 */
export const MAX_TEMPLATE_LENGTH = 50_000;

/**
 * token 数量上限。与主进程相等：最短合法标签 `{{a}}` 是 5 字符，50KB 模板
 * 最多产出 10000 个 token。
 */
export const MAX_TOKEN_COUNT = Math.ceil(MAX_TEMPLATE_LENGTH / 5);

/**
 * 渲染输出总长度上限：**5 MiB**（与主进程相等）。
 * 取值依据见主进程同名常量的注释：合法场景是自定义节点的 Java 代码片段，实测几十~几百 KB，
 * 5 MiB 是 ~20 倍余量；反过来把单次渲染的最坏堆占用钉死，杜绝
 * 「50KB 模板 × 巨大字段」的放大把渲染进程 OOM 掉。
 */
export const MAX_OUTPUT_LENGTH = 5 * 1024 * 1024;

/** 块嵌套深度上限：**16 层**（与主进程相等）。合法模板 2~4 层，16 层有 4 倍余量。 */
export const MAX_BLOCK_DEPTH = 16;

/** 单个 `{{#each}}` 迭代上限：**1 万次**（与主进程相等）。合法条目列表实测几十条。 */
export const MAX_EACH_ITERATIONS = 10_000;

/** 单次渲染**总**迭代上限：**5 万次**（与主进程相等），挡嵌套相乘（1 万 × 1 万）。 */
export const MAX_TOTAL_ITERATIONS = 50_000;

/** fields 顶层键数上限：**100**（与主进程相等，也与 zod refine 一致）。 */
export const MAX_FIELDS_ENTRIES = 100;

/** fields 值嵌套深度上限：**8 层**（与主进程相等）。`renderValue` 对对象走 `JSON.stringify`，深层必爆栈。 */
export const MAX_FIELDS_DEPTH = 8;

/** fields 字符串总量上限：**8 Mi**（与主进程相等）。 */
export const MAX_FIELDS_BYTES = 8 * 1024 * 1024;

/** fields 遍历节点数上限：**2 万**（与主进程相等，按 `MAX_FIELDS_NODES * 4` 个值计数）。 */
export const MAX_FIELDS_NODES = 20_000;

/** 键名长度上限：**128 字符**（与主进程相等）。 */
export const MAX_KEY_LENGTH = 128;

/** 渲染耗时上限：**250ms** 墙钟（与主进程相等）。渲染跑在 UI 线程上，合法模板 <1ms。 */
export const MAX_RENDER_MS = 250;

// ============================================================
// 错误类型（结构化：code 给程序判断，message 给人看）
// ============================================================

/** 与主进程 `MustacheRenderErrorCode` 同名同集合，便于两边对照排查。 */
export type MustacheRenderErrorCode =
  | 'TEMPLATE_INVALID'
  | 'TEMPLATE_TOO_LARGE'
  | 'TOKEN_LIMIT_EXCEEDED'
  | 'BLOCK_DEPTH_EXCEEDED'
  | 'FIELDS_INVALID'
  | 'FIELDS_TOO_MANY'
  | 'FIELDS_FORBIDDEN_KEY'
  | 'FIELDS_TOO_DEEP'
  | 'FIELDS_TOO_LARGE'
  | 'FIELDS_CYCLIC'
  | 'ITERATION_LIMIT_EXCEEDED'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'TIME_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_VALUE_TYPE'
  | 'RENDER_FAILED';

/** 带机器可读 code 的渲染错误。 */
export class MustacheRenderError extends Error {
  readonly code: MustacheRenderErrorCode;

  constructor(code: MustacheRenderErrorCode, message: string) {
    super(message);
    this.name = 'MustacheRenderError';
    this.code = code;
  }
}

// ============================================================
// 键名校验（原型链防线）
// ============================================================

/**
 * 禁用键：任何指向原型链自身的键名。
 * `__proto__` 可改原型、`prototype` / `constructor` 可拿到函数对象本身。
 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/** 该键名是否禁止使用（原型链键）。 */
export function isForbiddenFieldKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/**
 * 规范化键名；不可用（禁用键 / 空 / 超长）返回 `null`。
 * 所有取值都必须先过它 —— 这是「模板读不到原型链」的唯一入口。
 */
export function sanitizeFieldKey(key: string): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_KEY_LENGTH) return null;
  if (isForbiddenFieldKey(trimmed)) return null;
  return trimmed;
}

/** 「缺失」哨兵：与 `undefined` 区分（字段值本身允许是 undefined）。 */
const MISSING = Symbol('mustache.missing');
type Missing = typeof MISSING;

/**
 * 只读**自有**属性。
 *
 * 加固前渲染层写的是 `tok.key in fields`：`in` 会命中原型链
 * （`'constructor' in {}` 为真），于是 `{{field:constructor}}` 能读到
 * `function Object() { [native code] }`。`Object.hasOwn` 只看自有属性，
 * 配合 `sanitizeFieldKey` 拦掉原型链键，两道防线把这条读通道焊死。
 */
function readOwn(obj: Record<string, unknown>, key: string): unknown | Missing {
  const safeKey = sanitizeFieldKey(key);
  if (safeKey === null) return MISSING;
  if (!Object.hasOwn(obj, safeKey)) return MISSING;
  return obj[safeKey];
}

// ============================================================
// 输出预算（内存防线）
// ============================================================

interface OutputBudget {
  limit: number;
  used: number;
  /** 记账并返回该片段；超限抛 `OUTPUT_LIMIT_EXCEEDED`（立刻中断，不是渲染完再看）。 */
  append(chunk: string): string;
}

/** 创建输出预算。 */
export function createOutputBudget(limit: number = MAX_OUTPUT_LENGTH): OutputBudget {
  let used = 0;
  return {
    get limit(): number {
      return limit;
    },
    get used(): number {
      return used;
    },
    append(chunk: string): string {
      used += chunk.length;
      if (used > limit) {
        throw new MustacheRenderError(
          'OUTPUT_LIMIT_EXCEEDED',
          `渲染输出超限（最大 ${limit} 字符 ≈ ${formatLimit(limit)}，已达 ${used}）`,
        );
      }
      return chunk;
    },
  };
}

function formatLimit(n: number): string {
  return n % 1024 === 0 && n >= 1024 ? `${n / 1024}KiB` : String(n);
}

// ============================================================
// fields 预校验（深度 / 体积 / 环 / 禁用键）
// ============================================================

type FieldsValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; code: MustacheRenderErrorCode; error: string };

/** 只接受「纯对象」（Object.prototype 或 null 原型），数组/null/类实例一律拒绝。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** 遍历预算：最多检查这么多个「值」（对象键 + 数组元素）。 */
const FIELDS_VALUE_BUDGET = MAX_FIELDS_NODES * 4;

function fieldsTooDeep(): FieldsValidation {
  return {
    ok: false,
    code: 'FIELDS_TOO_DEEP',
    error: `fields 嵌套层级超限（最大 ${MAX_FIELDS_DEPTH} 层）`,
  };
}

function unsupportedChild(value: unknown): FieldsValidation {
  return {
    ok: false,
    code: 'UNSUPPORTED_VALUE_TYPE',
    error: `fields 含不支持的值类型（${Object.prototype.toString.call(value)}）`,
  };
}

/**
 * 迭代式遍历 fields：数深度、累计字符串长度、检测环、拒绝不支持的值类型。
 *
 * 两个刻意的实现选择（与主进程一致）：
 * 1. **显式栈 + enter/exit 帧**，而不是递归：被校验的数据是攻击者可控的，
 *    递归遍历等于把校验器自己变成爆栈靶子。
 * 2. **for...in + Object.hasOwn**，而不是 `Object.keys`：遍历期不分配键数组；
 *    `for...in` 会带上原型链上的可枚举键，hasOwn 守卫正好滤掉。
 *
 * 环检测只在**当前 DFS 路径**上放行同一对象：DAG 里重复引用合法，指回祖先才是环。
 */
function walkFields(root: Record<string, unknown>): FieldsValidation {
  type Frame =
    { kind: 'enter'; obj: Record<string, unknown>; depth: number } | { kind: 'exit'; obj: object };
  const stack: Frame[] = [{ kind: 'enter', obj: root, depth: 1 }];
  const onPath = new Set<object>();
  let bytes = 0;
  let seen = 0;

  const tooManyNodes = (): FieldsValidation => ({
    ok: false,
    code: 'FIELDS_TOO_LARGE',
    error: `fields 节点数超限（最多检查 ${FIELDS_VALUE_BUDGET} 个值）`,
  });
  const tooManyBytes = (): FieldsValidation => ({
    ok: false,
    code: 'FIELDS_TOO_LARGE',
    error: `fields 字符串总量超限（最大 ${MAX_FIELDS_BYTES} 字符）`,
  });

  const countString = (len: number): FieldsValidation | null => {
    bytes += len;
    return bytes > MAX_FIELDS_BYTES ? tooManyBytes() : null;
  };

  while (stack.length > 0) {
    const frame = stack.pop() as Frame;
    if (frame.kind === 'exit') {
      onPath.delete(frame.obj);
      continue;
    }
    if (frame.depth > MAX_FIELDS_DEPTH) return fieldsTooDeep();
    onPath.add(frame.obj);
    // exit 帧先入栈、后进先出 ⇒ 一定在所有子节点处理完之后才弹出
    stack.push({ kind: 'exit', obj: frame.obj });

    for (const key in frame.obj) {
      if (!Object.hasOwn(frame.obj, key)) continue; // 滤掉原型链上的可枚举键
      const value = frame.obj[key];
      seen += 1;
      if (seen > FIELDS_VALUE_BUDGET) return tooManyNodes();

      if (typeof value === 'string') {
        const overflow = countString(value.length);
        if (overflow) return overflow;
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        // 标量：无需下钻
      } else if (value === null || value === undefined) {
        // null/undefined 插值成空串，无需下钻
      } else if (Array.isArray(value)) {
        if (onPath.has(value)) {
          return { ok: false, code: 'FIELDS_CYCLIC', error: 'fields 含循环引用' };
        }
        onPath.add(value);
        stack.push({ kind: 'exit', obj: value });
        for (const item of value) {
          seen += 1;
          if (seen > FIELDS_VALUE_BUDGET) return tooManyNodes();
          if (typeof item === 'string') {
            const overflow = countString(item.length);
            if (overflow) return overflow;
            continue;
          }
          if (item === null || typeof item !== 'object') continue; // 标量元素插值安全
          if (onPath.has(item)) {
            return { ok: false, code: 'FIELDS_CYCLIC', error: 'fields 含循环引用' };
          }
          if (!isPlainObject(item)) return unsupportedChild(item);
          stack.push({ kind: 'enter', obj: item, depth: frame.depth + 1 });
        }
      } else if (typeof value === 'object') {
        if (onPath.has(value)) {
          return { ok: false, code: 'FIELDS_CYCLIC', error: 'fields 含循环引用' };
        }
        if (!isPlainObject(value)) return unsupportedChild(value);
        stack.push({ kind: 'enter', obj: value, depth: frame.depth + 1 });
      } else {
        return unsupportedChild(value);
      }
    }
  }
  return { ok: true, value: root };
}

/**
 * 校验 fields 载荷：类型 → 顶层键数 → 顶层禁用键 → 深度/体积/环。
 *
 * 顶层禁用键**直接拒请求**而不是静默忽略：`fields.__proto__` 没有任何合法用途，
 * 它出现就意味着有人在探原型链。
 */
export function validateFieldsPayload(fields: unknown): FieldsValidation {
  if (!isPlainObject(fields)) {
    return { ok: false, code: 'FIELDS_INVALID', error: 'fields 必须为普通对象' };
  }
  const keys = Object.keys(fields);
  if (keys.length > MAX_FIELDS_ENTRIES) {
    return {
      ok: false,
      code: 'FIELDS_TOO_MANY',
      error: `fields 字段数超限（最大 ${MAX_FIELDS_ENTRIES} 个）`,
    };
  }
  for (const key of keys) {
    if (isForbiddenFieldKey(key)) {
      return {
        ok: false,
        code: 'FIELDS_FORBIDDEN_KEY',
        error: `fields 含被禁用的键名（${key}）`,
      };
    }
  }
  return walkFields(fields);
}

// ============================================================
// Tokenizer
// ============================================================

const TOKEN_PATTERN = /\{\{[^{}]+\}\}/g;

type Token =
  | { type: 'text'; value: string }
  | { type: 'field'; key: string; raw: string }
  | { type: 'this'; raw: string }
  | { type: 'thisField'; key: string; raw: string }
  | { type: 'if'; key: string; raw: string }
  | { type: 'each'; key: string; raw: string }
  | { type: 'else'; raw: string }
  | { type: 'endif'; raw: string }
  | { type: 'endeach'; raw: string }
  | { type: 'unknown'; raw: string };

function tokenize(template: string, maxTokenCount: number): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  const re = new RegExp(TOKEN_PATTERN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', value: template.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const tag = raw.slice(2, -2).trim();
    if (tag.startsWith('#if ')) {
      tokens.push({ type: 'if', key: tag.slice(4).trim(), raw });
    } else if (tag.startsWith('#each ')) {
      tokens.push({ type: 'each', key: tag.slice(6).trim(), raw });
    } else if (tag === 'else') {
      tokens.push({ type: 'else', raw });
    } else if (tag === '/if') {
      tokens.push({ type: 'endif', raw });
    } else if (tag === '/each') {
      tokens.push({ type: 'endeach', raw });
    } else if (tag === 'this') {
      tokens.push({ type: 'this', raw });
    } else if (tag.startsWith('this.')) {
      tokens.push({ type: 'thisField', key: tag.slice(5).trim(), raw });
    } else if (tag.startsWith('field:')) {
      tokens.push({ type: 'field', key: tag.slice(6).trim(), raw });
    } else {
      // 未识别的标签（{{#unless @last}}、{{@last}}…）原样保留
      tokens.push({ type: 'unknown', raw });
    }
    lastIndex = re.lastIndex;
    if (tokens.length > maxTokenCount) {
      throw new MustacheRenderError(
        'TOKEN_LIMIT_EXCEEDED',
        `模板 token 数超限（最大 ${maxTokenCount} 个）`,
      );
    }
  }
  if (lastIndex < template.length) {
    tokens.push({ type: 'text', value: template.slice(lastIndex) });
  }
  return tokens;
}

// ============================================================
// 块闭合预扫描（O(n)）
// ============================================================

interface BlockRange {
  closeIndex: number;
  elseIndex: number;
}

/**
 * 一次线性扫描算出每个块 token 的 `closeIndex` / `elseIndex`。
 *
 * 加固前是渲染循环里对每个块 token 调 `findBlockEnd`（向后线性扫到配对闭合），
 * 嵌套块的范围互相重叠 → 最坏 O(n²)、「几千个未闭合 `{{#if}}`」就能烧掉主线程。
 * 改成栈式单遍扫描后总复杂度 O(n)，并在压栈时同步检查嵌套深度上限。
 *
 * 容错语义与加固前逐条一致：
 * - 块没有配对闭合 → 不进 ranges，渲染时保留起始标签原文；
 * - 闭合标签找不到同类型的开标签（交叉错配）→ 当孤儿，原样保留。
 */
function precomputeBlockRanges(tokens: Token[], maxBlockDepth: number): Map<number, BlockRange> {
  const ranges = new Map<number, BlockRange>();
  const open: Array<{ index: number; type: 'if' | 'each'; elseIndex: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'if' || tok.type === 'each') {
      open.push({ index: i, type: tok.type, elseIndex: -1 });
      if (open.length > maxBlockDepth) {
        throw new MustacheRenderError(
          'BLOCK_DEPTH_EXCEEDED',
          `模板块嵌套超限（最大 ${maxBlockDepth} 层）`,
        );
      }
    } else if (tok.type === 'else') {
      // 只认最内层尚未闭合的 if（与旧 findBlockEnd 的 depth===1 语义等价）
      const top = open[open.length - 1];
      if (top !== undefined && top.type === 'if' && top.elseIndex === -1) {
        top.elseIndex = i;
      }
    } else if (tok.type === 'endif' || tok.type === 'endeach') {
      const wantType = tok.type === 'endif' ? 'if' : 'each';
      if (open.length > 0 && open[open.length - 1].type === wantType) {
        const frame = open.pop() as { index: number; type: 'if' | 'each'; elseIndex: number };
        ranges.set(frame.index, { closeIndex: i, elseIndex: frame.elseIndex });
      }
      // 类型对不上 → 交叉错配的孤儿闭合标签，保留原文（renderTokens 负责输出）
    }
  }
  return ranges;
}

// ============================================================
// 渲染上下文（预算载体）
// ============================================================

interface RenderContext {
  budget: OutputBudget;
  ranges: Map<number, BlockRange>;
  now: () => number;
  deadline: number;
  tokensSeen: number;
  totalIterations: number;
  /** 上限随 ctx 走（而不是直接读模块常量），测试才能用小上限廉价覆盖同一条分支。 */
  maxBlockDepth: number;
  maxEachIterations: number;
  maxTotalIterations: number;
}

const TIME_CHECK_EVERY = 256;

/** 每 256 个 token 检查一次墙钟预算：均摊 O(1)，不 sleep，纯同步。 */
function checkTime(ctx: RenderContext): void {
  ctx.tokensSeen += 1;
  if (ctx.tokensSeen % TIME_CHECK_EVERY === 0 && ctx.now() > ctx.deadline) {
    throw new MustacheRenderError('TIME_LIMIT_EXCEEDED', `渲染耗时超限（最大 ${MAX_RENDER_MS}ms）`);
  }
}

// ============================================================
// 渲染辅助
// ============================================================

function isTruthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return Boolean(v);
}

/**
 * 字段值 → 字符串。对象走 JSON.stringify。
 * 深度/体积/环已在 `validateFieldsPayload` 阶段挡住，这里不会爆栈。
 */
function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/** 插值统一入口：转义 + 计入输出预算。 */
function interpolate(value: unknown, ctx: RenderContext): string {
  return ctx.budget.append(escapeJavaStringLiteral(renderValue(value)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * 作用域链取值：循环内优先取当前项（`this`），否则回落外层 fields。
 * 两级都用 `readOwn`，因此 `{{#if constructor}}` / `{{#each __proto__}}`
 * 只会得到 MISSING，不会碰到原型链。
 */
function resolveScope(
  currentThis: unknown,
  key: string,
  fields: Record<string, unknown>,
): unknown | Missing {
  const thisObj = asRecord(currentThis);
  if (thisObj !== null) {
    const fromThis = readOwn(thisObj, key);
    if (fromThis !== MISSING) return fromThis;
  }
  return readOwn(fields, key);
}

// ============================================================
// 渲染主循环
// ============================================================

/**
 * 渲染主循环。
 *
 * 用 `[start, end)` 下标区间递归，**不对 tokens 做 slice**：块闭合信息
 * `ctx.ranges` 是按绝对下标预扫描出来的，一旦递归传切片，相对下标就对不上
 * 预扫描结果（嵌套块会错配到外层的闭合标签）。
 */
function renderTokens(
  tokens: Token[],
  start: number,
  end: number,
  fields: Record<string, unknown>,
  currentThis: unknown,
  ctx: RenderContext,
  depth: number,
): string[] {
  if (depth > ctx.maxBlockDepth) {
    throw new MustacheRenderError(
      'BLOCK_DEPTH_EXCEEDED',
      `模板块嵌套超限（最大 ${ctx.maxBlockDepth} 层）`,
    );
  }
  const out: string[] = [];
  let i = start;
  while (i < end) {
    checkTime(ctx);
    const tok = tokens[i];
    switch (tok.type) {
      case 'text':
        // 模板正文原样输出（不转义）：模板是可信骨架，只有字段值需要转义
        out.push(ctx.budget.append(tok.value));
        i += 1;
        break;
      case 'field': {
        const value = readOwn(fields, tok.key);
        if (value === MISSING) {
          out.push(ctx.budget.append(tok.raw)); // 字段缺失保留原占位符
        } else {
          out.push(interpolate(value, ctx));
        }
        i += 1;
        break;
      }
      case 'this':
        out.push(interpolate(currentThis, ctx));
        i += 1;
        break;
      case 'thisField': {
        const obj = asRecord(currentThis);
        const value = obj === null ? MISSING : readOwn(obj, tok.key);
        if (value === MISSING) {
          out.push(ctx.budget.append(tok.raw)); // 子字段缺失保留原占位符
        } else {
          out.push(interpolate(value, ctx));
        }
        i += 1;
        break;
      }
      case 'if':
      case 'each': {
        const range = ctx.ranges.get(i);
        if (range === undefined) {
          // 未闭合，保留起始标签原文后继续渲染后续 token（容错，与加固前一致）
          out.push(ctx.budget.append(tok.raw));
          i += 1;
          break;
        }
        const bodyEnd = range.elseIndex === -1 ? range.closeIndex : range.elseIndex;

        if (tok.type === 'if') {
          const condVal = resolveScope(currentThis, tok.key, fields);
          const truthy = condVal !== MISSING && isTruthy(condVal);
          const branchStart = truthy ? i + 1 : range.elseIndex === -1 ? i + 1 : range.elseIndex + 1;
          const branchEnd = truthy ? bodyEnd : range.elseIndex === -1 ? i + 1 : range.closeIndex;
          // 逐个 push 而不是 out.push(...arr)：展开实参会撞上「参数个数上限」
          // （1 万次 each × 多 token 就能撞），这里必须是显式循环。
          for (const chunk of renderTokens(
            tokens,
            branchStart,
            branchEnd,
            fields,
            currentThis,
            ctx,
            depth + 1,
          )) {
            out.push(chunk);
          }
        } else {
          const arr = resolveScope(currentThis, tok.key, fields);
          let items: unknown[] = [];
          if (arr !== MISSING && Array.isArray(arr)) {
            items = arr;
          } else if (arr !== MISSING && arr !== null && arr !== undefined) {
            items = [arr]; // 非数组视为单元素遍历（与加固前一致）
          }
          if (items.length > ctx.maxEachIterations) {
            throw new MustacheRenderError(
              'ITERATION_LIMIT_EXCEEDED',
              `{{#each}} 迭代数超限（最大 ${ctx.maxEachIterations} 次，实际 ${items.length}）`,
            );
          }
          ctx.totalIterations += items.length;
          if (ctx.totalIterations > ctx.maxTotalIterations) {
            throw new MustacheRenderError(
              'ITERATION_LIMIT_EXCEEDED',
              `本次渲染总迭代数超限（最大 ${ctx.maxTotalIterations} 次）`,
            );
          }
          for (const item of items) {
            for (const chunk of renderTokens(
              tokens,
              i + 1,
              bodyEnd,
              fields,
              item,
              ctx,
              depth + 1,
            )) {
              out.push(chunk);
            }
          }
        }
        i = range.closeIndex + 1;
        break;
      }
      case 'else':
      case 'endif':
      case 'endeach':
      case 'unknown':
        // 孤立的闭合标签 / else / 未识别标签：原样保留
        out.push(ctx.budget.append(tok.raw));
        i += 1;
        break;
    }
  }
  return out;
}

// ============================================================
// 对外入口
// ============================================================

export interface RenderMustacheLimits {
  maxTemplateLength: number;
  maxTokenCount: number;
  maxOutputLength: number;
  maxBlockDepth: number;
  maxEachIterations: number;
  maxTotalIterations: number;
  maxRenderMs: number;
}

/** 生产必须用这套默认值（与主进程 `DEFAULT_LIMITS` 逐条相等）。 */
export const DEFAULT_LIMITS: RenderMustacheLimits = {
  maxTemplateLength: MAX_TEMPLATE_LENGTH,
  maxTokenCount: MAX_TOKEN_COUNT,
  maxOutputLength: MAX_OUTPUT_LENGTH,
  maxBlockDepth: MAX_BLOCK_DEPTH,
  maxEachIterations: MAX_EACH_ITERATIONS,
  maxTotalIterations: MAX_TOTAL_ITERATIONS,
  maxRenderMs: MAX_RENDER_MS,
};

export interface RenderMustacheOptions {
  /** 注入时钟（默认 `Date.now`），用于把耗时上限变成可测断言，无需 sleep。 */
  now?: () => number;
  /** 覆盖上限（**仅测试/bench**；生产必须走 `DEFAULT_LIMITS`，收紧到与主进程一致）。 */
  limits?: Partial<RenderMustacheLimits>;
}

function renderCore(
  template: string,
  fields: Record<string, unknown>,
  limits: RenderMustacheLimits,
  now: () => number,
): string {
  const tokens = tokenize(template, limits.maxTokenCount);
  const ctx: RenderContext = {
    budget: createOutputBudget(limits.maxOutputLength),
    ranges: precomputeBlockRanges(tokens, limits.maxBlockDepth),
    now,
    deadline: now() + limits.maxRenderMs,
    tokensSeen: 0,
    totalIterations: 0,
    maxBlockDepth: limits.maxBlockDepth,
    maxEachIterations: limits.maxEachIterations,
    maxTotalIterations: limits.maxTotalIterations,
  };
  return renderTokens(tokens, 0, tokens.length, fields, undefined, ctx, 0).join('');
}

/**
 * 渲染入口。**超预算 / 非法输入一律抛 `MustacheRenderError`**（带 `code`），
 * 绝不返回一段「截断的、看起来像正常结果」的字符串 —— 那会让上层
 * 把被拒绝的模板当成编译成功的代码继续用。
 *
 * 校验顺序刻意是「先小后大」：模板类型/长度 → fields 类型/键数 → fields 深度体积
 * → token 数 → 块嵌套 → 逐块渲染（预算/耗时/迭代）。
 *
 * 正常路径不抛异常（与加固前签名/行为兼容）：合法模板的返回值逐字节不变。
 */
export function renderMustache(
  template: unknown,
  fields: unknown,
  options: RenderMustacheOptions = {},
): string {
  const limits: RenderMustacheLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const now = options.now ?? Date.now;
  try {
    if (typeof template !== 'string') {
      throw new MustacheRenderError('TEMPLATE_INVALID', '模板必须为字符串');
    }
    if (template.length > limits.maxTemplateLength) {
      throw new MustacheRenderError(
        'TEMPLATE_TOO_LARGE',
        `模板长度超限（最大 ${limits.maxTemplateLength} 字符）`,
      );
    }
    const validated = validateFieldsPayload(fields);
    if (!validated.ok) {
      throw new MustacheRenderError(validated.code, validated.error);
    }
    return renderCore(template, validated.value, limits, now);
  } catch (err) {
    if (err instanceof MustacheRenderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new MustacheRenderError('RENDER_FAILED', `渲染失败：${msg}`);
  }
}
