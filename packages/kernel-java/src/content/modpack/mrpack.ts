/**
 * mrpack（Modrinth 整合包）格式构建。
 *
 * 产物为 zip 包，顶层结构：
 * - modrinth.index.json（必需，formatVersion=1）
 * - overrides/（必需目录，客户端覆盖：config/options.txt/全局资源等）
 * - modpack/ 服务器覆盖说明（本项目 serverOverrides 另行附带，不进标准 mrpack）
 *
 * modrinth.index.json 关键字段（Modrinth 规范）：
 * {
 *   formatVersion: 1, game: "minecraft",
 *   versionId, name, summary?,
 *   files: [{ path: "mods/xxx.jar",
 *             hashes: { sha512, sha1 },
 *             env: { client, server },
 *             downloads: [url], fileSize }],
 *   dependencies: { minecraft, "fabric-loader" | "quilt-loader" | forge | neoforge }
 * }
 *
 * 大文件（zip > 10MB）走 file:project:writeStream 流式通道分片写入，
 * 小文件直接经 EXPORT_ZIP / 普通 IPC 返回（见桌面主进程 modpack IPC）。
 */

import type { ModpackSpec } from '@mc-creator/shared';
import type { MrpackPlan } from './types.js';

/** loader → mrpack dependencies 键名（Modrinth 规范用 fabric-loader/quilt-loader） */
export function loaderToMrpackKey(loader: string): string {
  switch (loader) {
    case 'fabric':
    case 'legacy_fabric':
      return 'fabric-loader';
    case 'quilt':
      return 'quilt-loader';
    case 'neoforge':
      return 'neoforge';
    case 'forge':
      return 'forge';
    default:
      return loader;
  }
}

/** 兼容键：老版本曾用裸 loader 名（如 fabric）；新包同时保留以兼容旧启动器 */
export function legacyLoaderKey(loader: string): string | null {
  if (loader === 'fabric' || loader === 'legacy_fabric') return 'fabric';
  if (loader === 'quilt') return 'quilt';
  return null;
}

/** 缺失哈希时的确定性占位（sha1 hex 40 位 / sha512 hex 128 位，全 0） */
export const MISSING_SHA1 = '0'.repeat(40);
export const MISSING_SHA512 = '0'.repeat(128);

/**
 * 构建 modrinth.index.json 对象 + overrides 文件列表。
 * 不做网络请求；缺失 hashes/downloadUrl 时填占位并在 warnings 中说明。
 */
export function buildMrpackPlan(spec: ModpackSpec): MrpackPlan {
  const warnings: string[] = [];
  const loaderKey = loaderToMrpackKey(spec.loader);
  const legacyKey = legacyLoaderKey(spec.loader);

  const dependencies: Record<string, string> = { minecraft: spec.mcVersion };
  if (spec.loaderVersion) {
    dependencies[loaderKey] = spec.loaderVersion;
    // 向后兼容：老启动器认裸键（如 fabric），与现有单测/旧包保持一致
    if (legacyKey && legacyKey !== loaderKey) dependencies[legacyKey] = spec.loaderVersion;
  }

  const files = spec.mods.map((m) => {
    const hashes: Record<string, string> = {};
    if (m.sha512) hashes.sha512 = m.sha512;
    if (m.sha1) hashes.sha1 = m.sha1;
    if (Object.keys(hashes).length === 0) {
      hashes.sha512 = MISSING_SHA512;
      hashes.sha1 = m.versionId && /^[0-9a-f]{40}$/i.test(m.versionId) ? m.versionId : MISSING_SHA1;
      warnings.push(`${m.name} 缺少文件哈希，导出用占位值（启动器可能要求重新校验）`);
    } else {
      if (!hashes.sha512) hashes.sha512 = MISSING_SHA512;
      if (!hashes.sha1) hashes.sha1 = MISSING_SHA1;
    }
    const downloads =
      m.downloadUrl && m.downloadUrl.length > 0
        ? [m.downloadUrl]
        : [`https://cdn.modrinth.com/data/${m.projectId}/versions/${m.versionId}/${m.fileName}`];
    if (!m.downloadUrl) {
      warnings.push(`${m.name} 缺少直链，已按 Modrinth CDN 约定拼接（离线安装可能失败）`);
    }
    return {
      path: `mods/${m.fileName}`,
      hashes,
      env: {
        client: m.envClient ?? 'required',
        server: m.envServer ?? 'optional',
      },
      downloads,
      fileSize: m.fileSize ?? 0,
    };
  });

  const indexJson: Record<string, unknown> = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: spec.packVersion,
    name: spec.packName,
    files,
    dependencies,
  };
  if (spec.description) indexJson.summary = spec.description;
  if (spec.credits) indexJson.credits = spec.credits;

  const overrideFiles = (spec.overrides ?? []).map((o) => ({ ...o }));
  const serverOverrideFiles = (spec.serverOverrides ?? []).map((o) => ({ ...o }));
  if (serverOverrideFiles.length > 0) {
    warnings.push(
      `serverOverrides 共 ${serverOverrideFiles.length} 个文件：mrpack 标准仅含 overrides/，服务端覆盖需随包附带说明或单独分发`,
    );
  }

  return { indexJson, overrideFiles, serverOverrideFiles, warnings };
}

/** 校验 modrinth.index.json 是否符合最小可用结构 */
export function validateModrinthIndex(index: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof index !== 'object' || index === null) return { ok: false, errors: ['index 不是对象'] };
  const o = index as Record<string, unknown>;
  if (o.formatVersion !== 1) errors.push('formatVersion 必须为 1');
  if (o.game !== 'minecraft') errors.push('game 必须为 minecraft');
  if (typeof o.versionId !== 'string' || !o.versionId) errors.push('缺少 versionId');
  if (typeof o.name !== 'string' || !o.name) errors.push('缺少 name');
  if (!Array.isArray(o.files)) {
    errors.push('缺少 files 数组');
  } else {
    (o.files as unknown[]).forEach((f, i) => {
      const fo = f as Record<string, unknown>;
      if (typeof fo.path !== 'string') errors.push(`files[${i}].path 缺失`);
      const hashes = fo.hashes as Record<string, unknown> | undefined;
      if (!hashes || (typeof hashes.sha512 !== 'string' && typeof hashes.sha1 !== 'string')) {
        errors.push(`files[${i}].hashes 缺少 sha512/sha1`);
      }
      if (!Array.isArray(fo.downloads)) errors.push(`files[${i}].downloads 缺失`);
    });
  }
  const deps = o.dependencies as Record<string, unknown> | undefined;
  if (!deps || typeof deps.minecraft !== 'string') errors.push('dependencies.minecraft 缺失');
  return { ok: errors.length === 0, errors };
}

/**
 * mrpack 格式说明（供任务输出 + UI 导出页展示）。
 * 保持与 buildMrpackPlan 的实现一致。
 */
export function describeMrpackFormat(): string {
  return [
    'mrpack = zip 包，顶层含 modrinth.index.json + overrides/ 目录。',
    'modrinth.index.json: { formatVersion: 1, game: "minecraft", versionId, name,',
    '  files: [{ path: "mods/<file>", hashes: { sha512, sha1 },',
    '           env: { client: required|optional|unsupported, server: ... },',
    '           downloads: [url], fileSize }],',
    '  dependencies: { minecraft: "<mc>", "fabric-loader"|"quilt-loader"|forge|neoforge: "<ver>" } }。',
    'overrides/: 客户端覆盖文件（config/、options.txt 等），按原相对路径存放。',
    'serverOverrides: 非标准字段，随包附带说明，需单独分发到服务端。',
    '大文件（zip > 10MB）走 file:project:writeStream 流式分片写入并上报进度；',
    '小文件直接经 modpack:exportMrpack 返回句柄 + 普通保存对话框落盘。',
    '离线降级：网络失败时用 userData/modpack-cache 下的 resolve 缓存继续锁定版本并告警。',
  ].join('\n');
}
