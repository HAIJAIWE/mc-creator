import { z } from 'zod';

/** 导出 zip IPC 通道 */
export const EXPORT_ZIP = 'mod:exportZip';

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
