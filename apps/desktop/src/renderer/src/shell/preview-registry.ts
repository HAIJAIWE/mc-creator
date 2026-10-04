import { type ComponentType } from 'react';

/** 预览面板注册元数据 */
export interface PreviewPanelRegistration {
  /** 生成器类型（与 GeneratorType 一致） */
  generatorType: string;
  /** 惰性加载的预览面板组件 */
  component: () => Promise<{ default: ComponentType<unknown> }>;
  /** 显示名称（用于调试/占位） */
  displayName: string;
}

/** 预览面板注册表 */
export const previewPanelRegistry = new Map<string, PreviewPanelRegistration>();

/** 注册预览面板 */
export function registerPreviewPanel(registration: PreviewPanelRegistration): void {
  previewPanelRegistry.set(registration.generatorType, registration);
}

/** 获取预览面板组件 */
export function getPreviewPanel(generatorType: string): PreviewPanelRegistration | undefined {
  return previewPanelRegistry.get(generatorType);
}

/** 创建标准的预览面板惰性加载器 */
export function createPreviewPanelLoader<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>
): () => Promise<{ default: ComponentType<unknown> }> {
  return () => importFn() as Promise<{ default: ComponentType<unknown> }>;
}

/** 支持的生成器类型列表（用于校验/遍历） */
export const SUPPORTED_GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'resource_pack',
  'skin',
  'launcher',
  'kubejs',
  'crafttweaker',
  'behavior_pack',
  'enchantment',
  'behavior_item',
  'behavior_entity',
] as const;

export type SupportedGeneratorType = (typeof SUPPORTED_GENERATOR_TYPES)[number];