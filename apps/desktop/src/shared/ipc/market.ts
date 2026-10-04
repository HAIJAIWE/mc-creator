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
            project_id: z.string(),
            version_id: z.string().nullable().optional(),
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
          hashes: z.object({ sha512: z.string().optional(), sha1: z.string().optional() }).optional(),
        }),
      ),
    }),
  ),
});

export type ModrinthSearchReq = z.infer<typeof ModrinthSearchRequest>;
export type ModrinthSearchRes = z.infer<typeof ModrinthSearchResponse>;
export type ModrinthVersionsReq = z.infer<typeof ModrinthVersionsRequest>;
export type ModrinthVersionsRes = z.infer<typeof ModrinthVersionsResponse>;

// === CurseForge 搜索（P29：与 P25 Modrinth 共同构成资源市场，需 API key） ===
export const CURSEFORGE_SEARCH = 'curseforge:search';
export const CURSEFORGE_FILES = 'curseforge:files';
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
      dependencies: z.array(z.number()).optional(),
    }),
  ),
});
export const CurseForgeConfigSchema = z.object({ apiKey: z.string() });

export type CurseForgeSearchReq = z.infer<typeof CurseForgeSearchRequest>;
export type CurseForgeSearchRes = z.infer<typeof CurseForgeSearchResponse>;
export type CurseForgeFilesReq = z.infer<typeof CurseForgeFilesRequest>;
export type CurseForgeFilesRes = z.infer<typeof CurseForgeFilesResponse>;
export type CurseForgeConfig = z.infer<typeof CurseForgeConfigSchema>;
