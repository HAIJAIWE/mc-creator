import { type ComponentType } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
// 类型单向导入（编译期擦除，无运行时循环依赖）：domains.ts 在运行时会 import
// 本文件的 getAllPanels() 来派生域面板列表，所以这里只能用 import type 回指 DomainId。
import type { DomainId } from './domains.js';

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
  /**
   * §0.2 域归属（launcher / server / dev）。
   *
   * 跨域常驻的基础设施面板（explorer/search/git/settings）填 `null`；
   * 业务面板必须显式填一个域 —— `domains.ts` 据此派生各域的 tab 列表，
   * 新增面板漏填会被 `domains.test.ts` 的完整性断言当场拦下。
   *
   * 刻意与 `kind` 正交：`packages` 是 core（活动栏基础设施）但归 launcher，
   * `preview` 是 middle 但归 dev。详见 domains.ts 文件头「面板为什么这么归」。
   */
  domain?: DomainId | null;
  /**
   * **域内**顺序（数值越小越靠前），决定该面板在本域 tab 条里的位置。
   *
   * 为什么不能直接用 `order`：`order` 是跨组的全局排序键，而 `getAllPanels()` 按
   * `(kind, order)` 排。server 域里 kernel 是 middle/order=140，resources 是
   * middle/order=120 —— 用 `order` 排出来 kernel 落在**最后**，可它正是该域的
   * 默认面板。用户切进 server 域看到的第一眼不该是资源包而不是链路自检屏。
   *
   * 省略时回落到 `order`，再省略则 999（保持向后兼容，但域内 tab 顺序需显式声明）。
   */
  domainOrder?: number;
  /**
   * 该面板是否需要左侧文件树可见。
   *
   * ## 判据（不是「这个面板要不要用到 files」）
   *
   * 严格按「**点文件树里的一个文件，对这个面板有没有意义**」来判：
   *
   * - 消费 `selectedFile`（点开即编辑/预览该文件）→ `true`
   * - 只 `files.find(...)` 读某个特定文件、或把全部 files 打包 → 不算，
   *   用户不需要「浏览目录层级」，树在那儿只是个 200px 的展示位
   *
   * 核查结论（全仓 `selectFile(` 的生产调用点只有 3 处）：
   *
   * | 面板 | 判据 | needsFileTree |
   * | --- | --- | --- |
   * | `preview`（代码编辑） | `PurecodeWorkspace` 消费 `selectedFile` | ✅ |
   * | `nbt` | `NbtPanelWithStore` 消费 `selectedFile` | ✅ |
   * | `resources` | `selectedFile`×6 | ✅ |
   * | `skin` | 读 files 生成资源包，产物要能看到 | ✅ |
   * | `build` | 读 files 打包，产物要能看到 | ✅ |
   * | `game`（游戏启动器） | 只找一个 `.jar` 路径 | ❌ |
   * | `packages`（包管理） | 只用 loader/版本/spec 做版本匹配 | ❌ |
   * | `kernel`（内核自检） | 完全不碰项目文件 | ❌ |
   *
   * ## 为什么默认 false
   *
   * 宁可漏显示（用户可手动展开）也不默认占位 —— 若默认 `true`，
   * 游戏启动器、包管理、内核自检都会白白占掉 200px，
   * 而这正是用户反馈的「启动器那边为什么还要这个」。
   */
  needsFileTree?: boolean;
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

/** 类型别名 —— 直接用字面量联合，不再依赖数组（避免维护两份名单） */
export type CorePanelId = 'explorer' | 'search' | 'git' | 'packages' | 'settings';
export type DomainPanelId =
  'items' | 'blocks' | 'entity' | 'skin' | 'audio' | 'build' | 'cicd' | 'game';
export type MiddlePanelId = 'preview' | 'resources' | 'nbt' | 'kernel';
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
