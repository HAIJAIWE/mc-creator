import { z } from 'zod';
import { ModSpec } from './mod-spec.js';

/** 文件树节点（生成产物） */
export const FileNode = z.object({
  path: z.string(),       // 相对项目根
  content: z.string(),
});

/** 生成器上下文（规格 §3.3） */
export const GeneratorContext = z.object({
  loader: z.enum(['fabric', 'neoforge', 'quilt']),
  mcVersion: z.string(),
  modId: z.string(),
  spec: ModSpec,
  projectPath: z.string(),
});

/** 生成结果 */
export const GenerationResult = z.object({
  files: z.array(FileNode),
  warnings: z.array(z.string()).default([]),
  buildCmd: z.string().default('./gradlew build'),
});

export type FileNode = z.infer<typeof FileNode>;
export type GeneratorContext = z.infer<typeof GeneratorContext>;
export type GenerationResult = z.infer<typeof GenerationResult>;
