/**
 * 沙箱化 Mustache 渲染（主进程加固版）测试。
 *
 * 覆盖三类：
 * 1. **真实攻击输入**（不是 happy path）：原型链键读取、输出放大、深度嵌套、
 *    超大数组、深层/环形 fields —— 逐条断言「被什么挡住」。
 * 2. **回归防线**：合法模板的渲染结果一条都不许变；并与渲染层那份
 *    `mustacheRender.renderMustache` 逐例对照（两份实现的输出一致性）。
 * 3. **可测性纪律**：深度/长度/耗时类上限全部同步可断言，
 *    耗时上限用**注入时钟**验证，绝不 sleep。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join as joinPath } from 'node:path';
import {
  renderMustacheHardened,
  validateFieldsPayload,
  isForbiddenFieldKey,
  sanitizeFieldKey,
  assertWithinOutputBudget,
  createOutputBudget,
  MustacheRenderError,
  MAX_TEMPLATE_LENGTH,
  MAX_TOKEN_COUNT,
  MAX_BLOCK_DEPTH,
  MAX_EACH_ITERATIONS,
  MAX_TOTAL_ITERATIONS,
  MAX_FIELDS_ENTRIES,
  MAX_FIELDS_DEPTH,
  DEFAULT_LIMITS,
} from './sandboxed-mustache.js';
import { escapeJavaStringLiteral as escapeMain } from './java-escape.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 读同目录源码文本（用于结构性断言，不参与渲染逻辑）。 */
function readSource(file: string): string {
  return readFileSync(joinPath(HERE, file), 'utf8');
}

/** 去掉注释后再断言：注释里可以（也应该）解释「曾经长什么样」，不该被当成代码。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 断言渲染成功并返回字符串（失败时把结构化错误一起打出来，便于定位）。 */
function renderOk(template: string, fields: unknown = {}): string {
  const out = renderMustacheHardened(template, fields);
  if (!out.ok) {
    throw new Error(`期望渲染成功，实际失败：${out.code} / ${out.error}`);
  }
  return out.result;
}

/** 断言渲染被拒，并返回错误 code。 */
function renderErr(template: string, fields: unknown = {}): string {
  const out = renderMustacheHardened(template, fields);
  if (out.ok) {
    throw new Error(`期望渲染被拒，实际成功：${out.result.slice(0, 120)}`);
  }
  return out.code;
}

/** 构造 depth 层嵌套的 {{#if}} 模板（含 /if 收尾）。 */
function nestedIfTemplate(depth: number): string {
  return '{{#if a}}'.repeat(depth) + 'X' + '{{/if}}'.repeat(depth);
}

// ============================================================
// 1. 原型链读取（修复前：{{field:constructor}} 能读到 Object 构造函数）
// ============================================================

describe('原型链防线：模板侧的原型链键一个都读不到', () => {
  it('{{field:constructor}} 不会泄出 Object 构造函数（判为缺失，保留占位符）', () => {
    const result = renderOk('{{field:constructor}}', {});
    expect(result).toBe('{{field:constructor}}');
    expect(result).not.toContain('function');
    expect(result).not.toContain('[native code]');
  });

  it('{{field:__proto__}} 读不到 Object.prototype', () => {
    const result = renderOk('{{field:__proto__}}', {});
    expect(result).toBe('{{field:__proto__}}');
    expect(result).not.toContain('hasOwnProperty');
  });

  it('{{field:prototype}} 读不到原型对象', () => {
    expect(renderOk('{{field:prototype}}', {})).toBe('{{field:prototype}}');
  });

  it('{{this.constructor}} 在 #each 内也读不到构造函数', () => {
    const result = renderOk('{{#each xs}}{{this.constructor}};{{/each}}', { xs: [{}, {}] });
    expect(result).toBe('{{this.constructor}};{{this.constructor}};');
    expect(result).not.toContain('function');
  });

  it('{{this.__proto__}} 在 #each 内读不到原型', () => {
    const result = renderOk('{{#each xs}}{{this.__proto__}}{{/each}}', { xs: [{ a: 1 }] });
    expect(result).toBe('{{this.__proto__}}');
  });

  it('{{#each __proto__}} 不遍历原型链（既不报错也不输出）', () => {
    expect(renderOk('A{{#each __proto__}}LEAK{{/each}}B', {})).toBe('AB');
    expect(renderOk('A{{#each constructor}}LEAK{{/each}}B', {})).toBe('AB');
    expect(renderOk('A{{#each prototype}}LEAK{{/each}}B', {})).toBe('AB');
  });

  it('{{#if constructor}} 条件恒为假（Object 构造函数是 truthy，若能读到就会走 then 分支）', () => {
    expect(renderOk('{{#if constructor}}THEN{{else}}ELSE{{/if}}', {})).toBe('ELSE');
    expect(renderOk('{{#if __proto__}}THEN{{else}}ELSE{{/if}}', {})).toBe('ELSE');
  });

  it('#each 内 {{#if this.constructor}} 同样恒为假（作用域链优先查 this）', () => {
    const result = renderOk('{{#each xs}}{{#if this.constructor}}T{{else}}F{{/if}}{{/each}}', {
      xs: [{ a: 1 }],
    });
    expect(result).toBe('F');
  });

  it('fields 顶层带 __proto__/constructor 键 → 整个请求被拒', () => {
    expect(renderErr('{{field:a}}', JSON.parse('{"__proto__":{"x":1}}'))).toBe(
      'FIELDS_FORBIDDEN_KEY',
    );
    expect(renderErr('{{field:a}}', { constructor: 'evil' })).toBe('FIELDS_FORBIDDEN_KEY');
    expect(renderErr('{{field:a}}', JSON.parse('{"prototype":1}'))).toBe('FIELDS_FORBIDDEN_KEY');
  });

  it('显式 Object.create(null) 的 fields（无原型）正常工作', () => {
    const fields = Object.create(null) as Record<string, unknown>;
    fields.speed = '50';
    expect(renderOk('int {{field:speed}};', fields)).toBe('int 50;');
  });

  it('原型链键判定函数是纯函数、可单测', () => {
    expect(isForbiddenFieldKey('__proto__')).toBe(true);
    expect(isForbiddenFieldKey('prototype')).toBe(true);
    expect(isForbiddenFieldKey('constructor')).toBe(true);
    expect(isForbiddenFieldKey('speed')).toBe(false);
    expect(sanitizeFieldKey(' speed ')).toBe('speed');
    expect(sanitizeFieldKey('__proto__')).toBeNull();
    expect(sanitizeFieldKey('')).toBeNull();
    expect(sanitizeFieldKey('   ')).toBeNull();
    expect(sanitizeFieldKey('a'.repeat(129))).toBeNull();
    expect(sanitizeFieldKey('a'.repeat(128))).toBe('a'.repeat(128));
  });
});

// ============================================================
// 2. 输出放大（修复前：小模板 + 100MB 字段 → 输出无上限 → OOM）
// ============================================================

describe('输出长度上限：渲染中途即中断，不等拼完', () => {
  it('小模板 + 6MB 字段值 → 命中 5MiB 默认上限，返回结构化错误而非 OOM', () => {
    // 21 字符模板 → 6MB 输出，放大 30 万倍：修之前这会直接把 6MB 全量拼出来
    const huge = 'x'.repeat(6 * 1024 * 1024);
    const out = renderMustacheHardened('A{{field:big}}B', { big: huge });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('OUTPUT_LIMIT_EXCEEDED');
    expect(out.error).toContain(String(DEFAULT_LIMITS.maxOutputLength));
  });

  it('#each 放大：7000 × 900 字符 → 输出超限被拒（模板仍然很小）', () => {
    // 元素总量 ~6.3MB < fields 上限 8MiB，所以能走到「输出」这一关：
    // 两道预算各管一段输入放大与一段输出放大，缺一不可。
    const xs = Array.from({ length: 7000 }, (_, i) => String(i).padStart(900, '0'));
    expect(renderErr('{{#each xs}}{{this}}{{/each}}', { xs })).toBe('OUTPUT_LIMIT_EXCEEDED');
  });

  it('输出预算超限立即抛出，且记账只累加本次追加量（可单测的纯函数）', () => {
    const budget = createOutputBudget(10);
    expect(budget.append('abc')).toBe('abc');
    expect(budget.used).toBe(3);
    expect(() => budget.append('12345678')).toThrow(MustacheRenderError);
    expect(() => budget.append('12345678')).toThrow(/输出超限/);
    // 单独断言：assertWithinOutputBudget 是导出纯函数
    expect(() => assertWithinOutputBudget(10, 10)).not.toThrow();
    expect(() => assertWithinOutputBudget(11, 10)).toThrow(MustacheRenderError);
  });

  it('小上限注入：同一段模板在 8 字节预算下被拒（证明超限点与模板无关）', () => {
    const out = renderMustacheHardened(
      '{{field:a}}{{field:a}}',
      { a: 'abcdefghij' },
      {
        limits: { maxOutputLength: 8 },
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('OUTPUT_LIMIT_EXCEEDED');
  });

  it('模板正文本身也计入预算（不是只算字段插值）', () => {
    const out = renderMustacheHardened('y'.repeat(500), {}, { limits: { maxOutputLength: 100 } });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('OUTPUT_LIMIT_EXCEEDED');
  });

  it('恰好等于上限的输出仍然放行（边界不含糊）', () => {
    const out = renderMustacheHardened('abcde', {}, { limits: { maxOutputLength: 5 } });
    expect(out).toEqual({ ok: true, result: 'abcde' });
  });
});

// ============================================================
// 3. 嵌套深度（修复前：findBlockEnd O(n²) + 无上限递归）
// ============================================================

describe('块嵌套深度上限', () => {
  it(`${MAX_BLOCK_DEPTH} 层嵌套放行（边界值合法）`, () => {
    expect(renderOk(nestedIfTemplate(MAX_BLOCK_DEPTH), { a: true })).toBe('X');
  });

  it(`${MAX_BLOCK_DEPTH + 1} 层嵌套 → BLOCK_DEPTH_EXCEEDED`, () => {
    expect(renderErr(nestedIfTemplate(MAX_BLOCK_DEPTH + 1), { a: true })).toBe(
      'BLOCK_DEPTH_EXCEEDED',
    );
  });

  it('2000 层嵌套的病态模板立即被拒（修之前这会触发 O(n²) 扫描烧 CPU）', () => {
    expect(renderErr('{{#if a}}'.repeat(2000), { a: true })).toBe('BLOCK_DEPTH_EXCEEDED');
  });

  it('#each 与 #if 混合嵌套同样受限', () => {
    const tpl = '{{#each xs}}'.repeat(20) + 'X' + '{{/each}}'.repeat(20);
    expect(renderErr(tpl, { xs: [1] })).toBe('BLOCK_DEPTH_EXCEEDED');
  });

  it('小上限注入：depth=2 的模板在上限 1 下被拒（证明检查点在预扫描而非事后）', () => {
    const out = renderMustacheHardened(
      '{{#if a}}{{#if a}}X{{/if}}{{/if}}',
      { a: true },
      {
        limits: { maxBlockDepth: 1 },
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('BLOCK_DEPTH_EXCEEDED');
  });
});

// ============================================================
// 4. 迭代上限（修复前：{{#each}} 遍历任意长度数组）
// ============================================================

describe('#each 迭代上限', () => {
  it(`${MAX_EACH_ITERATIONS} 个元素放行`, () => {
    const xs = Array.from({ length: MAX_EACH_ITERATIONS }, (_, i) => i);
    expect(renderOk('{{#each xs}}.{{/each}}', { xs })).toBe('.'.repeat(MAX_EACH_ITERATIONS));
  });

  it(`${MAX_EACH_ITERATIONS + 1} 个元素 → ITERATION_LIMIT_EXCEEDED`, () => {
    const xs = Array.from({ length: MAX_EACH_ITERATIONS + 1 }, (_, i) => i);
    expect(renderErr('{{#each xs}}.{{/each}}', { xs })).toBe('ITERATION_LIMIT_EXCEEDED');
  });

  it('嵌套相乘被全局预算挡住（单块都合规，2 × 4 万 = 8 万 > 5 万）', () => {
    const xs = Array.from({ length: MAX_EACH_ITERATIONS }, (_, i) => i);
    const tpl = '{{#each xs}}{{#each xs}}{{/each}}{{/each}}';
    expect(renderErr(tpl, { xs })).toBe('ITERATION_LIMIT_EXCEEDED');
  });

  it('小上限注入：同一模板在 maxEachIterations=3 下被拒', () => {
    const out = renderMustacheHardened(
      '{{#each xs}}{{this}};{{/each}}',
      { xs: [1, 2, 3, 4] },
      {
        limits: { maxEachIterations: 3 },
      },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('ITERATION_LIMIT_EXCEEDED');
  });

  it('MAX_TOTAL_ITERATIONS 只在跨块累计时生效（单块用 maxEachIterations 卡）', () => {
    // 3 个块 × 每次 4 个元素：单块 4 < 5，总计 12 > 10
    const out = renderMustacheHardened(
      '{{#each xs}}{{/each}}{{#each xs}}{{/each}}{{#each xs}}{{/each}}',
      { xs: [1, 2, 3, 4] },
      { limits: { maxEachIterations: 5, maxTotalIterations: 10 } },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('ITERATION_LIMIT_EXCEEDED');
  });
});

// ============================================================
// 5. fields 自身：深度 / 体积 / 环 / 类型（修之前靠 JSON.stringify 递归，会爆栈）
// ============================================================

describe('fields 载荷预校验', () => {
  it('深层嵌套对象（100 层）→ FIELDS_TOO_DEEP，而不是爆栈', () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 100; i++) deep = { nested: deep };
    expect(renderErr('{{field:root}}', { root: deep })).toBe('FIELDS_TOO_DEEP');
  });

  it(`${MAX_FIELDS_DEPTH} 层放行`, () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    // root(depth1) → ... 让最深一层正好是 MAX_FIELDS_DEPTH
    for (let i = 0; i < MAX_FIELDS_DEPTH - 2; i++) deep = { nested: deep };
    const validated = validateFieldsPayload({ root: deep });
    expect(validated.ok).toBe(true);
  });

  it('环形引用 → FIELDS_CYCLIC', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic.self = cyclic;
    expect(renderErr('{{field:c}}', { c: cyclic })).toBe('FIELDS_CYCLIC');
  });

  it('数组自引用 → FIELDS_CYCLIC', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(renderErr('{{field:a}}', { a: arr })).toBe('FIELDS_CYCLIC');
  });

  it('DAG（同一对象被引用两次）不算环，正常放行', () => {
    const shared = { v: 1 };
    const out = renderMustacheHardened('{{field:a}}{{field:b}}', { a: shared, b: shared });
    expect(out.ok).toBe(true);
  });

  it('函数值 → UNSUPPORTED_VALUE_TYPE（不把源码文本写进产物）', () => {
    expect(renderErr('{{field:fn}}', { fn: () => 'leak' })).toBe('UNSUPPORTED_VALUE_TYPE');
  });

  it('Date / Map / 类实例 → UNSUPPORTED_VALUE_TYPE', () => {
    expect(renderErr('{{field:d}}', { d: new Date(0) })).toBe('UNSUPPORTED_VALUE_TYPE');
    expect(renderErr('{{field:m}}', { m: new Map() })).toBe('UNSUPPORTED_VALUE_TYPE');
    class Custom {
      v = 1;
    }
    expect(renderErr('{{field:c}}', { c: new Custom() })).toBe('UNSUPPORTED_VALUE_TYPE');
  });

  it('字符串总量超限 → FIELDS_TOO_LARGE', () => {
    const big = { s: 'x'.repeat(9 * 1024 * 1024) };
    expect(renderErr('{{field:s}}', big)).toBe('FIELDS_TOO_LARGE');
  });

  it('数组元素总量超限 → FIELDS_TOO_LARGE（输入侧的预算，挡在渲染之前）', () => {
    const xs = Array.from({ length: 100 }, () => 'y'.repeat(100 * 1024));
    expect(renderErr('{{#each xs}}{{/each}}', { xs })).toBe('FIELDS_TOO_LARGE');
  });

  it('值节点数超限 → FIELDS_TOO_LARGE（不让校验本身成为 CPU 靶子）', () => {
    const xs = Array.from({ length: 90_000 }, (_, i) => i);
    expect(renderErr('{{#each xs}}{{/each}}', { xs })).toBe('FIELDS_TOO_LARGE');
  });

  it('字段数超限 → FIELDS_TOO_MANY', () => {
    const fields: Record<string, unknown> = {};
    for (let i = 0; i <= MAX_FIELDS_ENTRIES; i++) fields[`f${i}`] = i;
    expect(renderErr('{{field:f0}}', fields)).toBe('FIELDS_TOO_MANY');
  });

  it('fields 不是普通对象 → FIELDS_INVALID', () => {
    expect(renderErr('x', null)).toBe('FIELDS_INVALID');
    expect(renderErr('x', [1, 2])).toBe('FIELDS_INVALID');
    expect(renderErr('x', 'not-an-object')).toBe('FIELDS_INVALID');
    expect(renderErr('x', 42)).toBe('FIELDS_INVALID');
  });
});

// ============================================================
// 6. 模板层校验 + 耗时上限（注入时钟，不 sleep）
// ============================================================

describe('模板层校验与耗时预算', () => {
  it('模板超长 → TEMPLATE_TOO_LARGE', () => {
    expect(renderErr('a'.repeat(MAX_TEMPLATE_LENGTH + 1), {})).toBe('TEMPLATE_TOO_LARGE');
  });

  it('恰好等于上限的模板放行', () => {
    expect(renderOk('a'.repeat(MAX_TEMPLATE_LENGTH), {})).toBe('a'.repeat(MAX_TEMPLATE_LENGTH));
  });

  it('模板不是字符串 → TEMPLATE_INVALID', () => {
    expect(renderErr(123 as unknown as string, {})).toBe('TEMPLATE_INVALID');
    expect(renderErr(null as unknown as string, {})).toBe('TEMPLATE_INVALID');
  });

  it(`token 数上限是推导值：${MAX_TOKEN_COUNT} 个最短标签刚好塞满 ${MAX_TEMPLATE_LENGTH} 字符`, () => {
    // 不变式：最短标签 `{{a}}` = 5 字符 ⇒ 50KB 模板最多 MAX_TOKEN_COUNT 个 token。
    // 即默认配置下 token 上限是「模板长度上限的推论」，不会先于它触发；
    // 它防的是将来有人改 tokenizer（比如支持嵌套标签）后这条防线静默失效。
    expect(MAX_TOKEN_COUNT * 5).toBe(MAX_TEMPLATE_LENGTH);
    expect(MAX_TOKEN_COUNT * 5 + 5).toBeGreaterThan(MAX_TEMPLATE_LENGTH);
  });

  it('token 上限可注入并真的会拒（证明这条防线是活的，不是死代码）', () => {
    const out = renderMustacheHardened(
      '{{a}}{{a}}{{a}}{{a}}',
      {},
      { limits: { maxTokenCount: 3 } },
    );
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('TOKEN_LIMIT_EXCEEDED');
  });

  it('耗时上限用注入时钟断言（无 sleep）', () => {
    let fake = 0;
    // 前 256 个 token 不检查时钟，之后每次都判定「已超时」
    const now = (): number => {
      fake += 1000;
      return fake;
    };
    const tpl = '{{field:a}}'.repeat(300);
    const out = renderMustacheHardened(tpl, { a: 'v' }, { now });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('TIME_LIMIT_EXCEEDED');
    expect(out.error).toContain(String(DEFAULT_LIMITS.maxRenderMs));
  });

  it('时钟不前进就永不超时（证明上限不会误伤正常渲染）', () => {
    const now = (): number => 0;
    expect(
      renderMustacheHardened('{{#each xs}}{{this}}{{/each}}', { xs: [1, 2, 3] }, { now }),
    ).toEqual({ ok: true, result: '123' });
  });

  it('耗时检查是稀疏采样：token 数不到 256 时即使 maxRenderMs=0 也不误伤', () => {
    let n = 0;
    const out = renderMustacheHardened(
      '{{field:a}}',
      { a: 'b' },
      {
        now: () => {
          n += 10;
          return n;
        },
        limits: { maxRenderMs: 0 },
      },
    );
    // 1 个 token，还没到第 256 个采样点 → 不触发（证明开销恒定、不误伤）
    expect(out).toEqual({ ok: true, result: 'b' });
  });
});

// ============================================================
// 7. 回归防线：合法模板的渲染结果一条都不许变
// ============================================================

/**
 * 合法输入的行为对照表（回归防线）。
 *
 * `expected` 全部取自渲染层那份仍然通过全量测试的 `mustacheRender.test.ts`
 * ——两份实现的期望值是同一批常量，所以任一侧漂移都会红。
 * （这里不能直接 import 渲染层那份实现做逐例对照：tsconfig.node.json 是
 * composite 项目，跨到 renderer 目录会报 TS6307。）
 *
 * 语义差异只有两处，且都是刻意的安全收紧：原型链键读不到、超预算直接拒绝。
 */
const PARITY_CASES: Array<{
  name: string;
  tpl: string;
  fields: Record<string, unknown>;
  expected: string;
}> = [
  { name: '纯文本', tpl: 'hello', fields: {}, expected: 'hello' },
  {
    name: '单字段',
    tpl: 'int {{field:speed}} = 1;',
    fields: { speed: '50' },
    expected: 'int 50 = 1;',
  },
  {
    name: '多字段',
    tpl: 'class {{field:className}} { int {{field:speed}}; }',
    fields: { className: 'Foo', speed: '3' },
    expected: 'class Foo { int 3; }',
  },
  {
    name: '字段缺失保留占位符',
    tpl: '{{field:missing}}',
    fields: {},
    expected: '{{field:missing}}',
  },
  { name: '数字字段', tpl: 'count = {{field:n}}', fields: { n: 42 }, expected: 'count = 42' },
  {
    name: '布尔真 if',
    tpl: '{{#if glow}}private boolean glow = true;{{/if}}',
    fields: { glow: true },
    expected: 'private boolean glow = true;',
  },
  {
    name: '布尔假 if',
    tpl: '{{#if glow}}private boolean glow = true;{{/if}}',
    fields: { glow: false },
    expected: '',
  },
  { name: 'if 字段缺失视为 falsy', tpl: '{{#if glow}}GLOW{{/if}}', fields: {}, expected: '' },
  {
    name: 'if/else 真分支',
    tpl: '{{#if flag}}MID{{else}}OUT{{/if}}',
    fields: { flag: true },
    expected: 'MID',
  },
  {
    name: 'if/else 假分支',
    tpl: '{{#if flag}}MID{{else}}OUT{{/if}}',
    fields: { flag: false },
    expected: 'OUT',
  },
  { name: '数字 truthy', tpl: '{{#if count}}N>0{{/if}}', fields: { count: 5 }, expected: 'N>0' },
  { name: '数字 0 falsy', tpl: '{{#if count}}N>0{{/if}}', fields: { count: 0 }, expected: '' },
  {
    name: '空串 falsy',
    tpl: '{{#if name}}HAS_NAME{{/if}}',
    fields: { name: '' },
    expected: '',
  },
  {
    name: '非空串 truthy',
    tpl: '{{#if name}}HAS_NAME{{/if}}',
    fields: { name: 'Item' },
    expected: 'HAS_NAME',
  },
  { name: '空数组 falsy', tpl: '{{#if items}}HAS{{/if}}', fields: { items: [] }, expected: '' },
  {
    name: '非空数组 truthy',
    tpl: '{{#if items}}HAS{{/if}}',
    fields: { items: [1] },
    expected: 'HAS',
  },
  {
    name: '多个 if 串联',
    tpl: '{{#if a}}A{{/if}}{{#if b}}B{{/if}}',
    fields: { a: true, b: false },
    expected: 'A',
  },
  {
    name: 'if 未闭合容错',
    tpl: '{{#if flag}}MID',
    fields: { flag: true },
    expected: '{{#if flag}}MID',
  },
  { name: '孤立 else 保留原文', tpl: 'X{{else}}Y', fields: {}, expected: 'X{{else}}Y' },
  {
    name: '未识别标签保留原文',
    tpl: '{{#unless @last}}?',
    fields: {},
    expected: '{{#unless @last}}?',
  },
  { name: '@last 保留原文', tpl: '{{@last}}', fields: {}, expected: '{{@last}}' },
  {
    name: '数组 each 字符串',
    tpl: '{{#each names}}{{this}};{{/each}}',
    fields: { names: ['A', 'B'] },
    expected: 'A;B;',
  },
  {
    name: '数组 each 数字',
    tpl: '{{#each nums}}{{this}},{{/each}}',
    fields: { nums: [1, 2, 3] },
    expected: '1,2,3,',
  },
  {
    name: '空数组 each',
    tpl: 'START|{{#each xs}}{{this}}{{/each}}|END',
    fields: { xs: [] },
    expected: 'START||END',
  },
  {
    name: '数组 each 字段插值',
    tpl: '{{#each items}}{{this.name}}={{this.count}};{{/each}}',
    fields: { items: [{ name: 'a', count: 1 }] },
    expected: 'a=1;',
  },
  {
    name: '数组元素含引号需转义（分隔符在循环体内，逐项重复）',
    tpl: 'String x = "{{#each names}}{{this}}|{{/each}}";',
    fields: { names: ['a"', 'b'] },
    expected: 'String x = "a\\"|b|";',
  },
  {
    name: '非数组视为单元素遍历',
    tpl: '{{#each single}}{{this}}{{/each}}',
    fields: { single: 'solo' },
    expected: 'solo',
  },
  {
    name: 'each 内访问外层字段',
    tpl: '{{#each xs}}{{field:prefix}}{{this}};{{/each}}',
    fields: { prefix: 'P', xs: ['a', 'b'] },
    expected: 'Pa;Pb;',
  },
  {
    name: 'each 内 if 读当前项（裸键名走作用域链）',
    tpl: '{{#each items}}{{#if on}}ON{{/if}}{{/each}}',
    fields: { items: [{ on: true }, { on: false }] },
    expected: 'ON',
  },
  {
    // 既有行为（本引擎的 #if 不解析点号路径，`this.on` 被当成一个整体键名）：
    // 锁定它是为了保证「加固没有顺手改语义」——要支持点号路径得两处同时改。
    name: '「{{#if this.on}}」点号键不解析：条件恒为假（与渲染层一致的既有行为）',
    tpl: '{{#each items}}{{#if this.on}}ON{{else}}OFF{{/if}}{{/each}}',
    fields: { items: [{ on: true }, { on: false }] },
    expected: 'OFFOFF',
  },
  {
    name: 'each 内 if 回落外层字段',
    tpl: '{{#each xs}}{{#if flag}}F{{/if}}{{/each}}',
    fields: { flag: true, xs: [1, 2] },
    expected: 'FF',
  },
  {
    name: '对象字段插值成 JSON（JSON 的引号也要过 Java 转义）',
    tpl: '{{field:obj}}',
    fields: { obj: { a: 1 } },
    expected: '{\\"a\\":1}',
  },
  {
    name: '数组字段插值成 JSON',
    tpl: '{{field:arr}}',
    fields: { arr: [1, 'x'] },
    expected: '[1,\\"x\\"]',
  },
  {
    name: 'null / undefined 插值成空串',
    tpl: '[{{field:a}}][{{field:b}}]',
    fields: { a: null, b: undefined },
    expected: '[][]',
  },
  {
    name: '反斜杠先于引号转义',
    tpl: 'String x = "{{field:v}}";',
    fields: { v: 'a\\"' },
    expected: 'String x = "a\\\\\\"";',
  },
  {
    name: '控制字符转义',
    tpl: 'String x = "{{field:v}}";',
    fields: { v: 'a\nb\rc\td' },
    expected: 'String x = "a\\nb\\rc\\td";',
  },
  {
    name: '引号闭合攻击被转义',
    tpl: 'String x = "{{field:v}}";',
    fields: { v: 'a"; evil(); "' },
    expected: 'String x = "a\\"; evil(); \\"";',
  },
  {
    name: 'thisField 缺失保留占位符',
    tpl: '{{#each xs}}{{this.nope}}{{/each}}',
    fields: { xs: [{ a: 1 }] },
    expected: '{{this.nope}}',
  },
  { name: '空模板', tpl: '', fields: {}, expected: '' },
  { name: '只有文本无标签', tpl: 'no tags here', fields: {}, expected: 'no tags here' },
  {
    name: '标签内含空格',
    tpl: '{{ field:spaced }}',
    fields: { spaced: 'ok' },
    expected: 'ok',
  },
  {
    name: '嵌套 each',
    tpl: '{{#each rows}}{{#each rows}}{{this}}{{/each}}-{{/each}}',
    fields: { rows: [1, 2] },
    expected: '12-12-',
  },
];

describe('回归：合法输入的渲染结果逐例锁定', () => {
  it.each(PARITY_CASES)('$name', ({ tpl, fields, expected }) => {
    expect(renderOk(tpl, fields)).toBe(expected);
  });

  it('escapeJavaStringLiteral 主进程版：与渲染层同规则（逐输入锁定）', () => {
    const cases: Array<[string, string]> = [
      ['', ''],
      ['plain', 'plain'],
      ['a\\b', 'a\\\\b'],
      ['a"b', 'a\\"b'],
      ['a\\"b', 'a\\\\\\"b'],
      ['line\nline', 'line\\nline'],
      ['cr\rtab\t', 'cr\\rtab\\t'],
      ['"; DROP TABLE x; --', '\\"; DROP TABLE x; --'],
      ['括号(分号);不该被转义', '括号(分号);不该被转义'],
      ['{"json":"value"}', '{\\"json\\":\\"value\\"}'],
      ['\u0000\u001f\u007f', '\u0000\u001f\u007f'],
    ];
    for (const [input, expected] of cases) {
      expect(escapeMain(input)).toBe(expected);
    }
  });
});

// ============================================================
// 8. 结构性防线：主进程侧只允许存在**一份**渲染实现
// ============================================================

describe('结构性防线：渲染实现只有一份（漏一处就是漏洞）', () => {
  it('generate.ts 里不再有 isolated-vm / 沙箱脚本字符串', () => {
    const src = stripComments(readSource('generate.ts'));
    expect(src).not.toContain('isolated-vm');
    expect(src).not.toContain('compileScript');
    expect(src).not.toContain('ExternalCopy');
    expect(src).not.toContain('renderMustachePure');
    expect(src).not.toContain('findBlockEnd');
  });

  it('渲染循环与 tokenizer 在主进程源码里各只出现一次定义', () => {
    const src = stripComments(readSource('sandboxed-mustache.ts'));
    const count = (needle: string): number => src.split(needle).length - 1;
    expect(count('function tokenize(')).toBe(1);
    expect(count('function renderTokens(')).toBe(1);
    expect(count('function renderValue(')).toBe(1);
    expect(count('function isTruthy(')).toBe(1);
    expect(count('function escapeJavaStringLiteral(')).toBe(0); // 只从 java-escape.ts 引入
  });

  it('取值一律走 Object.hasOwn，代码里没有裸 `key in obj` 判定', () => {
    const src = stripComments(readSource('sandboxed-mustache.ts'));
    expect(src).toContain('Object.hasOwn');
    // 渲染相关代码里不应再出现 `xxx in obj` 形式（会命中原型链）
    expect(src).not.toMatch(/\bkey in (obj|fields|thisObj|child)\b/);
  });
});

describe('回归：加固没有改变合法渲染的既有断言', () => {
  it('与渲染层既有测试同款的期望值逐条对齐', () => {
    const expectPairs: Array<[string, Record<string, unknown>, string]> = [
      ['int {{field:speed}} = 1;', { speed: '50' }, 'int 50 = 1;'],
      [
        'public class {{field:className}} { int {{field:speed}}; }',
        { className: 'C', speed: '1' },
        'public class C { int 1; }',
      ],
      [
        'String x = "{{field:name}}";',
        { name: 'a"; evil(); "' },
        'String x = "a\\"; evil(); \\"";',
      ],
      ['{{field:missing}}', {}, '{{field:missing}}'],
      ['count = {{field:n}}', { n: 42 }, 'count = 42'],
      ['{{#each names}}{{this}};{{/each}}', { names: ['A', 'B', 'C'] }, 'A;B;C;'],
      ['{{#each nums}}{{this}},{{/each}}', { nums: [1, 2, 3] }, '1,2,3,'],
      ['{{#each xs}}{{this}}{{/each}}', { xs: [] }, ''],
      ['{{#each xs}}X', { xs: [1, 2] }, '{{#each xs}}X'],
      ['X{{else}}Y', {}, 'X{{else}}Y'],
      ['{{#if a}}{{#if b}}AB{{/if}}{{/if}}', { a: true, b: true }, 'AB'],
      ['{{#if a}}Ab{{else}}Ab{{/if}}', { a: false, b: true }, 'Ab'],
    ];
    for (const [tpl, fields, expected] of expectPairs) {
      expect(renderOk(tpl, fields)).toBe(expected);
    }
  });

  it('结构化错误同时带 code 与中文 message（供 IPC 直接回传）', () => {
    const out = renderMustacheHardened('{{#each xs}}{{this}}{{/each}}', {
      xs: Array.from({ length: MAX_EACH_ITERATIONS + 1 }, () => 1),
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.code).toBe('ITERATION_LIMIT_EXCEEDED');
    expect(typeof out.error).toBe('string');
    expect(out.error.length).toBeGreaterThan(0);
  });

  it('默认上限与文档常量一致（防止有人只改 limits 而忘了改常量注释）', () => {
    expect(DEFAULT_LIMITS.maxTemplateLength).toBe(MAX_TEMPLATE_LENGTH);
    expect(DEFAULT_LIMITS.maxTokenCount).toBe(MAX_TOKEN_COUNT);
    expect(DEFAULT_LIMITS.maxEachIterations).toBe(MAX_EACH_ITERATIONS);
    expect(DEFAULT_LIMITS.maxTotalIterations).toBe(MAX_TOTAL_ITERATIONS);
    expect(DEFAULT_LIMITS.maxBlockDepth).toBe(MAX_BLOCK_DEPTH);
    expect(MAX_FIELDS_ENTRIES).toBe(100);
    expect(MAX_FIELDS_DEPTH).toBe(8);
  });

  // ⚠️ 上一条只验「常量与 limits 自洽」，**不验常量的绝对值** ——
  // 两者都改成 10 倍仍然全绿（实测：MAX_TEMPLATE_LENGTH 50k→500k、
  // MAX_TOTAL_ITERATIONS 50k→5M 都是 GREEN）。这些是 §13 的安全上限
  // （模板体积 / 迭代 DoS 防护），放宽 10 倍属安全回退却无人察觉。
  // 故这里必须用**字面量**钉死绝对值（自洽性绿，见 MEMORY §7.9 / §7.15）。
  it('安全上限的绝对值被字面量钉死（放宽上限必须是有意的决定）', () => {
    expect(MAX_TEMPLATE_LENGTH).toBe(50_000);
    expect(MAX_EACH_ITERATIONS).toBe(10_000);
    expect(MAX_TOTAL_ITERATIONS).toBe(50_000);
    expect(MAX_BLOCK_DEPTH).toBe(16);
    // MAX_TOKEN_COUNT 是派生的（模板长度 / 5），钉住派生关系而非魔数。
    expect(MAX_TOKEN_COUNT).toBe(Math.ceil(50_000 / 5));
    expect(MAX_TOKEN_COUNT).toBe(10_000);
  });

  it('limits 对象里的绝对值同样是字面量钉死', () => {
    expect(DEFAULT_LIMITS.maxTemplateLength).toBe(50_000);
    expect(DEFAULT_LIMITS.maxEachIterations).toBe(10_000);
    expect(DEFAULT_LIMITS.maxTotalIterations).toBe(50_000);
    expect(DEFAULT_LIMITS.maxBlockDepth).toBe(16);
  });
});
