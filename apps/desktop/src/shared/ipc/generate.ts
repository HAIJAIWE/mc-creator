import { z } from 'zod';
import { LOADERS } from '@mc-creator/shared';
import { GENERATOR_TYPES } from './generator-types.js';

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
export const GenerateFilesResponse = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  warnings: z.array(z.string()),
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
        kind: z.enum(['condition', 'action', 'event']),
        type: z.string(),
        id: z.string().default(''),
        reason: z.string(),
      }),
    )
    .optional(),
});

export type GenerateSpecReq = z.infer<typeof GenerateSpecRequest>;
export type GenerateSpecRes = z.infer<typeof GenerateSpecResponse>;
export type GenerateFilesReq = z.infer<typeof GenerateFilesRequest>;
export type GenerateFilesRes = z.infer<typeof GenerateFilesResponse>;
