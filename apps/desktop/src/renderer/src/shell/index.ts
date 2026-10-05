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
export { registerCorePanels, getRegisteredCorePanelIds } from './register-shell-panels.js';
export { registerDomainPanels, getRegisteredDomainPanelIds } from './register-domain-panels.js';
export {
  getPanel,
  createPanelLoader,
  CORE_PANEL_IDS,
  DOMAIN_PANEL_IDS,
  MIDDLE_PANEL_IDS,
} from './panels.js';
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
