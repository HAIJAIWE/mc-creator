/**
 * 依赖图构建（纯函数）。
 * 输入锁定后的 ModEntry[]（含 dependencies 声明），输出 requires/breaks/conflicts 图。
 */

import type { ModEntry } from '@mc-creator/shared';
import type { DependencyEdge, DependencyGraph, DependencyNode } from './types.js';
import { isCurseForgeId } from './resolver.js';

function sourceOf(m: ModEntry): DependencyNode['source'] {
  if (m.source) return m.source;
  return isCurseForgeId(m.projectId) ? 'curseforge' : 'modrinth';
}

/** Modrinth dependencyType → 图边 kind */
function edgeKindOf(t: string): DependencyEdge['kind'] {
  switch (t) {
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

export function buildDependencyGraph(resolved: ModEntry[]): DependencyGraph {
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
    for (const dep of m.dependencies ?? []) {
      const kind = edgeKindOf(dep.dependencyType);
      // breaks/conflicts 边即使目标不在包内也保留（用于冲突检测展示）
      edges.push({
        from: m.projectId,
        to: dep.projectId,
        kind: kind === 'breaks' ? 'breaks' : kind,
        ...(dep.versionId ? { versionConstraint: dep.versionId } : {}),
      });
    }
  }
  return { nodes, edges };
}
