/**
 * 版本冲突检测（纯函数，无网络）。
 *
 * 逐项检查：
 * 1. duplicate-version — 同一 projectId 出现多个 versionId
 * 2. loader-mismatch — entry.loaders 非空且不含目标 loader
 * 3. mc-out-of-range — entry.gameVersions 非空且不含目标 mcVersion
 * 4. 依赖语义（§5.3 五种，**新增**）— 见下方「依赖语义检查」小节
 *
 * 每项均给出 FixSuggestion（升级/降级/移除/补装），目标版本号尽量从已有元数据推导；
 * 无元数据时 suggestion 仅给方向性 reason（主进程可用在线元数据补全 targetVersionId）。
 *
 * ## 依赖语义检查（depends / recommends / suggests / breaks / conflicts）
 *
 * 语义 → 处置的完整决策表见 `./dependency-semantics.ts` 的
 * {@link DEPENDENCY_SEMANTIC_DOCS}。此处只描述落地方式：
 *
 * - `depends`（required）：缺失 → `missing-dependency` + **error**；
 *   已安装但版本不满足硬约束 → 同 kind、`detail: 'version-mismatch'` + **error**。
 * - `conflicts`（incompatible）：共存 → `breaks-conflict` + **error**。
 * - `breaks`：共存 → `breaks-conflict` + **warning**（理由见 dependency-semantics.ts）。
 * - `recommends`：缺失 → `missing-dependency` + **warning**；版本不符 → 同 kind + warning。
 * - `suggests`：缺失 → `missing-dependency` + **info**（仅提示，不阻断）。
 *
 * ⚠️ 版本约束来源：`dep.versionRange`（mods.toml / fabric.mod.json 解析器接入后可用）
 * 或调用方注入的 `opts.versionRangeByProject`。
 * **`dep.versionId` 绝不当版本约束用** —— 它是 Modrinth/CurseForge 的
 * 版本记录 ID（base62 哈希 / 数字 fileId），不是版本号，拿它做范围判定必然误报。
 */

import type { ModEntry } from '@mc-creator/shared';
import type { ConflictKind, ModConflict, VersionMetadata } from './types.js';
import { normalizeLoader } from './resolver.js';
import {
  DEPENDENCY_SEMANTIC_LABEL,
  DEPENDENCY_SEVERITY,
  isCoexistenceSemantic,
  normalizeDependencySemantic,
  resolveVersionConstraint,
  type ConflictSemanticOptions,
  type DependencySemantic,
  type DependencySeverity,
  type SemanticDependencyRef,
  type SemanticModEntry,
} from './dependency-semantics.js';
import { checkVersionRange } from './version-range.js';
import { compareVersionsSafe } from './version.js';

/** projectId → 候选版本（新到旧）→ dependency projectId → Maven version range */
export type VersionRangeTable =
  Map<string, Record<string, string>> | Record<string, Record<string, string>>;

/** 可选：供一键修复推导建议版本的候选元数据 + 语义策略 */
export interface ConflictDetectOptions extends ConflictSemanticOptions {
  /** projectId → 候选版本（新到旧），用于推导 upgrade/downgrade 目标 */
  metadataByProject?: Map<string, VersionMetadata[]> | Record<string, VersionMetadata[]>;
  /**
   * 版本约束注入表：owner projectId → dependency projectId → Maven range 原文。
   * 用于 mods.toml / fabric.mod.json 解析器尚未接入时的过渡通道。
   */
  versionRangeByProject?: VersionRangeTable;
}

function getMeta(opts: ConflictDetectOptions | undefined, projectId: string): VersionMetadata[] {
  if (!opts?.metadataByProject) return [];
  const m = opts.metadataByProject;
  if (m instanceof Map) return m.get(projectId) ?? [];
  return (m as Record<string, VersionMetadata[]>)[projectId] ?? [];
}

function getRangeTable(
  opts: ConflictDetectOptions | undefined,
  owner: string,
): Record<string, string> | undefined {
  const t = opts?.versionRangeByProject;
  if (!t) return undefined;
  if (t instanceof Map) return t.get(owner);
  return t[owner];
}

/** 在候选版本中找同时命中 loader+mc 的最新版（用于 upgrade 建议） */
function findHealthyVersion(
  candidates: VersionMetadata[],
  mcVersion: string,
  loader: string,
  constraint?: string,
): VersionMetadata | undefined {
  const wantLoader = normalizeLoader(loader);
  const healthy = candidates.filter(
    (v) =>
      v.loaders.map((l) => l.toLowerCase()).includes(wantLoader) &&
      v.gameVersions.includes(mcVersion),
  );
  // 有版本约束时优先挑真正满足约束的候选；一个都不满足才退回首个健康候选
  if (constraint) {
    const matching = healthy.find(
      (v) => checkVersionRange(v.versionNumber, constraint).status === 'satisfied',
    );
    if (matching) return matching;
  }
  return healthy[0];
}

/**
 * 在候选版本中找满足版本约束的最新版（不限定 loader / mc —— 这类条目本身
 * 就是"依赖版本不对"，按目标依赖的约束挑即可）。
 */
function findVersionSatisfying(
  candidates: VersionMetadata[],
  constraint: string,
): VersionMetadata | undefined {
  return candidates.find(
    (v) => checkVersionRange(v.versionNumber, constraint).status === 'satisfied',
  );
}

/** 非依赖类检查的默认级别（依赖类检查由 DEPENDENCY_SEVERITY 决定） */
function severityOf(kind: ConflictKind): DependencySeverity {
  switch (kind) {
    case 'missing-dependency':
    case 'breaks-conflict':
    case 'loader-mismatch':
    case 'mc-out-of-range':
      return 'error';
    case 'duplicate-version':
      return 'warning';
  }
}

/** 依赖条的已安装版本号（优先人类可读 versionNumber，回退 versionId） */
function installedVersionOf(m: ModEntry): string {
  return m.versionNumber ?? m.versionId;
}

export function detectConflicts(
  resolvedInput: ModEntry[] | SemanticModEntry[],
  mcVersion: string,
  loader: string,
  opts?: ConflictDetectOptions,
): ModConflict[] {
  const resolved = resolvedInput as SemanticModEntry[];
  const conflicts: ModConflict[] = [];
  const wantLoader = normalizeLoader(loader);
  const byProject = new Map<string, SemanticModEntry[]>();
  for (const m of resolved) {
    const list = byProject.get(m.projectId) ?? [];
    list.push(m);
    byProject.set(m.projectId, list);
  }

  // 1. 同一 mod 多版本
  for (const [pid, list] of byProject) {
    const versions = new Set(list.map((m) => m.versionId));
    if (versions.size > 1) {
      // 版本序用 Maven 比较（1.10 > 1.9），localeCompare 会把 '1.10' 排到 '1.9' 之后
      const sorted = [...list].sort((a, b) =>
        compareVersionsSafe(a.versionNumber ?? a.versionId, b.versionNumber ?? b.versionId),
      );
      const keep = sorted[sorted.length - 1];
      conflicts.push({
        kind: 'duplicate-version',
        severity: severityOf('duplicate-version'),
        projectIds: [pid],
        message: `同一 mod 存在 ${versions.size} 个不同版本：${[...versions].join(', ')}（${list[0]?.name ?? pid}）`,
        suggestion: {
          action: 'downgrade',
          targetVersionId: keep?.versionId,
          reason: `只保留一个版本，建议保留 ${keep?.versionNumber ?? keep?.versionId ?? ''} 并移除其余`,
        },
        ...(keep?.versionNumber ? { suggestedVersionNumber: keep.versionNumber } : {}),
      });
    }
  }

  // 2/3. loader 不匹配 / mcVersion 越界（逐 mod）
  for (const m of resolved) {
    if (m.loaders && m.loaders.length > 0) {
      const hit = m.loaders.map((l) => l.toLowerCase()).includes(wantLoader);
      if (!hit) {
        const healthy = findHealthyVersion(getMeta(opts, m.projectId), mcVersion, loader);
        conflicts.push({
          kind: 'loader-mismatch',
          severity: severityOf('loader-mismatch'),
          projectIds: [m.projectId],
          message: `${m.name}（${installedVersionOf(m as ModEntry)}）不支持 loader=${loader}（该版本支持：${m.loaders.join(', ') || '未知'}）`,
          suggestion: healthy
            ? {
                action: 'switch-loader-version',
                targetVersionId: healthy.id,
                reason: `切换到支持 ${loader}+${mcVersion} 的版本 ${healthy.versionNumber}`,
              }
            : {
                action: 'remove',
                reason: `暂无支持 ${loader} 的版本，建议移除或更换 loader`,
              },
          ...(healthy?.versionNumber ? { suggestedVersionNumber: healthy.versionNumber } : {}),
        });
      }
    }
    if (m.gameVersions && m.gameVersions.length > 0 && !m.gameVersions.includes(mcVersion)) {
      const healthy = findHealthyVersion(getMeta(opts, m.projectId), mcVersion, loader);
      // 升降级方向用 Maven 版本序判定（原为字符串 >，"1.10" 会被误判为需要降级）
      const wantsUpgrade =
        compareVersionsSafe(healthy?.versionNumber ?? '', installedVersionOf(m as ModEntry)) > 0;
      conflicts.push({
        kind: 'mc-out-of-range',
        severity: severityOf('mc-out-of-range'),
        projectIds: [m.projectId],
        message: `${m.name}（${installedVersionOf(m as ModEntry)}）未声明支持 MC ${mcVersion}（支持：${m.gameVersions.slice(0, 8).join(', ')}${m.gameVersions.length > 8 ? '…' : ''}）`,
        suggestion: healthy
          ? {
              action: wantsUpgrade ? 'upgrade' : 'downgrade',
              targetVersionId: healthy.id,
              reason: `切换到支持 MC ${mcVersion} 的版本 ${healthy.versionNumber}`,
            }
          : {
              action: 'remove',
              reason: `暂无支持 MC ${mcVersion} 的版本，建议移除或更换 MC 版本`,
            },
        ...(healthy?.versionNumber ? { suggestedVersionNumber: healthy.versionNumber } : {}),
      });
    }
  }

  // 4. 依赖语义（§5.3：depends / recommends / suggests / breaks / conflicts）
  for (const m of resolved) {
    const ranges = getRangeTable(opts, m.projectId);
    for (const dep of (m.dependencies ?? []) as SemanticDependencyRef[]) {
      const semantic = normalizeDependencySemantic(dep.dependencyType, opts);
      if (semantic === null) continue; // embedded / 未知值不参与判定
      const constraint = resolveVersionConstraint(dep, ranges?.[dep.projectId]);
      const label = DEPENDENCY_SEMANTIC_LABEL[semantic];
      const installed = byProject.get(dep.projectId)?.[0];

      // 4a. 依赖缺失（depends / recommends / suggests）
      if (!installed && !isCoexistenceSemantic(semantic)) {
        conflicts.push({
          kind: 'missing-dependency',
          severity: DEPENDENCY_SEVERITY[semantic],
          semantic,
          detail: 'absent',
          projectIds: [m.projectId, dep.projectId],
          message: `${m.name} ${label} ${dep.projectId}（${semantic}），但整合包内缺失`,
          suggestion: {
            action: 'add-missing',
            targetProjectId: dep.projectId,
            ...(dep.versionId ? { targetVersionId: dep.versionId } : {}),
            reason:
              semantic === 'depends'
                ? `补装必需依赖 ${dep.projectId}`
                : `建议补装${label} ${dep.projectId}`,
          },
          ...(constraint ? { constraint } : {}),
        });
        continue;
      }

      if (!installed) continue; // conflicts / breaks 且目标不在包内 → 无事发生

      // 4b. 共存检查（conflicts → error / breaks → warning）
      if (isCoexistenceSemantic(semantic)) {
        // 带约束时按区间判：`[2.0,)` 意为"2.0 起才允许共存"，落在区间内不报，
        // 只有区间外才报（detail=version-conflict 而非 coexist）
        if (constraint) {
          const check = checkVersionRange(installedVersionOf(installed as ModEntry), constraint);
          if (check.status === 'satisfied') continue;
          if (check.status === 'unknown') {
            conflicts.push({
              kind: 'breaks-conflict',
              severity: 'info',
              semantic,
              detail: 'version-unknown',
              projectIds: [m.projectId, dep.projectId],
              message: `${m.name} 声明 ${label} ${dep.projectId}，但约束「${constraint}」与已装版本无法比对，跳过判定`,
              suggestion: {
                action: 'remove',
                targetProjectId: dep.projectId,
                reason: '约束无法解析，建议人工确认是否可共存',
              },
              constraint,
            });
            continue;
          }
        }
        conflicts.push({
          kind: 'breaks-conflict',
          severity: DEPENDENCY_SEVERITY[semantic],
          semantic,
          detail: constraint ? 'version-conflict' : 'coexist',
          projectIds: [m.projectId, dep.projectId],
          message: conflictCoexistMessage(m.name, dep.projectId, semantic),
          suggestion: {
            action: 'remove',
            targetProjectId: dep.projectId,
            reason:
              semantic === 'breaks'
                ? `${m.name} 声明装了 ${dep.projectId} 会崩溃；建议移除其一（优先移除 ${dep.projectId}），或确认版本组合已修复`
                : `移除其中一方（建议移除 ${dep.projectId}）`,
          },
          ...(constraint ? { constraint } : {}),
        });
        continue;
      }

      // 4c. 版本核对（depends / recommends / suggests 有约束时才做）
      if (!constraint) continue;
      const have = installedVersionOf(installed as ModEntry);
      const check = checkVersionRange(have, constraint);
      if (check.status === 'satisfied') continue;
      if (check.status === 'unknown') {
        // 无法判定一律不阻断（仅 depends 值得提示，避免刷屏）
        if (semantic !== 'depends') continue;
        conflicts.push({
          kind: 'missing-dependency',
          severity: 'info',
          semantic,
          detail: 'version-unknown',
          projectIds: [m.projectId, dep.projectId],
          message: `${m.name} ${label} ${dep.projectId}，但 ${check.reason}`,
          suggestion: {
            action: 'upgrade',
            ...(dep.versionId ? { targetVersionId: dep.versionId } : {}),
            reason: `人工确认 ${dep.projectId} 的已装版本（${have}）是否满足 ${constraint}`,
          },
          constraint,
        });
        continue;
      }
      // 硬约束被违反 → 取该语义的默认级别（只有 depends/conflicts 才可能是 error）；
      // 软性约束（裸版本号推荐，strict=false）被违反 → 一律降为 info，绝不阻断。
      // 注：语义本身的软硬不参与这里的升降级 —— recommends 即便违反硬约束也只是
      // warning（丢附属功能但不崩），这是 DEPENDENCY_SEVERITY 表里的既定决策。
      const severity: DependencySeverity = check.strict ? DEPENDENCY_SEVERITY[semantic] : 'info';
      conflicts.push({
        kind: 'missing-dependency',
        severity,
        semantic,
        detail: 'version-mismatch',
        projectIds: [m.projectId, dep.projectId],
        message: `${m.name} ${label} ${dep.projectId}，但已装版本 ${have}：${check.reason}`,
        suggestion: versionMismatchSuggestion(m.projectId, dep, constraint, opts),
        ...(constraint ? { constraint } : {}),
      });
    }
  }

  return conflicts;
}

function conflictCoexistMessage(
  name: string,
  target: string,
  semantic: DependencySemantic,
): string {
  return semantic === 'breaks'
    ? `${name} 声明安装 ${target} 会导致崩溃（breaks）；两者共存有崩溃风险`
    : `${name} 与 ${target} 不兼容（conflicts/incompatible），两者不可共存`;
}

function versionMismatchSuggestion(
  ownerId: string,
  dep: SemanticDependencyRef,
  constraint: string,
  opts?: ConflictDetectOptions,
): ModConflict['suggestion'] {
  const satisfying = findVersionSatisfying(getMeta(opts, ownerId), constraint);
  if (satisfying) {
    return {
      action: 'upgrade',
      targetVersionId: satisfying.id,
      reason: `切换到满足 ${constraint} 的版本 ${satisfying.versionNumber}`,
    };
  }
  return {
    action: 'upgrade',
    ...(dep.versionId ? { targetVersionId: dep.versionId } : {}),
    reason: `将 ${dep.projectId} 调整到满足 ${constraint} 的版本`,
  };
}
