import { z } from 'zod';
import type { ModSpec } from './mod-spec.js';
import { LOADERS, LoaderVersionConfig } from '../types/loader.js';

/** 文件树节点（生成产物） */
export const FileNode = z.object({
  path: z.string(), // 相对项目根
  content: z.string(),
});

/** 生成器上下文（规格 §3.3） */
export const GeneratorContext = z.object({
  loader: z.enum(LOADERS),
  mcVersion: z.string(),
  modId: z.string(),
  /**
   * S-5 修复：原为 `spec: ModSpec`（值校验），但 server/datapack/modpack 等
   * 非 mod 生成器传入的是各自 spec，GeneratorContext.parse() 会失败。
   * 改为 z.custom<ModSpec>()：运行时不再强校验（各生成器自行 parse 各自 spec），
   * 同时保留 ModSpec 类型推断供 mod 生成器直接访问 ctx.spec 字段。
   */
  spec: z.custom<ModSpec>(),
  projectPath: z.string(),
  /**
   * P2 dogfood：loader 版本配置（替换各 adapter 硬编码版本号）。
   * 由调用方根据 mcVersion 从 getLoaderVersions() 获取并传入，
   * adapter 直接使用，不再硬编码 loader/api/plugin 版本字符串。
   * 未提供时 adapter 回退到 LOADER_VERSIONS[DEFAULT_MC_VERSION]。
   */
  loaderVersions: z.custom<LoaderVersionConfig>().optional(),
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
