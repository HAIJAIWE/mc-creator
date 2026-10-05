/**
 * Maven 版本号解析与比较（纯函数，无网络、无 Node 依赖）。
 *
 * ## 为什么不用现成库（依赖边界核实结论）
 *
 * `packages/core/package.json` 的 dependencies/devDependencies 中**没有**
 * `maven-artifact` / `semver` / 任何版本比较库（已核实：`node_modules/semver`、
 * `node_modules/maven-artifact`、`packages/core/node_modules/semver` 均不存在）。
 * 按任务约束不得 `pnpm install` 新增依赖，故自行实现。
 *
 * 不用 `semver` 的额外理由：Maven 的 range 语法（`[1.0,2.0)`、`(,1.0]`、`[1.0]`）
 * 与 npm semver 语法（`^1.0.0`、`~1.0.0`）是两套不同方言，且 Maven 的版本序
 * 与 semver 也不同 —— 典型冲突：`0.92.11+1.20.1`（Fabric API）在 semver 里
 * `+1.20.1` 是 build metadata（**被忽略**，于是与 `0.92.11` 相等），但在 Mod 生态里
 * 这个后缀是 **MC 版本 tag，必须参与排序**（`0.92.11+1.21` > `0.92.11+1.20.1`）。
 * 套 semver 会直接漏判 Fabric API 跨 MC 版本的新旧关系。
 *
 * ## 算法
 *
 * 采用 Apache Maven `ComparableVersion` 的算法（数字段 / qualifier 逐项比较，
 * `-` 与「数字后紧跟字母」引入嵌套列表），因为它是 Forge / NeoForge / Fabric
 * 生态事实上的标准。qualifier 规范序见 {@link QUALIFIER_ORDER}。
 *
 * 所有导出函数**不抛异常**：畸形输入返回 `null` / `0` 并附带原因，由调用方
 * 决定降级策略（见 version-range.ts 的 `unknown` 状态）。
 */

/**
 * Maven 已知 qualifier 的规范序（下标越小越"早"/越不稳定）。
 *
 * 采用 **Maven 官方传统序**（`alpha < beta < milestone < rc < snapshot < release < sp`），
 * 而不是 semver 的 `alpha < beta < prerelease < rc`：
 * - 本项目的核心判定对象是 Forge / NeoForge / Fabric 的**发布版本**，这些生态的
 *   `versionRange` 由 Maven 语义产生（`mods.toml` 的 `versionRange` 直传给
 *   `maven-artifact` 的 `VersionRange`），故与 Maven 保持一致可避免"我们判 A、
 *   Gradle/Forge 判 B"的自相矛盾。
 * - 未知 qualifier 排在所有已知 qualifier **之后**（与 Maven 一致）：`1.0-foo`
 *   视为"某个比正式版新的自定义构建"，而不是非法值。
 *
 * 注意 `''`（release）位于 `snapshot` 与 `sp` 之间 —— Maven 把
 * "release" 放在 snapshot 之后、sp（service pack）之前，这是 Maven 的历史约定，
 * 与直觉（sp 是补丁号，通常"更新"）相反，但必须照搬才能与 Forge 一致。
 */
export const QUALIFIER_ORDER = ['alpha', 'beta', 'milestone', 'rc', 'snapshot', '', 'sp'] as const;

/** Maven 中代表"正式版"的 RELEASE_VERSION_INDEX（`StringItem` 与 null 比较时的基准） */
const RELEASE_VERSION_INDEX = String(QUALIFIER_ORDER.indexOf('')); // '5'

/** 历史别名归一（Maven 官方 aliases） */
const QUALIFIER_ALIASES: Record<string, string> = {
  ga: '',
  final: '',
  release: '',
  cr: 'rc',
};

/** 未知 qualifier 的排序键前缀（必须大于所有已知 qualifier 的下标） */
const UNKNOWN_QUALIFIER_RANK = String(QUALIFIER_ORDER.length); // '7'

// === 内部 item 模型 ===

interface IntegerItem {
  readonly type: 'int';
  readonly value: string;
}

interface StringItem {
  readonly type: 'string';
  readonly value: string;
}

interface ListItem {
  readonly type: 'list';
  items: VersionItem[];
}

type VersionItem = IntegerItem | StringItem | ListItem;

const ZERO: IntegerItem = { type: 'int', value: '0' };

/** 可比较的版本号（解析结果） */
export interface ParsedVersion {
  /** 归一化后的小写原文（已剥离前导 `v`） */
  readonly raw: string;
  readonly items: readonly VersionItem[];
}

// === 基础比较原语 ===

/**
 * 任意长度十进制整数字符串比较。
 *
 * 刻意**不用 BigInt**：Maven 版本段理论上无限位，`bigint` 字面量还需要
 * target >= ES2020；剥掉前导零后按「长度 → 字典序」比较是精确等价的，且无兼容负担。
 */
function compareNumericStrings(a: string, b: string): number {
  const an = a.replace(/^0+/, '');
  const bn = b.replace(/^0+/, '');
  if (an.length !== bn.length) return an.length < bn.length ? -1 : 1;
  if (an === bn) return 0;
  return an < bn ? -1 : 1;
}

/** qualifier 的可比较字符串：`下标-qualifier`（未知则 `7-qualifier`） */
function comparableQualifier(qualifier: string): string {
  const idx = (QUALIFIER_ORDER as readonly string[]).indexOf(qualifier);
  return `${idx < 0 ? UNKNOWN_QUALIFIER_RANK : idx}-${qualifier}`;
}

function isNullItem(item: VersionItem): boolean {
  switch (item.type) {
    case 'int':
      return compareNumericStrings(item.value, '0') === 0;
    case 'string':
      // ⚠️ 有意偏离 Maven：Maven 用可比较键 `"5-".compareTo("5")` 判非空，
      // 于是 `1.0-ga` / `1.0-final` 会被判为**新于** `1.0`（可比较键的字典序副作用）。
      // 这与直觉、也与 Forge/Gradle 的展示语义不符 —— 我们把空 qualifier
      // （含 ga/final/release 别名归一后的结果）直接当 null 裁掉。
      if (item.value === '') return true;
      return comparableQualifier(item.value) === RELEASE_VERSION_INDEX;
    case 'list':
      return item.items.length === 0;
  }
}

/** `integer` 与 `null` 比较：0 视为相等（等价 release），非 0 按符号 */
function compareIntToNull(item: IntegerItem): number {
  return compareNumericStrings(item.value, '0');
}

/** `string` 与 `null` 比较 */
function compareStringToNull(item: StringItem): number {
  const key = comparableQualifier(item.value);
  if (key === RELEASE_VERSION_INDEX) return 0;
  return key < RELEASE_VERSION_INDEX ? -1 : 1;
}

function compareItemToNull(item: VersionItem): number {
  switch (item.type) {
    case 'int':
      return compareIntToNull(item);
    case 'string':
      return compareStringToNull(item);
    case 'list': {
      if (item.items.length === 0) return 0;
      for (const child of item.items) {
        const r = compareItemToNull(child);
        if (r !== 0) return r;
      }
      return 0;
    }
  }
}

/**
 * item 与 item 比较（左操作数为 `a`）。
 * `right === null` 表示"到头了"，语义见 Maven ComparableVersion。
 */
function compareItems(a: VersionItem, right: VersionItem | null): number {
  if (right === null) return compareItemToNull(a);
  switch (a.type) {
    case 'int':
      switch (right.type) {
        case 'int':
          return compareNumericStrings(a.value, right.value);
        // 1-1 < 1.1.x
        case 'list':
          return -1;
        // 1-1 > 1-sp
        case 'string':
          return 1;
      }
      break;
    case 'string':
      switch (right.type) {
        case 'int':
          return -1;
        case 'string': {
          const l = comparableQualifier(a.value);
          const r = comparableQualifier(right.value);
          if (l === r) return 0;
          return l < r ? -1 : 1;
        }
        case 'list':
          return 1;
      }
      break;
    case 'list': {
      switch (right.type) {
        // 1 < 1.1
        case 'int':
          return 1;
        // 1-sp > 1-1
        case 'string':
          return -1;
        case 'list': {
          const len = Math.max(a.items.length, right.items.length);
          for (let i = 0; i < len; i++) {
            const l = i < a.items.length ? a.items[i] : null;
            const r = i < right.items.length ? right.items[i] : null;
            // 短的这边视为"到头"，取反比较
            const result =
              l === null ? (r === null ? 0 : -compareItemToNull(r)) : compareItems(l, r);
            if (result !== 0) return result;
          }
          return 0;
        }
      }
      break;
    }
  }
  /* c8 ignore next */
  throw new Error('unreachable version item comparison');
}

/** 解析出的项列表尾部空项裁剪（Maven `ListItem.normalize`） */
function normalize(items: VersionItem[]): VersionItem[] {
  const out = items.slice();
  for (let i = out.length - 1; i >= 0; i--) {
    const last = out[i];
    if (last === undefined) break;
    if (isNullItem(last)) {
      out.splice(i, 1);
    } else if (last.type !== 'list') {
      break;
    }
  }
  return out;
}

/** 合法字符集：数字、字母、`.`、`-`、`_`、`+`（+ 承载 Fabric API 的 MC tag） */
const VERSION_CHARSET = /^[0-9a-z._+-]+$/;

/**
 * 解析 Maven 版本号为可比较结构。畸形输入返回 `null`（不抛异常）。
 *
 * 归一化规则（有意偏离 Maven，为了容忍 Mod 生态的脏数据）：
 * 1. 剥离**单个**前导 `v`/`V`（仅当其后紧跟数字时），如 `v1.2.3` → `1.2.3`；
 * 2. 转小写（`1.0-ALPHA` → `1.0-alpha`）；
 * 3. 前导零在**数值比较时**忽略（`1.01` 与 `1.1` 相等），但不改写原文；
 * 4. **必须含至少一个数字**，否则判为不可比较（见下方说明）。
 *
 * 判为畸形并返回 `null` 的情形：非字符串、空串 / 纯空白、含 `[0-9a-z._+-]`
 * 以外的字符、解析后归一化得到空列表（如 `'...'`、`'--'`）、**完全不含数字**。
 *
 * ### 为什么要求"至少一个数字"（有意偏离 Maven）
 *
 * Maven 会接受纯字母 token 并当作未知 qualifier（`garbage` → `[garbage]`），
 * 于是 `garbage < 1.0` 成立。但 Mod 生态的 `versionNumber` 字段里大量存在
 * `Latest` / `Beta` / `Release` / `AANobbMI`（Modrinth 版本记录 ID）这类**非版本串**。
 * 若放它们进来，`checkVersionRange('Latest', '[1.0,2.0)')` 会误报"版本不符"，
 * 产生大量假阳性的阻断级结论。要求含数字可彻底消除这一类假阳性，
 * 且永不误拒任何真实版本号（真实版本号必然含数字）。
 */
export function parseMavenVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim().toLowerCase();
  if (raw.length === 0) return null;
  if (/^v\d/.test(raw)) raw = raw.slice(1);
  if (!VERSION_CHARSET.test(raw)) return null;
  if (!/\d/.test(raw)) return null;

  const root: ListItem = { type: 'list', items: [] };
  /** 嵌套列表栈（normalize 后自内向外处理） */
  const stack: ListItem[] = [root];
  let isDigit = false;
  let startIndex = 0;

  const push = (item: VersionItem): void => {
    const cur = stack[stack.length - 1];
    if (cur) cur.items.push(item);
  };
  const descend = (): void => {
    const next: ListItem = { type: 'list', items: [] };
    push(next);
    stack.push(next);
  };

  for (let i = 0; i < raw.length; i++) {
    const c = raw.charAt(i);
    if (c === '.') {
      if (i === startIndex) push(ZERO);
      else push(parseItem(isDigit, raw.slice(startIndex, i)));
      startIndex = i + 1;
    } else if (c === '-') {
      if (i === startIndex) push(ZERO);
      else push(parseItem(isDigit, raw.slice(startIndex, i)));
      startIndex = i + 1;
      descend();
    } else if (c >= '0' && c <= '9') {
      // 1.0.0.X1 < 1.0.0.X2：数字段紧跟字母段后再接数字，需另起一层
      if (!isDigit && i > startIndex) {
        push(stringItem(raw.slice(startIndex, i)));
        startIndex = i;
        descend();
      }
      isDigit = true;
    } else {
      if (isDigit && i > startIndex) {
        push(parseItem(true, raw.slice(startIndex, i)));
        startIndex = i;
        descend();
      }
      isDigit = false;
    }
  }
  if (raw.length > startIndex) {
    push(parseItem(isDigit, raw.slice(startIndex)));
  }

  // 自内向外 normalize（Maven 从栈顶往下做，等价）
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur) cur.items = normalize(cur.items);
  }

  if (root.items.length === 0) return null;
  return { raw, items: root.items };
}

function parseItem(isDigit: boolean, buf: string): VersionItem {
  if (isDigit) return { type: 'int', value: buf };
  return stringItem(buf);
}

/** 字符串 item 工厂（统一走历史别名归一） */
function stringItem(buf: string): StringItem {
  return { type: 'string', value: QUALIFIER_ALIASES[buf] ?? buf };
}

/** 版本是否可解析（便于调用方在 UI 上标灰） */
export function isComparableVersion(input: string): boolean {
  return parseMavenVersion(input) !== null;
}

/** 两个已解析版本比较 */
export function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  const len = Math.max(a.items.length, b.items.length);
  for (let i = 0; i < len; i++) {
    const l = i < a.items.length ? a.items[i] : null;
    const r = i < b.items.length ? b.items[i] : null;
    const result = l === null ? (r === null ? 0 : -compareItemToNull(r)) : compareItems(l, r);
    if (result !== 0) return result;
  }
  return 0;
}

/**
 * 比较两个版本字符串。
 *
 * @returns `-1` a<b / `0` 相等 / `1` a>b；**任一侧无法解析则返回 `null`（无法比较）**。
 *
 * 行为要点：
 * - 数字段逐段比：`1.10 > 1.9`（`'1.10' < '1.9'` 的 `localeCompare` 结果是错的）；
 * - 预发布在后：`1.0-alpha < 1.0`、`1.0-rc1 < 1.0`、`1.0-alpha1 < 1.0-alpha2`；
 * - **缺失段视为 0**：`1.0` 与 `1.0.0` **判定为相等**（与 Maven 一致 —— Maven 的
 *   `ComparableVersion` 裁掉尾部 0 后两者 item 列表完全相同）。这正是 Forge
 *   `versionRange = "[21.1,)"` 能同时接受 `21.1` 与 `21.1.0` 的原因。
 * - 前导 `v` / 前导零 / 大写 qualifier 自动归一，不算畸形。
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseMavenVersion(a);
  if (!pa) return null;
  const pb = parseMavenVersion(b);
  if (!pb) return null;
  return compareParsedVersions(pa, pb);
}

/**
 * 永不返回 `null` 的比较（排序用）：无法比较时退化到 `localeCompare`。
 * 注意退化路径**不具备版本语义**（`1.10 < 1.9`），只用于保持排序稳定且不抛错。
 */
export function compareVersionsSafe(a: string, b: string): number {
  const r = compareVersions(a, b);
  if (r !== null) return r;
  return a.localeCompare(b);
}

/** `a` 是否严格新于 `b`（不可比较返回 false） */
export function isNewerVersion(a: string, b: string): boolean {
  return compareVersions(a, b) === 1;
}
