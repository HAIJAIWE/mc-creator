/**
 * `mustacheRender.ts` 的**攻击输入**回归测试。
 *
 * 与 `mustacheRender.test.ts` 的分工：
 * - `mustacheRender.test.ts`：合法模板的渲染语义（既有断言，本次一条未改）。
 * - 本文件：**恶意/病态输入**必须被挡（原型链、预算、深度、迭代），
 *   外加一条结构性防线（源码里不许再出现裸 `key in obj` 判定）。
 *
 * 这些防线**不能**依赖「主进程会先挡」：本文件在主进程完全没参与的
 * 非 Electron 上下文里直接调用渲染层实现。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  renderMustache,
  validateFieldsPayload,
  isForbiddenFieldKey,
  MustacheRenderError,
  MAX_TEMPLATE_LENGTH,
  MAX_BLOCK_DEPTH,
  MAX_EACH_ITERATIONS,
  MAX_OUTPUT_LENGTH,
  MAX_FIELDS_DEPTH,
  MAX_FIELDS_BYTES,
  DEFAULT_LIMITS,
} from './mustacheRender.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** 读同目录源码文本（用于结构性断言，不参与渲染逻辑）。 */
function readSource(file: string): string {
  return readFileSync(joinPath(HERE, file), 'utf8');
}

/** 去掉注释后再断言：注释里可以（也应该）解释「曾经长什么样」，不该被当成代码。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 执行 fn 并返回它抛出的 MustacheRenderError.code（没抛就判测试失败）。 */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(MustacheRenderError);
    return (err as MustacheRenderError).code;
  }
  throw new Error('期望抛出 MustacheRenderError，但没有抛');
}

// ============================================================
// 1. 原型链：模板读不到 Object 构造函数 / 原型链成员
// ============================================================

describe('原型链防线：模板读不到原型链', () => {
  const NATIVE = '[native code]';

  it('{{field:constructor}} 不泄露 Object 构造函数（修之前会泄露）', () => {
    const out = renderMustache('{{field:constructor}}', {});
    expect(out).not.toContain(NATIVE);
    expect(out).not.toContain('function Object');
    // 键被禁用 → 判为「缺失」→ 保留原占位符（与字段缺失行为一致）
    expect(out).toBe('{{field:constructor}}');
  });

  it('{{field:__proto__}} / {{field:prototype}} / {{field:toString}} 一律读不到', () => {
    // 修之前 `tok.key in fields` 对这几个键全部为真：
    //   constructor → Object 构造函数；__proto__ → Object.prototype；
    //   toString → Function.prototype.toString 的宿主对象（会被 JSON.stringify 序列化出来）
    expect(renderMustache('{{field:__proto__}}', {})).toBe('{{field:__proto__}}');
    expect(renderMustache('{{field:prototype}}', {})).toBe('{{field:prototype}}');
    expect(renderMustache('{{field:toString}}', {})).toBe('{{field:toString}}');
    // 对照组：普通自有字段照常读得到（证明不是「全都读不到」的假修复）
    expect(renderMustache('{{field:ok}}', { ok: 'v' })).toBe('v');
  });

  it('{{this.constructor}} 在顶层与循环内都拿不到 Object 构造函数', () => {
    // 顶层：currentThis 是 undefined → 子字段缺失 → 保留原占位符
    expect(renderMustache('{{this.constructor}}', {})).toBe('{{this.constructor}}');
    expect(renderMustache('{{this.constructor}}', {})).not.toContain(NATIVE);
    // 循环内：currentThis 是数据里的对象，键名仍被禁用
    expect(
      renderMustache('{{#each rows}}{{this.constructor}}{{/each}}', { rows: [{ a: 1 }] }),
    ).toBe('{{this.constructor}}');
  });

  it('循环内的 {{this.__proto__}} / {{this.toString}} 也读不到原型链', () => {
    expect(renderMustache('{{#each rows}}{{this.__proto__}}{{/each}}', { rows: [{ a: 1 }] })).toBe(
      '{{this.__proto__}}',
    );
    expect(renderMustache('{{#each rows}}{{this.toString}}{{/each}}', { rows: [{ a: 1 }] })).toBe(
      '{{this.toString}}',
    );
  });

  it('{{#each __proto__}} / {{#each constructor}} 不遍历原型链成员（空输出）', () => {
    expect(renderMustache('{{#each __proto__}}{{this}}{{/each}}', {})).toBe('');
    expect(renderMustache('{{#each constructor}}{{this}}{{/each}}', {})).toBe('');
    expect(renderMustache('{{#each prototype}}X{{/each}}', {})).toBe('');
    expect(renderMustache('{{#each toString}}{{this}}{{/each}}', {})).toBe('');
  });

  it('{{#if constructor}} / {{#if __proto__}} 判为 falsy（走 else 分支）', () => {
    expect(renderMustache('{{#if constructor}}LEAK{{else}}SAFE{{/if}}', {})).toBe('SAFE');
    expect(renderMustache('{{#if __proto__}}LEAK{{else}}SAFE{{/if}}', {})).toBe('SAFE');
    expect(renderMustache('{{#if toString}}LEAK{{else}}SAFE{{/if}}', {})).toBe('SAFE');
  });

  it('循环内作用域链的第一级（currentThis）也读不到原型链键', () => {
    // rows 里放「只有原型链可枚举键」的对象：hasOwn 守卫挡住 for...in 之外的读取
    const out = renderMustache(
      '{{#each rows}}{{#if constructor}}LEAK{{else}}SAFE{{/if}}{{/each}}',
      {
        rows: [{ a: 1 }, { b: 2 }],
      },
    );
    expect(out).toBe('SAFESAFE');
  });

  it('fields 顶层带原型链键 → 直接拒请求（不是静默忽略）', () => {
    // 显式构造的自有 __proto__ 键（JSON 解析出来的对象真的有这个自有键）
    const parsed = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    const v = validateFieldsPayload(parsed);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.code).toBe('FIELDS_FORBIDDEN_KEY');
    // 渲染入口同样拒（不是「读不到就当没这个字段」）
    expect(codeOf(() => renderMustache('{{field:a}}', parsed))).toBe('FIELDS_FORBIDDEN_KEY');
    expect(codeOf(() => renderMustache('{{field:a}}', { constructor: 'x' }))).toBe(
      'FIELDS_FORBIDDEN_KEY',
    );
    // 对照：合法字段照常通过
    expect(validateFieldsPayload({ a: 1 }).ok).toBe(true);
  });

  it('禁用键清单就是原型链那三个', () => {
    expect(isForbiddenFieldKey('constructor')).toBe(true);
    expect(isForbiddenFieldKey('__proto__')).toBe(true);
    expect(isForbiddenFieldKey('prototype')).toBe(true);
    expect(isForbiddenFieldKey('speed')).toBe(false);
  });
});

// ============================================================
// 2. 资源预算：小模板 + 巨大字段 / 超深嵌套 / 超大数组
// ============================================================

describe('输出预算：放大攻击被上限截断', () => {
  it('小模板 + 6MiB 字段 → 抛 OUTPUT_LIMIT_EXCEEDED（不会把 6MiB 拼出来）', () => {
    // 模板 12 字符 → 字段 6Mi 字符：约 50 万倍放大。
    // 上限 5 MiB 的依据：合法 Java 代码片段实测几十~几百 KB，5 MiB 已有 ~20 倍余量；
    // 反过来把单次渲染的最坏堆占用钉死（JS 字符串按 UTF-16 存，实际 ~10 MiB）。
    const huge = 'A'.repeat(6 * 1024 * 1024);
    expect(MAX_OUTPUT_LENGTH).toBe(5 * 1024 * 1024);
    // 字段体积本身在预算内（8Mi 上限），所以拦下它的一定是输出预算而不是 fields 校验
    expect(MAX_FIELDS_BYTES).toBe(8 * 1024 * 1024);
    expect(validateFieldsPayload({ big: huge }).ok).toBe(true);
    expect(codeOf(() => renderMustache('X{{field:big}}', { big: huge }))).toBe(
      'OUTPUT_LIMIT_EXCEEDED',
    );
  });

  it('放大攻击在 {{#each}} 复制路径上同样被截断（7 × 1MiB → 7MiB 输出）', () => {
    const chunk = 'B'.repeat(1024 * 1024);
    const fields = { rows: Array.from({ length: 7 }, () => chunk) };
    expect(codeOf(() => renderMustache('{{#each rows}}{{this}}{{/each}}', fields))).toBe(
      'OUTPUT_LIMIT_EXCEEDED',
    );
  });

  it('输出预算是**增量记账**：超限立刻中断，而不是渲染完再看长度', () => {
    // 用注入的小上限暴露记账点：若实现是「拼完再判长度」，这段会先产出 3×50 字符。
    expect(
      codeOf(() =>
        renderMustache(
          '{{field:a}}{{field:a}}{{field:a}}',
          { a: 'x'.repeat(50) },
          { limits: { maxOutputLength: 100 } },
        ),
      ),
    ).toBe('OUTPUT_LIMIT_EXCEEDED');
  });

  it('恰好等于上限时不抛（边界不误伤）', () => {
    const out = renderMustache(
      '{{field:a}}',
      { a: 'x'.repeat(100) },
      {
        limits: { maxOutputLength: 100 },
      },
    );
    expect(out).toBe('x'.repeat(100));
  });

  it('模板超长 → TEMPLATE_TOO_LARGE', () => {
    expect(MAX_TEMPLATE_LENGTH).toBe(50_000);
    expect(codeOf(() => renderMustache('y'.repeat(50_001), {}))).toBe('TEMPLATE_TOO_LARGE');
    // 边界：正好 50000 不抛
    expect(renderMustache('y'.repeat(50_000), {})).toHaveLength(50_000);
  });

  it('token 数超限 → TOKEN_LIMIT_EXCEEDED（用文本 token 把 token/字符密度提上去）', () => {
    // 上限 = ceil(50000 / 5) = 10000。纯 `{{a}}` 重复会先撞模板长度上限，
    // 所以用 `{{a}}x`（6 字符 → 2 个 token，密度更高）在长度上限内把 token 数顶穿。
    const tpl = '{{a}}x'.repeat(8333); // 49998 字符，16666 个 token
    expect(tpl.length).toBeLessThanOrEqual(MAX_TEMPLATE_LENGTH);
    expect(codeOf(() => renderMustache(tpl, { a: 'v' }))).toBe('TOKEN_LIMIT_EXCEEDED');
  });
});

describe('嵌套深度预算：深层 / 未闭合块被拒', () => {
  it('17 层 {{#if}} → BLOCK_DEPTH_EXCEEDED', () => {
    expect(MAX_BLOCK_DEPTH).toBe(16);
    const tpl = '{{#if a}}'.repeat(17) + 'X' + '{{/if}}'.repeat(17);
    expect(codeOf(() => renderMustache(tpl, { a: true }))).toBe('BLOCK_DEPTH_EXCEEDED');
  });

  it('未闭合的 17 层 {{#if}} → BLOCK_DEPTH_EXCEEDED', () => {
    const tpl = '{{#if a}}'.repeat(17);
    expect(codeOf(() => renderMustache(tpl, { a: true }))).toBe('BLOCK_DEPTH_EXCEEDED');
  });

  it('未闭合的 5000 层 {{#if}} 被立刻拒（预扫描是 O(n)，不退化成 O(n²) 全量扫）', () => {
    const tpl = '{{#if a}}'.repeat(5000);
    const started = Date.now();
    expect(codeOf(() => renderMustache(tpl, { a: true }))).toBe('BLOCK_DEPTH_EXCEEDED');
    // 只是「没有退化成 O(n²) 的量级」的护栏，不是性能基准
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('16 层（上限内）正常渲染，且未闭合仍保留原文（容错语义不变）', () => {
    const tpl = '{{#if a}}'.repeat(16) + 'X' + '{{/if}}'.repeat(16);
    expect(renderMustache(tpl, { a: true })).toBe('X');
    expect(renderMustache('{{#if a}}'.repeat(16) + 'MID', { a: true })).toBe(
      '{{#if a}}'.repeat(16) + 'MID',
    );
  });

  it('fields 值嵌套过深 → FIELDS_TOO_DEEP（挡住 JSON.stringify 爆栈）', () => {
    expect(MAX_FIELDS_DEPTH).toBe(8);
    let nested: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 12; i++) nested = { n: nested };
    expect(codeOf(() => renderMustache('{{field:a}}', { a: nested }))).toBe('FIELDS_TOO_DEEP');
  });
});

describe('迭代预算：超大数组 / 嵌套相乘被拒', () => {
  it('10001 项数组 {{#each}} → ITERATION_LIMIT_EXCEEDED', () => {
    expect(MAX_EACH_ITERATIONS).toBe(10_000);
    const xs = Array.from({ length: MAX_EACH_ITERATIONS + 1 }, (_, i) => i);
    expect(codeOf(() => renderMustache('{{#each xs}}{{this}}{{/each}}', { xs }))).toBe(
      'ITERATION_LIMIT_EXCEEDED',
    );
  });

  it('每块都没超限、但总迭代数超限 → 仍被拒（挡 1万 × 1万 的嵌套相乘）', () => {
    // 2 块 × 3 项：第 1 个外层项就把总额推到 6 > 5；单块 3 ≤ 3。证明总预算独立生效。
    expect(
      codeOf(() =>
        renderMustache(
          '{{#each rows}}{{#each rows}}X{{/each}}|{{/each}}',
          { rows: [1, 2, 3] },
          { limits: { maxEachIterations: 3, maxTotalIterations: 5 } },
        ),
      ),
    ).toBe('ITERATION_LIMIT_EXCEEDED');
  });

  it('默认总迭代预算下嵌套 each 在有界步数内被拒', () => {
    // 外层 + 内层各 1000 次/项，每项贡献 2000 → 第 26 个外层项越过 50000 上限
    const rows = Array.from({ length: 1000 }, () => 1);
    expect(
      codeOf(() => renderMustache('{{#each rows}}{{#each rows}}X{{/each}}{{/each}}', { rows })),
    ).toBe('ITERATION_LIMIT_EXCEEDED');
  });

  it('未闭合的 {{#each}} 根本不迭代（保留原文），所以超大数组也不产生工作量', () => {
    // 未闭合块没有配对范围 → 保留起始标签原文，不进入迭代循环。
    // 这条保证「未闭合 + 超大数组」不会退化成无上限遍历。
    const xs = Array.from({ length: MAX_EACH_ITERATIONS + 1 }, () => 1);
    expect(renderMustache('{{#each xs}}X', { xs })).toBe('{{#each xs}}X');
  });
});

describe('耗时预算：注入时钟即可测，绝不 sleep', () => {
  /** 第 1 次调用给出 deadline，之后一律返回「已超时」的时刻。 */
  function clockAfterFirstCall(): () => number {
    let calls = 0;
    return () => (calls++ === 0 ? 1000 : 5000);
  }

  it('时钟越过 deadline 且已采样 256 个 token → TIME_LIMIT_EXCEEDED', () => {
    const tpl = '{{field:a}}'.repeat(300); // 300 个 token ≥ 采样间隔 256
    expect(
      codeOf(() =>
        renderMustache(tpl, { a: 'v' }, { now: clockAfterFirstCall(), limits: { maxRenderMs: 0 } }),
      ),
    ).toBe('TIME_LIMIT_EXCEEDED');
  });

  it('token 数不足采样间隔时不检查时钟 → 短模板不误伤（证明开销恒定）', () => {
    expect(
      renderMustache(
        '{{field:a}}',
        { a: 'b' },
        {
          now: clockAfterFirstCall(),
          limits: { maxRenderMs: 0 },
        },
      ),
    ).toBe('b');
  });
});

describe('fields 预校验：结构类攻击输入', () => {
  it('循环引用 → FIELDS_CYCLIC', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(codeOf(() => renderMustache('{{field:a}}', cyclic))).toBe('FIELDS_CYCLIC');
  });

  it('数组自引用 → FIELDS_CYCLIC', () => {
    const arr: unknown[] = [1];
    arr.push(arr);
    expect(codeOf(() => renderMustache('{{field:a}}', { a: arr }))).toBe('FIELDS_CYCLIC');
  });

  it('DAG（重复引用同一子对象）不算环，合法放行', () => {
    const shared = { x: 1 };
    expect(validateFieldsPayload({ a: shared, b: shared }).ok).toBe(true);
  });

  it('函数 / Date / Map 等不支持类型 → UNSUPPORTED_VALUE_TYPE', () => {
    expect(codeOf(() => renderMustache('{{field:a}}', { a: () => 1 }))).toBe(
      'UNSUPPORTED_VALUE_TYPE',
    );
    expect(codeOf(() => renderMustache('{{field:a}}', { a: new Date(0) }))).toBe(
      'UNSUPPORTED_VALUE_TYPE',
    );
    expect(codeOf(() => renderMustache('{{field:a}}', { a: new Map() }))).toBe(
      'UNSUPPORTED_VALUE_TYPE',
    );
  });

  it('非纯对象 fields → FIELDS_INVALID', () => {
    expect(codeOf(() => renderMustache('x', null as unknown as Record<string, unknown>))).toBe(
      'FIELDS_INVALID',
    );
    expect(codeOf(() => renderMustache('x', [1, 2] as unknown as Record<string, unknown>))).toBe(
      'FIELDS_INVALID',
    );
  });

  it('模板不是字符串 → TEMPLATE_INVALID', () => {
    expect(codeOf(() => renderMustache(42 as unknown as string, {}))).toBe('TEMPLATE_INVALID');
  });

  it('字段数超限 → FIELDS_TOO_MANY', () => {
    const many: Record<string, unknown> = {};
    for (let i = 0; i < 101; i++) many[`k${i}`] = i;
    expect(codeOf(() => renderMustache('{{field:k0}}', many))).toBe('FIELDS_TOO_MANY');
  });

  it('fields 字符串总量超限 → FIELDS_TOO_LARGE', () => {
    expect(codeOf(() => renderMustache('{{field:a}}', { a: 'z'.repeat(9 * 1024 * 1024) }))).toBe(
      'FIELDS_TOO_LARGE',
    );
  });
});

// ============================================================
// 3. 结构性防线：漏一处就是漏洞
// ============================================================

describe('结构性防线：源码里不再有裸 `key in obj` 取值', () => {
  const code = stripComments(readSource('mustacheRender.ts'));

  it('取值统一走 readOwn → Object.hasOwn', () => {
    expect(code).toContain('Object.hasOwn');
    // 不应再有 `xxx in obj` 形式的原型链判定
    expect(code).not.toMatch(/\bkey in (obj|fields|thisObj|child)\b/);
    expect(code).not.toMatch(/\w+ in (fields|thisObj|obj)\b/);
  });

  it('每个上限常量都在渲染路径上被真正引用（不是只声明不用）', () => {
    for (const name of [
      'MAX_TEMPLATE_LENGTH',
      'MAX_TOKEN_COUNT',
      'MAX_OUTPUT_LENGTH',
      'MAX_BLOCK_DEPTH',
      'MAX_EACH_ITERATIONS',
      'MAX_TOTAL_ITERATIONS',
      'MAX_FIELDS_ENTRIES',
      'MAX_FIELDS_DEPTH',
      'MAX_FIELDS_BYTES',
      'MAX_FIELDS_NODES',
      'MAX_KEY_LENGTH',
      'MAX_RENDER_MS',
    ]) {
      // 声明 1 次 + 至少 1 次使用
      expect(code.split(name).length - 1).toBeGreaterThanOrEqual(2);
    }
  });

  it('默认上限集合与主进程那份逐条相等（本文件靠它保持不再分裂）', () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxTemplateLength: 50_000,
      maxTokenCount: 10_000,
      maxOutputLength: 5 * 1024 * 1024,
      maxBlockDepth: 16,
      maxEachIterations: 10_000,
      maxTotalIterations: 50_000,
      maxRenderMs: 250,
    });
  });
});
