import { create } from 'zustand';
import type { EditorMode } from '@mc-creator/shared';

/**
 * 编辑模式状态：L1 低代码 / L2 混合 / L3 纯代码
 *
 * 三种模式共享同一项目数据（ModSpec + NodeGraph + Files），
 * 切换模式不会丢失内容，仅切换 UI 表现。
 *
 * - lowcode：节点图编辑器为主，禁用 Monaco（生成代码只读预览）
 * - hybrid：节点图 + 代码节点（CodeNode 内嵌 Monaco）
 * - purecode：跳过节点图，直接 Monaco 编辑文件树
 */

interface EditorModeState {
  mode: EditorMode;
  /** 最近一次切换时间（用于触发预览刷新） */
  lastSwitchAt: number;
  setMode: (mode: EditorMode) => void;
  /** 循环切换：lowcode → hybrid → purecode → lowcode */
  cycleMode: () => void;
}

export const useEditorModeStore = create<EditorModeState>((set, get) => ({
  mode: 'lowcode',
  lastSwitchAt: Date.now(),
  setMode: (mode) => set({ mode, lastSwitchAt: Date.now() }),
  cycleMode: () => {
    const order: EditorMode[] = ['lowcode', 'hybrid', 'purecode'];
    const current = get().mode;
    const idx = order.indexOf(current);
    const next = order[(idx + 1) % order.length];
    set({ mode: next, lastSwitchAt: Date.now() });
  },
}));
