import { registerAllPanels } from './register-all-panels.js';
import { registerPreviewPanels } from './register-preview-panels.js';

/** 初始化所有面板注册表（应用启动时调用一次） */
export function initPanelRegistries(): void {
  registerAllPanels();
  registerPreviewPanels();
  console.log('[PanelRegistry] All panels registered');
}

// 导出常用函数
export { getAllPanels, getPanelsByGroup } from './register-all-panels.js';
export { getPanel, createPanelLoader, createShellIcon, createMcIcon } from './panels.js';
export type {
  PanelRegistration,
  PanelKind,
  CorePanelId,
  DomainPanelId,
  MiddlePanelId,
  AnyPanelId,
} from './panels.js';
export {
  getPreviewPanel,
  previewPanelRegistry,
  registerPreviewPanel,
  SUPPORTED_GENERATOR_TYPES,
} from './preview-registry.js';
export {
  useLayoutStore,
  selectLeftWidth,
  selectRightWidth,
  selectMiddleTab,
  selectRightPanel,
  selectSetLeftWidth,
  selectSetRightWidth,
  selectSetMiddleTab,
  selectSetRightPanel,
} from './layout-store.js';
export { PanelHost, PanelHostList } from './PanelHost.js';
