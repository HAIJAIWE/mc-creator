/**
 * 依赖语义（设计文档 §5.3 同一 bullet：depends / recommends / suggests / breaks / conflicts）。
 *
 * 纯类型 + 纯函数，无网络、无 Node 依赖。版本区间判定委托 `./version-range.ts`。
 *
 * ## 为什么需要一个 modpack 局部类型而不改 `@mc-creator/shared`
 *
 * `packages/shared/src/schemas/modpack-spec.ts` 的 `ModDependencyRef.dependencyType`
 * 是 **zod 枚举 `required | optional | incompatible | embedded`**，那是 **Modrinth
 * API 的四个值**，无法表达 Forge/Fabric 的 `recommends` / `suggests` / `breaks`。
 * 而 `apps/desktop`（本轮禁改区，且另有代理在途）把 `ModEntry` 与
 * `ModConflict.kind` 都做成了封闭枚举 + `Record<kind, string>` 穷举映射，
 * 直接改 shared 会连带炸掉桌面端的 IPC 契约。
 *
 * 因此这里定义**加宽的局部视图** {@link SemanticDependencyRef}：它在结构上兼容
 * `ModEntry.dependencies`，只是把 `dependencyType` 放宽为 `string` 并额外允许
 * `versionRange`（Maven range 原文）。`ModEntry[]` 可直接赋给
 * {@link SemanticModEntry}[]，因此 `detectConflicts` 保持向后兼容，
 * 而 mods.toml / fabric.mod.json 解析器一旦落地（给 `dependencyType` 填
 * `'recommends'` / `'breaks'` 并带上 `versionRange`）即可零改动接入。
 *
 * 若主代理愿意改 shared，最小改动是两处：
 * 1. `ModDependencyRef` 增加 `versionRange: z.string().optional()`；
 * 2. `dependencyType` 从 z.enum 改为 `z.string()`（或扩枚举）。
 */

import type { ModEntry } from '@mc-creator/shared';

/** 设计文档 §5.3 要求的五种依赖语义（缺一不可） */
export const DEPENDENCY_SEMANTICS = [
  'depends',
  'recommends',
  'suggests',
  'breaks',
  'conflicts',
] as const;

export type DependencySemantic = (typeof DEPENDENCY_SEMANTICS)[number];

/**
 * 处置级别。
 *
 * ⚠️ 仓库里**没有** info 级枚举可挂靠（`ModConflict.kind` 是封闭 union，
 * `ClassifiedError.category` 只有 network/validation/version/disk/permission/unknown）。
 * 表达「仅提示」的方式：给 {@link ModConflict} 增加**可选**字段 `severity`，
 * 取值 `'error' | 'warning' | 'info'`。可选字段对 `apps/desktop` 现有
 * zod schema 是**向后兼容**的（zod 默认 strip 未知键，不会 parse 失败），
 * 也不会破坏 `CONFLICT_KIND_LABEL: Record<kind, string>` 的穷举性。
 */
export type DependencySeverity = 'error' | 'warning' | 'info';

/**
 * 每种语义的默认处置级别 —— 本模块的核心决策表。
 *
 * | 语义 | 级别 | 缺失时 | 版本不符时 | 共存时 | 理由 |
 * |---|---|---|---|---|---|
 * | `depends` | `error` | 报错（阻断） | 报错（阻断） | — | 缺失/版本不符必然导致加载失败或功能不可用，Forge 自身也直接拒绝加载 |
 * | `conflicts` | `error` | — | — | 报错（阻断） | 作者显式声明"不可共存"，共存必崩 |
 * | `breaks` | `warning` | — | — | 警告（不阻断） | 见下方长说明 |
 * | `recommends` | `warning` | 警告（不阻断） | 警告（不阻断） | — | 缺失会丢功能（如 JEI 类附属），但不崩 |
 * | `suggests` | `info` | 仅提示 | 仅提示 | — | 作者自己都标成"或许你会想要"，提示即可 |
 *
 * ### 为什么 `breaks` 是 warning 而不是 error（关键决策）
 *
 * `breaks`（Fabric `fabric.mod.json`）与 `conflicts` 的**语义差别**在于
 * **确定性**：
 * - `conflicts` = "这两个 mod 一定不能共存"，加载器可以直接拒绝。
 * - `breaks` = "装了 X **会**导致 Y 崩溃" —— 原文是 *may/will break* 的软性断言，
 *   实际是否崩溃取决于版本组合、mixin 是否命中、加载顺序、甚至是否安装了该功能。
 *   同一条 `breaks` 在不同 MC 版本上的表现并不稳定。
 *
 * 若把 `breaks` 升为 error，会产生**大面积误阻断**：真实整合包里存在大量
 * "历史上会崩、现已修复" 的 breaks 声明，直接 error 会让工具不可用
 * （用户只能绕过工具手装）。若升为 info 又太弱 —— 它确实在提示崩溃。
 * 故取 **warning**：明确告知风险与依据（附 mod 名与版本），让用户自行决定，
 * 同时保留 `suggestion`（移除其一）以便一键处理。
 * 这与 Forge 的实际行为一致：Forge 对 `incompatible` 拒绝加载，
 * 对"疑似会崩"的组合只记录警告。
 */
export const DEPENDENCY_SEVERITY: Record<DependencySemantic, DependencySeverity> = {
  depends: 'error',
  conflicts: 'error',
  breaks: 'warning',
  recommends: 'warning',
  suggests: 'info',
};

/**
 * 原始 dependencyType → 语义归一表。
 *
 * | 原始值 | 来源 | 归一语义 | 说明 |
 * |---|---|---|---|
 * | `required` | Modrinth / Forge `mods.toml` | `depends` | 三者同义 |
 * | `depends` | Fabric `fabric.mod.json` | `depends` | — |
 * | `mandatory` | 少数老 mod 自定义 | `depends` | 同义兜底 |
 * | `recommends` | Fabric | `recommends` | — |
 * | `suggests` | Fabric | `suggests` | — |
 * | `optional` | Modrinth / Forge `optional` | `recommends`（可配） | **争议点，见下** |
 * | `conflicts` | Fabric | `conflicts` | — |
 * | `incompatible` | Modrinth / Forge `mods.toml` | `conflicts` | 同义 |
 * | `exclude` | 少数自定义 | `conflicts` | 同义兜底 |
 * | `breaks` | Fabric | `breaks` | — |
 * | `embedded` | Modrinth | `null`（忽略） | 已内嵌进本 jar，不参与冲突 |
 *
 * ### `optional` 归到 `recommends` 而不是 `suggests`（保守取向，可覆盖）
 *
 * Modrinth 的 `optional` 是 `recommends` 与 `suggests` 的**合并桶** ——
 * 上游没有更细的信息。取**较强**的一档（`recommends` / warning），
 * 理由：漏报（该提示却没提示）的代价是用户拿到一个功能残缺的整合包，
 * 而误报（提示一个可选附属缺失）只是多一条可忽略的 warning。
 * 需要另一侧取向的调用方可通过 {@link ConflictSemanticOptions.optionalAs} 覆盖。
 */
const SEMANTIC_BY_RAW: Record<string, DependencySemantic> = {
  required: 'depends',
  depends: 'depends',
  mandatory: 'depends',
  recommends: 'recommends',
  suggests: 'suggests',
  optional: 'recommends',
  conflicts: 'conflicts',
  incompatible: 'conflicts',
  exclude: 'conflicts',
  breaks: 'breaks',
};

/** 明确忽略、不产生任何冲突项的 dependencyType */
const IGNORED_RAW = new Set(['embedded', 'include', 'inclusion']);

/** 加宽的依赖声明（结构兼容 `ModEntry.dependencies`） */
export interface SemanticDependencyRef {
  projectId: string;
  /** Modrinth/CurseForge 的版本 ID（**不是**版本号，不用于版本区间判定） */
  versionId?: string;
  /** 原始 dependencyType（放宽为 string 以容纳五种语义） */
  dependencyType: string;
  /** Maven version range 原文（如 `[1.20.1,1.21)`）；缺失表示无版本约束 */
  versionRange?: string;
}

/** 加宽的 ModEntry 视图；`ModEntry` 可直接赋给它 */
export type SemanticModEntry = Omit<ModEntry, 'dependencies'> & {
  dependencies?: SemanticDependencyRef[];
};

/** 语义解析可选参数 */
export interface ConflictSemanticOptions {
  /** `optional` 归一到哪一档；默认 `'recommends'`（保守）。可传 `'suggests'` 或 `'ignores'` */
  optionalAs?: DependencySemantic | 'ignores';
}

/** 归一原始 dependencyType；`embedded` / 未知值返回 `null`（= 不参与冲突判定） */
export function normalizeDependencySemantic(
  raw: string | undefined,
  opts?: ConflictSemanticOptions,
): DependencySemantic | null {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (key === '') return null;
  if (IGNORED_RAW.has(key)) return null;
  if (key === 'optional' && opts?.optionalAs) {
    return opts.optionalAs === 'ignores' ? null : opts.optionalAs;
  }
  return SEMANTIC_BY_RAW[key] ?? null;
}

/** 取依赖声明的版本约束原文（优先显式 versionRange，其次调用方注入表） */
export function resolveVersionConstraint(
  dep: SemanticDependencyRef,
  injected?: string,
): string | undefined {
  const explicit = dep.versionRange?.trim();
  if (explicit) return explicit;
  const fromTable = injected?.trim();
  if (fromTable) return fromTable;
  return undefined;
}

/** 该语义是否为"软性"（缺失/版本不符都不阻断） */
export function isSoftSemantic(semantic: DependencySemantic): boolean {
  return semantic === 'recommends' || semantic === 'suggests';
}

/**
 * 该语义是否需要"共存检查"（conflicts / breaks）。
 * depends / recommends / suggests 只在缺失或版本不符时产生条目。
 */
export function isCoexistenceSemantic(semantic: DependencySemantic): boolean {
  return semantic === 'conflicts' || semantic === 'breaks';
}

/** 人类可读标签（中文，供 message 直接拼接，避免上层再造映射表） */
export const DEPENDENCY_SEMANTIC_LABEL: Record<DependencySemantic, string> = {
  depends: '必需依赖',
  recommends: '推荐依赖',
  suggests: '建议依赖',
  breaks: '破坏性依赖',
  conflicts: '互斥依赖',
};

/** 决策表的可读摘要（文档与测试共用一处事实来源） */
export const DEPENDENCY_SEMANTIC_DOCS: ReadonlyArray<{
  semantic: DependencySemantic;
  severity: DependencySeverity;
  missing: string;
  versionMismatch: string;
  coexistence: string;
}> = [
  {
    semantic: 'depends',
    severity: 'error',
    missing: 'error：缺失必崩，加载器会拒绝加载',
    versionMismatch: 'error：版本不符必崩或功能不可用',
    coexistence: '—',
  },
  {
    semantic: 'recommends',
    severity: 'warning',
    missing: 'warning：缺附属会丢功能，但不会崩',
    versionMismatch: 'warning：版本不符可能丢功能',
    coexistence: '—',
  },
  {
    semantic: 'suggests',
    severity: 'info',
    missing: 'info：作者标注为"或许你想要"，仅提示',
    versionMismatch: 'info：仅提示',
    coexistence: '—',
  },
  {
    semantic: 'breaks',
    severity: 'warning',
    missing: '—',
    versionMismatch: '—',
    coexistence: 'warning：作者声明会崩溃，但实际取决于版本组合，不阻断',
  },
  {
    semantic: 'conflicts',
    severity: 'error',
    missing: '—',
    versionMismatch: '—',
    coexistence: 'error：显式声明不可共存，共存必崩',
  },
];
