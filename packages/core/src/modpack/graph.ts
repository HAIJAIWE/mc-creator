/**
 * 依赖图构建（纯函数）。
 * 输入锁定后的 ModEntry[]（含 dependencies 声明），输出 requires/breaks/conflicts 图。
 */

import type { ModEntry } from '@mc-creator/shared';
import type { DependencyEdge, DependencyGraph, DependencyNode } from './types.js';
import { isCurseForgeId } from './resolver.js';
import type { SemanticDependencyRef, SemanticModEntry } from './dependency-semantics.js';

function sourceOf(m: SemanticModEntry): DependencyNode['source'] {
  if (m.source) return m.source;
  return isCurseForgeId(m.projectId) ? 'curseforge' : 'modrinth';
}

/**
 * 原始 dependencyType → 图边 kind。
 *
 * 覆盖 §5.3 的五种语义（depends / recommends / suggests / breaks / conflicts），
 * 同时保留 Modrinth/Forge 的历史映射：
 * - `required` / `depends` → `requires`
 * - `recommends` / `suggests` / `optional` → `optional`
 * - `conflicts` / `incompatible` → `breaks`（历史行为，不改，见下方注）
 * - `breaks` → `breaks`
 * - `embedded` → `embedded`
 *
 * 注：`incompatible` 历史上就映射为 `breaks`，尽管 `DependencyEdge.kind` 另有
 * `conflicts` 一档。为避免既有断言变红，此处**保持不变**；语义层面的区分改由
 * `conflicts.ts` 的 `semantic` / `severity` 字段承担（见 dependency-semantics.ts）。
 */
function edgeKindOf(t: string): DependencyEdge['kind'] {
  switch (t) {
    case 'recommends':
    case 'suggests':
      return 'optional';
    case 'conflicts':
    case 'breaks':
      return 'breaks';
    case 'optional':
      return 'optional';
    case 'incompatible':
      return 'breaks';
    case 'embedded':
      return 'embedded';
    default:
      return 'requires';
  }
}

export function buildDependencyGraph(
  resolvedInput: ModEntry[] | SemanticModEntry[],
): DependencyGraph {
  const resolved = resolvedInput as SemanticModEntry[];
  const nodes: DependencyNode[] = resolved.map((m) => ({
    projectId: m.projectId,
    name: m.name,
    versionId: m.versionId,
    ...(m.versionNumber ? { versionNumber: m.versionNumber } : {}),
    source: sourceOf(m),
  }));
  const known = new Set(resolved.map((m) => m.projectId));
  void known;
  const edges: DependencyEdge[] = [];
  for (const m of resolved) {
    for (const dep of (m.dependencies ?? []) as SemanticDependencyRef[]) {
      const kind = edgeKindOf(dep.dependencyType);
      // breaks/conflicts 边即使目标不在包内也保留（用于冲突检测展示）
      // 约束优先取 Maven versionRange 原文；缺失才退回 Modrinth version_id 精确匹配
      const constraint = dep.versionRange ?? dep.versionId;
      edges.push({
        from: m.projectId,
        to: dep.projectId,
        kind: kind === 'breaks' ? 'breaks' : kind,
        ...(constraint ? { versionConstraint: constraint } : {}),
      });
    }
  }
  return { nodes, edges };
}
