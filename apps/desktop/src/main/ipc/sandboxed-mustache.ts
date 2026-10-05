/**
 * 沙箱化 Mustache 渲染 —— 主进程侧**唯一**实现（加固版）。
 *
 * ============================ 为什么没有 isolated-vm ============================
 * 本文件取代了此前 `generate.ts` 里两份同构的渲染实现（`renderMustachePure`
 * 的闭包 + isolated-vm 沙箱脚本字符串里的抄写版）。实测结论：
 *
 * 1. 沙箱里跑的**不是用户代码**，而是我们自己写死的约 100 行 Mustache 渲染器。
 *    `template` / `fields` 是作为**数据**注入的（ExternalCopy），从不作为代码执行，
 *    所以「V8 级隔离防恶意 JS」这个威胁模型在这里根本不成立。
 * 2. isolated-vm@7.0.1 在 Electron 44.4.3 上**必然 require 失败**：
 *    win32-x64 只有 abi137(Node24)/abi147 预编译，Electron 44 的 ABI 是 149；
 *    实测报错 `No native build was found for ... abi=149`。
 *    （源码重编也不行：V8 15.x 的 `v8::External::New` 签名已变。）
 * 3. 那段沙箱脚本字符串本身是** TypeScript **（含 `x as T` / `let v: T`），
 *    `new Function(src)` 直接 SyntaxError；即便原生模块能加载也会静默回退。
 *
 * 也就是说：沙箱提供不了任何额外安全价值，却带来「同一套渲染逻辑写两遍」的结构性
 * 缺陷 —— 任何安全修复都要做两遍，漏一处就是漏洞。这里用**严格输入校验 + 资源
 * 预算**替代它，把渲染逻辑收敛成一份。
 *
 * ============================ 真实威胁与对应防线 ============================
 * 恶意输入能打爆的是**主进程**（内存 / CPU），不是执行任意代码：
 *
 * | 攻击输入                                   | 修之前                     | 修之后                       |
 * |-------------------------------------------|----------------------------|------------------------------|
 * | `{{field:constructor}}` / `{{field:__proto__}}` | `key in fields` 命中原型链，泄出 Object 构造函数 | `readOwn` 只读自有属性 + 禁用键，判为「缺失」 |
 * | `{{#each __proto__}}`                      | 遍历原型链成员            | 判为「缺失」→ 不遍历         |
 * | 小模板 + 100MB 字段值                       | 输出无上限 → 堆耗尽       | `MAX_OUTPUT_LENGTH` 增量预算，超限立即中断 |
 * | 数千层 `{{#if}}`                           | `findBlockEnd` O(n²) → CPU 打满 | 预扫描 O(n) + `MAX_BLOCK_DEPTH` |
 * | 超大数组 `{{#each}}`                        | 无上限 → CPU/内存双杀     | `MAX_EACH_ITERATIONS` / `MAX_TOTAL_ITERATIONS` |
 * | 深层嵌套 / 环形 fields 对象                 | `JSON.stringify` 爆栈      | 迭代式预校验（深度/节点数/环检测） |
 *
 * ============================ 语义兼容承诺 ============================
 * 对**合法**输入，输出与渲染层那份 `mustacheRender.renderMustache` 逐字节一致
 * （`sandboxed-mustache.test.ts` 里有逐例对照的回归防线）。差别只在两处，且都是
 * 刻意的安全收紧：
 * 1. 原型链键不再可读（视为「缺失」→ 保留原占位符，与字段缺失行为一致）；
 * 2. 超预算的输入返回结构化错误而不是继续拼字符串。
 */

import { escapeJavaStringLiteral } from './java-escape.js';

// ============================================================
// 上限常量（取值依据逐条写在注释里，改动前请先读）
// ============================================================

/**
 * 模板长度上限。与 `shared/ipc/sandbox.ts` 里 zod 的 `.max(50000)` 对齐，
 * 两处必须同时改（schema 负责挡 IPC 入口，本常量负责渲染层自查）。
 */
export const MAX_TEMPLATE_LENGTH = 50_000;

/**
 * token 数量上限。推导值：最短合法标签是 `{{a}}`（5 字符），故 50KB 模板
 * 最多产出 `50000 / 5 = 10000` 个 token。显式设限是为了让「tokenize 不会
 * 被单个巨型模板撑爆数组」成为可测的不变量，而不是依赖推导。
 */
export const MAX_TOKEN_COUNT = Math.ceil(MAX_TEMPLATE_LENGTH / 5);

/**
 * 渲染输出总长度上限：**5 MiB**。
 *
 * 取值依据：
 * - 合法场景是「自定义节点的 Java 代码片段」，实测规模在几十 ~ 几百 KB；
 *   5 MiB 已是它的 ~20 倍余量，不会误伤正常模板。
 * - 反过来看攻击收益：`{{field:x}}` 展开 100MB 字段是 50KB 模板的 2000 倍
 *   放大，这条上限把单次渲染的最坏堆占用钉死在 5 MiB（JS 字符串按 UTF-16
 *   存，实际 ~10 MiB），杜绝 OOM。
 * - 与既有 GENERATE_FILES 通道一致：那边 >10MB 的文件已经走分块下载通道，
 *   说明「单次返回值 5 MiB 量级」是本项目 IPC 的既有量级假设。
 */
export const MAX_OUTPUT_LENGTH = 5 * 1024 * 1024;

/**
 * 块嵌套深度上限：**16 层**。
 *
 * 取值依据：合法模板最多 2~4 层（`#each` 里 `#if`，再里一层 `#each`）；
 * 16 层仍有 4 倍余量。同时它还兜住两件事：
 * - `renderTokens` 是真递归，深度上限顺带防 V8 调用栈溢出；
 * - 闭合标签预扫描是 O(n)，未闭合的深层模板（如 5000 个 `{{#if}}`）会在
 *   压栈时直接被拒，不会退化成旧 `findBlockEnd` 的 O(n²) 全量扫描。
 */
export const MAX_BLOCK_DEPTH = 16;

/**
 * 单个 `{{#each}}` 的迭代上限：**1 万次**。
 * 取值依据：合法模板遍历的是节点配置里的条目列表（物品 / 生物 / 配方条目），
 * 实测在几十条；1 万条是 ~200 倍余量。
 */
export const MAX_EACH_ITERATIONS = 10_000;

/**
 * 单次渲染的**总**迭代上限：**5 万次**。
 * 取值依据：单个 `#each` 的上限挡不住嵌套相乘（1 万 × 1 万），
 * 所以再加一道全局预算；5 万 ≈ 单块上限的 5 倍，嵌套 2~3 层仍够用。
 */
export const MAX_TOTAL_ITERATIONS = 50_000;

/** fields 顶层键数上限。与 `shared/ipc/sandbox.ts` 的 zod refine（≤100）一致。 */
export const MAX_FIELDS_ENTRIES = 100;

/**
 * fields 值的嵌套深度上限：**8 层**。
 * 取值依据：合法字段值是扁平标量或「一层数组 of 扁平对象」（节点 schema 产物），
 * 8 层余量充足。存在的理由是 `renderValue` 对对象走 `JSON.stringify`，
 * 深层嵌套会递归爆栈。
 */
export const MAX_FIELDS_DEPTH = 8;

/**
 * fields 值的字符串总量上限：**8 Mi**（单位为 JS 字符串长度，即 UTF-16 码元数）。
 * 取值依据：fields 由 `sanitizeFields` 从节点 schema 产出（短 id / 名称 / 枚举），
 * 正常 <10 KB，8 Mi 是 ~800 倍余量；同时保证单次渲染的输入不会主导主进程堆。
 */
export const MAX_FIELDS_BYTES = 8 * 1024 * 1024;

/**
 * fields 遍历节点数上限：**2 万**（实现里按 `MAX_FIELDS_NODES * 4` 个「被检查的值」
 * 计数，含数组元素），取值依据：让「校验本身」也是有界 O(n) 的，防止用巨型对象
 * 把校验阶段变成新的 CPU 靶子。合法载荷实测在 ~10³ 量级，这里是 80 倍余量。
 */
export const MAX_FIELDS_NODES = 20_000;

/**
 * 键名长度上限：**128 字符**。
 * 取值依据：键名来自节点 schema 的 `field.key`，是短标识符；128 足够，
 * 同时避免超长键名在多次查找/字符串驻留上做无谓功。
 */
export const MAX_KEY_LENGTH = 128;

/**
 * 渲染耗时上限：**250ms**（墙钟）。
 * 取值依据：渲染是主线程上的同步调用，UI 不能被卡住；合法模板渲染耗时 <1ms，
 * 250ms 只用来兜住病态输入。每 256 个 token 检查一次 `now()`，开销可忽略。
 * 可测：入口接受注入的 `now`（见 `RenderMustacheOptions`），无需 sleep。
 */
export const MAX_RENDER_MS = 250;

// ============================================================
// 错误类型（结构化：code 给程序判断，message 给人看）
// ============================================================

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

/** 带机器可读 code 的渲染错误。内部抛出，入口统一转成 `{ ok:false, code, error }`。 */
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
 * 渲染层所有取值都必须先过它 —— 这是「模板读不到原型链」的唯一入口。
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
 * 这是加固的核心：旧实现写的是 `tok.key in fields`，`in` 会命中原型链
 * （`'constructor' in {}` 为真），于是 `{{field:constructor}}` 能读到
 * `Object` 构造函数。`Object.hasOwn` 只看自有属性，配合 `sanitizeFieldKey`
 * 拦掉原型链键，两道防线一起把这条读通道焊死。
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

/** 输出预算累加器：增量记账，超限**立刻**抛，而不是渲染完再看。 */
export interface OutputBudget {
  readonly limit: number;
  readonly used: number;
  /** 记账并返回该片段；超限抛 `OUTPUT_LIMIT_EXCEEDED`。 */
  append(chunk: string): string;
}

/** 断言累计长度未超限（独立导出，便于单测与复用）。 */
export function assertWithinOutputBudget(used: number, limit: number = MAX_OUTPUT_LENGTH): void {
  if (used > limit) {
    throw new MustacheRenderError(
      'OUTPUT_LIMIT_EXCEEDED',
      `渲染输出超限（最大 ${limit} 字符 ≈ ${formatLimit(limit)}，已达 ${used}）`,
    );
  }
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
      assertWithinOutputBudget(used, limit);
      return chunk;
    },
  };
}

// ============================================================
// fields 预校验（深度 / 体积 / 环 / 禁用键）
// ============================================================

export type FieldsValidation =
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

/** 非对象值里的「不支持类型」（函数 / Date / Map / 类实例…）。 */
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
 * 两个刻意的实现选择：
 * 1. **显式栈 + enter/exit 帧**，而不是递归：被校验的数据来自 IPC，是攻击者可控的，
 *    递归遍历等于把校验器自己变成爆栈靶子（旧实现直接在 `renderValue` 里递归
 *    `JSON.stringify`，深层对象必炸）。
 * 2. **for...in + Object.hasOwn**，而不是 `Object.keys`：遍历期不分配键数组，
 *    校验器自身的内存开销也是常量级；`for...in` 会带上原型链上的可枚举键，
 *    hasOwn 守卫正好把它们滤掉（顺带免疫原型污染）。
 *
 * 环检测只在**当前 DFS 路径**上放行同一个对象：DAG 里重复引用同一对象是合法的，
 * 只有指回祖先的引用才是环。
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

  /** 记一个字符串长度，超限返回错误；返回 null 表示继续。 */
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
          // 标量元素（number / boolean / null / undefined）插值安全，无需下钻
          if (item === null || typeof item !== 'object') continue;
          // 先判环（数组自引用/指回祖先都是环），再判是否可下钻
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
 * 顶层禁用键**直接拒请求**而不是静默忽略：`fields.__proto__` 没有任何合法
 * 用途，它出现就意味着有人在探原型链。
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
// 块闭合预扫描（O(n)，替掉旧的 O(n²) findBlockEnd）
// ============================================================

interface BlockRange {
  closeIndex: number;
  elseIndex: number;
}

/**
 * 一次线性扫描算出每个块 token 的 `closeIndex` / `elseIndex`。
 *
 * 旧实现在渲染循环里对每个块 token 调 `findBlockEnd`（向后线性扫到配对闭合），
 * 嵌套块的范围互相重叠 → 最坏 O(n²)，「几千个未闭合 `{{#if}}`」就能把主线程
 * 烧掉。改成栈式单遍扫描后总复杂度 O(n)，并在压栈时同步检查嵌套深度上限。
 *
 * 容错语义与旧实现保持一致：
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
 * 预扫描结果（嵌套块会错配到外层的闭合标签 —— 这正是实现期实测踩到的坑）。
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
          // 未闭合，保留起始标签原文后继续渲染后续 token（容错，与旧实现一致）
          out.push(ctx.budget.append(tok.raw));
          i += 1;
          break;
        }
        const bodyEnd = range.elseIndex === -1 ? range.closeIndex : range.elseIndex;

        if (tok.type === 'if') {
          const condVal = resolveScope(currentThis, tok.key, fields);
          const truthy = condVal !== MISSING && isTruthy(condVal);
          // 三分支：真 → body；假且有 else → else 体；假且无 else → 空区间
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
            items = [arr]; // 非数组视为单元素遍历（与旧实现一致）
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
  /** 覆盖上限（测试用；生产走 `DEFAULT_LIMITS`）。 */
  limits?: Partial<RenderMustacheLimits>;
}

export type MustacheRenderOutcome =
  { ok: true; result: string } | { ok: false; code: MustacheRenderErrorCode; error: string };

function formatLimit(n: number): string {
  return n % 1024 === 0 && n >= 1024 ? `${n / 1024}KiB` : String(n);
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
 * 渲染入口：**不抛异常**，统一返回结构化结果。
 *
 * 校验顺序刻意是「先小后大」：模板类型/长度 → fields 类型/键数 → fields 深度体积
 * → token 数 → 块嵌套 → 逐块渲染（预算/耗时/迭代）。
 * 先过便宜的校验，病态输入最晚在真正开始拼字符串之前就被拒。
 */
export function renderMustacheHardened(
  template: unknown,
  fields: unknown,
  options: RenderMustacheOptions = {},
): MustacheRenderOutcome {
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
    return { ok: true, result: renderCore(template, validated.value, limits, now) };
  } catch (err) {
    if (err instanceof MustacheRenderError) {
      return { ok: false, code: err.code, error: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: 'RENDER_FAILED', error: `渲染失败：${msg}` };
  }
}
