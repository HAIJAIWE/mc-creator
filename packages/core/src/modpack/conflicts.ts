/**
 * 版本冲突检测（纯函数，无网络）。
 *
 * 逐项检查：
 * 1. duplicate-version — 同一 projectId 出现多个 versionId
 * 2. loader-mismatch — entry.loaders 非空且不含目标 loader
 * 3. mc-out-of-range — entry.gameVersions 非空且不含目标 mcVersion
 * 4. missing-dependency — requires/optional 指向包外缺失的 required 依赖
 * 5. breaks-conflict — incompatible/breaks 指向包内已含 mod
 *
 * 每项均给出 FixSuggestion（升级/降级/移除/补装），目标版本号尽量从已有元数据推导；
 * 无元数据时 suggestion 仅给方向性 reason（主进程可用在线元数据补全 targetVersionId）。
 */

import type { ModEntry } from '@mc-creator/shared';
import type { ModConflict, VersionMetadata } from './types.js';
import { normalizeLoader } from './resolver.js';

/** 可选：供一键修复推导建议版本的候选元数据 */
export interface ConflictDetectOptions {
  /** projectId → 候选版本（新到旧），用于推导 upgrade/downgrade 目标 */
  metadataByProject?: Map<string, VersionMetadata[]> | Record<string, VersionMetadata[]>;
}

function getMeta(opts: ConflictDetectOptions | undefined, projectId: string): VersionMetadata[] {
  if (!opts?.metadataByProject) return [];
  const m = opts.metadataByProject;
  if (m instanceof Map) return m.get(projectId) ?? [];
  return (m as Record<string, VersionMetadata[]>)[projectId] ?? [];
}

/** 在候选版本中找同时命中 loader+mc 的最新版（用于 upgrade 建议） */
function findHealthyVersion(
  candidates: VersionMetadata[],
  mcVersion: string,
  loader: string,
): VersionMetadata | undefined {
  const want = normalizeLoader(loader);
  return candidates.find(
    (v) =>
      v.loaders.map((l) => l.toLowerCase()).includes(want) && v.gameVersions.includes(mcVersion),
  );
}

export function detectConflicts(
  resolved: ModEntry[],
  mcVersion: string,
  loader: string,
  opts?: ConflictDetectOptions,
): ModConflict[] {
  const conflicts: ModConflict[] = [];
  const wantLoader = normalizeLoader(loader);
  const byProject = new Map<string, ModEntry[]>();
  for (const m of resolved) {
    const list = byProject.get(m.projectId) ?? [];
    list.push(m);
    byProject.set(m.projectId, list);
  }
  const inPack = new Set(byProject.keys());

  // 1. 同一 mod 多版本
  for (const [pid, list] of byProject) {
    const versions = new Set(list.map((m) => m.versionId));
    if (versions.size > 1) {
      const sorted = [...list].sort((a, b) => a.versionId.localeCompare(b.versionId));
      const keep = sorted[sorted.length - 1];
      conflicts.push({
        kind: 'duplicate-version',
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
          projectIds: [m.projectId],
          message: `${m.name}（${m.versionNumber ?? m.versionId}）不支持 loader=${loader}（该版本支持：${m.loaders.join(', ') || '未知'}）`,
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
      conflicts.push({
        kind: 'mc-out-of-range',
        projectIds: [m.projectId],
        message: `${m.name}（${m.versionNumber ?? m.versionId}）未声明支持 MC ${mcVersion}（支持：${m.gameVersions.slice(0, 8).join(', ')}${m.gameVersions.length > 8 ? '…' : ''}）`,
        suggestion: healthy
          ? {
              action: healthy.versionNumber > (m.versionNumber ?? '') ? 'upgrade' : 'downgrade',
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

  // 4/5. 依赖缺失 / breaks 冲突（基于 dependencies 声明）
  for (const m of resolved) {
    for (const dep of m.dependencies ?? []) {
      if (dep.dependencyType === 'required' && !inPack.has(dep.projectId)) {
        conflicts.push({
          kind: 'missing-dependency',
          projectIds: [m.projectId, dep.projectId],
          message: `${m.name} 需要依赖 ${dep.projectId}（required），但整合包内缺失`,
          suggestion: {
            action: 'add-missing',
            targetProjectId: dep.projectId,
            ...(dep.versionId ? { targetVersionId: dep.versionId } : {}),
            reason: `补装缺失依赖 ${dep.projectId}`,
          },
        });
      }
      if (dep.dependencyType === 'incompatible' && inPack.has(dep.projectId)) {
        conflicts.push({
          kind: 'breaks-conflict',
          projectIds: [m.projectId, dep.projectId],
          message: `${m.name} 与 ${dep.projectId} 不兼容（incompatible），两者不可共存`,
          suggestion: {
            action: 'remove',
            targetProjectId: dep.projectId,
            reason: `移除其中一方（建议移除 ${dep.projectId}）`,
          },
        });
      }
    }
  }

  return conflicts;
}
