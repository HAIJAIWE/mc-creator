import { z } from 'zod';

// === 沙箱化 Mustache 渲染（P0 安全：防止自定义节点模板注入）===
export const SANDBOXED_MUSTACHE_RENDER = 'sandboxed:mustacheRender';

export const SandboxedMustacheRenderRequest = z.object({
  template: z.string().max(50000),
  fields: z.record(z.unknown()).refine((val) => Object.keys(val).length <= 100, {
    message: 'fields 字段数超限（最大 100 个）',
  }),
});
export const SandboxedMustacheRenderResponse = z.object({
  ok: z.boolean(),
  result: z.string().optional(),
  error: z.string().optional(),
});
export type SandboxedMustacheRenderRequest = z.infer<typeof SandboxedMustacheRenderRequest>;
export type SandboxedMustacheRenderResponse = z.infer<typeof SandboxedMustacheRenderResponse>;
