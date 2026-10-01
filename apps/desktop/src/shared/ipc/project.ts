import { z } from 'zod';
import { LOADERS } from '@mc-creator/shared';
import { GENERATOR_TYPES } from './generator-types.js';

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
