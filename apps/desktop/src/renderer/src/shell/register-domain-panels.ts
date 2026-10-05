import { registerPanel, createPanelLoader, createShellIcon, DOMAIN_PANEL_IDS } from './panels.js';
import type { PanelRegistration } from './panels.js';

/** 惰性加载器映射：panelId -> import 函数 */
const domainPanelLoaders: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> =
  {
    items: () =>
      import('../components/ItemRecipeEditor.js').then((m) => ({ default: m.ItemRecipeEditor })),
    blocks: () => import('../components/BlockEditor.js').then((m) => ({ default: m.BlockEditor })),
    entity: () =>
      import('../components/EntityAiEditor.js').then((m) => ({ default: m.EntityAiEditor })),
    audio: () => import('../components/AudioPanel.js').then((m) => ({ default: m.AudioPanel })),
    cicd: () => import('../components/CiCdPanel.js').then((m) => ({ default: m.CiCdPanel })),
    game: () =>
      import('../components/GameLauncherPanel.js').then((m) => ({ default: m.GameLauncherPanel })),
  };

/** 注册所有 domain 面板（领域编辑器） */
export function registerDomainPanels(): void {
  const panelConfigs: Omit<PanelRegistration, 'component' | 'kind'>[] = [
    {
      id: 'items',
      title: 'activityBar.items',
      icon: createShellIcon('ingot'),
      order: 10,
    },
    {
      id: 'blocks',
      title: 'activityBar.blocks',
      icon: createShellIcon('grass'),
      order: 20,
    },
    {
      id: 'entity',
      title: 'activityBar.entity',
      icon: createShellIcon('creeper'),
      order: 30,
    },
    {
      id: 'audio',
      title: 'activityBar.audio',
      icon: createShellIcon('note'),
      order: 40,
    },
    {
      id: 'cicd',
      title: 'activityBar.cicd',
      icon: createShellIcon('cmd'),
      order: 50,
    },
    {
      id: 'game',
      title: 'activityBar.game',
      icon: createShellIcon('gamepad'),
      order: 60,
    },
  ];

  for (const config of panelConfigs) {
    const loader = domainPanelLoaders[config.id];
    if (!loader) {
      console.warn(`[Domain] No loader for panel: ${config.id}`);
      continue;
    }
    registerPanel({
      ...config,
      component: createPanelLoader(loader),
      kind: 'domain',
    });
  }
}

/** 获取已注册的 domain 面板 ID 列表 */
export function getRegisteredDomainPanelIds(): string[] {
  return DOMAIN_PANEL_IDS.filter((id) => getPanel(id) !== undefined);
}

// 延迟导入避免循环
import { getPanel } from './panels.js';
import React from 'react';
