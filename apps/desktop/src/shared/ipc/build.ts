import { z } from 'zod';

export const BuildRequest = z.object({
  projectPath: z.string().min(1),
  /** 可选：用于按 MC 版本提示所需 JDK 版本 */
  mcVersion: z.string().optional(),
});
export const BuildResponse = z.object({
  success: z.boolean(),
  jarPath: z.string().nullable(),
  log: z.string(),
});

// === 流式构建（P20） ===
export const BUILD_STREAM = 'mod:buildStream';
export const BUILD_STREAM_CHUNK = 'mod:buildStream:chunk';
export const BuildStreamRequest = z.object({ projectPath: z.string().min(1) });
export const BuildStreamChunk = z.object({
  type: z.enum(['stdout', 'stderr', 'exit']),
  text: z.string(),
  done: z.boolean(),
  exitCode: z.number().nullable().optional(),
});
export type BuildStreamReq = z.infer<typeof BuildStreamRequest>;
export type BuildStreamChunkT = z.infer<typeof BuildStreamChunk>;

// === 构建取消（Phase 3.2）：kill 流式构建子进程并保留已生成文件（占位实现：仅 kill 主进程直接 spawn 的 gradle 子进程） ===
export const BUILD_ABORT = 'mod:buildAbort';
export const BuildAbortResponse = z.object({
  ok: z.boolean(),
  killed: z.number().default(0),
});
export type BuildAbortRes = z.infer<typeof BuildAbortResponse>;

// === JDK 预检（Phase 3.2）：点“编译”前校验本机 JDK 是否满足目标 MC 版本，不符则前端拦截 ===
export const BUILD_CHECK_JAVA = 'mod:checkJava';
export const BuildCheckJavaRequest = z.object({ mcVersion: z.string().optional() });
export const BuildCheckJavaResponse = z.object({
  java: z.number().nullable(),
  need: z.number(),
  ok: z.boolean(),
  message: z.string(),
  downloadUrl: z.string(),
});
export type BuildCheckJavaReq = z.infer<typeof BuildCheckJavaRequest>;
export type BuildCheckJavaRes = z.infer<typeof BuildCheckJavaResponse>;

export type BuildReq = z.infer<typeof BuildRequest>;
export type BuildRes = z.infer<typeof BuildResponse>;

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

// === 准备构建目录（P22-4：构建前把内存中的 files 写入临时目录，避免硬编码路径） ===
export const PREPARE_BUILD_DIR = 'mod:prepareBuildDir';

export const PrepareBuildDirRequest = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
});
export const PrepareBuildDirResponse = z.object({
  projectPath: z.string(),
  /** 预估构建步骤数（Phase 3.2：写入文件数，供前端三态进度“准备→编译”展示） */
  estimatedSteps: z.number().default(0),
});

export type PrepareBuildDirReq = z.infer<typeof PrepareBuildDirRequest>;
export type PrepareBuildDirRes = z.infer<typeof PrepareBuildDirResponse>;
