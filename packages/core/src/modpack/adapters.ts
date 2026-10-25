/**
 * Modrinth / CurseForge 原始版本元数据 → 统一 VersionMetadata。
 * 供桌面主进程在 resolve 时调用；缺失字段时降级为空数组/空串，不抛错。
 */

import type { CurseForgeFile } from '../curseforge/api-client.js';
import { curseforgeLoaderKey, isCurseForgeMcVersion } from '../curseforge/api-client.js';
import { CF_RELATION_OPTIONAL, dependenciesOf } from '../curseforge/dependencies.js';
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
    dependencies: (v.dependencies ?? [])
      // `project_id` 可为 null（整合包的「自带文件」条目）。那是**没有项目**
      // 的依赖，塞进需要 projectId 的统一模型里就是脏数据 —— 直接丢掉，
      // 依赖解析会把「null」当项目 id 去查源站。
      .filter((d) => typeof d.project_id === 'string' && d.project_id.length > 0)
      .map((d) => ({
        projectId: d.project_id as string,
        ...(d.version_id ? { versionId: d.version_id } : {}),
        dependencyType: d.dependency_type,
      })),
  };
}

/** CurseForge loader 名 → 归一化小写 loader（表在核心，见 `curseforgeLoaderKey`） */
function normalizeCfLoader(name: string): string {
  return curseforgeLoaderKey(name);
}

/**
 * CurseForge `relationType` → 统一 `dependencyType`。
 *
 * ⚠️ 老实现把**所有** CF 依赖都写成 `required` —— 当时以为那边没有必需/可选
 * 标记（见 `curseforge/dependencies.ts` 的文件头）。实测每条的
 * `{modId, relationType}` 里 `3=必需 / 2=可选`（拿 Iris→Sodium、Xaero→
 * Fabric API、JEI→MezzConfig 这些真实关系对钉过），所以可选依赖（2）被硬报成
 * 必需是错的：整合包预览里 Xaero's World Map、MezzConfigGUI 这类可选联动
 * 会显示成「缺了会坏」。
 *
 * 未识别的值维持老行为（当必需）—— 宁可多报一条，也不能对可能的硬前置装聋作哑。
 */
function cfDependencyType(
  relationType?: number,
): 'required' | 'optional' | 'incompatible' | 'embedded' {
  switch (relationType) {
    case CF_RELATION_OPTIONAL:
      return 'optional';
    case 1: // EmbeddedLibrary：库已经打进 jar 里
    case 6: // Include：内容已包含
      return 'embedded';
    case 5: // Incompatible：装一起会冲突
      return 'incompatible';
    default: // 3=RequiredDependency（实测）／4=Tool／缺值
      return 'required';
  }
}

/** CurseForge 文件 → 统一元数据（displayName 作 versionNumber 回退） */
export function curseforgeToMetadata(modId: number, f: CurseForgeFile): VersionMetadata {
  const loaders = (f.modLoaderNames ?? []).map(normalizeCfLoader);
  // gameVersions 混有 loader 名与 MC 版本，仅保留像 1.x 的条目为 MC 版本。
  // 判定与 `CurseForgeApiClient` 内部用的是**同一个函数** —— 客户端已经过滤过
  // 一遍，这里是给「外部直接构造 CurseForgeFile」的调用方兜底。
  const gameVersions = (f.gameVersions ?? []).filter(isCurseForgeMcVersion);
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
    dependencies: dependenciesOf(f).map((d) => ({
      projectId: String(d.modId),
      dependencyType: cfDependencyType(d.relationType),
    })),
  };
}
