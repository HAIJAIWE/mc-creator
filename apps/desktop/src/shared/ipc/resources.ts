import { z } from 'zod';

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
