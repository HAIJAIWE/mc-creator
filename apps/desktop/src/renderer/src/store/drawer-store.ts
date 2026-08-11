import { createWithEqualityFn } from 'zustand/traditional';
import type { NodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from './node-graph-store.js';
import { getFieldSchemas } from '../components/lowcode/nodes/drawer/fieldSchemas.js';

/**
 * 抽屉状态管理（草稿模式，契约 §4）。
 *
 * 数据流：
 * - openDrawer(nodeId) → 从 node-graph-store 深拷贝 node.data 到 draft
 * - updateField(key, value) → 修改 draft，标记 dirty
 * - saveDraft() → 校验通过后写回 node-graph-store.updateNode + commit + 关闭
 * - cancelDraft() → 丢弃 draft + 关闭
 *
 * P0 dogfood 修复：saveDraft 增加字段级校验，有错误时拒绝保存并更新 errors。
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
  saveDraft: () => boolean;
  cancelDraft: () => void;
}

/**
 * 字段级校验：与 NodeDetailForm.validateField 逻辑一致。
 * 返回错误 map，无错误返回空对象。
 */
function validateDraft(draft: NodeData): Record<string, string> {
  const fields = getFieldSchemas(draft.kind);
  const errors: Record<string, string> = {};
  for (const f of fields) {
    // 排除 excludeKinds 中排除的字段
    if (f.excludeKinds?.includes(draft.kind)) continue;
    // 检查 condition
    if (f.condition) {
      const fieldValue = (draft as Record<string, unknown>)[f.condition.field];
      const comparableValue = typeof fieldValue === 'boolean' ? String(fieldValue) : fieldValue;
      if (f.condition.equals !== undefined && comparableValue !== f.condition.equals) continue;
      if (f.condition.in !== undefined && !f.condition.in.includes(String(comparableValue)))
        continue;
    }
    const v = (draft as Record<string, unknown>)[f.key];
    if (f.required && (v === undefined || v === null || v === '')) {
      errors[f.key] = `${f.label}为必填项`;
      continue;
    }
    if (f.type === 'number' && typeof v === 'number') {
      if (f.min !== undefined && v < f.min) errors[f.key] = `值 ${v} 小于最小值 ${f.min}`;
      if (f.max !== undefined && v > f.max) errors[f.key] = `值 ${v} 大于最大值 ${f.max}`;
    }
    if (f.type === 'resourceId' && typeof v === 'string' && v.length > 0) {
      if (!/^[a-z0-9_]+:[a-z0-9_/]+$/.test(v)) errors[f.key] = `格式错误，应为 modid:path`;
    }
    if (f.pattern && typeof v === 'string' && v.length > 0) {
      if (!new RegExp(f.pattern).test(v))
        errors[f.key] = f.patternMessage ?? `格式不匹配：${f.pattern}`;
    }
  }
  return errors;
}

export const useDrawerStore = createWithEqualityFn<DrawerState>((set, get) => ({
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
    let next = { ...draft, [key]: value } as NodeData;
    // U-3 修复：variable 节点切换 varType 时同步转换 value 类型，
    // 避免旧类型的脏值（数字/布尔/字符串）在新类型编辑器下显示错误
    if (draft.kind === 'variable' && key === 'varType') {
      const old = (draft as Record<string, unknown>).value;
      let v: unknown;
      switch (String(value)) {
        case 'boolean':
          v = old === true || old === 'true' || old === 1;
          break;
        case 'int':
          v = typeof old === 'number' ? Math.trunc(old) : Number(old) || 0;
          break;
        case 'double':
          v = typeof old === 'number' ? old : Number(old) || 0;
          break;
        case 'item':
        case 'block':
        case 'string':
        default:
          v = old === undefined || old === null ? '' : String(old);
          break;
      }
      next = { ...next, value: v } as NodeData;
    }
    set({
      draft: next,
      dirty: true,
      // Minor 修复：清除 storeErrors，让 NodeDetailForm 的 computedErrors 实时接管校验，
      // 避免用户修正字段后仍显示过期的 saveDraft 校验错误。
      errors: {},
    });
  },

  /**
   * P0 dogfood 修复：保存前校验 draft，有错误时拒绝保存并更新 errors，返回 false。
   * 校验通过时正常保存并返回 true。
   */
  saveDraft: () => {
    const { nodeId, draft } = get();
    if (!nodeId || !draft) return false;

    const errors = validateDraft(draft);
    const hasErrors = Object.keys(errors).length > 0;
    if (hasErrors) {
      set({ errors });
      return false;
    }

    useNodeGraphStore.getState().commit();
    useNodeGraphStore.getState().updateNode(nodeId, draft);
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
    return true;
  },

  cancelDraft: () => {
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },
}));
