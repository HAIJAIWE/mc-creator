import { z } from 'zod';
import { LOADERS } from '@mc-creator/shared';
import { GENERATOR_TYPES } from './generator-types.js';
import { RagHitSchema } from './rag.js';

/** 请求/响应 schema（zod 校验，规格 §7.2 类型化 IPC） */
export const GenerateSpecRequest = z.object({
  description: z.string().min(1),
  generatorType: z.enum(GENERATOR_TYPES).default('mod'),
});
export const GenerateSpecResponse = z.object({
  ok: z.boolean(),
  spec: z.record(z.unknown()).optional(),
  raw: z.string().optional(),
  error: z.string().optional(),
  /**
   * RAG 引用来源（可选，向后兼容附加字段）。
   * 主进程在生成 Spec 前按 description 自动检索，LLM prompt 已注入同份片段；
   * UI 可用其渲染“引用来源”，注明出处、避免幻觉引用。
   */
  ragSources: z.array(RagHitSchema).optional(),
});

export const GenerateFilesRequest = z.object({
  loader: z.enum(LOADERS),
  mcVersion: z.string(),
  // spec 可能是 ModSpec/ServerSpec/SkinSpec 等，由各 Generator 内部用对应 schema.parse 校验
  spec: z.record(z.unknown()),
  modId: z.string().default(''),
  generatorType: z.enum(GENERATOR_TYPES).default('mod'),
  /**
   * 当前项目 id（可选）：主进程用它隔离增量构建缓存，并按项目落到 userData 下，
   * 使缓存跨会话可复用。空串表示「未保存项目」，共用一个 default 缓存桶。
   */
  projectId: z.string().default(''),
});

/** 大文件元数据（用于流式传输） */
export const LargeFileMeta = z.object({
  path: z.string(),
  size: z.number(),
  chunks: z.number(),
  hash: z.string(),
});

export const GenerateFilesResponse = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  warnings: z.array(z.string()),
  /**
   * 校验并填充默认值后的 spec。
   * 渲染进程不再本地跑生成器，需要主进程把它回传，供 UI 用完整 spec 回写 store。
   */
  spec: z.record(z.unknown()).optional(),
  /**
   * P1-4：增量构建统计（可选）。
   * 仅当生成器支持增量构建（如 ModGenerator）时返回，否则不存在。
   * 用于 UI 展示"本次构建命中缓存 X 个类别，重新生成 Y 个"。
   */
  buildStats: z
    .object({
      total: z.number(),
      cached: z.number(),
      regenerated: z.number(),
      filesTotal: z.number(),
      filesUnchanged: z.number(),
    })
    .optional(),
  /**
   * 未实现清单（Task 1.1，可选）。
   * 仅 Mod 生成器在产物含 `MC-Creator: unsupported(...)` 占位时返回；
   * UI 用其渲染黄色横幅 + 导出 UNIMPLEMENTED.md。
   */
  unimplemented: z
    .array(
      z.object({
        kind: z.enum(['condition', 'action', 'event', 'block']),
        type: z.string(),
        id: z.string().default(''),
        reason: z.string(),
      }),
    )
    .optional(),
  /**
   * 大文件元数据（可选）。
   * 当生成的文件中有超过 10MB 的文件时，这些文件不直接包含在 files 数组中，
   * 而是记录在此处，渲染侧需通过流式通道单独下载。
   */
  largeFiles: z.array(LargeFileMeta).optional(),
  /**
   * RAG 引用来源（可选，向后兼容附加字段）。
   * 主进程按 spec 内容自动检索（确定性生成器本身不用 LLM，但来源可供 UI 展示；
   * 同时本次检索会预热主进程 LRU，后续同 query 直接命中）。
   */
  ragSources: z.array(RagHitSchema).optional(),
});

export type GenerateSpecReq = z.infer<typeof GenerateSpecRequest>;
export type GenerateSpecRes = z.infer<typeof GenerateSpecResponse>;
export type GenerateFilesReq = z.infer<typeof GenerateFilesRequest>;
export type GenerateFilesRes = z.infer<typeof GenerateFilesResponse>;
export type LargeFileMetaT = z.infer<typeof LargeFileMeta>;
