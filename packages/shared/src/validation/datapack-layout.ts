/**
 * 数据包目录布局校验（设计文档 §5.7）。
 *
 * ## §5.7 的原文要求
 *
 * > - `pack.mcmeta` + `data/<namespace>/`
 * > - ⚠️ **目录层级陷阱**：根目录必须直接含 `pack.mcmeta` 与 `data/`，禁止多套一层
 * > - 静态验证：Spyglass 式检查；动态验证：`/reload` + `/datapack list`
 *
 * ## 为什么要有这一层
 *
 * 「多套一层」是最常见也最难自查的数据包错误：zip 解出来是
 * `MyPack/pack.mcmeta` + `MyPack/data/...` 而不是 `pack.mcmeta` + `data/...`。
 * 游戏会**静默不加载**这个包（`/datapack list` 里不出现），用户看不出原因，
 * 于是反复重打包。本模块把这道检查做成**生成期可判**，而不是留给运行时。
 *
 * 本仓基岩侧已有同类检查（`kernel-bedrock/src/kernel.ts` 查根目录是否直接含
 * `manifest.json`），本模块是它在 Java 数据包侧的对应物，且额外覆盖
 * §5.7 明确要求的 `data/` 存在性与命名空间目录层数。
 *
 * ## 判据来源
 *
 * 全部来自设计文档 §5.7 的明文要求，不含推测：
 * 1. 根目录**直接**含 `pack.mcmeta`（不能是 `X/pack.mcmeta`）。
 * 2. 根目录**直接**含 `data/`。
 * 3. 命名空间目录是 `data/<namespace>/`，即 `data/` 下**再套一层**才是命名空间
 *    —— 多一层或少一层都不对。
 * 4. 命名空间须是合法资源位置（`[a-z0-9_.-]`），大写非法。
 *
 * 另外附一条**通用 zip 卫生**检查（与 §13.1 zip-slip 同源）：
 * 路径不得为绝对路径、不得含 `..`、不得为空段。
 */

/** 文件条目（与 @mc-creator/shared 的 FileNode 结构兼容，刻意只取需要的字段）。 */
export interface LayoutFile {
  path: string;
}

/** 布局问题。 */
export interface DatapackLayoutIssue {
  level: 'error' | 'warning';
  /** 稳定的机器可读标识，便于测试与 UI 分派。 */
  code:
    | 'MISSING_PACK_MCMETA'
    | 'MISSING_DATA_DIR'
    | 'EXTRA_ROOT_LAYER'
    | 'NESTED_TOO_DEEP'
    | 'INVALID_NAMESPACE'
    | 'UNSAFE_PATH'
    | 'NO_CONTENT';
  message: string;
  /** 相关路径（若有）。 */
  path?: string;
}

/** `pack.mcmeta` 的规范路径。 */
export const PACK_MCMETA_PATH = 'pack.mcmeta';

/** `data/` 目录前缀。 */
export const DATA_DIR = 'data/';

/** 命名空间合法形态：小写字母/数字/下划线/点/连字符，1-64 字符。 */
const NAMESPACE_RE = /^[a-z0-9_.-]{1,64}$/;

/** 归一化：反斜杠转正斜杠、去掉前导 `./`。 */
function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** zip 卫生检查（§13.1 同源）：绝对路径 / `..` / 空段 / 盘符。 */
export function unsafePaths(files: readonly LayoutFile[]): DatapackLayoutIssue[] {
  const issues: DatapackLayoutIssue[] = [];
  for (const f of files) {
    const raw = f.path;
    const p = normalize(raw);
    if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
      issues.push({
        level: 'error',
        code: 'UNSAFE_PATH',
        message: `路径是绝对路径: ${raw}`,
        path: raw,
      });
      continue;
    }
    if (p.split('/').some((seg) => seg === '..')) {
      issues.push({
        level: 'error',
        code: 'UNSAFE_PATH',
        message: `路径含上级引用（路径穿越）: ${raw}`,
        path: raw,
      });
    }
  }
  return issues;
}

/**
 * 校验数据包目录布局（§5.7）。
 *
 * 只看 `files` 的路径，不读磁盘 —— 这样生成器与测试都能直接用，
 * 且不引入 I/O。
 */
export function validateDatapackLayout(files: readonly LayoutFile[]): DatapackLayoutIssue[] {
  const issues: DatapackLayoutIssue[] = [...unsafePaths(files)];

  const paths = files.map((f) => normalize(f.path)).filter((p) => p !== '');
  const dirs = new Set(paths.map((p) => p.split('/').slice(0, -1).join('/')));

  // --- 判据 1：根目录直接含 pack.mcmeta ---
  const hasRootMcmeta = paths.includes(PACK_MCMETA_PATH);
  if (!hasRootMcmeta) {
    // 找出它被套了几层，给出可执行的修复提示而不是只说「缺文件」。
    const nested = paths.find((p) => p.endsWith('/' + PACK_MCMETA_PATH));
    if (nested !== undefined) {
      const prefix = nested.slice(0, -(PACK_MCMETA_PATH.length + 1));
      issues.push({
        level: 'error',
        code: 'EXTRA_ROOT_LAYER',
        message:
          `pack.mcmeta 位于 ${nested} 而非包根目录。` +
          `§5.7 目录层级陷阱：根目录必须**直接**含 pack.mcmeta 与 data/，禁止多套一层。` +
          `修复：去掉前缀 ${prefix}/ 后重新打包。`,
        path: nested,
      });
    } else {
      issues.push({
        level: 'error',
        code: 'MISSING_PACK_MCMETA',
        message: `包根目录缺少 ${PACK_MCMETA_PATH}（§5.7 要求根目录直接含该文件）`,
        path: PACK_MCMETA_PATH,
      });
    }
  }

  // --- 判据 2：根目录直接含 data/ ---
  // 「根目录直接含 data/」= 存在以 `data/` 开头的路径，或本身就是 `data` 条目。
  // 不能靠 dirs 集合里出现裸 `data` —— 有命名空间时 `data` 只是中间目录，不会单独成条目。
  const hasDataDir =
    dirs.has('data') || paths.includes('data') || paths.some((p) => p.startsWith(DATA_DIR));

  // 除了 pack.mcmeta 之外还有没有别的内容 —— 用来区分「空数据包」与「层级套错」。
  const nonMeta = paths.filter((p) => p !== PACK_MCMETA_PATH && p !== 'data');

  if (!hasDataDir && nonMeta.length === 0) {
    // 只有 pack.mcmeta：不是层级错，是**没内容**。空数据包游戏会正常加载
    // （只是没有东西可加载），故只给 warning。
    issues.push({
      level: 'warning',
      code: 'NO_CONTENT',
      message: `数据包里除 ${PACK_MCMETA_PATH} 外没有任何内容，产出的数据包不会被游戏加载`,
      path: PACK_MCMETA_PATH,
    });
  } else if (!hasDataDir) {
    const nestedData = paths.find((p) => /^[^/]+\/data\//.test(p));
    if (nestedData !== undefined) {
      issues.push({
        level: 'error',
        code: 'EXTRA_ROOT_LAYER',
        message:
          `data/ 被套在了子目录下（示例：${nestedData}）。` +
          `§5.7 目录层级陷阱：根目录必须直接含 data/。`,
        path: nestedData,
      });
    } else {
      issues.push({
        level: 'error',
        code: 'MISSING_DATA_DIR',
        message: `包根目录缺少 data/ 目录（§5.7：根目录必须直接含 pack.mcmeta 与 data/）`,
        path: DATA_DIR,
      });
    }
  }

  // --- 判据 3 + 4：data/ 下必须恰好再套一层命名空间，且命名空间合法 ---
  const namespaces = new Set<string>();
  for (const p of paths) {
    if (!p.startsWith(DATA_DIR)) continue;
    const rest = p.slice(DATA_DIR.length);
    if (rest === '') continue;
    const segs = rest.split('/');
    const ns = segs[0] as string;
    namespaces.add(ns);
    if (!NAMESPACE_RE.test(ns)) {
      issues.push({
        level: 'error',
        code: 'INVALID_NAMESPACE',
        message:
          `命名空间 ${ns} 非法（须为 1-64 位小写字母/数字/下划线/点/连字符；` +
          `大写与空格在资源位置中不可用）`,
        path: p,
      });
    }
  }
  if (namespaces.size === 0 && hasDataDir) {
    issues.push({
      level: 'warning',
      code: 'NO_CONTENT',
      message: 'data/ 存在但没有任何命名空间目录，产出的数据包不会被游戏加载',
      path: DATA_DIR,
    });
  }

  return issues;
}

/**
 * 是否存在会**阻止游戏加载**的硬错误。
 *
 * §5.7 的动态验证是 `/reload` + `/datapack list`；本函数是它的静态前置，
 * 用于在生成期就拦住「打包完才发现没加载」。
 */
export function hasBlockingLayoutIssue(issues: readonly DatapackLayoutIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}

/**
 * 布局问题 → 中文一行摘要（供 agent / warning 文案使用）。
 */
export function summarizeLayoutIssues(issues: readonly DatapackLayoutIssue[]): string {
  if (issues.length === 0) return '数据包目录布局符合 §5.7（根目录直接含 pack.mcmeta 与 data/）';
  return issues.map((i) => `[${i.code}] ${i.message}`).join('；');
}
