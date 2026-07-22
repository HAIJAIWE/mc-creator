import { create } from 'zustand';
import type { NodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from './node-graph-store.js';

/**
 * 抽屉状态管理（草稿模式，契约 §4）。
 *
 * 数据流：
 * - openDrawer(nodeId) → 从 node-graph-store 深拷贝 node.data 到 draft
 * - updateField(key, value) → 修改 draft，标记 dirty
 * - saveDraft() → 校验通过后写回 node-graph-store.updateNode + commit + 关闭
 * - cancelDraft() → 丢弃 draft + 关闭
 *
 * 注意：用 cancelDraft（不叫 cancelDrawer），用 updateNode（不叫 updateNodeData）。
 */
interface DrawerState {
  open: boolean;
  nodeId: string | null;
  draft: NodeData | null;
  dirty: boolean;
  errors: Record<string, string>;

  openDrawer: (nodeId: string) => void;
  closeDrawer: () => void;
  updateField: (key: string, value: unknown) => void;
  saveDraft: () => void;
  cancelDraft: () => void;
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
  open: false,
  nodeId: null,
  draft: null,
  dirty: false,
  errors: {},

  openDrawer: (nodeId) => {
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    set({
      open: true,
      nodeId,
      draft: structuredClone(node.data),
      dirty: false,
      errors: {},
    });
  },

  closeDrawer: () => {
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },

  updateField: (key, value) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: { ...draft, [key]: value } as NodeData,
      dirty: true,
    });
  },

  saveDraft: () => {
    const { nodeId, draft } = get();
    if (!nodeId || !draft) return;
    useNodeGraphStore.getState().commit();
    useNodeGraphStore.getState().updateNode(nodeId, draft);
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },

  cancelDraft: () => {
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },
}));
