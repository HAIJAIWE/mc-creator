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

// === 大文件流式传输 ===

/** 流式写入请求（发起） */
export const FileWriteStreamStartRequest = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  totalSize: z.number().int().positive(),
  chunkSize: z.number().int().positive().optional(),
  expectedHash: z.string().optional(),
  requestId: z.string(),
});

/** 流式写入分片数据 */
export const FileWriteStreamChunkRequest = z.object({
  requestId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  data: z.string(), // base64 编码的二进制数据
  isLast: z.boolean(),
});

/** 流式写入响应 */
export const FileWriteStreamResponse = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  meta: z
    .object({
      size: z.number(),
      mtime: z.number(),
      isDirectory: z.boolean(),
      hash: z.string(),
    })
    .optional(),
});

/** 流式读取请求（发起） */
export const FileReadStreamStartRequest = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
  chunkSize: z.number().int().positive().optional(),
  requestId: z.string(),
});

/** 流式读取分片响应 */
export const FileReadStreamChunkResponse = z.object({
  requestId: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  data: z.string(), // base64 编码的二进制数据
  isLast: z.boolean(),
  progress: z.object({
    loaded: z.number(),
    total: z.number(),
    percentage: z.number(),
  }).optional(),
});

export type FileWriteStreamStartReq = z.infer<typeof FileWriteStreamStartRequest>;
export type FileWriteStreamChunkReq = z.infer<typeof FileWriteStreamChunkRequest>;
export type FileWriteStreamRes = z.infer<typeof FileWriteStreamResponse>;
export type FileReadStreamStartReq = z.infer<typeof FileReadStreamStartRequest>;
export type FileReadStreamChunkRes = z.infer<typeof FileReadStreamChunkResponse>;
