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
  'crafttweaker',
  'behavior_pack',
  'enchantment',
  'behavior_item',
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

/** 协作编辑：Spec 快照导出/导入（基于文件异步协作） */
export const EXPORT_SPEC = 'spec:export';
export const IMPORT_SPEC = 'spec:import';

/** 游戏启动器（下载客户端 + 离线启动） */
export const LAUNCHER_LIST_VERSIONS = 'launcher:listVersions';
export const LAUNCHER_DOWNLOAD = 'launcher:download';
export const LAUNCHER_LAUNCH = 'launcher:launch';
export const LAUNCHER_INSTALL_LOADER = 'launcher:installLoader';
export const LAUNCHER_LIST_MODS = 'launcher:listMods';
export const LAUNCHER_INSTALL_MOD = 'launcher:installMod';
export const LAUNCHER_REMOVE_MOD = 'launcher:removeMod';
export const LAUNCHER_INSTALL_SKIN = 'launcher:installSkin';

export const LauncherInstallLoaderRequest = z.object({
  version: z.string(),
  loader: z.enum(['fabric', 'neoforge']),
});
export const LauncherInstallLoaderResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherListModsResponse = z.object({
  mods: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const LauncherInstallModRequest = z.object({
  version: z.string(),
  name: z.string(),
  url: z.string(),
});
export const LauncherInstallModResponse = z.object({
  ok: z.boolean(),
  path: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherRemoveModRequest = z.object({ version: z.string(), name: z.string() });

export const LauncherInstallSkinRequest = z.object({
  version: z.string(),
  skinApiUrl: z.string().default('https://littleskin.cn/api/yggdrasil'),
});
export const LauncherInstallSkinResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherListVersionsResponse = z.object({
  versions: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      releaseTime: z.string(),
    }),
  ),
  error: z.string().nullable().optional(),
});

export const LauncherDownloadRequest = z.object({ version: z.string() });
export const LauncherDownloadResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherLaunchRequest = z.object({
  version: z.string(),
  username: z.string().default('Steve'),
  memory: z.string().default('2G'),
  gameDir: z.string().default(''),
});
export const LauncherLaunchResponse = z.object({
  pid: z.number(),
  error: z.string().nullable().optional(),
});

/** Spec 快照文件格式：{ meta, spec } */
export const SpecSnapshotSchema = z.object({
  meta: z.object({
    exportedAt: z.string(),
    exporter: z.string().default(''),
    description: z.string().default(''),
    generatorType: z.string().default('mod'),
  }),
  spec: z.record(z.unknown()),
});
export type SpecSnapshot = z.infer<typeof SpecSnapshotSchema>;

export const ExportSpecRequest = z.object({
  spec: z.record(z.unknown()),
  generatorType: z.string().default('mod'),
  description: z.string().default(''),
});
export const ExportSpecResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedPath: z.string().nullable(),
});

export const ImportSpecResponse = z.object({
  snapshot: SpecSnapshotSchema.nullable(),
  canceled: z.boolean(),
  error: z.string().nullable().optional(),
});

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
  /**
   * P1-4：增量构建统计（可选）。
   * 仅当生成器支持增量构建（如 ModGenerator）时返回，否则不存在。
   * 用于 UI 展示"本次构建命中缓存 X 个类别，重新生成 Y 个"。
   */
  buildStats: z
    .object({
      total: z.number(),
      cached: z.number(),
      regenerated: z.number(),
      filesTotal: z.number(),
      filesUnchanged: z.number(),
    })
    .optional(),
});

export const BuildRequest = z.object({
  projectPath: z.string().min(1),
  /** 可选：用于按 MC 版本提示所需 JDK 版本 */
  mcVersion: z.string().optional(),
});
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

/**
 * P12 chat 模式工具调用增强：ChatStreamRequest 添加可选 context 字段，
 * 让 chat 模式能感知项目上下文（生成器类型 + 用户描述 + 当前 spec 摘要）。
 * 上下文由 main 进程拼接到 system message，不暴露原始 spec 给模型以外的用途。
 */
export const ChatStreamRequest = z.object({
  message: z.string().min(1),
  context: z
    .object({
      generatorType: z.string().optional(),
      description: z.string().optional(),
      /** spec 的简短摘要（避免传完整 JSON 消耗 token） */
      specSummary: z.string().optional(),
    })
    .optional(),
});
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
// === 多模型对比（流式） ===
export const COMPARE_MODELS = 'ai:compareModels';
export const COMPARE_MODELS_CHUNK = 'ai:compareModels:chunk';

export const CompareModelsRequest = z.object({
  description: z.string().min(1),
  generatorType: z.string(),
  models: z
    .array(
      z.object({
        name: z.string(),
        modelId: z.string().min(1),
        baseURL: z.string().min(1),
        apiKey: z.string(),
      }),
    )
    .min(2)
    .max(3),
});
export type CompareModelsReq = z.infer<typeof CompareModelsRequest>;

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

// === AI 修复建议（流式） ===
export const AI_FIX_SUGGEST = 'ai:fixSuggest';
export const AI_FIX_SUGGEST_CHUNK = 'ai:fixSuggest:chunk';

export const AiFixSuggestRequest = z.object({
  buildLog: z.string().min(1),
  files: z
    .array(
      z.object({
        path: z.string(),
        content: z.string(),
      }),
    )
    .default([]),
});
export type AiFixSuggestReq = z.infer<typeof AiFixSuggestRequest>;
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
// === 单文件保存到磁盘 ===
export const SAVE_FILE = 'mod:saveFile';

export const SaveFileRequest = z.object({
  path: z.string().min(1),
  content: z.string(),
  defaultName: z.string().default(''),
});
export const SaveFileResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedPath: z.string().nullable(),
});
export type SaveFileReq = z.infer<typeof SaveFileRequest>;
export type SaveFileRes = z.infer<typeof SaveFileResponse>;

// === 保存全部文件到磁盘 ===
export const SAVE_ALL_FILES = 'mod:saveAllFiles';

export const SaveAllFilesRequest = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
export const SaveAllFilesResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedDir: z.string().nullable(),
  count: z.number().default(0),
});
export type SaveAllFilesReq = z.infer<typeof SaveAllFilesRequest>;
export type SaveAllFilesRes = z.infer<typeof SaveAllFilesResponse>;

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
export const GIT_BRANCH_LIST = 'git:branchList';
export const GIT_BRANCH_CREATE = 'git:branchCreate';
export const GIT_BRANCH_SWITCH = 'git:branchSwitch';
export const GIT_ADD = 'git:add';
export const GIT_RESET = 'git:reset';
export const GIT_DIFF = 'git:diff';

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

// Git 分支管理
export const GitBranchListRequest = z.object({ repoPath: z.string().min(1) });
export const GitBranchListResponse = z.object({
  ok: z.boolean(),
  branches: z
    .array(
      z.object({
        name: z.string(),
        current: z.boolean(),
      }),
    )
    .default([]),
  error: z.string().nullable().optional(),
});
export type GitBranchListRes = z.infer<typeof GitBranchListResponse>;

export const GitBranchCreateRequest = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
});
export const GitBranchCreateResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type GitBranchCreateRes = z.infer<typeof GitBranchCreateResponse>;

export const GitBranchSwitchRequest = z.object({
  repoPath: z.string().min(1),
  name: z.string().min(1),
});
export const GitBranchSwitchResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type GitBranchSwitchRes = z.infer<typeof GitBranchSwitchResponse>;

// Git 暂存区操作
export const GitAddRequest = z.object({
  repoPath: z.string().min(1),
  paths: z.array(z.string()),
});
export const GitAddResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const GitResetRequest = z.object({
  repoPath: z.string().min(1),
  paths: z.array(z.string()),
});
export const GitResetResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

// Git Diff
export const GitDiffRequest = z.object({
  repoPath: z.string().min(1),
  path: z.string().min(1),
  staged: z.boolean().default(false),
});
export const GitDiffResponse = z.object({
  ok: z.boolean(),
  diff: z.string().default(''),
  error: z.string().nullable().optional(),
});
export type GitDiffRes = z.infer<typeof GitDiffResponse>;

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

// === 终端（主进程 PTY 桥接，渲染进程仅展示）===
export const TERMINAL_SPAWN = 'terminal:spawn';

// === 资源文件导入（选择本地 .png/.ogg/.json/.lang 文件，读取并 base64 编码返回）===
export const IMPORT_RESOURCE_FILES = 'resource:importFiles';

export const ImportResourceFilesRequest = z.object({
  /** 文件选择对话框标题 */
  title: z.string().default('导入资源文件'),
  /** 允许的扩展名过滤，如 ['png', 'ogg', 'json'] */
  extensions: z.array(z.string()).default(['png', 'ogg', 'json', 'lang']),
  /** 是否允许多选（默认 true） */
  multiSelect: z.boolean().default(true),
});
export const ImportedResourceFile = z.object({
  /** 用户磁盘上的原始路径 */
  sourcePath: z.string(),
  /** 文件名（含扩展名） */
  fileName: z.string(),
  /** 扩展名（小写，无点） */
  ext: z.string(),
  /** base64 编码内容 */
  base64: z.string(),
  /** 文件大小（字节） */
  size: z.number(),
});
export const ImportResourceFilesResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean().default(false),
  files: z.array(ImportedResourceFile).default([]),
  error: z.string().nullable().optional(),
});
export type ImportResourceFilesReq = z.infer<typeof ImportResourceFilesRequest>;
export type ImportResourceFilesRes = z.infer<typeof ImportResourceFilesResponse>;
export type ImportedResourceFileT = z.infer<typeof ImportedResourceFile>;
export const TERMINAL_DATA = 'terminal:data';
export const TERMINAL_EXIT = 'terminal:exit';
export const TERMINAL_WRITE = 'terminal:write';
export const TERMINAL_RESIZE = 'terminal:resize';
export const TERMINAL_KILL = 'terminal:kill';

export const TerminalSpawnRequest = z.object({
  shell: z.string().optional(),
  cwd: z.string().optional(),
  cols: z.number().default(80),
  rows: z.number().default(24),
});
export const TerminalSpawnResponse = z.object({
  pid: z.number(),
});
export type TerminalSpawnReq = z.infer<typeof TerminalSpawnRequest>;
export type TerminalSpawnRes = z.infer<typeof TerminalSpawnResponse>;

export const TerminalWriteRequest = z.object({
  pid: z.number(),
  data: z.string(),
});
export const TerminalResizeRequest = z.object({
  pid: z.number(),
  cols: z.number(),
  rows: z.number(),
});
export const TerminalKillRequest = z.object({
  pid: z.number(),
});

// === 节点图持久化（保存/加载到磁盘 + 文件对话框）===
// 渲染层通过 window.api.nodeGraph 调用，主进程用 fs.promises 读写文件、dialog 弹出选择框。
export const NODE_GRAPH_SAVE = 'nodeGraph:save';
export const NODE_GRAPH_LOAD = 'nodeGraph:load';
export const NODE_GRAPH_SHOW_SAVE_DIALOG = 'nodeGraph:showSaveDialog';
export const NODE_GRAPH_SHOW_OPEN_DIALOG = 'nodeGraph:showOpenDialog';

/** nodeGraph:save 请求：把 JSON 字符串写入指定路径 */
export const NodeGraphSaveRequest = z.object({
  filePath: z.string().min(1),
  json: z.string(),
});
export const NodeGraphSaveResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

/** nodeGraph:load 请求：读取指定路径的 JSON 字符串 */
export const NodeGraphLoadRequest = z.object({
  filePath: z.string().min(1),
});
export const NodeGraphLoadResponse = z.object({
  ok: z.boolean(),
  json: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** nodeGraph:showSaveDialog 请求：默认文件名（一般传 modId-node-graph.json） */
export const NodeGraphShowSaveDialogRequest = z.object({
  defaultName: z.string().default('node-graph.json'),
});
export const NodeGraphShowSaveDialogResponse = z.object({
  ok: z.boolean(),
  filePath: z.string().nullable().optional(),
});

/** nodeGraph:showOpenDialog 响应：用户选择文件后返回路径 */
export const NodeGraphShowOpenDialogResponse = z.object({
  ok: z.boolean(),
  filePath: z.string().nullable().optional(),
});

export type NodeGraphSaveReq = z.infer<typeof NodeGraphSaveRequest>;
export type NodeGraphSaveRes = z.infer<typeof NodeGraphSaveResponse>;
export type NodeGraphLoadReq = z.infer<typeof NodeGraphLoadRequest>;
export type NodeGraphLoadRes = z.infer<typeof NodeGraphLoadResponse>;
export type NodeGraphShowSaveDialogReq = z.infer<typeof NodeGraphShowSaveDialogRequest>;
export type NodeGraphShowSaveDialogRes = z.infer<typeof NodeGraphShowSaveDialogResponse>;
export type NodeGraphShowOpenDialogRes = z.infer<typeof NodeGraphShowOpenDialogResponse>;
