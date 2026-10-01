import { z } from 'zod';

/** 协作编辑：Spec 快照导出/导入（基于文件异步协作） */
export const EXPORT_SPEC = 'spec:export';
export const IMPORT_SPEC = 'spec:import';

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
