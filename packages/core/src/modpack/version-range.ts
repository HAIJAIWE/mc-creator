/**
 * Maven version range 解析与判定（纯函数，无网络、无 Node 依赖）。
 *
 * ## 为什么不用库
 *
 * 见 `./version.ts` 顶部的依赖边界核实：仓库里没有 maven-artifact / semver，
 * 且不得新增依赖。根本原因除"没装"外还有一条：**Maven range 语法与 npm semver
 * 语法是两套方言**（`[1.0,2.0)` vs `^1.0.0`），两者互不兼容，
 * 混用只会引入"同一串约束在 Gradle 与我们这里判定不同"的静默 bug。
 *
 * ## 支持的语法清单
 *
 * | 形式 | 示例 | 语义 |
 * |---|---|---|
 * | 左闭右开区间 | `[1.0,2.0)` | `>=1.0 && <2.0` |
 * | 闭区间 | `[1.0,2.0]` | `>=1.0 && <=2.0` |
 * | 精确 | `[1.0]` | `==1.0`（`1.0` 与 `1.0.0` 视为相等，见 version.ts） |
 * | 无下界 | `(,1.0]` / `[,1.0]` | `<=1.0` |
 * | 无上界 | `[1.0,)` / `[1.0,]` | `>=1.0` |
 * | 无界 | `(,)` / `[,]` | 任意版本 |
 * | 多区间并集 | `[1.0,2.0),[3.0,4.0)` | 逗号分隔 = **并集**（Maven 规范） |
 * | 多约束交集 | `>=1.20.1 <1.21` | 空白分隔 = **交集**（semver / fabric.mod.json 规范） |
 * | 显式交集 | `intersectRanges(a, b)` | 两个 range 串求交 |
 * | 软性推荐 | `1.0` | 裸版本号 = `>=1.0` 且 **strict=false**（不做强约束） |
 * | 开放上界（扩展） | `1.0+` / `[1.0,2.0+)` | `>=1.0` 且无上界，strict=true |
 * | 比较符 | `>=1.0` `>1.0` `<=1.0` `<1.0` `=1.0` `==1.0` | 单边硬约束 |
 * | 波浪/插入符 | `~1.2.3` `^0.2.3` | npm 语义（见下） |
 * | 通配 | `1.20.x` `1.20.*` `*` | npm 语义 |
 *
 * Maven 规范本身**没有交集运算符**；本文件约定「空白分隔 = 交集」，是为了兼容
 * `fabric.mod.json` 的 `depends`（Fabric 用 semver 空间分隔 AND），
 * 而「逗号分隔 = 并集」完全沿用 Maven `VersionRange` 的规范，两者不冲突。
 *
 * ## 畸形输入的明确行为
 *
 * - `parseVersionRange(spec)`：无法解析返回 **`null`**，不抛异常。
 * - `satisfiesRange(version, spec)`：任一侧无法解析 → **返回 `false`**。
 *   保守取向：宁可说"不满足"，也不谎称"满足"（谎称满足会让阻断级检查失效），
 *   但**调用方必须用 `checkVersionRange` 才能区分**「确定不满足」与「无法判定」——
 *   前者该阻断，后者该放行。用 `satisfiesRange` 直接当判定依据会产生假阳性阻断。
 * - `checkVersionRange(version, spec)`：需要区分「确定不满足」与「无法判定」时用
 *   这个入口 —— 畸形 spec 或畸形 version 都返回 `status: 'unknown'`，
 *   由调用方决定降级（conflicts.ts 降级为不阻断）。
 */

import { compareParsedVersions, parseMavenVersion, type ParsedVersion } from './version.js';

/** 单个区间（无上/下界时对应字段省略） */
export interface RangeInterval {
  /** 下界（省略 = 无下界） */
  lower?: ParsedVersion;
  lowerInclusive: boolean;
  /** 上界（省略 = 无上界） */
  upper?: ParsedVersion;
  upperInclusive: boolean;
}

/** 解析后的版本区间集合 */
export interface ParsedVersionRange {
  /** 原始约束串（trim 后） */
  raw: string;
  /**
   * 归一化后的区间集合：**任一命中即满足**（集合本身已表达并集）。
   * 交集语义在解析阶段就已折叠完毕（见 `intersectRangeLists`）。
   */
  intervals: RangeInterval[];
  /**
   * 是否硬约束。
   * `false` = 软性推荐（裸版本号），此时 `status: 'violated'` **不应**被升级为阻断级。
   */
  strict: boolean;
}

/** 判定结果状态 */
export type RangeStatus = 'satisfied' | 'violated' | 'unknown';

/** 单次 range 判定结果 */
export interface RangeCheck {
  status: RangeStatus;
  /** 硬约束？见 {@link ParsedVersionRange.strict} */
  strict: boolean;
  /** 原始约束串 */
  raw: string;
  /** 中文原因，可直接进冲突 message */
  reason: string;
}

// === 构造辅助 ===

function interval(
  lower: ParsedVersion | undefined,
  lowerInclusive: boolean,
  upper: ParsedVersion | undefined,
  upperInclusive: boolean,
): RangeInterval {
  return {
    ...(lower !== undefined ? { lower } : {}),
    lowerInclusive,
    ...(upper !== undefined ? { upper } : {}),
    upperInclusive,
  };
}

/** 无界区间（`[,]` / `(,)` / `*`） */
function anyInterval(): RangeInterval {
  return interval(undefined, true, undefined, true);
}

/** 只有一个下界 */
function lowerOnly(v: ParsedVersion, inclusive = true): RangeInterval {
  return interval(v, inclusive, undefined, true);
}

/** 只有一个上界 */
function upperOnly(v: ParsedVersion, inclusive: boolean): RangeInterval {
  return interval(undefined, true, v, inclusive);
}

// === 集合运算 ===

/**
 * 求两个区间的交集；交集为空（不可能同时满足）返回 `null`。
 * 边界相等的处理：两下界相等时，闭区间优先（`[1.0,2.0] ∩ (1.0,3.0]` → `[1.0,2.0]`）。
 */
export function intersectIntervals(a: RangeInterval, b: RangeInterval): RangeInterval | null {
  let lower: ParsedVersion | undefined;
  let lowerInclusive: boolean;
  if (a.lower === undefined) {
    lower = b.lower;
    lowerInclusive = b.lowerInclusive;
  } else if (b.lower === undefined) {
    lower = a.lower;
    lowerInclusive = a.lowerInclusive;
  } else {
    const c = compareParsedVersions(a.lower, b.lower);
    if (c > 0) {
      lower = a.lower;
      lowerInclusive = a.lowerInclusive;
    } else if (c < 0) {
      lower = b.lower;
      lowerInclusive = b.lowerInclusive;
    } else {
      lower = a.lower;
      lowerInclusive = a.lowerInclusive && b.lowerInclusive;
    }
  }

  let upper: ParsedVersion | undefined;
  let upperInclusive: boolean;
  if (a.upper === undefined) {
    upper = b.upper;
    upperInclusive = b.upperInclusive;
  } else if (b.upper === undefined) {
    upper = a.upper;
    upperInclusive = a.upperInclusive;
  } else {
    const c = compareParsedVersions(a.upper, b.upper);
    if (c < 0) {
      upper = a.upper;
      upperInclusive = a.upperInclusive;
    } else if (c > 0) {
      upper = b.upper;
      upperInclusive = b.upperInclusive;
    } else {
      upper = a.upper;
      upperInclusive = a.upperInclusive && b.upperInclusive;
    }
  }

  // 空交集检测
  if (lower !== undefined && upper !== undefined) {
    const c = compareParsedVersions(lower, upper);
    if (c > 0) return null;
    if (c === 0 && !(lowerInclusive && upperInclusive)) return null;
  }

  return interval(lower, lowerInclusive, upper, upperInclusive);
}

/** 区间列表求交（笛卡尔积 + 丢弃空交集） */
export function intersectRangeLists(
  a: readonly RangeInterval[],
  b: readonly RangeInterval[],
): RangeInterval[] {
  const out: RangeInterval[] = [];
  for (const x of a) {
    for (const y of b) {
      const ov = intersectIntervals(x, y);
      if (ov) out.push(ov);
    }
  }
  return out;
}

/** 区间列表求并（直接拼接，Maven 逗号语义即此） */
export function unionRangeLists(
  a: readonly RangeInterval[],
  b: readonly RangeInterval[],
): RangeInterval[] {
  return [...a, ...b];
}

/** 两个 range 串求交（显式交集入口）；任一侧无法解析返回 `null` */
export function intersectRanges(a: string, b: string): ParsedVersionRange | null {
  const ra = parseVersionRange(a);
  const rb = parseVersionRange(b);
  if (!ra || !rb) return null;
  return {
    raw: `${ra.raw} ∩ ${rb.raw}`,
    intervals: intersectRangeLists(ra.intervals, rb.intervals),
    strict: ra.strict && rb.strict,
  };
}

/** 两个 range 串求并；任一侧无法解析返回 `null` */
export function unionRanges(a: string, b: string): ParsedVersionRange | null {
  const ra = parseVersionRange(a);
  const rb = parseVersionRange(b);
  if (!ra || !rb) return null;
  return {
    raw: `${ra.raw},${rb.raw}`,
    intervals: unionRangeLists(ra.intervals, rb.intervals),
    strict: ra.strict && rb.strict,
  };
}

// === 判定 ===

function intervalContains(iv: RangeInterval, v: ParsedVersion): boolean {
  if (iv.lower !== undefined) {
    const c = compareParsedVersions(v, iv.lower);
    if (c < 0) return false;
    if (c === 0 && !iv.lowerInclusive) return false;
  }
  if (iv.upper !== undefined) {
    const c = compareParsedVersions(v, iv.upper);
    if (c > 0) return false;
    if (c === 0 && !iv.upperInclusive) return false;
  }
  return true;
}

/** 版本是否落在区间集合内（任一命中即 true） */
export function rangeSatisfiesVersion(range: ParsedVersionRange, version: ParsedVersion): boolean {
  return range.intervals.some((iv) => intervalContains(iv, version));
}

// === 解析 ===

/** 顶层逗号切分（括号内逗号不切） */
function splitTopLevel(spec: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < spec.length; i++) {
    const c = spec.charAt(i);
    if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(spec.slice(start, i));
      start = i + 1;
    }
  }
  out.push(spec.slice(start));
  return out;
}

/** 解析单个 Maven restriction，如 `[1.0,2.0)` / `[1.0]` / `(,1.0]` */
function parseRestriction(token: string): RangeInterval | null {
  const open = token.charAt(0);
  const close = token.charAt(token.length - 1);
  if ((open !== '[' && open !== '(') || (close !== ']' && close !== ')')) return null;
  if (token.length < 2) return null;
  const inner = token.slice(1, -1);
  const segs = inner.split(',');
  if (segs.length === 1) {
    // 精确形式只允许 `[1.0]`；`(1.0)` 是 Maven 明确拒绝的非法区间
    if (open !== '[' || close !== ']') return null;
    const only = (segs[0] ?? '').trim();
    // `+` 只在"无上界"位置有意义，`[1.0+]` 属非法精确区间
    if (only.endsWith('+')) return null;
    const v = parseMavenVersion(only);
    if (!v) return null;
    return interval(v, true, v, true);
  }
  if (segs.length !== 2) return null;
  const rawLower = (segs[0] ?? '').trim();
  const rawUpper = (segs[1] ?? '').trim();
  // `+` 开放上界扩展只允许出现在上界
  if (rawLower.endsWith('+')) return null;
  const unboundedUpper = rawUpper === '' || rawUpper.endsWith('+');
  let lower: ParsedVersion | undefined;
  let upper: ParsedVersion | undefined;
  if (rawLower !== '') {
    const parsed = parseMavenVersion(rawLower);
    if (!parsed) return null;
    lower = parsed;
  }
  if (!unboundedUpper) {
    const parsed = parseMavenVersion(rawUpper);
    if (!parsed) return null;
    upper = parsed;
  }
  return interval(lower, open === '[', upper, close === ']');
}

/** 提取版本串开头的数字段（`1.20.1-rc1` → `['1','20','1']`） */
function numericSegments(raw: string): string[] | null {
  const parts = raw.trim().split('.');
  const out: string[] = [];
  for (const p of parts) {
    const m = /^(\d+)/.exec(p);
    if (!m?.[1]) return null;
    out.push(m[1]);
  }
  return out;
}

/** 十进制字符串 +1（避免 BigInt 兼容负担） */
function incrementDecimal(s: string): string {
  const chars = s.split('');
  let i = chars.length - 1;
  while (i >= 0) {
    const cur = chars[i] as string;
    if (cur !== '9') {
      chars[i] = String(Number(cur) + 1);
      return chars.join('');
    }
    chars[i] = '0';
    i--;
  }
  return `1${chars.join('')}`;
}

/** 把第 index 段 +1 并丢弃其后所有段（`['1','20','3']` @ 1 → `['1','21']`） */
function bumpAt(segs: readonly string[], index: number): string {
  const head = segs.slice(0, index + 1);
  const bumped = head.map((s, i) => (i === index ? incrementDecimal(s) : s));
  return bumped.join('.');
}

/** 解析单个比较符 token（semver / 扩展语法） */
function parseComparator(token: string): { intervals: RangeInterval[]; strict: boolean } | null {
  // 通配：* / x / X
  if (token === '*' || token === 'x' || token === 'X') {
    return { intervals: [anyInterval()], strict: true };
  }

  const opMatch = /^(>=|<=|==|=|>|<|~|\^)\s*(.+)$/.exec(token);
  if (opMatch) {
    const op = opMatch[1] as string;
    const rest = (opMatch[2] ?? '').trim();
    if (rest === '') return null;
    const segs = numericSegments(rest);
    if (!segs) {
      // 比较符 + 非纯数字版本（如 `>=1.0-rc1`）：走通用版本解析
      const v = parseMavenVersion(rest);
      if (!v) return null;
      if (op === '>=') return { intervals: [lowerOnly(v, true)], strict: true };
      if (op === '>') return { intervals: [lowerOnly(v, false)], strict: true };
      if (op === '<=') return { intervals: [upperOnly(v, true)], strict: true };
      if (op === '<') return { intervals: [upperOnly(v, false)], strict: true };
      return { intervals: [interval(v, true, v, true)], strict: true };
    }
    // segs 非空 ⟹ rest 至少含数字，parseMavenVersion 必然成功（数字要求由它兜底）
    const v = parseMavenVersion(rest);
    if (!v) return null;
    switch (op) {
      case '>=':
        return { intervals: [lowerOnly(v, true)], strict: true };
      case '>':
        return { intervals: [lowerOnly(v, false)], strict: true };
      case '<=':
        return { intervals: [upperOnly(v, true)], strict: true };
      case '<':
        return { intervals: [upperOnly(v, false)], strict: true };
      case '=':
      case '==':
        return { intervals: [interval(v, true, v, true)], strict: true };
      case '~': {
        // npm tilde：~1 → >=1,<2 ；~1.2 → >=1.2,<1.3 ；~1.2.3 → >=1.2.3,<1.3
        // 抬升位 = 最后一段的"次末"：1 段抬第 0 段，2 段及以上抬第 1 段
        const lower = parseMavenVersion(rest);
        if (!lower) return null;
        const idx = Math.min(1, segs.length - 1);
        const upper = parseMavenVersion(bumpAt(segs, idx));
        if (!upper) return null;
        return { intervals: [interval(lower, true, upper, false)], strict: true };
      }
      case '^': {
        // ^1.2.3 → >=1.2.3,<2 ；^0.2.3 → >=0.2.3,<0.3 ；^0.0.3 → >=0.0.3,<0.0.4
        const lower = parseMavenVersion(rest);
        if (!lower) return null;
        const firstNonZero = segs.findIndex((s) => compareNumeric(s, '0') !== 0);
        const idx = firstNonZero < 0 ? segs.length - 1 : firstNonZero;
        const upper = parseMavenVersion(bumpAt(segs, idx));
        if (!upper) return null;
        return { intervals: [interval(lower, true, upper, false)], strict: true };
      }
    }
    return null;
  }

  // 通配段：1.20.x / 1.20.* / 1.X
  if (/[xX*]/.test(token)) {
    const parts = token.trim().split('.');
    const wildcardIdx = parts.findIndex((p) => /^[xX*]$/.test(p));
    if (wildcardIdx < 0) return null;
    const head: string[] = [];
    for (let i = 0; i < wildcardIdx; i++) {
      const m = /^(\d+)/.exec(parts[i] as string);
      if (!m?.[1]) return null;
      head.push(m[1]);
    }
    if (head.length === 0) return { intervals: [anyInterval()], strict: true };
    const lower = parseMavenVersion(head.join('.'));
    const upper = parseMavenVersion(bumpAt(head, head.length - 1));
    if (!lower || !upper) return null;
    return { intervals: [interval(lower, true, upper, false)], strict: true };
  }

  if (token.endsWith('+')) {
    // 开放上界扩展：`1.0+` → >=1.0，无上界，显式声明故为硬约束
    const v = parseMavenVersion(token.slice(0, -1));
    if (!v) return null;
    return { intervals: [lowerOnly(v, true)], strict: true };
  }

  // 裸版本号 = 软性推荐（>= 该版本），strict=false
  const v = parseMavenVersion(token);
  if (!v) return null;
  return { intervals: [lowerOnly(v, true)], strict: false };
}

/** 十进制字符串比较的小工具（供 `^` 判首个非零段） */
function compareNumeric(a: string, b: string): number {
  const an = a.replace(/^0+/, '');
  const bn = b.replace(/^0+/, '');
  if (an.length !== bn.length) return an.length < bn.length ? -1 : 1;
  if (an === bn) return 0;
  return an < bn ? -1 : 1;
}

/**
 * 解析版本区间约束串。无法解析返回 **`null`**，不抛异常。
 *
 * - 以 `[` / `(` 开头 → Maven restriction 语法，逗号分隔 = 并集。
 * - 否则 → 比较符 / 裸版本语法，空白分隔 = 交集。
 */
export function parseVersionRange(spec: string): ParsedVersionRange | null {
  if (typeof spec !== 'string') return null;
  const raw = spec.trim();
  if (raw.length === 0) return null;

  const first = raw.charAt(0);
  if (first === '[' || first === '(') {
    const intervals: RangeInterval[] = [];
    for (const token of splitTopLevel(raw)) {
      const iv = parseRestriction(token.trim());
      if (!iv) return null;
      intervals.push(iv);
    }
    if (intervals.length === 0) return null;
    return { raw, intervals, strict: true };
  }

  const tokens = raw.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  let intervals: RangeInterval[] = [];
  let strict = true;
  for (const token of tokens) {
    const parsed = parseComparator(token);
    if (!parsed) return null;
    intervals =
      intervals.length === 0 ? parsed.intervals : intersectRangeLists(intervals, parsed.intervals);
    strict = strict && parsed.strict;
  }
  if (intervals.length === 0) return null;
  return { raw, intervals, strict };
}

/**
 * 版本是否满足约束串。
 *
 * 畸形 spec 或畸形 version → **false**（保守，不谎称满足）。
 * 需要区分「确定不满足」与「无法判定」时改用 {@link checkVersionRange}。
 */
export function satisfiesRange(version: string, spec: string): boolean {
  const range = parseVersionRange(spec);
  if (!range) return false;
  const v = parseMavenVersion(version);
  if (!v) return false;
  return rangeSatisfiesVersion(range, v);
}

/** 带原因的三态判定（conflicts.ts 的入口） */
export function checkVersionRange(version: string, spec: string): RangeCheck {
  const range = parseVersionRange(spec);
  if (!range) {
    return {
      status: 'unknown',
      strict: false,
      raw: typeof spec === 'string' ? spec : String(spec),
      reason: `版本约束「${spec}」无法解析（Maven range 语法错误），跳过版本核对`,
    };
  }
  const v = parseMavenVersion(version);
  if (!v) {
    return {
      status: 'unknown',
      strict: range.strict,
      raw: range.raw,
      reason: `已安装版本「${version}」无法解析，无法核对约束「${range.raw}」`,
    };
  }
  if (rangeSatisfiesVersion(range, v)) {
    return {
      status: 'satisfied',
      strict: range.strict,
      raw: range.raw,
      reason: `${version} 满足约束 ${range.raw}`,
    };
  }
  return {
    status: 'violated',
    strict: range.strict,
    raw: range.raw,
    reason: range.strict
      ? `${version} 不满足版本约束 ${range.raw}`
      : `${version} 与推荐版本 ${range.raw} 不同（软性约束，不阻断）`,
  };
}
