import { type ComponentType } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';

/**
 * 面板分组：core 基础设施 / domain 领域编辑器 / middle 中部功能
 *
 * ## 为什么这里没有 §0.2 的三个新分组（launcher / server / dev）
 *
 * F1 需求写着「PanelKind 扩展：加 'launcher' | 'server' | 'dev'，保留旧三个」。实测后**不能**这么做：
 * `register-all-panels.ts`（不在本任务允许改动的文件清单内）里另有一份同名 `getAllPanels()`，
 * 它把分组顺序写死成 `const groupOrder: Record<PanelKind, number> = { core: 0, domain: 1, middle: 2 }`。
 * PanelKind 只要多出任何一个字面量，这一行就因「缺键」编译失败（tsc 原文，已实跑复现）：
 *
 *   src/renderer/src/shell/register-all-panels.ts(177,9): error TS2739:
 *     Type '{ core: number; domain: number; middle: number; }' is missing the following
 *     properties from type 'Record<PanelKind, number>': launcher, server, dev
 *
 * 「不许改 register-all-panels.ts」与「typecheck 必须绿」只能保一个，这里选**保 typecheck 绿 + 零越界改动**：
 * - 域（launcher/server/dev）的**词表与归属真源**放在 `shell/domains.ts` 的 `DomainId`，导航层 /
 *   store / 面板归属判定一律只认它 —— 这正是需求 2 后半句「domains.ts 的归属表是唯一真源，
 *   不要把域信息再塞回 PanelKind 里搞两套」；
 * - 本文件的 `groupOrder` 已放宽为 `Partial<Record<PanelKind, number>>`（见 getAllPanels），
 *   读取仍走 `?? 99` 兜底，所以将来并入新字面量时不会崩、只会落到默认排序（与需求
 *   「用 ?? 99 这种兜底，别让它崩」一致），且不改动任何现有面板的排序结果。
 */
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
  // 刻意声明为 Partial：这样以后往 PanelKind 里加新分组（含 §0.2 的 launcher/server/dev）时，
  // 这里无需改类型就能编译，未登记的 kind 由下方 ?? 99 兜底（见文件头「为什么这里没有三个新分组」）。
  const groupOrder: Partial<Record<PanelKind, number>> = { core: 0, domain: 1, middle: 2 };
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
export const CORE_PANEL_IDS = ['explorer', 'search', 'git', 'packages', 'settings'] as const;

/** 预定义的 domain 面板 ID（领域编辑器） */
export const DOMAIN_PANEL_IDS = ['items', 'blocks', 'entity', 'audio', 'cicd', 'game'] as const;

/** 预定义的 middle 面板 ID（中部功能） */
export const MIDDLE_PANEL_IDS = ['preview', 'lowcode', 'purecode', 'code'] as const;

/** 类型别名 */
export type CorePanelId = (typeof CORE_PANEL_IDS)[number];
export type DomainPanelId = (typeof DOMAIN_PANEL_IDS)[number];
export type MiddlePanelId = (typeof MIDDLE_PANEL_IDS)[number];
export type AnyPanelId = CorePanelId | DomainPanelId | MiddlePanelId;

/** 创建标准的惰性加载器（统一 Suspense fallback 行为） */
export function createPanelLoader<T extends ComponentType<unknown>>(
  importFn: () => Promise<{ default: T }>,
): () => Promise<{ default: ComponentType<unknown> }> {
  return () => importFn() as Promise<{ default: ComponentType<unknown> }>;
}

/** Shell 面板图标工厂（统一像素风 20px） */
export function createShellIcon(name: string): React.ReactNode {
  return <McIcon scope="pixel" name={`atb-${name}`} size={20} />;
}

/** 通用 McIcon 工厂（供 .ts 注册文件使用，避免在 .ts 里写 JSX 或顶层 React.createElement） */
export function createMcIcon(
  scope: 'pixel' | 'game' | 'mob',
  name: string,
  size = 20,
): React.ReactNode {
  return <McIcon scope={scope} name={name} size={size} />;
}
