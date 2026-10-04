import { z } from 'zod';
import { ModEntry } from '@mc-creator/shared';

// === 整合包依赖解析（modpack:resolve） ===
export const MODPACK_RESOLVE = 'modpack:resolve';
export const MODPACK_CHECK_CONFLICTS = 'modpack:checkConflicts';
export const MODPACK_EXPORT_MRPACK = 'modpack:exportMrpack';
/** 导出进度事件（主 → 渲，webContents.send） */
export const MODPACK_EXPORT_PROGRESS = 'modpack:exportProgress';

export const ModpackResolveRequest = z.object({
  mods: z.array(z.object({ projectId: z.string().min(1), name: z.string().optional() })),
  mcVersion: z.string().min(1),
  loader: z.string().min(1),
  /** 离线时允许用缓存（默认 true） */
  allowCache: z.boolean().optional().default(true),
});

export const DependencyNodeSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  versionId: z.string(),
  versionNumber: z.string().optional(),
  source: z.enum(['modrinth', 'curseforge', 'unknown']),
});
export const DependencyEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(['requires', 'optional', 'breaks', 'conflicts', 'embedded']),
  versionConstraint: z.string().optional(),
});
export const FixSuggestionSchema = z.object({
  action: z.enum(['upgrade', 'downgrade', 'remove', 'add-missing', 'switch-loader-version']),
  targetVersionId: z.string().optional(),
  targetProjectId: z.string().optional(),
  reason: z.string(),
});
export const ModConflictSchema = z.object({
  kind: z.enum([
    'duplicate-version',
    'loader-mismatch',
    'mc-out-of-range',
    'missing-dependency',
    'breaks-conflict',
  ]),
  projectIds: z.array(z.string()),
  message: z.string(),
  suggestion: FixSuggestionSchema,
  suggestedVersionNumber: z.string().optional(),
});

export const ModpackResolveResponse = z.object({
  resolved: z.array(ModEntry),
  graph: z.object({ nodes: z.array(DependencyNodeSchema), edges: z.array(DependencyEdgeSchema) }),
  conflicts: z.array(ModConflictSchema),
  unresolved: z.array(z.object({ projectId: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  /** 是否走了离线缓存降级 */
  fromCache: z.boolean().default(false),
});

// === 冲突检测（modpack:checkConflicts，纯本地，无网络） ===
export const ModpackCheckConflictsRequest = z.object({
  mods: z.array(ModEntry),
  mcVersion: z.string().min(1),
  loader: z.string().min(1),
});
export const ModpackCheckConflictsResponse = z.object({
  conflicts: z.array(ModConflictSchema),
});

// === mrpack 导出（modpack:exportMrpack） ===
export const ModpackExportMrpackRequest = z.object({
  /** 完整 ModpackSpec（mods 应为 resolve 锁定后的条目） */
  spec: z.record(z.unknown()),
  /** 当前项目 id（可选）：用于大文件经 file:project:writeStream 落到 exports 目录 */
  projectId: z.string().optional().default(''),
  defaultName: z.string().optional().default(''),
});
export const ModpackExportMrpackResponse = z.object({
  ok: z.boolean(),
  canceled: z.boolean(),
  savedPath: z.string().nullable(),
  fileCount: z.number().default(0),
  totalBytes: z.number().default(0),
  /** 是否走了流式通道（zip > 阈值） */
  usedStream: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
});

/** 导出进度事件载荷 */
export const ModpackExportProgressSchema = z.object({
  requestId: z.string().default(''),
  loaded: z.number(),
  total: z.number(),
  percentage: z.number(),
  currentFile: z.string().default(''),
  done: z.boolean().default(false),
});

export type ModpackResolveReq = z.infer<typeof ModpackResolveRequest>;
export type ModpackResolveRes = z.infer<typeof ModpackResolveResponse>;
export type ModpackCheckConflictsReq = z.infer<typeof ModpackCheckConflictsRequest>;
export type ModpackCheckConflictsRes = z.infer<typeof ModpackCheckConflictsResponse>;
export type ModpackExportMrpackReq = z.infer<typeof ModpackExportMrpackRequest>;
export type ModpackExportMrpackRes = z.infer<typeof ModpackExportMrpackResponse>;
export type ModpackExportProgressT = z.infer<typeof ModpackExportProgressSchema>;
export type ModConflictT = z.infer<typeof ModConflictSchema>;
