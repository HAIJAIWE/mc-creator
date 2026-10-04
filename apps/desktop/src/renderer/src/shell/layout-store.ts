import { createWithEqualityFn } from 'zustand/traditional';
import { persist } from 'zustand/middleware';
import { resolveUiStorage } from '../store/persist-storage.js';

/** 布局状态：仅持久化 UI 几何信息，不持久化业务数据 */
interface LayoutState {
  /** 左侧边栏宽度 (px) */
  leftWidth: number;
  /** 右侧边栏宽度 (px) */
  rightWidth: number;
  /** 中部编辑器当前激活的标签 */
  middleTab: string;
  /** 右侧面板当前激活的面板 */
  rightPanel: string;

  setLeftWidth: (w: number) => void;
  setRightWidth: (w: number) => void;
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
      middleTab: 'preview',
      rightPanel: 'agent',

      setLeftWidth: (w) =>
        set({ leftWidth: Math.max(MIN_LEFT_WIDTH, Math.min(MAX_LEFT_WIDTH, w)) }),
      setRightWidth: (w) =>
        set({ rightWidth: Math.max(MIN_RIGHT_WIDTH, Math.min(MAX_RIGHT_WIDTH, w)) }),
      setMiddleTab: (tab) => set({ middleTab: tab }),
      setRightPanel: (panel) => set({ rightPanel: panel }),
      reset: () =>
        set({
          leftWidth: DEFAULT_LEFT_WIDTH,
          rightWidth: DEFAULT_RIGHT_WIDTH,
          middleTab: 'preview',
          rightPanel: 'agent',
        }),
    }),
    {
      name: 'mc-creator-layout',
      version: 1,
      storage: resolveUiStorage(),
      partialize: (s) => ({
        leftWidth: s.leftWidth,
        rightWidth: s.rightWidth,
        middleTab: s.middleTab,
        rightPanel: s.rightPanel,
      }),
    },
  ),
);

/** 便捷选择器 */
export const selectLeftWidth = (s: LayoutState) => s.leftWidth;
export const selectRightWidth = (s: LayoutState) => s.rightWidth;
export const selectMiddleTab = (s: LayoutState) => s.middleTab;
export const selectRightPanel = (s: LayoutState) => s.rightPanel;
export const selectSetLeftWidth = (s: LayoutState) => s.setLeftWidth;
export const selectSetRightWidth = (s: LayoutState) => s.setRightWidth;
export const selectSetMiddleTab = (s: LayoutState) => s.setMiddleTab;
export const selectSetRightPanel = (s: LayoutState) => s.setRightPanel;