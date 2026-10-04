import {
  registerPreviewPanel,
  createPreviewPanelLoader,
  SUPPORTED_GENERATOR_TYPES,
} from './preview-registry.js';

/** 惰性加载器映射：generatorType -> import 函数 */
const previewPanelLoaders: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> = {
  server: () => import('../components/middle/ServerPreviewPanel.js').then((m) => ({ default: m.ServerPreviewPanel })),
  mod: () => import('../components/middle/ModPreviewPanel.js').then((m) => ({ default: m.ModPreviewPanel })),
  datapack: () => import('../components/middle/DatapackPreviewPanel.js').then((m) => ({ default: m.DatapackPreviewPanel })),
  modpack: () => import('../components/middle/ModpackPreviewPanel.js').then((m) => ({ default: m.ModpackPreviewPanel })),
  launcher: () => import('../components/middle/LauncherPreviewPanel.js').then((m) => ({ default: m.LauncherPreviewPanel })),
  resource_pack: () => import('../components/middle/ResourcePackPreviewPanel.js').then((m) => ({ default: m.ResourcePackPreviewPanel })),
  skin: () => import('../components/middle/SkinPreviewPanel.js').then((m) => ({ default: m.SkinPreviewPanel })),
  kubejs: () => import('../components/middle/KubejsPreviewPanel.js').then((m) => ({ default: m.KubejsPreviewPanel })),
  crafttweaker: () => import('../components/middle/CraftTweakerPreviewPanel.js').then((m) => ({ default: m.CraftTweakerPreviewPanel })),
  behavior_pack: () => import('../components/middle/BehaviorPackPreviewPanel.js').then((m) => ({ default: m.BehaviorPackPreviewPanel })),
  enchantment: () => import('../components/middle/EnchantmentPreviewPanel.js').then((m) => ({ default: m.EnchantmentPreviewPanel })),
  behavior_item: () => import('../components/middle/BehaviorItemPreviewPanel.js').then((m) => ({ default: m.BehaviorItemPreviewPanel })),
  behavior_entity: () => import('../components/middle/BehaviorEntityPreviewPanel.js').then((m) => ({ default: m.BehaviorEntityPreviewPanel })),
};

/** 注册所有预览面板 */
export function registerPreviewPanels(): void {
  for (const generatorType of SUPPORTED_GENERATOR_TYPES) {
    const loader = previewPanelLoaders[generatorType];
    if (!loader) {
      console.warn(`[Preview] No loader for generator type: ${generatorType}`);
      continue;
    }
    registerPreviewPanel({
      generatorType,
      component: createPreviewPanelLoader(loader),
      displayName: `${generatorType} preview`,
    });
  }
}

/** 获取已注册的预览面板类型列表 */
export function getRegisteredPreviewTypes(): string[] {
  return SUPPORTED_GENERATOR_TYPES.filter((t) => getPreviewPanel(t) !== undefined);
}

// 延迟导入避免循环
import { getPreviewPanel } from './preview-registry.js';
import React from 'react';