import { registerPanel, createPanelLoader, createShellIcon, CORE_PANEL_IDS } from './panels.js';
import type { PanelRegistration } from './panels.js';
import { getPanel } from './panels.js';

/** 惰性加载器映射：panelId -> import 函数 */
const shellPanelLoaders: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> = {
  explorer: () => import('../components/FileTree.js').then((m) => ({ default: m.FileTree })),
  search: () => import('../components/SearchPanel.js').then((m) => ({ default: m.SearchPanel })),
  git: () => import('../components/GitPanel.js').then((m) => ({ default: m.GitPanel })),
  packages: () => import('../components/PackagesPanel.js').then((m) => ({ default: m.PackagesPanel })),
  settings: () =>
    import('../components/SettingsPanel.js').then((m) => ({ default: m.SettingsPanel })),
};

/** 注册所有 core 面板（基础设施） */
export function registerCorePanels(): void {
  const panelConfigs: Omit<PanelRegistration, 'component' | 'kind'>[] = [
    {
      id: 'explorer',
      title: 'activityBar.explorer',
      icon: createShellIcon('folder'),
      shortcut: 'Ctrl+Shift+E',
      order: 10,
    },
    {
      id: 'search',
      title: 'activityBar.search',
      icon: createShellIcon('search'),
      shortcut: 'Ctrl+Shift+F',
      order: 20,
    },
    {
      id: 'git',
      title: 'activityBar.git',
      icon: createShellIcon('git'),
      shortcut: 'Ctrl+Shift+G',
      order: 30,
    },
    {
      id: 'packages',
      title: 'activityBar.packages',
      icon: createShellIcon('chest'),
      shortcut: 'Ctrl+Shift+P',
      order: 40,
    },
    {
      id: 'settings',
      title: 'activityBar.settings',
      icon: createShellIcon('cog'),
      shortcut: 'Ctrl+,',
      order: 999, // 始终在底部
    },
  ];

  for (const config of panelConfigs) {
    const loader = shellPanelLoaders[config.id];
    if (!loader) {
      console.warn(`[Core] No loader for panel: ${config.id}`);
      continue;
    }
    registerPanel({
      ...config,
      component: createPanelLoader(loader),
      kind: 'core',
    });
  }
}

/** 获取已注册的 core 面板 ID 列表（用于测试/校验） */
export function getRegisteredCorePanelIds(): string[] {
  return CORE_PANEL_IDS.filter((id) => getPanel(id) !== undefined);
}