/**
 * i18n 的**键存在性**与**两语言一致性**回归网。
 *
 * 为什么值得单独一个测试：`t()` 在找不到键时会**原样返回 key**（只往控制台
 * 打一行 warn），于是「界面上一小块写着 `settings.colorMode`」这种 bug
 * 不会让任何测试变红，也没人会在 console 里注意到它。本仓实际踩过两次：
 *
 *  1. `zh.json` / `en-US.json` 各自有**两个**顶层 `"settings"` 对象。
 *     JSON 只保留最后一个，于是第一个块里的键（colorMode / themeColor /
 *     curseforgeFreeApply …）全部变成死键，设置面板照原样显示 key。
 *  2. `SettingsPanel` 调 `tCommon('saved' | 'saving' | 'testing')`，但
 *     `common` 段里从来没有这三个键（它们在 `settings` 段下）—— 于是
 *     「保存中... / 已保存」显示成 `common.saved`。
 *
 * 三条断言分别对应：
 *  1. 两个语言的键集合**完全一致**（一边缺键 = 那边界面漏文案）；
 *  2. JSON **文本**里没有重复键（`JSON.parse` 会把重复键悄悄合并，所以必须
 *     扫原文；这是第 1 类 bug）；
 *  3. 源码里出现的静态键（`t('a.b')` / `tCommon('x')`）在两个语言里都存在
 *     （这是第 2 类 bug）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zh from './zh.json' with { type: 'json' };
import enUS from './en-US.json' with { type: 'json' };

/**
 * i18n 目录的绝对路径。
 *
 * ⚠️ 不能用 `fileURLToPath(import.meta.url)` 了事：vitest 在 jsdom 环境下
 * `import.meta.url` 不是 `file:` URL，会直接抛 `The URL must be of scheme file`。
 * 退回 `process.cwd()`（= 跑测试时的包目录 `apps/desktop`）并**校验探测到的
 * 路径真的存在**，免得 cwd 变了以后变成「扫了 0 个文件、断言全过」的假绿。
 */
const HERE = (() => {
  const candidates: string[] = [];
  try {
    candidates.push(fileURLToPath(new URL('.', import.meta.url)));
  } catch {
    // jsdom 下走这里
  }
  candidates.push(join(process.cwd(), 'src', 'renderer', 'src', 'i18n'));
  for (const c of candidates) {
    try {
      if (statSync(join(c, 'zh.json')).isFile()) return c;
    } catch {
      // 试下一个
    }
  }
  throw new Error(`找不到 i18n 目录，候选：${candidates.join(' | ')}`);
})();
/** 渲染层源码根（`src/renderer/src`）。 */
const SRC_ROOT = resolve(HERE, '..');

/** 递归收集「字符串叶子」的点分路径，例如 `settings.colorMode`。 */
function collectPaths(node: unknown, prefix = '', out = new Set<string>()): Set<string> {
  if (node === null || typeof node !== 'object') return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.add(path);
    else collectPaths(value, path, out);
  }
  return out;
}

const ZH_PATHS = collectPaths(zh);
const EN_PATHS = collectPaths(enUS);

/**
 * 扫 JSON **原文**找同一个对象里重复出现的键。
 *
 * 为什么必须扫原文：`JSON.parse` 会把重复键悄悄合并（后一个赢），所以「同一个
 * 段落被写成两份」这种 bug 在解析后的对象里已经无迹可寻了。
 *
 * 这是**行级**扫描（prettier 保证一个键一行），靠显式跟踪 `{` / `[` 的开关来
 * 划分层级：只有对象容器才记录键（数组元素各自是独立对象，同一个数组里两个
 * 不同对象出现同名键是合法的，不能算重复）。
 */
function duplicateKeys(raw: string): string[] {
  const dupes: string[] = [];
  /**
   * 当前打开的容器栈。`indent` = 开括号那一行的缩进，所以：
   *  - 这个容器的键在 `indent + 2`；
   *  - 它的闭括号也在 `indent`。
   * 只有 object 容器参与「重复键」判定。
   */
  const stack: { indent: number; kind: 'object' | 'array'; path: string; seen: Set<string> }[] = [
    // 根对象：开括号在第 0 列，所以它的键在第 2 列。
    { indent: 0, kind: 'object', path: '', seen: new Set() },
  ];
  /** 键（缩进 K）所属的 object 容器：其开括号在 K-2。 */
  const owner = (keyIndent: number) =>
    [...stack].reverse().find((c) => c.kind === 'object' && c.indent + 2 === keyIndent);

  for (const line of raw.split('\n')) {
    const inline = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:\s*([{[])\s*$/.exec(line);
    const bare = /^(\s*)([{[])\s*$/.exec(line);
    const close = /^(\s*)[}\]]/.exec(line);

    if (close) {
      const indent = close[1].length;
      while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
      continue;
    }

    if (inline) {
      const indent = inline[1].length;
      const parent = stack[stack.length - 1];
      const key = inline[2];
      // 这个键自己属于「键缩进 = indent」的那个容器（= 开括号在 indent - 2）
      const level = owner(indent);
      if (level) {
        if (level.seen.has(key)) dupes.push(`${level.path}.${key}`);
        level.seen.add(key);
      }
      stack.push({
        indent,
        kind: inline[3] === '{' ? 'object' : 'array',
        path: parent.path === '' ? key : `${parent.path}.${key}`,
        seen: new Set(),
      });
      continue;
    }

    if (bare) {
      const indent = bare[1].length;
      // 第 1 行的根 `{` 就是栈底那个容器，别再压一个
      if (indent === 0 && stack.length === 1) continue;
      stack.push({
        indent,
        kind: bare[2] === '{' ? 'object' : 'array',
        path: `${stack[stack.length - 1].path}[]`,
        seen: new Set(),
      });
      continue;
    }

    const kv = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:/.exec(line);
    if (kv) {
      const level = owner(kv[1].length);
      if (!level) continue;
      if (level.seen.has(kv[2])) dupes.push(`${level.path}.${kv[2]}`);
      level.seen.add(kv[2]);
    }
  }
  return dupes;
}

/** 递归列出某个目录下的源码文件。 */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '__snapshots__') continue;
      listSourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 故意用动态键的地方形如 `t('common.loader.' + l)` —— 正则只能截到 `common.loader.`。
 * 这类键不要求「本身存在」，而是要求**那个前缀下面确实有键**（namespace 存在），
 * 否则就是拼错了前缀；这比手工白名单更耐改。
 */
function isDynamicPrefix(key: string): boolean {
  return key.endsWith('.');
}

const hasNamespace = (paths: Set<string>, prefix: string): boolean =>
  [...paths].some((p) => p.startsWith(prefix));

describe('i18n · 键表本身', () => {
  it('中文与英文的键集合完全一致（一方缺键 = 那边界面漏文案）', () => {
    const onlyZh = [...ZH_PATHS].filter((k) => !EN_PATHS.has(k)).sort();
    const onlyEn = [...EN_PATHS].filter((k) => !ZH_PATHS.has(k)).sort();
    expect({ onlyZh, onlyEn }).toEqual({ onlyZh: [], onlyEn: [] });
  });

  it('两个语言的顶层结构一致（防止把一个段落写成两份）', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(enUS).sort());
  });

  it.each([
    ['zh', zh, readFileSync(join(HERE, 'zh.json'), 'utf8')],
    ['en-US', enUS, readFileSync(join(HERE, 'en-US.json'), 'utf8')],
  ])('%s.json 原文里没有重复键（JSON.parse 会把它们悄悄合并）', (_name, _obj, raw) => {
    expect(duplicateKeys(raw as string)).toEqual([]);
  });

  it('两份语言表覆盖的键都非空', () => {
    expect(ZH_PATHS.size).toBeGreaterThan(100);
  });
});

describe('i18n · 源码里用到的键', () => {
  /** 源码里出现的所有静态键：`t('a.b')` → 'a.b'，`tCommon('x')` → 'common.x'。 */
  function usedKeys(): { key: string; where: string }[] {
    const found: { key: string; where: string }[] = [];
    for (const file of listSourceFiles(SRC_ROOT)) {
      const text = readFileSync(file, 'utf8');
      const rel = file.slice(SRC_ROOT.length + 1).replace(/\\/g, '/');
      const lineOf = (idx: number) => text.slice(0, idx).split('\n').length;
      for (const m of text.matchAll(/\bt\(\s*'([^']+)'/g)) {
        found.push({ key: m[1], where: `${rel}:${lineOf(m.index ?? 0)}` });
      }
      for (const m of text.matchAll(/\btCommon\(\s*'([^']+)'/g)) {
        found.push({ key: `common.${m[1]}`, where: `${rel}:${lineOf(m.index ?? 0)}` });
      }
    }
    return found;
  }

  it('每个静态键在 zh 与 en-US 里都能解析到字符串', () => {
    const missing: string[] = [];
    for (const { key, where } of usedKeys()) {
      if (isDynamicPrefix(key)) {
        // 动态前缀：只要那个 namespace 下有键即可
        if (!hasNamespace(ZH_PATHS, key))
          missing.push(`zh 没有 ${key}* 这个 namespace（${where}）`);
        if (!hasNamespace(EN_PATHS, key))
          missing.push(`en-US 没有 ${key}* 这个 namespace（${where}）`);
        continue;
      }
      if (!ZH_PATHS.has(key)) missing.push(`zh 缺 ${key}（${where}）`);
      if (!EN_PATHS.has(key)) missing.push(`en-US 缺 ${key}（${where}）`);
    }
    expect(missing).toEqual([]);
  });

  it('扫描确实在工作（否则上面那条会变成永远为真的空断言）', () => {
    const keys = usedKeys();
    expect(keys.length).toBeGreaterThan(50);
    // 至少能看见一个已知真实存在的键，证明正则没跑偏
    expect(keys.some((k) => k.key === 'common.saved')).toBe(true);
  });
});
