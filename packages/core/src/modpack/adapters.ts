/**
 * Modrinth / CurseForge 原始版本元数据 → 统一 VersionMetadata。
 * 供桌面主进程在 resolve 时调用；缺失字段时降级为空数组/空串，不抛错。
 */

import type { CurseForgeFile } from '../curseforge/api-client.js';
import type { ModrinthVersion } from '../modrinth/api-client.js';
import type { VersionMetadata } from './types.js';

function primaryFileOf(v: ModrinthVersion): ModrinthVersion['files'][number] | undefined {
  return v.files.find((f) => f.primary) ?? v.files[0];
}

/** Modrinth 版本 → 统一元数据 */
export function modrinthToMetadata(v: ModrinthVersion): VersionMetadata {
  const file = primaryFileOf(v);
  return {
    id: v.id,
    versionNumber: v.version_number,
    fileName: file?.filename ?? `${v.project_id}-${v.version_number}.jar`,
    downloadUrl: file?.url ?? '',
    fileSize: file?.size ?? 0,
    ...(file?.hashes?.sha512 ? { sha512: file.hashes.sha512 } : {}),
    ...(file?.hashes?.sha1 ? { sha1: file.hashes.sha1 } : {}),
    gameVersions: [...(v.game_versions ?? [])],
    loaders: [...(v.loaders ?? [])],
    dependencies: (v.dependencies ?? []).map((d) => ({
      projectId: d.project_id,
      ...(d.version_id ? { versionId: d.version_id } : {}),
      dependencyType: d.dependency_type,
    })),
  };
}

/** CurseForge loader 名 → 归一化小写 loader */
function normalizeCfLoader(name: string): string {
  const l = name.toLowerCase();
  if (l.includes('neoforge')) return 'neoforge';
  if (l.includes('fabric')) return 'fabric';
  if (l.includes('quilt')) return 'quilt';
  if (l.includes('forge')) return 'forge';
  return l;
}

/** CurseForge 文件 → 统一元数据（displayName 作 versionNumber 回退） */
export function curseforgeToMetadata(modId: number, f: CurseForgeFile): VersionMetadata {
  const loaders = (f.modLoaderNames ?? []).map(normalizeCfLoader);
  // gameVersions 混有 loader 名与 MC 版本，仅保留像 1.x 的条目为 MC 版本
  const gameVersions = (f.gameVersions ?? []).filter((v) => /^\d+\.\d+/.test(v));
  const sha1 = f.hashes?.find((h) => h.algo === 1)?.value;
  // CurseForge algo: 1=sha1, 2=md5；sha512 通常无，此处仅透传 sha1
  return {
    id: String(f.id),
    versionNumber: f.displayName || f.fileName,
    fileName: f.fileName,
    downloadUrl: f.downloadUrl ?? '',
    fileSize: f.fileLength ?? 0,
    ...(sha1 ? { sha1 } : {}),
    gameVersions,
    loaders,
    dependencies: (f.dependencies ?? []).map((depId) => ({
      projectId: String(depId),
      dependencyType: 'required' as const,
    })),
  };
}
