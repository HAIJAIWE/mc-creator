import { registerPanel, createPanelLoader, createShellIcon, createMcIcon } from './panels.js';
import type { PanelRegistration, PanelKind } from './panels.js';
import { panelRegistry } from './panels.js';
import { withMonacoSetup } from '../lib/lazy-monaco.js';

/** 惰性加载器映射：panelId -> import 函数 */
const panelLoaders: Record<string, () => Promise<{ default: React.ComponentType<unknown> }>> = {
  // Core panels (基础设施)
  explorer: () => import('../components/FileTree.js').then((m) => ({ default: m.FileTree })),
  search: () => import('../components/SearchPanel.js').then((m) => ({ default: m.SearchPanel })),
  git: () => import('../components/GitPanel.js').then((m) => ({ default: m.GitPanel })),
  packages: () =>
    import('../components/PackagesPanel.js').then((m) => ({ default: m.PackagesPanel })),
  settings: () =>
    import('../components/SettingsPanel.js').then((m) => ({ default: m.SettingsPanel })),
  // Domain panels (领域编辑器)
  items: () =>
    import('../components/dev/ItemRecipeEditor.js').then((m) => ({ default: m.ItemRecipeEditor })),
  blocks: () =>
    import('../components/dev/BlockEditor.js').then((m) => ({ default: m.BlockEditor })),
  entity: () =>
    import('../components/dev/EntityAiEditor.js').then((m) => ({ default: m.EntityAiEditor })),
  skin: () =>
    import('../components/middle/SkinPreviewPanel.js').then((m) => ({
      default: m.SkinPreviewPanel,
    })),
  audio: () => import('../components/AudioPanel.js').then((m) => ({ default: m.AudioPanel })),
  cicd: () => import('../components/dev/CiCdPanel.js').then((m) => ({ default: m.CiCdPanel })),
  // 本地构建 + 部署 + 启动。与 cicd 的区别：cicd 生成远程流水线 YAML（GitHub/GitLab/Jenkins），
  // build 真正调用 BUILD_STREAM 在本机 gradle 出 .jar 并装进 mods。
  build: () => import('../components/dev/BuildPanel.js').then((m) => ({ default: m.BuildPanel })),
  game: () =>
    import('../components/launcher/GameLauncherPanel.js').then((m) => ({
      default: m.GameLauncherPanel,
    })),
  // Middle panels (中部功能) - 仅保留没有独立左侧入口的
  // preview → MiddlePanel 的静态依赖里带 <Editor>，加载前必须先完成 Monaco 本地化配置。
  // （PanelHost 走的是这条注册表路径，与 MainPanelView 里的 lazy 是两条独立入口，
  //   两边都要 gate，否则先打开工作台的用户会拿到没配置的 loader.init()。）
  preview: withMonacoSetup(() =>
    import('../components/middle/MiddlePanel.js').then((m) => ({ default: m.MiddlePanel })),
  ),
  resources: () =>
    import('../components/ResourcePackPreview.js').then((m) => ({
      default: m.ResourcePackPreview,
    })),
  nbt: () =>
    import('../components/NbtEditor.js').then((m) => ({
      default: m.NbtEditor as React.ComponentType<unknown>,
    })),
  // 内核面板（§18 阶段 10）：只读链路验证屏。放在 middle 分组 —— 它既不是领域编辑器，
  // 也不是左侧活动栏里的基础设施项，与 preview/resources/nbt 同级。
  kernel: () => import('../components/KernelPanel.js').then((m) => ({ default: m.KernelPanel })),
};

/** 所有面板的统一配置 */
const allPanelConfigs: Omit<PanelRegistration, 'component'>[] = [
  // 基础设施面板（始终显示）
  {
    id: 'explorer',
    title: 'activityBar.explorer',
    icon: createShellIcon('folder'),
    kind: 'core',
    // 跨域常驻（null）：文件基础设施三域都要用，不参与切域判定
    domain: null,
    order: 10,
  },
  {
    id: 'search',
    title: 'activityBar.search',
    icon: createShellIcon('search'),
    kind: 'core',
    domain: null,
    order: 20,
  },
  {
    id: 'git',
    title: 'activityBar.git',
    icon: createShellIcon('git'),
    kind: 'core',
    domain: null,
    order: 30,
  },
  {
    // kind 是 core（活动栏基础设施入口），但归属是 launcher —— 归属与 PanelKind 正交
    id: 'packages',
    title: 'activityBar.packages',
    icon: createShellIcon('chest'),
    kind: 'core',
    domain: 'launcher',
    domainOrder: 20,
    order: 40,
  },
  // 领域编辑器面板（Mod 制作相关）
  {
    id: 'items',
    title: 'activityBar.items',
    icon: createShellIcon('ingot'),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 10,
    order: 50,
  },
  {
    id: 'blocks',
    title: 'activityBar.blocks',
    icon: createShellIcon('grass'),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 20,
    order: 60,
  },
  {
    id: 'entity',
    title: 'activityBar.entity',
    icon: createShellIcon('creeper'),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 30,
    order: 70,
  },
  {
    // skin 归 launcher（实例外观）而非 dev：它的操作对象是「要被跑起来的实例」
    id: 'skin',
    title: 'generator.skin.label',
    icon: createMcIcon('pixel', 'gen-skin', 20),
    kind: 'domain',
    domain: 'launcher',
    domainOrder: 30,
    order: 75,
    // 读 files 生成资源包，生成产物要能在树里看到
    needsFileTree: true,
  },
  {
    id: 'audio',
    title: 'activityBar.audio',
    icon: createShellIcon('note'),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 40,
    order: 80,
  },
  {
    id: 'cicd',
    title: 'activityBar.cicd',
    icon: createShellIcon('cmd'),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 60,
    order: 90,
  },
  // 构建与部署：本地编译产物 → 装进 mods → 启动游戏。
  // 归 dev 域（产出内容本身的一环），order 紧随 cicd 之后。
  {
    id: 'build',
    title: 'activityBar.build',
    icon: createMcIcon('pixel', 'anvil', 20),
    kind: 'domain',
    domain: 'dev',
    domainOrder: 50,
    order: 95,
    // 读 files 打包，产物要能在树里看到
    needsFileTree: true,
  },
  {
    id: 'game',
    title: 'activityBar.game',
    icon: createShellIcon('gamepad'),
    kind: 'domain',
    domain: 'launcher',
    domainOrder: 10,
    order: 100,
  },
  // 中部功能面板（无独立左侧入口的）
  {
    // kind 是 middle，但归属 dev —— 它预览的是内容产物
    id: 'preview',
    title: 'activityBar.preview',
    icon: createShellIcon('star'),
    kind: 'middle',
    domain: 'dev',
    domainOrder: 70,
    order: 110,
    // 文件树的主要消费者：其「代码」tab 的 PurecodeWorkspace 靠点树打开文件
    needsFileTree: true,
  },
  {
    id: 'resources',
    title: 'activityBar.resources',
    icon: createShellIcon('image'),
    kind: 'middle',
    domain: 'server',
    domainOrder: 20,
    order: 120,
    // selectedFile×6 —— 点树切资源包内的文件
    needsFileTree: true,
  },
  {
    id: 'nbt',
    title: 'activityBar.nbt',
    icon: createShellIcon('box'),
    kind: 'middle',
    domain: 'server',
    domainOrder: 30,
    order: 130,
    // NbtPanelWithStore 消费 selectedFile —— 点树选 NBT 文件来编辑
    needsFileTree: true,
  },
  // 内核（§10 只读链路）。刻意不占左侧活动栏：它目前是「链路通了没」的验证屏，
  // 不是日常高频入口；等 W/X 门控 UI 落地后再考虑提级。
  {
    id: 'kernel',
    title: '内核',
    icon: createMcIcon('pixel', 'gen-skin', 20),
    kind: 'middle',
    domain: 'server',
    domainOrder: 10,
    order: 140,
  },
  // 设置（始终在底部）
  {
    id: 'settings',
    title: 'activityBar.settings',
    icon: createShellIcon('cog'),
    kind: 'core',
    domain: null,
    order: 999,
  },
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
