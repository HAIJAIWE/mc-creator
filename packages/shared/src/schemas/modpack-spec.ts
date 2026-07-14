import { z } from 'zod';

/** Mod 条目（整合包中的单个 mod） */
export const ModEntry = z.object({
  name: z.string(),
  projectId: z.string(),    // Modrinth project ID 或 CurseForge project ID
  versionId: z.string(),    // Modrinth version ID 或 CurseForge file ID
  fileName: z.string(),     // 下载后的文件名
  fileSize: z.number().optional(),       // 文件大小（字节）
  downloadUrl: z.string().optional(),    // 直接下载 URL（可选）
});

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
  mcVersion: z.string(),
  loader: z.enum(['fabric', 'neoforge']),
  loaderVersion: z.string().default(''),
  mods: z.array(ModEntry).default([]),
  // P10 新增字段（向后兼容：均带 default）
  credits: z.string().default(''),
  overrides: z.array(OverrideFileSpec).default([]),         // 覆盖文件（如 config/xxx.conf）
  serverOverrides: z.array(OverrideFileSpec).default([]),   // 仅服务器覆盖
  launchMessage: z.string().default(''),                     // 启动器显示的消息
});

export type ModpackSpec = z.infer<typeof ModpackSpec>;
export type ModEntry = z.infer<typeof ModEntry>;
export type OverrideFileSpec = z.infer<typeof OverrideFileSpec>;
