import { z } from 'zod';

/** Mod 条目（整合包中的单个 mod） */
export const ModDependencyRef = z.object({
  projectId: z.string(),
  versionId: z.string().optional(),
  dependencyType: z.enum(['required', 'optional', 'incompatible', 'embedded']).default('required'),
});

export const ModEntry = z.object({
  name: z.string(),
  projectId: z.string(), // Modrinth project ID 或 CurseForge project ID
  versionId: z.string(), // Modrinth version ID 或 CurseForge file ID
  fileName: z.string(), // 下载后的文件名
  fileSize: z.number().optional(), // 文件大小（字节）
  downloadUrl: z.string().optional(), // 直接下载 URL（可选）
  // === mrpack 依赖解析新增（全部可选，向后兼容） ===
  /** 人类可读版本号（如 0.5.8），锁定后由 resolver 填充 */
  versionNumber: z.string().optional(),
  /** 该版本支持的 MC 版本列表（resolver 从版本元数据填充，用于冲突检测） */
  gameVersions: z.array(z.string()).optional(),
  /** 该版本支持的 loader 列表（小写，如 fabric/neoforge/quilt/forge） */
  loaders: z.array(z.string()).optional(),
  /** 文件哈希（mrpack 必需；缺失时导出用占位并告警） */
  sha512: z.string().optional(),
  sha1: z.string().optional(),
  /** 运行侧声明（mrpack env.client/env.server） */
  envClient: z.enum(['required', 'optional', 'unsupported']).optional(),
  envServer: z.enum(['required', 'optional', 'unsupported']).optional(),
  /** 依赖声明（resolver 从版本元数据填充，用于依赖图） */
  dependencies: z.array(ModDependencyRef).optional(),
  /** mod 来源（resolver 填充，便于 UI 区分） */
  source: z.enum(['modrinth', 'curseforge']).optional(),
});

export type ModDependencyRef = z.infer<typeof ModDependencyRef>;

/** 整合包覆盖文件条目（P10 新增） */
export const OverrideFileSpec = z.object({
  path: z.string(),
  content: z.string(),
});

/** 整合包规格（loader 无关的结构化规格） */
export const ModpackSpec = z.object({
  packId: z.string().regex(/^[a-z0-9_]+$/),
  packName: z.string(),
  packVersion: z.string().default('1.0.0'),
  author: z.string().default(''),
  description: z.string().default(''),
  format: z.enum(['modrinth', 'curseforge']).default('modrinth'),
  // S-10 修复：补默认值（此前缺失，AI 输出省略这两字段时 orchestrator parse 失败）
  mcVersion: z.string().default('1.21.11'),
  loader: z.enum(['fabric', 'neoforge', 'quilt', 'legacy_fabric']).default('fabric'),
  loaderVersion: z.string().default(''),
  mods: z.array(ModEntry).default([]),
  // P10 新增字段（向后兼容：均带 default）
  credits: z.string().default(''),
  overrides: z.array(OverrideFileSpec).default([]), // 覆盖文件（如 config/xxx.conf）
  serverOverrides: z.array(OverrideFileSpec).default([]), // 仅服务器覆盖
  launchMessage: z.string().default(''), // 启动器显示的消息
});

export type ModpackSpec = z.infer<typeof ModpackSpec>;
export type ModEntry = z.infer<typeof ModEntry>;
export type OverrideFileSpec = z.infer<typeof OverrideFileSpec>;
