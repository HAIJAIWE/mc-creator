import { registerPanel, createPanelLoader, createShellIcon, createMcIcon } from './panels.js';
import type { PanelRegistration, PanelKind } from './panels.js';
import { panelRegistry } from './panels.js';

/** 惰性加载器映射：panelId -> import 函数 */
const panelLoaders: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> = {
  // Core panels (基础设施)
  explorer: () => import('../components/FileTree.js').then((m) => ({ default: m.FileTree })),
  search: () => import('../components/SearchPanel.js').then((m) => ({ default: m.SearchPanel })),
  git: () => import('../components/GitPanel.js').then((m) => ({ default: m.GitPanel })),
  packages: () => import('../components/PackagesPanel.js').then((m) => ({ default: m.PackagesPanel })),
  settings: () => import('../components/SettingsPanel.js').then((m) => ({ default: m.SettingsPanel })),
  // Domain panels (领域编辑器)
  items: () => import('../components/ItemRecipeEditor.js').then((m) => ({ default: m.ItemRecipeEditor })),
  blocks: () => import('../components/BlockEditor.js').then((m) => ({ default: m.BlockEditor })),
  entity: () => import('../components/EntityAiEditor.js').then((m) => ({ default: m.EntityAiEditor })),
  skin: () => import('../components/middle/SkinPreviewPanel.js').then((m) => ({ default: m.SkinPreviewPanel })),
  audio: () => import('../components/AudioPanel.js').then((m) => ({ default: m.AudioPanel })),
  cicd: () => import('../components/CiCdPanel.js').then((m) => ({ default: m.CiCdPanel })),
  game: () => import('../components/GameLauncherPanel.js').then((m) => ({ default: m.GameLauncherPanel })),
  // Middle panels (中部功能) - 仅保留没有独立左侧入口的
  preview: () => import('../components/middle/MiddlePanel.js').then((m) => ({ default: m.MiddlePanel })),
  resources: () => import('../components/ResourcePackPreview.js').then((m) => ({ default: m.ResourcePackPreview })),
  nbt: () => import('../components/NbtEditor.js').then((m) => ({ default: m.NbtEditor as React.ComponentType<unknown> })),
};

/** 所有面板的统一配置 */
const allPanelConfigs: Omit<PanelRegistration, 'component'>[] = [
  // 基础设施面板（始终显示）
  { id: 'explorer', title: 'activityBar.explorer', icon: createShellIcon('folder'), kind: 'core', order: 10 },
  { id: 'search', title: 'activityBar.search', icon: createShellIcon('search'), kind: 'core', order: 20 },
  { id: 'git', title: 'activityBar.git', icon: createShellIcon('git'), kind: 'core', order: 30 },
  { id: 'packages', title: 'activityBar.packages', icon: createShellIcon('chest'), kind: 'core', order: 40 },
  // 领域编辑器面板（Mod 制作相关）
  { id: 'items', title: 'activityBar.items', icon: createShellIcon('ingot'), kind: 'domain', order: 50 },
  { id: 'blocks', title: 'activityBar.blocks', icon: createShellIcon('grass'), kind: 'domain', order: 60 },
  { id: 'entity', title: 'activityBar.entity', icon: createShellIcon('creeper'), kind: 'domain', order: 70 },
  { id: 'skin', title: '皮肤', icon: createMcIcon('pixel', 'gen-skin', 20), kind: 'domain', order: 75 },
  { id: 'audio', title: 'activityBar.audio', icon: createShellIcon('note'), kind: 'domain', order: 80 },
  { id: 'cicd', title: 'activityBar.cicd', icon: createShellIcon('cmd'), kind: 'domain', order: 90 },
  { id: 'game', title: 'activityBar.game', icon: createShellIcon('gamepad'), kind: 'domain', order: 100 },
  // 中部功能面板（无独立左侧入口的）
  { id: 'preview', title: 'activityBar.preview', icon: createShellIcon('star'), kind: 'middle', order: 110 },
  { id: 'resources', title: 'activityBar.resources', icon: createShellIcon('image'), kind: 'middle', order: 120 },
  { id: 'nbt', title: 'activityBar.nbt', icon: createShellIcon('box'), kind: 'middle', order: 130 },
  // 设置（始终在底部）
  { id: 'settings', title: 'activityBar.settings', icon: createShellIcon('cog'), kind: 'core', order: 999 },
];

/** 注册所有面板 */
export function registerAllPanels(): void {
  for (const config of allPanelConfigs) {
    const loader = panelLoaders[config.id];
    if (!loader) {
      console.warn(`[PanelRegistry] No loader for panel: ${config.id}`);
      continue;
    }
    registerPanel({
      ...config,
      component: createPanelLoader(loader),
    });
  }
}

/** 获取所有已启用面板（按 group 排序，组内按 order） */
export function getAllPanels(): PanelRegistration[] {
  const groupOrder: Record<PanelKind, number> = { core: 0, domain: 1, middle: 2 };
  return Array.from(panelRegistry.values())
    .filter((p) => p.enabled !== false)
    .sort((a, b) => {
      const ga = groupOrder[a.kind] ?? 99;
      const gb = groupOrder[b.kind] ?? 99;
      if (ga !== gb) return ga - gb;
      return (a.order ?? 999) - (b.order ?? 999);
    });
}

/** 获取指定分组的面板 */
export function getPanelsByGroup(group: PanelKind): PanelRegistration[] {
  return getAllPanels().filter((p) => p.kind === group);
}

// panelRegistry 已在顶部导入（保持 import 提升，避免循环初始化问题）