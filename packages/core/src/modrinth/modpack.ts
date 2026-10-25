/**
 * 整合包安装清单（Modrinth `.mrpack`）。
 *
 * ## 为什么下 .mrpack 而不是只靠 API
 *
 * 一开始的实现是纯 API 路线：整合包版本的 `dependencies[]` 里每个成员都是
 * `embedded` 且带精确 `version_id`，批量取回来就能下。**但实测跑完发现它少三样**：
 *
 * | | API（embedded） | `modrinth.index.json` |
 * |---|---|---|
 * | 文件目标路径 | 只能靠 `project_type` 反推 | `path` 直接给（`mods/xxx.jar`）|
 * | 加载器版本 | 只有 `fabric` | `"fabric-loader": "0.19.5"` 精确版本 |
 * | overrides | ✗ | 51 个文件 |
 * | 校验 | ✗ | sha1 + sha512 |
 *
 * overrides 是最大的那块：实测 Fabulously Optimized 15.0.0-beta.1 里是
 * `overrides/` 下 51 个文件，含 `options.txt`、`rrls.toml`、18 个语言包。
 * 不铺这些，mod 全部跑在默认参数上 —— 用户看到的是「整合包装了，但和没装一样」。
 *
 * 所以 **`.mrpack` 是主路径**（它是作者打出来的权威清单，带 hash、带路径、带 env、
 * 带 overrides），API 那条降级成拿 `game_versions` / `loaders` 的轻量快路径。
 *
 * ## 实测数据（Fabulously Optimized 1KVo5zza / D35n5vLL，2026-10）
 *
 * ```
 * zip 173 KB / 52 条目（1 个 index.json + 51 个 overrides）
 * index.files 49 条，env 全是 client:required / server:required
 * index.dependencies = { minecraft: "26.3", "fabric-loader": "0.19.5" }
 * ```
 *
 * `env` 这一项 API 完全不给（它不知道哪个文件是服务端专用）。
 */

import type { ModrinthApiClient, ModrinthVersion } from './api-client.js';
import { pickPrimaryFile } from './dependencies.js';
import { MODRINTH_CDN_BASE } from '../modpack/mrpack.js';
import { safePath, unzip, DEFAULT_ZIP_LIMITS, type ZipLimits } from '../modpack/zip.js';

/**
 * 从 Modrinth CDN 下载地址认出项目 id（`mr_xxx`；认不出返回 `null`）。
 *
 * 地址形状是固定的：`<root>/data/<projectId>/versions/<versionSegment>/<文件名>`。
 * 整合包清单（mrpack 的 `files[].downloads`）给的就是这种地址，而它是我们唯一
 * 能拿到「这个文件属于哪个项目」的地方 —— 装包时要把这份归属记进下载账本。
 *
 * 只认官方 CDN：别的站哪怕路径长得一样也不猜（账本记错项目会让替换删错文件）。
 */
export function modrinthProjectIdFromUrl(url: string): string | null {
  const prefix = `${MODRINTH_CDN_BASE}/`; // https://cdn.modrinth.com/data/
  if (!url.startsWith(prefix)) return null;
  const projectId = url.slice(prefix.length).split('/')[0];
  return /^[A-Za-z0-9]{6,}$/.test(projectId) ? `mr_${projectId}` : null;
}

/** 清单里要装的一个文件。 */
export interface ModpackFile {
  /** 文件名（显示用）。 */
  name: string;
  /** 下载直链；`null` = 该条目走 CurseForge 重定向（要 CF key 才能拿到 URL）。 */
  url: string | null;
  /** CurseForge 重定向信息；仅当 `url === null` 时有值。 */
  curseforge?: { projectId: number; fileId: number };
  /**
   * 这个文件属于哪个项目；格式与 `ModEntry.id` 一致（`mr_xxx` / `cf_123`）。
   *
   * 装整合包时靠它把「文件名 → 项目」记进实例的下载账本
   * （`apps/desktop/src/main/download-index.ts`）。没有它的话，用户装完整合包、
   * 再从搜索页下同一个 mod 时，两份同 mod id 的 jar 会并排躺在 `mods/` 里 ——
   * NeoForge 直接 `Duplicate mod` 拒启动。
   *
   * 认不出来时**不猜**：省掉这个字段，代价只是那一份不进账本。
   */
  projectId?: string;
  /** 展示名。 */
  displayName: string;
  /** 字节数；null = 清单没给。 */
  size: number | null;
  /**
   * 相对 `gameDir` 的目标路径（**已过 `safePath`**，不含 `..`）。
   * 主进程直接 `join(gameDir, targetPath)`。
   */
  targetPath: string;
  /** 客户端是否需要。服务端专用的条目在客户端实例里装上反而会崩。 */
  client: boolean;
  /** 服务端是否需要。 */
  server: boolean;
  /**
   * 清单里这个文件的 sha1（hex）。
   *
   * Modrinth 侧来自 `files[].hashes.sha1`；CurseForge 侧来自文件接口的
   * `hashes`（`algo = 1` 那一项）。**有它才能在安装时校验下载完整性** ——
   * 断流/半个文件会被 sha1 抓住，而不是静默躺进 `mods/`。
   * 缺哈希时不下发这个字段（没有参照物就无从校验）。
   */
  sha1?: string;
}

/** 整合包自带的、要直接覆盖到 gameDir 的文件。 */
export interface ModpackOverride {
  /** 相对 `gameDir` 的目标路径（已过 `safePath`，已剥掉 `overrides/` 前缀）。 */
  targetPath: string;
  content: Buffer;
}

/** 装不了、也不该装的条目。如实报出来，不假装装全了。 */
export interface ModpackMissing {
  name: string;
  reason: string;
}

export interface ModpackManifest {
  projectId: string;
  versionId: string;
  versionNumber: string;
  /** MC 版本。 */
  mcVersion: string;
  /**
   * 加载器：`fabric` / `neoforge`。
   *
   * `null` = 清单要求的加载器我们**不支持**（实测 CurseForge 上的 Forge 整合包
   * 会走到这里）。这是真实会出现的状态，不是「还没解析」——所以类型如实写成
   * nullable，调用方必须处理，而不是靠 `?? 'neoforge'` 蒙过去装出一个起不来的实例。
   */
  loader: string | null;
  /** 清单指定的加载器精确版本；null = 清单没给（用最新兼容版）。 */
  loaderVersion: string | null;
  files: ModpackFile[];
  overrides: ModpackOverride[];
  missing: ModpackMissing[];
}

/** `modrinth.index.json` 的一小部分（只取我们要的）。 */
interface MrpackIndex {
  name?: string;
  files?: Array<{
    path?: string;
    env?: { client?: string; server?: string };
    downloads?: string[];
    redirects?: string[];
    fileSize?: number;
    /**
     * 官方 mrpack 格式自带的哈希。**带上它才校验得了下载完整性**
     * （安装循环比对 sha1；我们的打包器也是按这个格式写 hashes 的）。
     */
    hashes?: { sha1?: string; sha512?: string };
  }>;
  dependencies?: Record<string, string>;
}

/** 只认我们要的两个加载器。理由见搜索页筛选器。 */
const SUPPORTED_LOADERS = new Set(['neoforge', 'fabric']);

/**
 * `dependencies` 的**键** → 归一化加载器名。
 *
 * ⚠️ 键**不等于**加载器名：实测 Modrinth 写的是 `fabric-loader`，值才是版本号
 *（`{"fabric-loader": "0.19.5", "minecraft": "26.3"}`）。按值去找键会全部落空。
 *
 * 键的形状还有历史差异：`quilt-loader` / `forge`（Forge）以及作者的**自加载器**
 *（`dependencies` 里可以有任意自定义键，那对应 Modrinth 的「自定义启动器」）。
 * 认不出来的落到 `null` → 上层明确报错，不猜。
 */
function loaderFromDependencyKey(key: string): string | null {
  const k = key.toLowerCase();
  if (k === 'fabric-loader' || k === 'fabricloader' || k === 'fabric') return 'fabric';
  if (k === 'neoforge') return 'neoforge';
  return null;
}

function normalizeLoader(raw: string | undefined): string {
  const l = (raw ?? '').toLowerCase();
  if (l === 'legacy_fabric' || l === 'fabricloader') return 'fabric';
  return l;
}

/**
 * `curseforge:<projectId>:<fileId>` → 结构化信息。
 *
 * 没 CF key 时 URL 拿不到 —— 调用方据此把该条目报成「装不了」，
 * 而不是下到一个 403 的地址然后报一句看不懂的错。
 */
function parseRedirect(spec: string): { projectId: number; fileId: number } | null {
  const m = /^curseforge:(\d+):(\d+)$/.exec(spec);
  if (!m) return null;
  return { projectId: Number(m[1]), fileId: Number(m[2]) };
}

/**
 * 把下载好的 `.mrpack` 解成清单。
 *
 * 纯函数（收 Buffer），不碰网络 —— 网络在 `fetchMrpack` 那一层，
 * 这样解包逻辑能被单测直接钉住。
 *
 * @throws zip 损坏 / 缺 `modrinth.index.json` / 清单里有不安全路径时抛错。
 */
export function parseMrpack(
  buf: Buffer,
  opts: { projectId?: string; versionId?: string; versionNumber?: string; limits?: ZipLimits } = {},
): ModpackManifest {
  const files = unzip(buf, opts.limits ?? DEFAULT_ZIP_LIMITS);

  const indexRaw = files.get('modrinth.index.json');
  if (!indexRaw) throw new Error('.mrpack 里没有 modrinth.index.json（不是有效的整合包）');
  const index = JSON.parse(indexRaw.toString('utf-8')) as MrpackIndex;

  const mcVersion = index.dependencies?.['minecraft'];
  if (!mcVersion) {
    throw new Error('整合包清单没有声明 Minecraft 版本（dependencies.minecraft）');
  }

  const loaderKey = Object.keys(index.dependencies ?? {}).find(
    (k) => loaderFromDependencyKey(k) !== null,
  );
  const loader = loaderKey !== undefined ? loaderFromDependencyKey(loaderKey) : null;
  if (loader === null) {
    // 明确列出看到了哪些键 —— 报错要说清「是什么不支持」，
    // 只说「未知加载器」等于让用户去猜。
    const seen = Object.keys(index.dependencies ?? {}).join('、') || '(空)';
    throw new Error(
      `整合包要求的加载器不受支持（本启动器只支持 NeoForge 与 Fabric）。` +
        `清单 dependencies 的键：${seen}`,
    );
  }

  const outFiles: ModpackFile[] = [];
  const missing: ModpackMissing[] = [];

  for (const f of index.files ?? []) {
    const name = (f.path ?? '').split('/').pop() ?? f.path ?? '(未命名)';
    // 目标路径是**相对 gameDir** 的，`path` 本身就是；去掉开头的 `/`
    const target = safePath((f.path ?? '').replace(/^\/+/, ''));
    if (!target) {
      missing.push({ name, reason: '清单里的目标路径不安全（越界/绝对路径），已拒绝安装' });
      continue;
    }
    const client = (f.env?.client ?? 'required') !== 'unsupported';
    const server = (f.env?.server ?? 'required') !== 'unsupported';
    // 两端都不需要的条目不用装
    if (!client && !server) continue;

    const direct = f.downloads?.find((u) => u.startsWith('http'));
    if (direct) {
      const projectId = modrinthProjectIdFromUrl(direct);
      outFiles.push({
        name,
        url: direct,
        displayName: name,
        size: typeof f.fileSize === 'number' ? f.fileSize : null,
        targetPath: target,
        client,
        server,
        // 认得出项目就把归属带上（装完进账本，之后从搜索页下同一个 mod 才能替换旧文件）
        ...(projectId !== null ? { projectId } : {}),
        // 清单里有 sha1 就带上，安装时比对（断流/半个文件不该静默进 mods/）
        ...(f.hashes?.sha1 ? { sha1: f.hashes.sha1 } : {}),
      });
      continue;
    }
    const redirect = (f.redirects ?? []).map(parseRedirect).find((r) => r !== null);
    if (redirect) {
      outFiles.push({
        name,
        url: null,
        curseforge: redirect,
        displayName: name,
        size: typeof f.fileSize === 'number' ? f.fileSize : null,
        targetPath: target,
        client,
        server,
        // CF 重定向本身就带 projectId（`curseforge:<project>:<file>`），不必再猜
        projectId: `cf_${redirect.projectId}`,
        ...(f.hashes?.sha1 ? { sha1: f.hashes.sha1 } : {}),
      });
      continue;
    }
    missing.push({ name, reason: '清单里既没有下载地址也没有可识别的重定向' });
  }

  // ---- overrides：直接盖到 gameDir ----
  const overrides: ModpackOverride[] = [];
  for (const [key, content] of files) {
    if (!key.startsWith('overrides/')) continue;
    const rel = key.slice('overrides/'.length);
    const target = safePath(rel);
    if (!target) {
      missing.push({ name: rel, reason: 'overrides 路径不安全（越界/绝对路径），已拒绝写入' });
      continue;
    }
    overrides.push({ targetPath: target, content });
  }

  return {
    projectId: opts.projectId ?? '',
    versionId: opts.versionId ?? '',
    versionNumber: opts.versionNumber ?? index.name ?? '',
    mcVersion,
    loader,
    // `dependencies['fabric-loader']` 是**精确版本号**（实测 "0.19.5"）；
    // NeoForge 那边的键是 `neoforge`，值形如 "21.1.209"。
    loaderVersion: loaderKey ? (index.dependencies?.[loaderKey] ?? null) : null,
    files: outFiles,
    overrides,
    missing,
  };
}

/** 下载 `.mrpack`（`maxBytes` 是 zip bomb 兜底）。 */
export async function fetchMrpack(url: string, maxBytes = 64 * 1024 * 1024): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载整合包清单失败: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`整合包清单过大：${buf.length} > ${maxBytes} 字节`);
  }
  return buf;
}

/**
 * 走 API 的降级路径。
 *
 * 什么时候用：拿不到 `.mrpack` 地址（比如源站只给了 projects 但没有 primary 文件），
 * 或者用户装了但 zip 解不开。**这时没有 overrides**，必须如实告知 ——
 * 静默装一个「mod 齐全但配置全默认」的整合包，比明说更坑。
 *
 * 与 {@link parseMrpack} 的差异会体现在 `missing` 里：这里会把
 * 「overrides 拿不到」明确列出来。
 */
export async function buildModpackManifestFromApi(
  pack: ModrinthVersion,
  client: ModrinthApiClient,
): Promise<ModpackManifest> {
  const deps = pack.dependencies ?? [];
  const mcVersion = pack.game_versions?.[0];
  if (!mcVersion) {
    throw new Error(`整合包版本 ${pack.id} 没有声明 Minecraft 版本，无法确定要装到哪个实例`);
  }
  const loader = normalizeLoader(pack.loaders?.[0]);
  if (!SUPPORTED_LOADERS.has(loader)) {
    throw new Error(`整合包要求 ${loader || '未知'} 加载器，本启动器只支持 NeoForge 与 Fabric`);
  }

  const embedded = deps.filter(
    (d) => d.dependency_type === 'embedded' && d.project_id && d.version_id,
  );
  const versions = await client.getVersionsByIds(embedded.map((d) => d.version_id as string));
  const projects = await client.getProjectsByIds(embedded.map((d) => d.project_id as string));

  const files: ModpackFile[] = [];
  const missing: ModpackMissing[] = [];

  for (const dep of embedded) {
    const versionId = dep.version_id as string;
    const projectId = dep.project_id as string;
    const version = versions.get(versionId);
    if (!version) {
      missing.push({ name: projectId, reason: '清单指定的版本已从 Modrinth 删除' });
      continue;
    }
    const file = pickPrimaryFile(version);
    if (!file) {
      missing.push({ name: projectId, reason: '该版本没有可下载的文件' });
      continue;
    }
    const meta = projects.get(projectId);
    const isResource = meta?.project_type === 'resourcepack';
    files.push({
      name: file.filename,
      url: file.url,
      displayName: meta?.title ?? file.filename,
      size: file.size,
      targetPath: isResource ? `resourcepacks/${file.filename}` : `mods/${file.filename}`,
      client: true,
      server: true,
      // 降级路径上项目 id 是现成的（依赖条目里就有）—— 带上它，装完才能进账本
      projectId: `mr_${projectId}`,
      // Modrinth 版本文件自带 sha1（`files[].hashes.sha1`），带上供安装时校验
      ...(file.hashes?.sha1 ? { sha1: file.hashes.sha1 } : {}),
    });
  }

  for (const dep of deps) {
    if (dep.dependency_type !== 'embedded') continue;
    if (dep.project_id) continue;
    missing.push({
      name: dep.file_name ?? '(未命名)',
      reason: '整合包自带的文件（拿不到 .mrpack 时无法取得其内容），需手动放入实例',
    });
  }
  missing.push({
    name: '(整合包配置)',
    reason: '未能读取 .mrpack，overrides（config/、options.txt 等）不会安装',
  });

  return {
    projectId: pack.project_id,
    versionId: pack.id,
    versionNumber: pack.version_number,
    mcVersion,
    loader,
    loaderVersion: null,
    files,
    overrides: [],
    missing,
  };
}
