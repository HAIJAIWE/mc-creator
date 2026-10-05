/**
 * 整合包依赖解析器（纯函数，无网络、无 Node 依赖）。
 *
 * 网络拉取由调用方（桌面主进程）完成并归一化为 VersionMetadata[] 后传入；
 * 此处只做：版本挑选 → 锁定 ModEntry → 构建依赖图。
 * 离线降级由调用方用缓存的 VersionMetadata / ModEntry 实现（见主进程 modpack IPC）。
 */

import type { ModEntry } from '@mc-creator/shared';
import type { DependencyGraph, ResolveInput, ResolveResult, VersionMetadata } from './types.js';
import { buildDependencyGraph } from './graph.js';
import { detectConflicts } from './conflicts.js';

/** loader 别名归一化（legacy_fabric 视为 fabric；大小写不敏感） */
export function normalizeLoader(loader: string): string {
  const l = loader.toLowerCase();
  if (l === 'legacy_fabric') return 'fabric';
  return l;
}

/**
 * 从版本列表中挑选最佳版本。
 *
 * 评分（高者胜）：
 * - loader 命中 +100（归一化后比较）
 * - mcVersion 命中 +50
 * - 两者都命中额外 +25
 * - 同分时取列表靠前者（上游已按时间倒序，即最新优先）
 *
 * 无任何版本命中 loader+mc 时返回 null（调用方据此报 mc-out-of-range/loader-mismatch）。
 */
export function pickBestVersion(
  versions: VersionMetadata[],
  mcVersion: string,
  loader: string,
): VersionMetadata | null {
  if (versions.length === 0) return null;
  const wantLoader = normalizeLoader(loader);
  let best: VersionMetadata | null = null;
  let bestScore = -1;
  for (const v of versions) {
    const loaderHit = v.loaders.map((l) => l.toLowerCase()).includes(wantLoader);
    const mcHit = v.gameVersions.includes(mcVersion);
    let score = 0;
    if (loaderHit) score += 100;
    if (mcHit) score += 50;
    if (loaderHit && mcHit) score += 25;
    if (score > bestScore) {
      bestScore = score;
      best = v;
    }
  }
  // 至少要求 loader 命中，否则视为无可用版本（避免跨 loader 误装）
  if (!best) return null;
  const loaderHit = best.loaders.map((l) => l.toLowerCase()).includes(wantLoader);
  if (!loaderHit) return null;
  return best;
}

/** 判断 projectId 是否为 CurseForge 数字 ID */
export function isCurseForgeId(projectId: string): boolean {
  return /^\d+$/.test(projectId);
}

/**
 * 将挑选出的版本锁定为完整 ModEntry。
 * downloadUrl 为空时保留空串（mrpack 下载器会跳过并告警）。
 */
export function lockVersionToEntry(
  projectId: string,
  fallbackName: string,
  version: VersionMetadata,
): ModEntry {
  const entry: ModEntry = {
    name: fallbackName || projectId,
    projectId,
    versionId: version.id,
    fileName: version.fileName,
    fileSize: version.fileSize,
    downloadUrl: version.downloadUrl,
    versionNumber: version.versionNumber,
    gameVersions: [...version.gameVersions],
    loaders: [...version.loaders],
    dependencies: version.dependencies.map((d) => ({ ...d })),
    source: isCurseForgeId(projectId) ? 'curseforge' : 'modrinth',
  };
  if (version.sha512) entry.sha512 = version.sha512;
  if (version.sha1) entry.sha1 = version.sha1;
  if (version.envClient) entry.envClient = version.envClient;
  if (version.envServer) entry.envServer = version.envServer;
  return entry;
}

/**
 * 纯内存解析：调用方已按 projectId 准备好候选版本列表。
 *
 * @param input mod 列表 + mcVersion + loader
 * @param metadataByProject projectId → 候选版本（已按新到旧排序）
 * @param nameByProject 可选的展示名映射
 */
export function resolveFromMetadata(
  input: ResolveInput,
  metadataByProject: Map<string, VersionMetadata[]> | Record<string, VersionMetadata[]>,
  nameByProject?: Map<string, string> | Record<string, string>,
): ResolveResult {
  const getMeta = (pid: string): VersionMetadata[] => {
    if (metadataByProject instanceof Map) return metadataByProject.get(pid) ?? [];
    return (metadataByProject as Record<string, VersionMetadata[]>)[pid] ?? [];
  };
  const getName = (pid: string): string => {
    if (nameByProject instanceof Map) return nameByProject.get(pid) ?? pid;
    return (nameByProject as Record<string, string> | undefined)?.[pid] ?? pid;
  };

  const resolved: ModEntry[] = [];
  const unresolved: ResolveResult['unresolved'] = [];
  const warnings: string[] = [];

  for (const mod of input.mods) {
    const candidates = getMeta(mod.projectId);
    if (candidates.length === 0) {
      unresolved.push({ projectId: mod.projectId, reason: '无可用版本元数据（网络失败且无缓存）' });
      warnings.push(`未解析 ${mod.projectId}：无可用版本元数据`);
      continue;
    }
    const best = pickBestVersion(candidates, input.mcVersion, input.loader);
    if (!best) {
      unresolved.push({
        projectId: mod.projectId,
        reason: `无匹配 loader=${input.loader} 的版本（共 ${candidates.length} 个候选）`,
      });
      warnings.push(`未解析 ${mod.projectId}：无匹配 loader=${input.loader} 的版本`);
      continue;
    }
    const loaderHit = best.loaders
      .map((l) => l.toLowerCase())
      .includes(normalizeLoader(input.loader));
    const mcHit = best.gameVersions.includes(input.mcVersion);
    if (loaderHit && !mcHit && best.gameVersions.length > 0) {
      warnings.push(
        `${mod.projectId} 最佳版本 ${best.versionNumber} 未声明支持 MC ${input.mcVersion}（支持：${best.gameVersions.slice(0, 5).join(', ')}），已就近锁定`,
      );
    }
    resolved.push(lockVersionToEntry(mod.projectId, mod.name ?? getName(mod.projectId), best));
  }

  const graph: DependencyGraph = buildDependencyGraph(resolved);
  const conflicts = detectConflicts(resolved, input.mcVersion, input.loader);
  return { resolved, graph, conflicts, unresolved, warnings };
}
