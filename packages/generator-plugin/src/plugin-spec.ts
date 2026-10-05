/**
 * Paper 插件规格（设计文档 §7.3 插件开发 / §12 PluginProject 数据模型）。
 *
 * PluginProject { id, name, target: 'paper'|'folia'|'spigot', apiVersion, foliaSupported, files[] }
 * 本包的 PluginSpec 即其"生成输入"形态：files[] 由 generatePlugin(spec) 产出。
 */
import { z } from 'zod';

/** 插件运行目标（§7.2 服务端运行时矩阵：Paper / Folia / Spigot）。 */
export const PluginTarget = z.enum(['paper', 'folia', 'spigot']);
export type PluginTarget = z.infer<typeof PluginTarget>;

/** 插件命令声明（写入两份清单的 commands 节）。 */
export const PluginCommandSpec = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  usage: z.string().default(''),
  permission: z.string().default(''),
});
export type PluginCommandSpec = z.infer<typeof PluginCommandSpec>;

/** 插件权限声明（写入两份清单的 permissions 节）。 */
export const PluginPermissionSpec = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  default: z.enum(['op', 'not-op', 'true', 'false']).default('op'),
});
export type PluginPermissionSpec = z.infer<typeof PluginPermissionSpec>;

export const PluginSpecSchema = z.object({
  /** 插件展示名（写入清单 name）。 */
  name: z.string().min(1),
  /** 插件 id（目录/产物命名用，字母数字 + - _）。 */
  pluginId: z.string().regex(/^[A-Za-z0-9_-]+$/, 'pluginId 仅允许字母、数字、-、_'),
  /** 插件自身版本（写入清单 version）。 */
  version: z.string().min(1),
  description: z.string().default(''),
  author: z.string().default(''),
  /**
   * Paper api-version（§7.3：会出现 '26.1.2' 这类新版本号）。
   * 必填且无默认值——调用方必须在运行时从 PaperMC 官方源拉取当前值后传入
   * （§0.5#3：版本号一律运行时拉取，禁止模型凭记忆输出）。
   */
  apiVersion: z.string().min(1),
  /** 运行目标：paper | folia | spigot。 */
  target: PluginTarget,
  /**
   * 是否声明 Folia 支持（§7.3 硬开关：不声明则无法在 Folia 上运行）。
   * 仅 paper 目标下透传；folia 目标强制 true，spigot 目标强制 false
   * （见 resolveFoliaSupported）。
   */
  foliaSupported: z.boolean().default(false),
  commands: z.array(PluginCommandSpec).default([]),
  permissions: z.array(PluginPermissionSpec).default([]),
  /** 主类简单名（如 MyPlugin），须大写字母开头。 */
  mainClass: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'mainClass 须为合法 Java 类名（大写开头）'),
  /** Java 包名（如 com.example.myplugin）。 */
  namespace: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, 'namespace 须为合法 Java 包名（含至少一个 .）'),
});

export type PluginSpec = z.infer<typeof PluginSpecSchema>;

/**
 * apiVersion 格式占位（§0.5）。
 * 注意：此值仅为"格式占位"（如 '1.21'），供本地单测/手工试填；
 * 真实调用方必须在运行时拉取当前 api-version 覆盖它，
 * 禁止把占位值当作"最新版"发布（见 §7.3 api-version 如 26.1.2）。
 */
export const API_VERSION_PLACEHOLDER = '1.21';
