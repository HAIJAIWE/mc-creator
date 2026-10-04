/**
 * IPC Intent 体系
 * 参考 Onyxz UMAS 和 minemind 的规划器模式
 * 
 * 所有 IPC handler 都应接收 { intent, payload } 并返回 { success, data, error? }
 * 
 * 结构:
 * - FileIntent: 文件操作
 * - GeneratorIntent: AI 生成操作
 * - ProjectIntent: 项目操作
 */

// ---------------------------------------------------------------------------
// File Intents (26 个 file:* handlers 的统一意图)
// ---------------------------------------------------------------------------

/** 创建文件 */
export const FileIntentCreate = 'file:create';

/** 读取文件 */
export const FileIntentRead = 'file:read';

/** 写入/覆盖文件 */
export const FileIntentWrite = 'file:write';

/** 删除文件 */
export const FileIntentDelete = 'file:delete';

/** 移动/重命名文件 */
export const FileIntentMove = 'file:move';

/** 列出目录 */
export const FileIntentList = 'file:list';

/** 模糊搜索 */
export const FileIntentSearch = 'file:search';

/** 检查冲突 (名称冲突、版本冲突) */
export const FileIntentConflictCheck = 'file:conflict-check';

/** 获取文件元数据 */
export const FileIntentGetMeta = 'file:get-meta';

/** 设置文件元数据 */
export const FileIntentSetMeta = 'file:set-meta';

// 文件类型枚举
export enum FileIntentType {
  File = 'file',
  Json = 'json',
  Jsonc = 'jsonc',
  McManifest = 'mcmanifest',
  McLootTable = 'mcloottable',
  McRecipe = 'mcrecipe',
  McLang = 'mclang',
  McTag = 'mctag',
  McBlockstate = 'mcblockstate',
  McItemmodel = 'mcitemmodel',
  McEntitymodel = 'mcentitymodel',
  Python = 'python',
  JavaScript = 'javascript',
  Css = 'css',
  Html = 'html',
  Markdown = 'markdown',
  Other = 'other',
}

// 获取文件类型图标/扩展名
export function getFileIntentTypeByPath(filePath: string): FileIntentType {
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
  const map: Record<string, FileIntentType> = {
    '.json': FileIntentType.Json,
    '.jsonc': FileIntentType.Jsonc,
    '.js': FileIntentType.JavaScript,
    '.ts': FileIntentType.JavaScript,
    '.jsx': FileIntentType.JavaScript,
    '.tsx': FileIntentType.JavaScript,
    '.mcfunction': FileIntentType.Python, // 虽然是 mcfunction 但通常视为脚本
    '.py': FileIntentType.Python,
    '.jsm': FileIntentType.JavaScript,
    '.css': FileIntentType.Css,
    '.html': FileIntentType.Html,
    '.md': FileIntentType.Markdown,
    '.toml': FileIntentType.Other,
    '.yaml': FileIntentType.Other,
    '.yml': FileIntentType.Other,
    '.xml': FileIntentType.Other,
  };
  for (const [e, t] of Object.entries(map)) {
    if (ext === e) return t;
  }
  return FileIntentType.Other;
}

// ---------------------------------------------------------------------------
// Generator Intents (AI 生成相关)
// ---------------------------------------------------------------------------

/** AI 生成 */
export const GeneratorIntentGenerate = 'generator:generate';

/** 应用模板 */
export const GeneratorIntentTemplateApply = 'generator:template:apply';

/** 验证生成结果 */
export const GeneratorIntentValidate = 'generator:validate';

/** 重新加载生成的资源 */
export const GeneratorIntentReload = 'generator:reload';

/** 获取可用模板 */
export const GeneratorIntentGetTemplates = 'generator:get-templates';

/** 获取生成建议 */
export const GeneratorIntentGetSuggestions = 'generator:get-suggestions';

// 生成器类型
export enum GeneratorIntentType {
  Mod = 'mod',
  ResourcePack = 'resource_pack',
  DataPack = 'data_pack',
  Script = 'script',
  Entity = 'entity',
  Block = 'block',
  Item = 'item',
  Blockstate = 'blockstate',
  Loottable = 'loottable',
  Language = 'language',
  Tag = 'tag',
  Custom = 'custom',
}

// ---------------------------------------------------------------------------
// Project Intents (项目操作)
// ---------------------------------------------------------------------------

/** 新建项目 */
export const ProjectIntentNew = 'project:new';

/** 加载项目 */
export const ProjectIntentLoad = 'project:load';

/** 切换项目 */
export const ProjectIntentSwitch = 'project:switch';

/** 删除项目 */
export const ProjectIntentDelete = 'project:delete';

/** 列出项目 */
export const ProjectIntentList = 'project:list';

/** 获取当前项目 */
export const ProjectIntentGetCurrent = 'project:get-current';

/** 项目配置 */
export const ProjectIntentGetConfig = 'project:get-config';

/** 保存项目配置 */
export const ProjectIntentSaveConfig = 'project:save-config';

// 项目配置文件路径
export interface ProjectProfile {
  id: string; // 例如 "mc_creator", "modpack"
  name: string; // 显示名称
  workspace: string; // 相对于根目录的工作区路径
  output: string; // 输出路径
  buildCache: string; // 构建缓存路径
  temp: string; // 临时文件路径
  resourcePacks: string; // 资源包路径
  mods: string; // 模组路径
  exports: string; // 导出物路径
  conflictStrategy: 'skip' | 'overwrite' | 'merge';
  ttlDays?: number; // IndexedDB 缓存 TTL
  llm?: {
    model: string;
    temperature: number;
    maxTokens: number;
    baseUrl?: string;
  };
}

// 项目配置存储接口
export interface ProjectConfig {
  currentProfile: string;
  profiles: Record<string, ProjectProfile>;
  lastUpdated: number;
}

// ---------------------------------------------------------------------------
// Union Types for IPC Payloads
// ---------------------------------------------------------------------------

/** 基础 payload 结构 */
export interface BaseIntentPayload {
  projectId?: string; // 目标项目 ID
  path?: string; // 文件路径 (相对于工作区)
  content?: any; // 文件内容
  name?: string; // 新文件名
  target?: string; // 目标路径 (用于 move/rename)
  /** AI 生成时的额外参数 */
  llmParams?: {
    temperature?: number;
    maxTokens?: number;
    systemPrompt?: string;
  };
}

/** 文件操作 payload */
export interface FileIntentPayload extends BaseIntentPayload {
  type?: FileIntentType;
  /** 冲突处理策略 */
  conflictStrategy?: 'skip' | 'overwrite' | 'merge';
}

/** 生成器操作 payload */
export interface GeneratorIntentPayload extends BaseIntentPayload {
  type?: GeneratorIntentType;
  /** 模板名称 (用于 template:apply) */
  template?: string;
  /** 生成时的提示 */
  prompt?: string;
  /** 参数配置 */
  params?: Record<string, any>;
}

/** 项目操作 payload */
export interface ProjectIntentPayload extends BaseIntentPayload {
  /** 项目名称 */
  name?: string;
  /** 生成器类型 */
  generatorType?: string;
  /** 加载器 */
  loader?: string;
  /** Minecraft 版本 */
  mcVersion?: string;
  /** 描述 */
  description?: string;
  /** 要切换的配置文件 */
  profile?: string;
}

// ---------------------------------------------------------------------------
// Union Types for IPC Results
// ---------------------------------------------------------------------------

/** 基础结果结构 */
export interface BaseIntentResult {
  success: boolean;
  /** 生成/操作的文件路径 (相对于工作区) */
  filePath?: string;
  /** 新项目/当前项目的 ID */
  projectId?: string;
  /** 版本号或元数据 */
  metadata?: Record<string, any>;
  /** 建议/信息 */
  suggestions?: string[];
}

/** 文件操作结果 */
export interface FileIntentResult extends BaseIntentResult {
  /** 文件的完整绝对路径 */
  absolutePath?: string;
  /** 父目录路径 */
  parentPath?: string;
}

/** 生成器操作结果 */
export interface GeneratorIntentResult extends BaseIntentResult {
  /** 生成的文件列表 */
  generatedFiles?: string[];
  /** 更新的项目配置 */
  updatedConfig?: ProjectConfig;
}

/** 项目操作结果 */
export interface ProjectIntentResult extends BaseIntentResult {
  /** 所有项目列表 */
  projects?: ProjectConfig['profiles'];
  /** 当前激活的项目 */
  currentProject?: string;
}

// ---------------------------------------------------------------------------
// Handler 函数类型
// ---------------------------------------------------------------------------

/** IPC handler 接收事件和 payload，返回结果 */
export type IntentHandler = <T extends keyof IntentPayloadMap>(
  event: any,
  payload: IntentPayloadMap[T]
) => Promise<IntentResultMap[T]>;

// 映射 payload 类型到 intent 键
export type IntentPayloadMap = {
  [FileIntentCreate]: FileIntentPayload;
  [FileIntentRead]: FileIntentPayload;
  [FileIntentWrite]: FileIntentPayload;
  [FileIntentDelete]: FileIntentPayload;
  [FileIntentMove]: FileIntentPayload;
  [FileIntentList]: BaseIntentPayload;
  [FileIntentSearch]: BaseIntentPayload;
  [FileIntentConflictCheck]: BaseIntentPayload;
  [FileIntentGetMeta]: BaseIntentPayload;
  [FileIntentSetMeta]: BaseIntentPayload;
  [GeneratorIntentGenerate]: GeneratorIntentPayload;
  [GeneratorIntentTemplateApply]: GeneratorIntentPayload;
  [GeneratorIntentValidate]: GeneratorIntentPayload;
  [GeneratorIntentReload]: BaseIntentPayload;
  [GeneratorIntentGetTemplates]: BaseIntentPayload;
  [GeneratorIntentGetSuggestions]: BaseIntentPayload;
  [ProjectIntentNew]: ProjectIntentPayload;
  [ProjectIntentLoad]: ProjectIntentPayload;
  [ProjectIntentSwitch]: ProjectIntentPayload;
  [ProjectIntentDelete]: ProjectIntentPayload;
  [ProjectIntentList]: BaseIntentPayload;
  [ProjectIntentGetCurrent]: BaseIntentPayload;
  [ProjectIntentGetConfig]: BaseIntentPayload;
  [ProjectIntentSaveConfig]: BaseIntentPayload;
};

// 映射 result 类型到 intent 键
export type IntentResultMap = {
  [FileIntentCreate]: FileIntentResult;
  [FileIntentRead]: FileIntentResult;
  [FileIntentWrite]: FileIntentResult;
  [FileIntentDelete]: FileIntentResult;
  [FileIntentMove]: FileIntentResult;
  [FileIntentList]: BaseIntentResult;
  [FileIntentSearch]: BaseIntentResult;
  [FileIntentConflictCheck]: BaseIntentResult;
  [FileIntentGetMeta]: BaseIntentResult;
  [FileIntentSetMeta]: BaseIntentResult;
  [GeneratorIntentGenerate]: GeneratorIntentResult;
  [GeneratorIntentTemplateApply]: GeneratorIntentResult;
  [GeneratorIntentValidate]: BaseIntentResult;
  [GeneratorIntentReload]: BaseIntentResult;
  [GeneratorIntentGetTemplates]: BaseIntentResult;
  [GeneratorIntentGetSuggestions]: BaseIntentResult;
  [ProjectIntentNew]: ProjectIntentResult;
  [ProjectIntentLoad]: ProjectIntentResult;
  [ProjectIntentSwitch]: ProjectIntentResult;
  [ProjectIntentDelete]: ProjectIntentResult;
  [ProjectIntentList]: BaseIntentResult;
  [ProjectIntentGetCurrent]: BaseIntentResult;
  [ProjectIntentGetConfig]: BaseIntentResult;
  [ProjectIntentSaveConfig]: BaseIntentResult;
};

// ---------------------------------------------------------------------------
// 默认配置
// ---------------------------------------------------------------------------

/** 默认项目配置 */
export const DEFAULT_PROJECT_PROFILE: ProjectProfile = {
  id: 'mc_creator',
  name: 'Minecraft Creator',
  workspace: 'workspaces/{projectName}',
  output: 'generated/{projectName}',
  buildCache: '.cache/{projectName}',
  temp: 'tmp/{projectName}',
  resourcePacks: 'resource_packs/{projectName}',
  mods: 'mods/{projectName}',
  exports: 'exports/{projectName}',
  conflictStrategy: 'skip',
  ttlDays: 7,
  llm: {
    model: 'claude-sonnet-4',
    temperature: 0.3,
    maxTokens: 4000,
  },
};

/** 默认项目配置 */
export const DEFAULT_PROJECT_CONFIG: ProjectConfig = {
  currentProfile: 'mc_creator',
  profiles: {
    mc_creator: DEFAULT_PROJECT_PROFILE,
  },
  lastUpdated: Date.now(),
};