import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { resolveUiStorage } from '../store/persist-storage.js';

/** 布局状态：仅持久化 UI 几何信息，不持久化业务数据 */
interface LayoutState {
  /** 左侧边栏宽度 (px) */
  leftWidth: number;
  /** 右侧边栏宽度 (px) */
  rightWidth: number;
  /**
   * 左侧边栏是否折叠。`null` = 跟随当前面板自动决定（见 App.tsx 的 useFileTreeVisibility）。
   *
   * ## 为什么是三态而不是 boolean
   *
   * 只有 boolean 时，「自动跟随面板」和「用户手动锁死」无法共存 ——
   * 每次切面板都会把用户刚展开的文件树无声收掉，
   * 「我明明打开了」和「它自己关了」用户分不清。
   * `null` 表示「还没锁」，true/false 表示「用户锁成这个状态」。
   *
   * 自动判据来自面板注册的 `needsFileTree`：文件树真正的作用是给代码编辑器挑文件
   * （全仓 `selectFile(` 生产调用点只有 PurecodeWorkspace / Breadcrumb / SearchPanel），
   * 而游戏启动器、包管理、内核自检并不需要它。
   */
  leftCollapsed: boolean | null;
  /** 中部编辑器当前激活的标签 */
  middleTab: string;
  /** 右侧面板当前激活的面板 */
  rightPanel: string;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
  /** 见 `leftCollapsed`：null=跟随面板自动，显式 true/false=用户锁定 */
  setLeftCollapsed: (v: boolean | null) => void;
  setMiddleTab: (tab: string) => void;
  setRightPanel: (panel: string) => void;
  /** 重置为默认值 */
  reset: () => void;
}

const DEFAULT_LEFT_WIDTH = 200;
const DEFAULT_RIGHT_WIDTH = 360;
const MIN_LEFT_WIDTH = 120;
const MAX_LEFT_WIDTH = 480;
const MIN_RIGHT_WIDTH = 200;
const MAX_RIGHT_WIDTH = 600;

export const useLayoutStore = createWithEqualityFn<LayoutState>()(
  persist(
    (set) => ({
      leftWidth: DEFAULT_LEFT_WIDTH,
      rightWidth: DEFAULT_RIGHT_WIDTH,
      leftCollapsed: null,
      middleTab: 'preview',
      rightPanel: 'agent',

      setLeftWidth: (w) =>
        set({ leftWidth: Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, w)) }),
      setRightWidth: (w) =>
        set({ rightWidth: Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, w)) }),
      setLeftCollapsed: (v) => set({ leftCollapsed: v }),
      setMiddleTab: (tab) => set({ middleTab: tab }),
      setRightPanel: (panel) => set({ rightPanel: panel }),
      reset: () =>
        set({
          leftWidth: DEFAULT_LEFT_WIDTH,
          rightWidth: DEFAULT_RIGHT_WIDTH,
          leftCollapsed: null,
          middleTab: 'preview',
          rightPanel: 'agent',
        }),
    }),
    {
      name: 'mc-creator-layout',
      // 版本 +1：新增 leftCollapsed。老版本 localStorage 里没有这个键，
      // zustand persist 会用 initial state 补上 false，不需要写 migrate。
      version: 2,
      storage: resolveUiStorage(),
      partialize: (s) => ({
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        leftCollapsed: s.leftCollapsed,
        middleTab: s.middleTab,
        rightPanel: s.rightPanel,
      }),
    },
  ),
);

/** 便捷选择器 */
export const selectLeftWidth = (s: LayoutState) => s.leftWidth;
export const selectRightWidth = (s: LayoutState) => s.rightWidth;
export const selectLeftCollapsed = (s: LayoutState) => s.leftCollapsed;
export const selectMiddleTab = (s: LayoutState) => s.middleTab;
export const selectRightPanel = (s: LayoutState) => s.rightPanel;
export const selectSetLeftWidth = (s: LayoutState) => s.setLeftWidth;
export const selectSetRightWidth = (s: LayoutState) => s.setRightWidth;
export const selectSetLeftCollapsed = (s: LayoutState) => s.setLeftCollapsed;
export const selectSetMiddleTab = (s: LayoutState) => s.setMiddleTab;
export const selectSetRightPanel = (s: LayoutState) => s.setRightPanel;
