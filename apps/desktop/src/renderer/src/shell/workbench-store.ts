/**
 * 工作台导航状态 —— **当前域 + 当前激活面板**的唯一真源
 *
 * ## 为什么取代原来的 `useState` + 纠偏 effect
 *
 * 重构前 `App.tsx` 用 `useState` 持有 `activeLeftPanel`，并配一个 `useEffect` 做
 * 「域纠偏」：面板不属于当前域就弹回该域默认面板。这个模式有三个问题：
 *
 * 1. **弹回是静默的**。用户在 dev 域点活动栏的 `packages`（它归 launcher），
 *    面板被弹回 `items`，界面上不给任何解释 —— 用户只会觉得「这按钮坏了」。
 * 2. **纠偏逻辑与渲染耦合**。它靠 effect 跑在渲染之后，于是存在一帧不一致；
 *    域与面板两个状态可以短暂互相矛盾。
 * 3. **判定规则散落在 JSX 里**。哪个 UI 负责激活哪个面板，只存在于
 *    `App.tsx` 闭包中的字面量，没有任何注册表记录这件事。
 *
 * 现在把两者放进一个 store，规则变成**纯函数**：
 * - 切域 → 重置为该域默认面板（D2 决策）
 * - 激活面板 → 若该面板归属别的域，**同时把域切过去**，而不是弹回
 *
 * ## D2：切域重置面板
 *
 * 用户拍板「切域即重置」。理由与代价：
 * - 好处：状态机只有一条转移（切域 → 默认面板），不需要按域记忆面板，
 *   也不存在「回到上次看的面板但那个面板在当前语境已不合适」的歧义。
 * - 代价：域内来回切会丢失面板位置。对本项目可接受 —— 三域职责正交
 *   （§0.2），用户跨域时本就换了心智上下文。
 *
 * ## 为什么 `panelId` 允许为 null
 *
 * 存储层无法在构造时校验 `panelId`：注册表由 `initPanelRegistries()` 填充，
 * 而它在 `App.tsx` 模块体里执行 —— **晚于本模块的初始化**（ES import 先于模块体求值）。
 * 若在 store 初始值里就算 `defaultPanelOfDomain(domain)`，拿到的会是空注册表下的错误值。
 *
 * 因此约定：`panelId === null` 表示「未显式选择，按域默认面板解析」。
 * 解析发生在 `resolveActivePanel()` —— 运行期调用，注册表早已就绪。
 */
import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { resolveUiStorage } from '../store/persist-storage.js';
import {
  DEFAULT_DOMAIN_ID,
  defaultPanelOfDomain,
  domainOfPanel,
  isDomainId,
  type DomainId,
} from './domains.js';
import { getPanel } from './panels.js';

interface WorkbenchState {
  /** 当前工作域（§0.2 三域） */
  domain: DomainId;
  /** 当前激活面板；null = 未显式选择，按域默认面板解析（见文件头「为什么允许为 null」） */
  panelId: string | null;

  /** 切换工作域，并**重置**为该域默认面板（D2） */
  setDomain: (domain: DomainId) => void;
  /**
   * 激活面板。若该面板归属别的域，同时把域切过去 ——
   * 这取代了旧的「弹回默认面板」：用户点了 `packages` 就该看到 `packages`，
   * 域切换器同步移动到 launcher，如实反馈「你换了个语境」，
   * 而不是把按钮弄成看起来失灵的样子。
   */
  selectPanel: (panelId: string) => void;
}

export const useWorkbenchStore = createWithEqualityFn<WorkbenchState>()(
  persist(
    (set) => ({
      domain: DEFAULT_DOMAIN_ID,
      panelId: null,

      setDomain: (domain) => set({ domain, panelId: null }),

      selectPanel: (panelId) =>
        set((s) => ({
          panelId,
          // 跨域常驻面板（domainOfPanel 返回 null）不改变当前域
          domain: domainOfPanel(panelId) ?? s.domain,
        })),
    }),
    {
      name: 'mc-creator-workbench',
      version: 1,
      storage: resolveUiStorage(),
      partialize: (s) => ({ domain: s.domain, panelId: s.panelId }),
      merge: (persisted, current) => {
        const raw = (persisted as Partial<WorkbenchState> | undefined) ?? {};
        return {
          ...current,
          domain: isDomainId(raw.domain) ? raw.domain : current.domain,
          // panelId 不在此校验「是否已注册 / 是否属于该域」—— 注册表此刻还没初始化。
          // 失效 id 由 resolveActivePanel 在运行期兜底（见该函数注释）。
          panelId: typeof raw.panelId === 'string' ? raw.panelId : current.panelId,
        };
      },
    },
  ),
);

/**
 * 只存在于**左侧边栏**的面板：中栏永远不渲染它们。
 *
 * ## 为什么 explorer 在这里
 *
 * `explorer` 的 loader 指向 `FileTree`（注册表里与活动栏图标同名），
 * 而 `App.tsx` 的左栏**也**渲染 `FileTree`。两者叠加的后果是
 * 点 explorer 图标后屏幕上同时出现两个文件树 —— 这不是理论推演，
 * `explorer-duplication.repro.test.tsx` 用 `waitFor` 数出 `filetree-empty × 2` 实锤过。
 *
 * 更早的一次改动（`MainPanelView.test.tsx` 记录的「explorer 三份语义」）把
 * 中栏那份从 `CodePreview` 统一成了 `FileTree`，语义是统一了，
 * 但**没有处理「左栏本来就常驻文件树」** —— 于是从「三份语义冲突」
 * 变成了「两份重复渲染」。语义一致 ≠ 可以同时显示两份。
 *
 * 文件树也不能整体删掉：它是中栏唯一的目录浏览入口
 * （`MiddlePanel` 的 5 个 tab 里只有「已打开文件的 TabBar」，没有目录层级）。
 * 所以正确做法是让它**只**住在左栏，中栏一律不渲。
 *
 * 放在 `resolveActivePanel` 而不是各个 action 里，与该函数既有的定位一致：
 * 它是「该渲染哪个面板」的唯一判定点，规则只在这里加一处。
 */
const SIDEBAR_ONLY_PANEL_IDS: ReadonlySet<string> = new Set(['explorer']);

/**
 * 解析当前应渲染的面板 id。
 *
 * 这是「未注册 / 已删除 / 不属于当前域 / 属于左栏」四类失效值的**唯一兜底点**：
 * - `panelId` 为 null → 该域默认面板
 * - `panelId` 在注册表里不存在（面板被删、localStorage 里是旧版本残留）→ 该域默认面板
 * - `panelId` 存在但归属别的域（例如 localStorage 记着 `kernel`，域却是 launcher）→ 该域默认面板
 * - `panelId` 属于左栏专属面板（`explorer`）→ 该域默认面板
 *
 * 之所以不在 store 的 action 里挡住后两种情况：那样每次切域都要写一遍同样的校验，
 * 而校验规则本身会随域模型演进而变化。集中在这里只有一个地方要跟着改。
 */
export function resolveActivePanel(state: Pick<WorkbenchState, 'domain' | 'panelId'>): string {
  const fallback = defaultPanelOfDomain(state.domain);
  if (state.panelId && getPanel(state.panelId) && !SIDEBAR_ONLY_PANEL_IDS.has(state.panelId)) {
    const owner = domainOfPanel(state.panelId);
    // 跨域常驻面板（owner === null）在任何域都合法
    if (owner === null || owner === state.domain) return state.panelId;
  }
  return fallback;
}

/** 便捷选择器 */
export const selectDomain = (s: WorkbenchState) => s.domain;
export const selectPanelId = (s: WorkbenchState) => s.panelId;
export const selectSetDomain = (s: WorkbenchState) => s.setDomain;
export const selectSelectPanel = (s: WorkbenchState) => s.selectPanel;
