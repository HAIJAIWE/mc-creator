import { z } from 'zod';

// === Modrinth 搜索（P25） ===
export const MODRINTH_SEARCH = 'modrinth:search';
export const MODRINTH_VERSIONS = 'modrinth:versions';

export const ModrinthSearchRequest = z.object({
  query: z.string(),
  loader: z.string().optional(),
  mcVersion: z.string().optional(),
  limit: z.number().optional().default(20),
});
export const ModrinthSearchResponse = z.object({
  hits: z.array(
    z.object({
      project_id: z.string(),
      slug: z.string(),
      title: z.string(),
      description: z.string(),
      icon_url: z.string().nullable(),
      downloads: z.number(),
      categories: z.array(z.string()),
    }),
  ),
});

export const ModrinthVersionsRequest = z.object({
  projectId: z.string(),
  loader: z.string().optional(),
  mcVersion: z.string().optional(),
});
export const ModrinthVersionsResponse = z.object({
  versions: z.array(
    z.object({
      id: z.string(),
      project_id: z.string(),
      version_number: z.string(),
      name: z.string(),
      game_versions: z.array(z.string()).optional(),
      loaders: z.array(z.string()).optional(),
      dependencies: z
        .array(
          z.object({
            /**
             * **可为 null** —— 整合包用 `{ project_id: null, file_name: 'x.zip' }`
             * 表示「整合包自带的文件」。按必填 string 读，解析整合包版本时会直接炸。
             */
            project_id: z.string().nullable().optional(),
            version_id: z.string().nullable().optional(),
            /** 自带文件的文件名；项目引用时为 null。 */
            file_name: z.string().nullable().optional(),
            dependency_type: z.enum(['required', 'optional', 'incompatible', 'embedded']),
          }),
        )
        .optional(),
      files: z.array(
        z.object({
          url: z.string(),
          filename: z.string(),
          primary: z.boolean(),
          size: z.number(),
          hashes: z
            .object({ sha512: z.string().optional(), sha1: z.string().optional() })
            .optional(),
        }),
      ),
    }),
  ),
});

export type ModrinthSearchReq = z.infer<typeof ModrinthSearchRequest>;
export type ModrinthSearchRes = z.infer<typeof ModrinthSearchResponse>;
export type ModrinthVersionsReq = z.infer<typeof ModrinthVersionsRequest>;
export type ModrinthVersionsRes = z.infer<typeof ModrinthVersionsResponse>;

// === CurseForge 搜索（P29：与 P25 Modrinth 共同构成资源市场） ===
// ⚠️ **不再需要 API key**：走国内镜像（MCIM）时镜像自带 key（PCL 同款）。
// 配了 key 的请求会走官方根，且 key 不会发给镜像。
export const CURSEFORGE_SEARCH = 'curseforge:search';
export const CURSEFORGE_FILES = 'curseforge:files';
export const CURSEFORGE_TEST_KEY = 'curseforge:testKey';
export const LOAD_CURSEFORGE_CONFIG = 'curseforge:loadConfig';
export const SAVE_CURSEFORGE_CONFIG = 'curseforge:saveConfig';

export const CurseForgeSearchRequest = z.object({
  query: z.string(),
  loader: z.string().optional(),
  mcVersion: z.string().optional(),
  limit: z.number().optional().default(20),
});
export const CurseForgeSearchResponse = z.object({
  hits: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      summary: z.string(),
      logoUrl: z.string().nullable(),
      downloadCount: z.number(),
      categories: z.array(z.string()),
    }),
  ),
});
export const CurseForgeFilesRequest = z.object({
  modId: z.number(),
  loader: z.string().optional(),
  mcVersion: z.string().optional(),
});
export const CurseForgeFilesResponse = z.object({
  files: z.array(
    z.object({
      id: z.number(),
      displayName: z.string(),
      fileName: z.string(),
      fileLength: z.number(),
      downloadUrl: z.string().nullable(),
      gameVersions: z.array(z.string()),
      modLoaderNames: z.array(z.string()),
      hashes: z.array(z.object({ value: z.string(), algo: z.number() })).optional(),
      // 依赖**带必需/可选标记**（实测：`relationType` 3=必需、2=可选，见
      // `packages/core/src/curseforge/dependencies.ts`）。老 schema 是
      // `z.array(z.number())`——那时候客户端已经把标记丢掉了，两边一起错。
      dependencies: z
        .array(z.object({ modId: z.number(), relationType: z.number().optional() }))
        .optional(),
    }),
  ),
});
export const CurseForgeConfigSchema = z.object({ apiKey: z.string() });

/**
 * 用**官方根**验证一个 CurseForge key。
 *
 * 不复用搜索通道：搜索的根地址由「下载源」偏好决定，镜像优先时测的是镜像
 * 自带的 key，测不出用户填的这把到底行不行。这里强制官方根，且只用这一次
 * 请求，不缓存、不落盘。
 */
export const CurseForgeTestKeyRequest = z.object({ apiKey: z.string().min(1) });
export const CurseForgeTestKeyResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type CurseForgeTestKeyReq = z.infer<typeof CurseForgeTestKeyRequest>;
export type CurseForgeTestKeyRes = z.infer<typeof CurseForgeTestKeyResponse>;

// === 下载源偏好（官方源 / 国内镜像） ===
/**
 * 一个开关管两家镜像：原版游戏走 BMCLAPI，Mod 内容（Modrinth / CurseForge
 * 的接口与 CDN）走 MCIM。理由见 `main/download-sources.ts` 里
 * `SourcePreference` 的注释 —— 让人为了"下得快"跑两个地方各切一次是糟糕的 UI。
 *
 * 两种取值都**保留官方源**在候选列表里：切到镜像优先不等于放弃官方兜底。
 */
export const LOAD_SOURCE_PREFERENCE = 'market:loadSourcePreference';
export const SAVE_SOURCE_PREFERENCE = 'market:saveSourcePreference';

export const SourcePreferenceSchema = z.object({
  /** true = 官方源优先；false = 国内镜像优先。 */
  preferOfficial: z.boolean(),
});
export type SourcePreferencePayload = z.infer<typeof SourcePreferenceSchema>;

export type CurseForgeSearchReq = z.infer<typeof CurseForgeSearchRequest>;
export type CurseForgeSearchRes = z.infer<typeof CurseForgeSearchResponse>;
export type CurseForgeFilesReq = z.infer<typeof CurseForgeFilesRequest>;
export type CurseForgeFilesRes = z.infer<typeof CurseForgeFilesResponse>;
export type CurseForgeConfig = z.infer<typeof CurseForgeConfigSchema>;
