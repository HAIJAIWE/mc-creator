import { create } from 'zustand';
import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeKind,
  NodeData,
  EditorMode,
} from '@mc-creator/shared';
import type { CompileResult } from '../lib/compileNodeGraph.js';
import { serializeGraph, safeDeserializeGraph } from '../lib/nodeGraphSerializer.js';
import { getPorts } from '../components/lowcode/nodes/portSchemas.js';

/**
 * 节点图状态管理
 *
 * 管理 React Flow 画布的节点和连线，支持：
 * - 增删改节点（基于 nodeId）
 * - 增删改连线
 * - 选中节点（驱动 PropertyPanel）
 * - 视口同步（缩放/平移）
 * - 撤销/重做（基于历史栈）
 *
 * 节点图最终通过 compileNodeGraph() 编译为 ModSpec，再由 mod-generator 生成 Java。
 */

interface NodeGraphState {
  /** 当前节点图 */
  graph: NodeGraph;
  /** 选中的节点 ID */
  selectedNodeId: string | null;
  /** 选中的连线 ID */
  selectedEdgeId: string | null;
  /** 撤销栈 */
  undoStack: NodeGraph[];
  /** 重做栈 */
  redoStack: NodeGraph[];
  /** 最近一次编译结果（null 表示尚未编译），用于节点图错误高亮与属性面板详情 */
  compileResult: CompileResult | null;

  // === 节点操作 ===
  addNode: (
    kind: NodeKind,
    position: { x: number; y: number },
    partial?: Partial<NodeData>,
  ) => string;
  updateNode: (nodeId: string, patch: Partial<NodeData>) => void;
  removeNode: (nodeId: string) => void;
  duplicateNode: (nodeId: string) => string | null;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  selectNode: (nodeId: string | null) => void;

  // === 折叠 ===
  toggleCollapse: (nodeId: string) => void;
  collapseAll: () => void;
  expandAll: () => void;

  // === 连线操作 ===
  addEdge: (edge: Omit<ModEdge, 'id'>) => string;
  updateEdge: (edgeId: string, patch: Partial<ModEdge>) => void;
  removeEdge: (edgeId: string) => void;
  selectEdge: (edgeId: string | null) => void;

  // === 画布操作 ===
  setViewport: (viewport: { x: number; y: number; zoom: number }) => void;
  setModId: (modId: string) => void;

  // === 历史 ===
  /** 提交当前 graph 到撤销栈（在用户操作前调用） */
  commit: () => void;
  undo: () => void;
  redo: () => void;
  /** 重置为空图 */
  clear: () => void;
  /** 从外部载入节点图（如打开项目） */
  loadGraph: (graph: NodeGraph) => void;

  // === 编译 ===
  /** 存储编译结果（供 NodeGraphEditor 高亮错误节点、PropertyPanel 显示详情） */
  setCompileResult: (result: CompileResult | null) => void;

  // === 导出/导入 ===
  /** 导出当前节点图为序列化 JSON 字符串（含 format/version/exportedAt 元信息） */
  exportGraph: () => string;
  /** 从 JSON 字符串导入节点图（替换当前图，自动 commit 撤销点）；失败返回 { ok: false, error } */
  importGraph: (json: string) => { ok: true } | { ok: false; error: string };
}

// === 节点工厂 ===

let nodeCounter = 0;
function genId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${nodeCounter.toString(36)}`;
}

/** 根据节点类型创建默认 data */
function createDefaultNodeData(kind: NodeKind, modId: string): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
  };

  switch (kind) {
    case 'item':
      return {
        ...base,
        kind: 'item',
        itemId: 'new_item',
        displayName: '新物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      } as NodeData;
    case 'block':
      return {
        ...base,
        kind: 'block',
        blockId: 'new_block',
        displayName: '新方块',
        hardness: 1.0,
        blastResistance: 3.0,
        luminance: 0,
        transparent: false,
        solid: true,
        modelType: 'cube_all',
        isBlockEntity: false,
      } as NodeData;
    case 'entity':
      return {
        ...base,
        kind: 'entity',
        entityId: 'new_entity',
        displayName: '新生物',
        maxHealth: 20,
        attackDamage: 0,
        movementSpeed: 0.3,
        classification: 'misc',
        modelType: 'pig',
        spawnWeight: 0,
        spawnBiomes: [],
      } as NodeData;
    case 'recipe':
      return {
        ...base,
        kind: 'recipe',
        recipeId: 'new_recipe',
        recipeType: 'crafting_shaped',
        outputCount: 1,
        cookTime: 200,
        experience: 0,
        pattern: [],
      } as NodeData;
    case 'machine':
      return {
        ...base,
        kind: 'machine',
        machineId: 'new_machine',
        displayName: '新机器',
        energyCapacity: 10000,
        maxEnergyTransfer: 100,
        inputSlots: 1,
        outputSlots: 1,
        defaultProcessTime: 200,
        defaultEnergyPerTick: 10,
        guiWidth: 176,
        guiHeight: 166,
      } as NodeData;
    case 'multiblock':
      return {
        ...base,
        kind: 'multiblock',
        structureId: 'new_structure',
        displayName: '新多方块结构',
        width: 3,
        height: 3,
        depth: 3,
        hollow: true,
        controllerOffset: { x: 1, y: 1, z: 0 },
      } as NodeData;
    case 'event':
      return {
        ...base,
        kind: 'event',
        eventType: 'player_right_click_block',
        eventArgs: '{}',
      } as NodeData;
    case 'condition':
      return {
        ...base,
        kind: 'condition',
        conditionType: 'has_item',
        conditionArgs: '{}',
        invert: false,
      } as NodeData;
    case 'action':
      return {
        ...base,
        kind: 'action',
        actionType: 'spawn_entity',
        actionArgs: '{}',
      } as NodeData;
    case 'code':
      return {
        ...base,
        kind: 'code',
        language: 'java',
        code: '// 在此写 Java 代码\npublic ItemStack process(ItemStack input) {\n    return input;\n}',
        inputSignature: '{}',
        outputSignature: '{}',
        methodName: 'process',
      } as NodeData;
    case 'comment':
      return {
        ...base,
        kind: 'comment',
        text: '备注',
        color: 'yellow',
      } as NodeData;
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

/** 根据节点类型返回默认端口（委托给 portSchemas.getPorts） */
function createDefaultPorts(kind: NodeKind): NodeGraphState['graph']['nodes'][number]['ports'] {
  // 构造最小默认 data 以调用 getPorts（端口定义不依赖 data 具体值，只依赖 kind）
  const data = createDefaultNodeData(kind, '');
  return getPorts(data);
}

const EMPTY_GRAPH: NodeGraph = {
  version: 1,
  modId: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
};

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  graph: EMPTY_GRAPH,
  selectedNodeId: null,
  selectedEdgeId: null,
  undoStack: [],
  redoStack: [],
  compileResult: null,

  addNode: (kind, position, partial) => {
    const nodeId = genId(kind);
    const data = {
      ...createDefaultNodeData(kind, get().graph.modId),
      ...partial,
      nodeId,
    } as NodeData;
    const node: ModNode = {
      id: nodeId,
      type: kind,
      position,
      data,
      ports: createDefaultPorts(kind),
      selected: false,
    };
    set((state) => ({
      graph: { ...state.graph, nodes: [...state.graph.nodes, node] },
      selectedNodeId: nodeId,
    }));
    return nodeId;
  },

  updateNode: (nodeId, patch) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...patch } as NodeData } : n,
        ),
      },
    }));
  },

  removeNode: (nodeId) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.filter((n) => n.id !== nodeId),
        edges: state.graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      },
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },

  duplicateNode: (nodeId) => {
    const state = get();
    const original = state.graph.nodes.find((n) => n.id === nodeId);
    if (!original) return null;
    const newId = genId(original.type);
    const newData = {
      ...original.data,
      nodeId: newId,
      label: `${original.data.label} 副本`,
    } as NodeData;
    const newNode: ModNode = {
      ...original,
      id: newId,
      position: { x: original.position.x + 40, y: original.position.y + 40 },
      data: newData,
      selected: false,
    };
    set((s) => ({
      graph: { ...s.graph, nodes: [...s.graph.nodes, newNode] },
      selectedNodeId: newId,
    }));
    return newId;
  },

  moveNode: (nodeId, position) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      },
    }));
  },

  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),

  toggleCollapse: (nodeId) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } as NodeData }
            : n,
        ),
      },
    }));
  },

  collapseAll: () => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => ({
          ...n,
          data: { ...n.data, collapsed: true } as NodeData,
        })),
      },
    }));
  },

  expandAll: () => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => ({
          ...n,
          data: { ...n.data, collapsed: false } as NodeData,
        })),
      },
    }));
  },

  addEdge: (edge) => {
    const id = genId('edge');
    const fullEdge: ModEdge = { ...edge, id };
    set((state) => ({
      graph: { ...state.graph, edges: [...state.graph.edges, fullEdge] },
    }));
    return id;
  },

  updateEdge: (edgeId, patch) => {
    set((state) => ({
      graph: {
        ...state.graph,
        edges: state.graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
      },
    }));
  },

  removeEdge: (edgeId) => {
    set((state) => ({
      graph: {
        ...state.graph,
        edges: state.graph.edges.filter((e) => e.id !== edgeId),
      },
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
    }));
  },

  selectEdge: (edgeId) => set({ selectedEdgeId: edgeId, selectedNodeId: null }),

  setViewport: (viewport) => {
    set((state) => ({ graph: { ...state.graph, viewport } }));
  },

  setModId: (modId) => {
    set((state) => ({ graph: { ...state.graph, modId } }));
  },

  commit: () => {
    set((state) => ({
      undoStack: [...state.undoStack.slice(-49), state.graph], // 最多 50 步
      redoStack: [],
    }));
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    const previous = state.undoStack[state.undoStack.length - 1];
    set({
      graph: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, state.graph],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    const next = state.redoStack[state.redoStack.length - 1];
    set({
      graph: next,
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, state.graph],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  clear: () => {
    set((state) => ({
      graph: { ...EMPTY_GRAPH, modId: state.graph.modId },
      selectedNodeId: null,
      selectedEdgeId: null,
      undoStack: [],
      redoStack: [],
    }));
  },

  loadGraph: (graph) => {
    set({
      graph,
      selectedNodeId: null,
      selectedEdgeId: null,
      undoStack: [],
      redoStack: [],
    });
  },

  setCompileResult: (result) => set({ compileResult: result }),

  // === 导出/导入（委托给 nodeGraphSerializer 纯函数） ===
  exportGraph: () => serializeGraph(get().graph),

  importGraph: (json) => {
    const result = safeDeserializeGraph(json);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // 导入前保存撤销点，便于 Ctrl+Z 回滚到导入前的状态
    set((state) => ({
      undoStack: [...state.undoStack.slice(-49), state.graph],
      redoStack: [],
    }));
    set({
      graph: result.graph,
      selectedNodeId: null,
      selectedEdgeId: null,
      compileResult: null,
    });
    return { ok: true };
  },
}));

// === 选择器便捷 hooks ===

/** 获取当前选中节点 */
export function useSelectedNode(): ModNode | null {
  return useNodeGraphStore((s) => {
    if (!s.selectedNodeId) return null;
    return s.graph.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  });
}
