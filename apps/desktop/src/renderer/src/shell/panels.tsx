import { type ComponentType } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';

/** 面板分组：core 基础设施 / domain 领域编辑器 / middle 中部功能 */
export type PanelKind = 'core' | 'domain' | 'middle';

/** 面板注册元数据 */
export interface PanelRegistration {
  /** 唯一标识，用于路由/存储 */
  id: string;
  /** 显示标题（i18n key 或直接文案） */
  title: string;
  /** 图标组件（已实例化，直接渲染） */
  icon: React.ReactNode;
  /** 惰性加载的面板组件（默认导出） */
  component: () => Promise<{ default: ComponentType<unknown> }>;
  /** 快捷键提示（可选） */
  shortcut?: string;
  /** 分组：core 基础设施 / domain 领域编辑器 / middle 中部功能 */
  kind: PanelKind;
  /** 显示顺序（数值越小越靠前） */
  order?: number;
  /** 是否启用（可按权限/环境动态控制） */
  enabled?: boolean;
}

/** 全局面板注册表 */
export const panelRegistry = new Map<string, PanelRegistration>();

/** 注册面板（幂等：同 id 后注册覆盖） */
export function registerPanel(panel: PanelRegistration): void {
  panelRegistry.set(panel.id, panel);
}

/** 获取面板注册信息 */
export function getPanel(id: string): PanelRegistration | undefined {
  return panelRegistry.get(id);
}

/** 获取所有已启用的面板（按 group 排序，组内按 order） */
export function getAllPanels(): PanelRegistration[] {
  const groupOrder = { core: 0, domain: 1, middle: 2 };
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

/** 获取所有已启用的 shell 面板（按 order 排序） - 兼容旧代码 */
export function getShellPanels(): PanelRegistration[] {
  return getPanelsByGroup('core');
}

/** 获取所有已启用的 domain 面板（按 order 排序） - 兼容旧代码 */
export function getDomainPanels(): PanelRegistration[] {
  return getPanelsByGroup('domain');
}

/** 预定义的 core 面板 ID（基础设施） */
export const CORE_PANEL_IDS = [
  'explorer',
  'search',
  'git',
  'packages',
  'settings',
] as const;

/** 预定义的 domain 面板 ID（领域编辑器） */
export const DOMAIN_PANEL_IDS = [
  'items',
  'blocks',
  'entity',
  'audio',
  'cicd',
  'game',
] as const;

/** 预定义的 middle 面板 ID（中部功能） */
export const MIDDLE_PANEL_IDS = [
  'preview',
  'lowcode',
  'purecode',
  'code',
] as const;

/** 类型别名 */
export type CorePanelId = (typeof CORE_PANEL_IDS)[number];
export type DomainPanelId = (typeof DOMAIN_PANEL_IDS)[number];
export type MiddlePanelId = (typeof MIDDLE_PANEL_IDS)[number];
export type AnyPanelId = CorePanelId | DomainPanelId | MiddlePanelId;

/** 创建标准的惰性加载器（统一 Suspense fallback 行为） */
export function createPanelLoader<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>
): () => Promise<{ default: ComponentType<unknown> }> {
  return () => importFn() as Promise<{ default: ComponentType<unknown> }>;
}

/** Shell 面板图标工厂（统一像素风 20px） */
export function createShellIcon(name: string): React.ReactNode {
  return <McIcon scope="pixel" name={`atb-${name}`} size={20} />;
}

/** 通用 McIcon 工厂（供 .ts 注册文件使用，避免在 .ts 里写 JSX 或顶层 React.createElement） */
export function createMcIcon(scope: 'pixel' | 'game' | 'mob', name: string, size = 20): React.ReactNode {
  return <McIcon scope={scope} name={name} size={size} />;
}