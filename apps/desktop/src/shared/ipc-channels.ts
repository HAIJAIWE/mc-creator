import { z } from 'zod';
import { ModSpec } from '@mc-creator/shared';

/** 生成器类型联合（mod/datapack/modpack/server/texture/skin） */
export const GENERATOR_TYPES = ['mod', 'datapack', 'modpack', 'server', 'texture', 'skin'] as const;
export type GeneratorType = typeof GENERATOR_TYPES[number];

/** IPC 通道名常量 */
export const IPC = {
  GENERATE_SPEC: 'mod:generateSpec',
  GENERATE_FILES: 'mod:generateFiles',
  BUILD: 'mod:build',
} as const;

/** 导出 zip IPC 通道 */
export const EXPORT_ZIP = 'mod:exportZip';

/** 请求/响应 schema（zod 校验，规格 §7.2 类型化 IPC） */
export const GenerateSpecRequest = z.object({ description: z.string().min(1) });
export const GenerateSpecResponse = z.object({ spec: ModSpec, raw: z.string() });

export const GenerateFilesRequest = z.object({
  loader: z.enum(['fabric', 'neoforge']),
  mcVersion: z.string(),
  // spec 可能是 ModSpec/ServerSpec/TextureSpec/SkinSpec 等，由各 Generator 内部用对应 schema.parse 校验
  spec: z.record(z.unknown()),
  modId: z.string().default(''),
  generatorType: z.enum(GENERATOR_TYPES).default('mod'),
});
export const GenerateFilesResponse = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  warnings: z.array(z.string()),
});

export const BuildRequest = z.object({ projectPath: z.string().min(1) });
export const BuildResponse = z.object({
  success: z.boolean(),
  jarPath: z.string().nullable(),
  log: z.string(),
});

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

export const ChatStreamRequest = z.object({ message: z.string().min(1) });
export type ChatStreamReq = z.infer<typeof ChatStreamRequest>;

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
