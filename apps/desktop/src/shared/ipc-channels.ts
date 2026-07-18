import { z } from 'zod';
import { LOADERS } from '@mc-creator/shared';

/** 生成器类型联合（mod/datapack/modpack/server/resource_pack/skin/launcher） */
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'resource_pack',
  'skin',
  'launcher',
  'kubejs',
] as const;
export type GeneratorType = (typeof GENERATOR_TYPES)[number];

/** IPC 通道名常量 */
export const IPC = {
  GENERATE_SPEC: 'mod:generateSpec',
  GENERATE_FILES: 'mod:generateFiles',
  BUILD: 'mod:build',
} as const;

/** 导出 zip IPC 通道 */
export const EXPORT_ZIP = 'mod:exportZip';

/** 请求/响应 schema（zod 校验，规格 §7.2 类型化 IPC） */
export const GenerateSpecRequest = z.object({
  description: z.string().min(1),
  generatorType: z.enum(GENERATOR_TYPES).default('mod'),
});
export const GenerateSpecResponse = z.object({
  spec: z.record(z.unknown()),
  raw: z.string(),
});

export const GenerateFilesRequest = z.object({
  loader: z.enum(LOADERS),
  mcVersion: z.string(),
  // spec 可能是 ModSpec/ServerSpec/SkinSpec 等，由各 Generator 内部用对应 schema.parse 校验
  spec: z.record(z.unknown()),
  modId: z.string().default(''),
  generatorType: z.enum(GENERATOR_TYPES).default('mod'),
});
export const GenerateFilesResponse = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  warnings: z.array(z.string()),
});

export const BuildRequest = z.object({ projectPath: z.string().min(1) });
export const BuildResponse = z.object({
  success: z.boolean(),
  jarPath: z.string().nullable(),
  log: z.string(),
});

// === 流式构建（P20） ===
export const BUILD_STREAM = 'mod:buildStream';
export const BUILD_STREAM_CHUNK = 'mod:buildStream:chunk';
export const BuildStreamRequest = z.object({ projectPath: z.string().min(1) });
export const BuildStreamChunk = z.object({
  type: z.enum(['stdout', 'stderr', 'exit']),
  text: z.string(),
  done: z.boolean(),
  exitCode: z.number().nullable().optional(),
});
export type BuildStreamReq = z.infer<typeof BuildStreamRequest>;
export type BuildStreamChunkT = z.infer<typeof BuildStreamChunk>;

export type GenerateSpecReq = z.infer<typeof GenerateSpecRequest>;
export type GenerateSpecRes = z.infer<typeof GenerateSpecResponse>;
export type GenerateFilesReq = z.infer<typeof GenerateFilesRequest>;
export type GenerateFilesRes = z.infer<typeof GenerateFilesResponse>;
export type BuildReq = z.infer<typeof BuildRequest>;
export type BuildRes = z.infer<typeof BuildResponse>;

// === 模型配置 ===
export const LOAD_MODEL_CONFIG = 'model:loadConfig';
export const SAVE_MODEL_CONFIG = 'model:saveConfig';

export const SaveModelConfigRequest = z.object({
  name: z.string(),
  modelId: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string(),
});
export const ModelConfigResponse = z.object({
  name: z.string(),
  modelId: z.string(),
  baseURL: z.string(),
  apiKey: z.string(),
});

export type SaveModelConfigReq = z.infer<typeof SaveModelConfigRequest>;
export type ModelConfigRes = z.infer<typeof ModelConfigResponse>;

// === AI 聊天 ===
export const CHAT = 'ai:chat';

export const ChatRequest = z.object({ message: z.string().min(1) });
export const ChatResponse = z.object({ reply: z.string() });

export type ChatReq = z.infer<typeof ChatRequest>;
export type ChatRes = z.infer<typeof ChatResponse>;

// === 流式 AI 聊天 ===
export const CHAT_STREAM = 'ai:chatStream';
export const CHAT_STREAM_CHUNK = 'ai:chatStream:chunk'; // 主进程→渲染进程的事件

export const ChatStreamRequest = z.object({ message: z.string().min(1) });
export type ChatStreamReq = z.infer<typeof ChatStreamRequest>;

// === AI 解释代码（流式） ===
export const EXPLAIN_CODE = 'ai:explainCode';
export const EXPLAIN_CODE_CHUNK = 'ai:explainCode:chunk';

export const ExplainCodeRequest = z.object({
  fileName: z.string().min(1),
  code: z.string().min(1),
  generatorType: z.string().optional(),
});
export type ExplainCodeReq = z.infer<typeof ExplainCodeRequest>;

// === 带修复的构建 ===
export const BUILD_WITH_FIX = 'mod:buildWithFix';

export const BuildWithFixRequest = z.object({ projectPath: z.string().min(1) });
export const BuildWithFixResponse = z.object({
  success: z.boolean(),
  attempts: z.number(),
  jarPath: z.string().nullable(),
  log: z.string(),
  fixLog: z.array(z.string()),
});

export type BuildWithFixReq = z.infer<typeof BuildWithFixRequest>;
export type BuildWithFixRes = z.infer<typeof BuildWithFixResponse>;

// === 导出 zip ===
export const ExportZipRequest = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  defaultName: z.string().default('export.zip'),
});
export const ExportZipResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedPath: z.string().nullable(),
});

export type ExportZipReq = z.infer<typeof ExportZipRequest>;
export type ExportZipRes = z.infer<typeof ExportZipResponse>;

// === 准备构建目录（P22-4：构建前把内存中的 files 写入临时目录，避免硬编码路径） ===
export const PREPARE_BUILD_DIR = 'mod:prepareBuildDir';

export const PrepareBuildDirRequest = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
export const PrepareBuildDirResponse = z.object({
  projectPath: z.string(),
});

export type PrepareBuildDirReq = z.infer<typeof PrepareBuildDirRequest>;
export type PrepareBuildDirRes = z.infer<typeof PrepareBuildDirResponse>;

// === 项目管理 ===
export const LIST_PROJECTS = 'project:list';
export const GET_PROJECT = 'project:get';
export const SAVE_PROJECT = 'project:save';
export const DELETE_PROJECT = 'project:delete';

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  generatorType: z.enum(GENERATOR_TYPES),
  loader: z.enum(LOADERS),
  mcVersion: z.string(),
  description: z.string(),
  spec: z.record(z.unknown()),
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof ProjectSchema>;

// === 项目导入/导出（P28） ===
export const EXPORT_PROJECT = 'project:export';
export const IMPORT_PROJECT = 'project:import';

export const ExportProjectRequest = z.object({
  project: ProjectSchema, // 完整 Project 对象
});
export const ExportProjectResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedPath: z.string().nullable(),
});

export const ImportProjectResponse = z.object({
  project: ProjectSchema.nullable(), // 导入成功返回新 Project，失败返回 null
  error: z.string().nullable().optional(),
});

export type ExportProjectReq = z.infer<typeof ExportProjectRequest>;
export type ExportProjectRes = z.infer<typeof ExportProjectResponse>;
export type ImportProjectRes = z.infer<typeof ImportProjectResponse>;

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
      files: z.array(
        z.object({
          url: z.string(),
          filename: z.string(),
          primary: z.boolean(),
          size: z.number(),
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
    }),
  ),
});
export const CurseForgeConfigSchema = z.object({ apiKey: z.string() });

export type CurseForgeSearchReq = z.infer<typeof CurseForgeSearchRequest>;
export type CurseForgeSearchRes = z.infer<typeof CurseForgeSearchResponse>;
export type CurseForgeFilesReq = z.infer<typeof CurseForgeFilesRequest>;
export type CurseForgeFilesRes = z.infer<typeof CurseForgeFilesResponse>;
export type CurseForgeConfig = z.infer<typeof CurseForgeConfigSchema>;

// === 源代码管理（Git 桥接：主进程跑 git，渲染进程只展示）===
export const GIT_CHOOSE_REPO = 'git:chooseRepo';
export const GIT_STATUS = 'git:status';
export const GIT_LOG = 'git:log';
export const GIT_COMMIT = 'git:commit';
export const GIT_PULL = 'git:pull';
export const GIT_PUSH = 'git:push';

export const GitChooseRepoResponse = z.object({
  path: z.string().nullable(),
});
export type GitChooseRepoRes = z.infer<typeof GitChooseRepoResponse>;

export const GitStatusRequest = z.object({ repoPath: z.string().min(1) });
export const GitFileStatus = z.object({
  // X = 暂存区状态, Y = 工作区状态（来自 git status --porcelain 的两字母码）
  x: z.string(),
  y: z.string(),
  path: z.string(),
  // 重命名/复制的原始路径（如有）
  origPath: z.string().optional(),
});
export const GitStatusResponse = z.object({
  ok: z.boolean(),
  branch: z.string().nullable(),
  upstream: z.string().nullable(),
  ahead: z.number().default(0),
  behind: z.number().default(0),
  clean: z.boolean().default(true),
  files: z.array(GitFileStatus).default([]),
  error: z.string().nullable().optional(),
});
export type GitStatusReq = z.infer<typeof GitStatusRequest>;
export type GitStatusRes = z.infer<typeof GitStatusResponse>;

export const GitLogRequest = z.object({
  repoPath: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
});
export const GitCommitEntry = z.object({
  hash: z.string(),
  shortHash: z.string(),
  message: z.string(),
  author: z.string(),
  date: z.string(),
});
export const GitLogResponse = z.object({
  ok: z.boolean(),
  commits: z.array(GitCommitEntry).default([]),
  error: z.string().nullable().optional(),
});
export type GitLogReq = z.infer<typeof GitLogRequest>;
export type GitLogRes = z.infer<typeof GitLogResponse>;

export const GitCommitRequest = z.object({
  repoPath: z.string().min(1),
  message: z.string().min(1),
  // 是否先把所有改动加入暂存区（默认 true）
  all: z.boolean().default(true),
});
export const GitCommitResponse = z.object({
  ok: z.boolean(),
  hash: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type GitCommitReq = z.infer<typeof GitCommitRequest>;
export type GitCommitRes = z.infer<typeof GitCommitResponse>;

export const GitPullRequest = z.object({ repoPath: z.string().min(1) });
export const GitPushRequest = z.object({ repoPath: z.string().min(1) });
export const GitSyncResponse = z.object({
  ok: z.boolean(),
  stdout: z.string().default(''),
  error: z.string().nullable().optional(),
});
export type GitPullReq = z.infer<typeof GitPullRequest>;
export type GitPushReq = z.infer<typeof GitPushRequest>;
export type GitSyncRes = z.infer<typeof GitSyncResponse>;

// === Minecraft 启动器（A 切片：离线账号，无需微软 OAuth）===
export const LOCATE_MC = 'mc:locate';
export const MC_CHOOSE_DIR = 'mc:chooseDir';
export const INSTALL_MOD = 'mc:installMod';
export const LAUNCH_MC = 'mc:launch';

export const LocateMcResponse = z.object({
  found: z.boolean(),
  mcDir: z.string().nullable(),
  modsDir: z.string().nullable(),
  launcherExe: z.string().nullable(),
  launcher: z.enum(['official', 'pcl2', 'hmcl']).nullable(),
  error: z.string().nullable().optional(),
});
export type LocateMcRes = z.infer<typeof LocateMcResponse>;

export const McChooseDirResponse = z.object({ path: z.string().nullable() });
export type McChooseDirRes = z.infer<typeof McChooseDirResponse>;

export const InstallModRequest = z.object({
  jarPath: z.string().min(1),
  mcDir: z.string().optional(),
});
export const InstallModResponse = z.object({
  ok: z.boolean(),
  modsDir: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type InstallModReq = z.infer<typeof InstallModRequest>;
export type InstallModRes = z.infer<typeof InstallModResponse>;

export const LaunchMcRequest = z.object({ mcDir: z.string().optional() });
export const LaunchMcResponse = z.object({
  ok: z.boolean(),
  method: z.string().nullable(),
  launcher: z.enum(['official', 'pcl2', 'hmcl']).nullable(),
  error: z.string().nullable().optional(),
});
export type LaunchMcReq = z.infer<typeof LaunchMcRequest>;
export type LaunchMcRes = z.infer<typeof LaunchMcResponse>;
