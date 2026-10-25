/**
 * CurseForge 整合包清单（zip 里的 `manifest.json`）。
 *
 * ## 格式的来源
 *
 * 不是照文档写的，是照 **PCL 的实际实现**（`Hex-Dragon/PCL2`，
 * `Plain Craft Launcher 2/Modules/Minecraft/ModModpack.vb:163-223`）：
 *
 * ```vb
 * Json = Archive.GetEntry(ArchiveBaseFolder & "manifest.json").Open().ReadString().DeserializeJson()
 * If Json("minecraft") Is Nothing OrElse Json("minecraft")("version") Is Nothing Then Throw ...
 * TargetVersion.VanillaName = Json("minecraft")("version").ToString
 * For Each Entry In If(Json("minecraft")("modLoaders"), {})
 *     Dim Id As String = If(Entry("id"), "").ToString.Lower
 *     If Id.StartsWithF("forge-") Then TargetVersion.Forge = Id.Replace("forge-", "")
 *     ... neoforge- / fabric- ...
 * Dim OverrideHome As String = If(Json("overrides"), "")
 * For Each ModEntry In If(Json("files"), {})
 *     If ModEntry("projectID") Is Nothing OrElse ModEntry("fileID") Is Nothing Then ... 跳过
 *     ModList.Add(ModEntry("fileID"))
 *     If ModEntry("required") IsNot Nothing AndAlso Not ModEntry("required").ToObject(Of Boolean) Then ModOptionalList.Add(...)
 * ```
 *
 * 所以与 Modrinth 的 `.mrpack` 相比，**四处不同**（都实现对了）：
 *
 * | | Modrinth `.mrpack` | CurseForge `manifest.json` |
 * |---|---|---|
 * | MC 版本 | `dependencies.minecraft` | `minecraft.version` |
 * | 加载器 | `dependencies["fabric-loader"]` | `minecraft.modLoaders[].id`，格式 `fabric-0.19.5` |
 * | overrides 目录名 | 固定 `overrides/` | **`overrides` 字段可自定义**（也可能没有）|
 * | 文件地址 | `downloads[]` 直链 | 只有 `projectID`/`fileID`，**必须再查 API** |
 *
 * 另有 PCL 也拷的 `client-overrides/`（客户端专用覆写）。
 */

import type { CurseForgeApiClient, CurseForgeFile } from './api-client.js';
import type { ModpackFile, ModpackOverride, ModpackMissing } from '../modrinth/modpack.js';
import { safePath, unzip, DEFAULT_ZIP_LIMITS, type ZipLimits } from '../modpack/zip.js';

/** `manifest.json` 的子集。 */
export interface CfModpackManifest {
  name?: string;
  version?: string;
  author?: string;
  minecraft?: {
    version?: string;
    modLoaders?: Array<{ id?: string; primary?: boolean }>;
  };
  /** overrides 目录名（相对 zip 根）。缺省 = 没有 overrides。 */
  overrides?: string;
  files?: Array<{ projectID?: number; fileID?: number; required?: boolean }>;
}

export interface CfModpackManifestParsed {
  projectId: number;
  versionId: number;
  mcVersion: string;
  /** `fabric` / `neoforge`；清单不支持这两个时为 null。 */
  loader: string | null;
  /** 清单指定的加载器精确版本（`fabric-0.19.5` → `0.19.5`）。 */
  loaderVersion: string | null;
  /** 要向 CF API 查的文件（`getFilesByIds` 的入参）。 */
  fileIds: number[];
  /** `fileId` → `projectID`（响应可能漏掉某些 id，要靠它反查）。 */
  fileToProject: Map<number, number>;
  /** `required: false` 的 fileId（可选依赖，不自动装 —— 与 PCL 一致）。 */
  optionalIds: Set<number>;
  overrides: ModpackOverride[];
  missing: ModpackMissing[];
}

/** CF 文件里的 sha1（`hashes` 里 `algo = 1` 的那一项；algo 2 是 md5）。 */
function sha1OfCfFile(f: CurseForgeFile): string | null {
  return f.hashes?.find((h) => h.algo === 1)?.value ?? null;
}

/**
 * CF 整合包里的一个文件该落哪个目录。
 *
 * CF 的 `manifest.json` 只给 `projectID`/`fileID`，**不说**它是 mod 还是
 * 资源包。一律丢进 `mods/` 的老做法会把资源包/光影当 mod 扫（PCL 是按类型
 * 分 `mods/resourcepacks/shaderpacks/saves` 的，`ModModpack.vb:246-261`）。
 *
 * 唯一可用的判据是后缀，而它**不可靠**（少量 mod 也打包成 zip）。所以：
 * - `.jar` → `mods/`（绝大多数 mod 的主文件）
 * - `.zip` → `resourcepacks/`（资源包/光影的主文件；它俩在这里区分不了，
 *   但放在 resourcepacks 至少比放在 mods 对，用户也能一眼看出该挪）
 * - 其它 → 保守放 `mods/`
 *
 * 导出成函数是为了让这条规则被单测钉住：改错会让整个 CF 整合包装出来
 * 一个 mod 都加载不了，或者资源包被当成垃圾扔掉。
 */
export function targetDirForCfFileName(fileName: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? '';
  if (ext === 'zip') return `resourcepacks/${fileName}`;
  return `mods/${fileName}`;
}

/** `fabric-0.19.5` → `{ loader: 'fabric', version: '0.19.5' }`。 */
export function parseModLoaderId(id: string): { loader: string; version: string } | null {
  const l = id.toLowerCase();
  if (l.startsWith('neoforge-')) {
    return { loader: 'neoforge', version: l.slice('neoforge-'.length) };
  }
  if (l.startsWith('fabric-')) {
    return { loader: 'fabric', version: l.slice('fabric-'.length) };
  }
  return null;
}

/**
 * 从 CF 整合包 zip 解出清单骨架（**不解析 mod 下载地址** —— 那要走网络，
 * 见 {@link buildCfModpackManifest}；以前是因为「那要 API key」，现在走国内
 * 镜像没 key 也能解析，但网络就该留在网络那一层）。
 *
 * 纯函数（收 Buffer），网络在 {@link buildCfModpackManifest} 那一层。
 */
export function parseCfModpack(
  buf: Buffer,
  opts: { projectId: number; versionId: number; limits?: ZipLimits } = {
    projectId: 0,
    versionId: 0,
  },
): CfModpackManifestParsed {
  const entries = unzip(buf, opts.limits ?? DEFAULT_ZIP_LIMITS);
  const manifestRaw = entries.get('manifest.json');
  if (!manifestRaw) {
    throw new Error('CurseForge 整合包里没有 manifest.json');
  }
  const m = JSON.parse(manifestRaw.toString('utf-8')) as CfModpackManifest;

  const mcVersion = m.minecraft?.version;
  if (!mcVersion) {
    throw new Error('CurseForge 整合包未提供 Minecraft 版本信息');
  }

  // modLoaders 是数组，可能同时给出多个（PCL 是逐个判断，后面的覆盖前面的）。
  // 这里取**最后一个能识别的**（与 PCL 的覆盖语义一致），并显式跳过 forge ——
  // 我们不支持 Forge，且「悄悄按 neoforge 装」比「明说不支持」更糟。
  let loader: string | null = null;
  let loaderVersion: string | null = null;
  const seenLoaderIds: string[] = [];
  for (const entry of m.minecraft?.modLoaders ?? []) {
    const id = (entry.id ?? '').toLowerCase();
    if (id.length === 0) continue;
    seenLoaderIds.push(id);
    const parsed = parseModLoaderId(id);
    if (parsed) {
      loader = parsed.loader;
      loaderVersion = parsed.version;
    }
  }

  const fileIds: number[] = [];
  const fileToProject = new Map<number, number>();
  const optionalIds = new Set<number>();
  const missing: ModpackMissing[] = [];

  for (const f of m.files ?? []) {
    // PCL 对缺 projectID/fileID 的条目是「跳过 + 提示」，我们照做但把原因记下来
    if (typeof f.projectID !== 'number' || typeof f.fileID !== 'number') {
      missing.push({
        name: JSON.stringify(f),
        reason: '该条目缺少 projectID 或 fileID，已跳过',
      });
      continue;
    }
    fileIds.push(f.fileID);
    fileToProject.set(f.fileID, f.projectID);
    // required: false = 可选依赖。PCL 归到 ModOptionalList（不自动装）。
    if (f.required === false) optionalIds.add(f.fileID);
  }

  // ---- overrides ----
  const overrides: ModpackOverride[] = [];
  // PCL 拷 `overrides`（名字取自清单）与 `client-overrides`（固定名）。
  // 两者的条目可能同名（少见），后者覆盖前者 —— 同样是「后写入的赢」。
  const overrideHomes: string[] = [];
  if (typeof m.overrides === 'string' && m.overrides !== '') overrideHomes.push(m.overrides);
  overrideHomes.push('client-overrides');

  for (const home of overrideHomes) {
    const prefix = home.endsWith('/') ? home : `${home}/`;
    for (const [key, content] of entries) {
      if (!key.startsWith(prefix)) continue;
      const target = safePath(key.slice(prefix.length));
      if (!target) {
        missing.push({
          name: key,
          reason: 'overrides 路径不安全（越界/绝对路径），已拒绝写入',
        });
        continue;
      }
      const existing = overrides.findIndex((o) => o.targetPath === target);
      const item = { targetPath: target, content };
      if (existing >= 0) overrides[existing] = item;
      else overrides.push(item);
    }
  }

  if (loader === null) {
    missing.push({
      name: '(加载器)',
      reason:
        seenLoaderIds.length > 0
          ? `整合包要求的加载器是 ${seenLoaderIds.join('、')}，本启动器只支持 NeoForge 与 Fabric`
          : '整合包没有声明 modLoaders，无法确定要装哪个加载器',
    });
  }

  return {
    projectId: opts.projectId,
    versionId: opts.versionId,
    mcVersion,
    loader,
    loaderVersion,
    fileIds,
    fileToProject,
    optionalIds,
    overrides,
    missing,
  };
}

/**
 * 补齐下载信息：向 CF API 批量查 `fileIds` → 直链 + 文件名。
 *
 * ⚠️ 源站会**静默跳过**已被作者删除的文件（PCL 在 `ModModpack.vb:232-253`
 * 也专门处理了这个）。所以这里按 id 对齐后逐个核对，少了的报成缺 ——
 * 不核对的话用户会以为装全了，缺的那个在启动时才炸。
 */
export async function buildCfModpackManifest(
  buf: Buffer,
  client: CurseForgeApiClient,
  opts: { projectId: number; versionId: number; limits?: ZipLimits },
): Promise<{
  mcVersion: string;
  loader: string | null;
  loaderVersion: string | null;
  files: ModpackFile[];
  overrides: ModpackOverride[];
  missing: ModpackMissing[];
}> {
  const parsed = parseCfModpack(buf, opts);
  const missing = [...parsed.missing];

  const byId = await client.getFilesByIds(parsed.fileIds);
  const files: ModpackFile[] = [];

  for (const fileId of parsed.fileIds) {
    const f: CurseForgeFile | undefined = byId.get(fileId);
    if (!f) {
      missing.push({
        name: `fileId ${fileId}`,
        reason: '该文件已被 CurseForge 删除或下架',
      });
      continue;
    }
    if (!f.downloadUrl) {
      missing.push({
        name: f.fileName,
        reason: 'CurseForge 没给下载地址（项目被设为不公开下载？）',
      });
      continue;
    }
    if (parsed.optionalIds.has(fileId)) continue; // 可选依赖不自动装

    files.push({
      name: f.fileName,
      url: f.downloadUrl,
      displayName: f.displayName ?? f.fileName,
      size: f.fileLength,
      // CF 清单里每个文件都标了它属于哪个项目（`fileToProject`），带进账本 ——
      // 装完再从搜索页下同一个 mod 时，才能认出「这是同一个项目的旧文件」
      ...(parsed.fileToProject.get(fileId) !== undefined
        ? { projectId: `cf_${parsed.fileToProject.get(fileId) as number}` }
        : {}),
      // CF 的文件接口带 sha1（`hashes` 里 algo=1 的那个）。带上它，安装时才能校验
      // 下载完整性 —— 不带的话坏 jar 会静默躺在 mods/ 里。
      ...(sha1OfCfFile(f) !== null ? { sha1: sha1OfCfFile(f) as string } : {}),
      // CF 清单只给 projectID/fileID，不说这个文件是 mod 还是资源包。
      // 一律丢进 mods/ 的旧做法把资源包/光影当成 mod 扫（PCL 是按类型分
      // mods/resourcepacks/shaderpacks/saves 的）。
      //
      // 可靠判据只有后缀 —— 而它**不可靠**（少量 mod 也是 zip）。所以：
      // - `.jar` → mods/（绝大多数 mod 的主文件）
      // - `.zip` → resourcepacks/（资源包/光影的主文件；它俩在这个层级区分不了，
      //   放 resourcepacks 至少比放 mods 对，光影包被误放时用户也能一眼看出）
      // - 其它 → 保守放 mods/
      targetPath: targetDirForCfFileName(f.fileName),
      client: true,
      server: true,
    });
  }

  if (parsed.optionalIds.size > 0) {
    missing.push({
      name: `(可选依赖 × ${parsed.optionalIds.size})`,
      reason:
        `整合包里有 ${parsed.optionalIds.size} 个可选依赖（清单里 required: false）` +
        `没有自动安装，如需要请手动添加`,
    });
  }

  return {
    mcVersion: parsed.mcVersion,
    loader: parsed.loader,
    loaderVersion: parsed.loaderVersion,
    files,
    overrides: parsed.overrides,
    missing,
  };
}
