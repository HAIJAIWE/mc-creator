import { create } from 'zustand';
import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeKind,
  NodeData,
  SubgraphDefinition,
} from '@mc-creator/shared';
import { LATEST_FORMAT_VERSION } from '@mc-creator/shared';
import type { CompileResult } from '../lib/compileNodeGraph.js';
import { serializeGraph, safeDeserializeGraph } from '../lib/nodeGraphSerializer.js';
import { getPorts } from '../components/lowcode/nodes/portSchemas.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';

/**
 * 为 procedure 节点生成不冲突的 procedureName（Java 方法名需唯一）。
 * 以 baseName 为基准：冲突则追加数字后缀，直到找到未使用的名称。
 * addNode（新增）与 duplicateNode（复制）共用，避免复制后产生同名过程。
 */
function uniqueProcedureName(nodes: ModNode[], baseName: string): string {
  const existing = new Set(
    nodes
      .filter((n) => n.data.kind === 'procedure')
      .map((n) => (n.data as { procedureName: string }).procedureName),
  );
  if (!existing.has(baseName)) return baseName;
  let suffix = 2;
  while (existing.has(`${baseName}${suffix}`)) suffix++;
  return `${baseName}${suffix}`;
}

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
  /** 阶段 C：当前正在编辑的子图 ID（null 表示编辑主图） */
  editingSubgraphId: string | null;

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

  // === 阶段 C：子图/自定义节点 ===
  /** 把选中节点封装为子图，返回新 SubgraphNode id（失败返回 null） */
  encapsulateSubgraph: (nodeIds: string[], name: string) => string | null;
  /** 设置当前编辑的子图 ID（null 回到主图） */
  setEditingSubgraphId: (subgraphId: string | null) => void;
  /** 添加自定义节点（基于 customNodeRegistry 中已注册的 schema） */
  addCustomNode: (typeId: string, position: { x: number; y: number }) => string;

  // === 导出/导入 ===
  /** 导出当前节点图为序列化 JSON 字符串（含 format/version/exportedAt 元信息） */
  exportGraph: () => string;
  /** 从 JSON 字符串导入节点图（替换当前图，自动 commit 撤销点）；失败返回 { ok: false, error } */
  importGraph: (json: string) => { ok: true } | { ok: false; error: string };
}

// === 节点工厂 ===

let nodeCounter = 0;

/**
 * P2 修复：根据图中已有节点/边 ID 更新 nodeCounter，
 * 防止 loadGraph/importGraph 后新 ID 与已导入的 ID 碰撞。
 * 从已有 ID 中提取最大 counter 值并加 1。
 */
function syncCounterFromGraph(graph: NodeGraph): void {
  let maxCounter = 0;
  const allIds = [...graph.nodes.map((n) => n.id), ...graph.edges.map((e) => e.id)];
  for (const id of allIds) {
    const parts = id.split('_');
    const last = parts[parts.length - 1];
    // genId 产生 base36 counter 作为最后一段
    const parsed = parseInt(last, 36);
    if (!Number.isNaN(parsed) && parsed > maxCounter) {
      maxCounter = parsed;
    }
  }
  if (maxCounter >= nodeCounter) {
    nodeCounter = maxCounter + 1;
  }
}

function genId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${nodeCounter.toString(36)}`;
}

/** 根据节点类型创建默认 data */
function createDefaultNodeData(kind: NodeKind, _modId: string): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
    // P1-1：新建节点使用最新 formatVersion，反序列化旧 JSON 时由 migrateGraph 升级
    formatVersion: LATEST_FORMAT_VERSION,
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
        template: 'minecraft:netherite_upgrade_smithing_template',
        base: '',
        addition: '',
        inputPotion: 'minecraft:water',
        ingredientItem: '',
        outputPotion: '',
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
    case 'variable':
      return {
        ...base,
        kind: 'variable',
        varName: 'var1',
        varType: 'int',
        value: 0,
        isConstant: false,
      } as NodeData;
    case 'subgraph':
      return {
        ...base,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: null,
        customFields: {},
      } as NodeData;
    case 'loop':
      return {
        ...base,
        kind: 'loop',
        loopType: 'for',
        init: 'int i = 0',
        condition: 'i < 10',
        update: 'i++',
        loopVarName: 'i',
        loopVarType: 'int',
      } as NodeData;
    case 'procedure':
      // P1-3：过程节点（对标 MCreator procedure），命名可复用逻辑单元
      return {
        ...base,
        kind: 'procedure',
        procedureName: 'myProcedure',
        displayName: '新过程',
      } as NodeData;
    case 'biome':
      return {
        ...base,
        kind: 'biome',
        biomeId: 'my_biome',
        displayName: '新生物群系',
        precipitation: 'rain',
        temperature: 0.5,
        temperatureModifier: 'none',
        downfall: 0.5,
        skyColor: 0x78a7ff,
        waterColor: 0x3f76e4,
        waterFogColor: 0x050533,
        fogColor: 0xc0d8ff,
        surfaceBuilder: 'minecraft:grass',
        spawnWeight: 10,
        spawnDimensions: ['minecraft:overworld'],
      } as NodeData;
    case 'dimension':
      return {
        ...base,
        kind: 'dimension',
        dimensionId: 'my_dimension',
        displayName: '新维度',
        baseType: 'overworld',
        fixedTime: null,
        hasSkyLight: true,
        hasCeiling: false,
        ultrawarm: false,
        natural: true,
        minY: -64,
        height: 384,
        effects: 'overworld',
      } as NodeData;
    case 'fluid':
      return {
        ...base,
        kind: 'fluid',
        fluidId: 'my_fluid',
        displayName: '新流体',
        color: 0x00aaff,
        temperature: 300,
        viscosity: 1000,
        density: 1000,
        luminous: false,
      } as NodeData;
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

/** 根据节点类型返回默认端口（委托给 portSchemas.getPorts） */
function createDefaultPorts(kind: NodeKind): NodeGraphState['graph']['nodes'][number]['ports'] {
  // 阶段 C 新节点：variable/subgraph/loop 的端口直接生成（Task 9 会同步到 getPorts）
  switch (kind) {
    case 'variable':
      return [
        {
          id: 'value',
          label: '变量',
          type: 'integer',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'subgraph':
      // 子图节点端口由 portMappings 动态生成，默认空（getPorts 在 Task 9 处理）
      return [];
    case 'loop':
      return [
        {
          id: 'input',
          label: '输入',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'loop_var',
          label: '循环变量',
          type: 'integer',
          direction: 'out',
          required: false,
          multiple: true,
        },
        {
          id: 'body',
          label: '循环体',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: false,
        },
        {
          id: 'done',
          label: '完成',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    default: {
      // 原 11 种节点：构造最小默认 data 以调用 getPorts
      const data = createDefaultNodeData(kind, '');
      return getPorts(data);
    }
  }
}

const EMPTY_GRAPH: NodeGraph = {
  version: 1,
  modId: '',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [],
  edges: [],
  subgraphs: {},
};

export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  graph: EMPTY_GRAPH,
  selectedNodeId: null,
  selectedEdgeId: null,
  undoStack: [],
  redoStack: [],
  compileResult: null,
  editingSubgraphId: null,

  addNode: (kind, position, partial) => {
    const nodeId = genId(kind);
    const defaultData = createDefaultNodeData(kind, get().graph.modId);
    // P1-4 dogfood：procedure 节点 procedureName 自增后缀，避免多个过程同名导致编译冲突
    // Minor 修复：收集已存在的 procedureName，找到第一个不冲突的名称，
    // 防止删除后重新添加时产生重名（如 myProcedure2 碰撞）。
    const procedureOverride =
      kind === 'procedure'
        ? { procedureName: uniqueProcedureName(get().graph.nodes, 'myProcedure') }
        : {};
    const data = {
      ...defaultData,
      ...procedureOverride,
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
        nodes: state.graph.nodes.map((n) => {
          if (n.id !== nodeId) return n;
          const newData = { ...n.data, ...patch } as NodeData;
          // P0-2 dogfood 修复：data 变更后同步 ports（确保端口定义与 data 一致）
          // Major 修复：subgraph/custom 节点的端口来自 portMappings/registry schema，
          // 不依赖可编辑的 data 字段；且 getPorts 对 subgraph 需要 graph 参数，
          // 缺失时返回 []，会导致端口清空、连线断裂。跳过端口重生成保留现有端口。
          const newPorts = newData.kind === 'subgraph' ? n.ports : getPorts(newData, state.graph);
          return { ...n, data: newData, ports: newPorts };
        }),
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
    // Major 修复：复制 procedure 节点时重命名 procedureName，
    // 避免与原件重名导致编译出同名 Java 方法（addNode 已去重，此处补上）。
    // NodeData 是联合类型，仅 procedure 成员含 procedureName，需类型断言。
    if (original.data.kind === 'procedure') {
      (newData as { procedureName: string }).procedureName = uniqueProcedureName(
        state.graph.nodes,
        (original.data as { procedureName: string }).procedureName,
      );
    }
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

  selectNode: (nodeId) =>
    set((state) => ({
      selectedNodeId: nodeId,
      selectedEdgeId: null,
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => {
          if (n.id === nodeId) return n.selected ? n : { ...n, selected: true };
          return n.selected ? { ...n, selected: false } : n;
        }),
      },
    })),

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
      // P1-5 dogfood 修复：undo 后清除旧编译结果，避免错误高亮指向已不存在的节点
      compileResult: null,
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
      // P1-5 dogfood 修复：redo 后清除旧编译结果
      compileResult: null,
    });
  },

  clear: () => {
    set((state) => ({
      graph: { ...EMPTY_GRAPH, modId: state.graph.modId },
      selectedNodeId: null,
      selectedEdgeId: null,
      undoStack: [],
      redoStack: [],
      // L-2 修复：清空后同时清除旧编译结果与子图编辑态，避免高亮/子图面板指向旧图
      compileResult: null,
      editingSubgraphId: null,
    }));
  },

  loadGraph: (graph) => {
    // P2 修复：导入后同步 counter，避免后续 genId 碰撞
    syncCounterFromGraph(graph);
    set({
      graph,
      selectedNodeId: null,
      selectedEdgeId: null,
      undoStack: [],
      redoStack: [],
      // L-2 修复：载入新图后清除旧编译结果与子图编辑态
      compileResult: null,
      editingSubgraphId: null,
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
    // P2 修复：导入后同步 counter，避免后续 genId 碰撞
    syncCounterFromGraph(result.graph);
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
      // L-2 修复：导入新图后重置子图编辑态
      editingSubgraphId: null,
    });
    return { ok: true };
  },

  // === 阶段 C：子图/自定义节点 ===

  encapsulateSubgraph: (nodeIds, name) => {
    if (nodeIds.length === 0) return null;
    const state = get();
    const { graph } = state;
    const selectedNodes = graph.nodes.filter((n) => nodeIds.includes(n.id));
    if (selectedNodes.length === 0) return null;

    // 收集选中节点之间的内部连线
    const selectedIdSet = new Set(nodeIds);
    const internalEdges = graph.edges.filter(
      (e) => selectedIdSet.has(e.source) && selectedIdSet.has(e.target),
    );

    // 外部连线 → portMappings + 重连边
    // P0 dogfood 修复：外部边不再直接删除，而是重连到新建的子图节点的对应端口
    const portMappings: SubgraphDefinition['portMappings'] = [];
    const reconnectedEdges: ModEdge[] = [];
    let inPortIdx = 0;
    let outPortIdx = 0;
    for (const edge of graph.edges) {
      if (selectedIdSet.has(edge.source) && !selectedIdSet.has(edge.target)) {
        // 内 → 外：创建输出端口映射 + 重连边（子图节点 out → 原外部 target）
        const externalPortId = `out_${outPortIdx}`;
        portMappings.push({
          internalPortId: `${edge.source}:${edge.sourceHandle ?? 'out'}`,
          externalPortId,
          label: `输出${outPortIdx + 1}`,
          direction: 'out' as const,
          type: 'any',
        });
        reconnectedEdges.push({
          id: genId('edge'),
          source: '__SG_NODE_ID__', // 占位，后面替换为 sgNodeId
          target: edge.target,
          sourceHandle: externalPortId,
          targetHandle: edge.targetHandle,
          kind: edge.kind,
          label: edge.label,
          disabled: edge.disabled,
        });
        outPortIdx++;
      } else if (!selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target)) {
        // 外 → 内：创建输入端口映射 + 重连边（原外部 source → 子图节点 in）
        const externalPortId = `in_${inPortIdx}`;
        portMappings.push({
          internalPortId: `${edge.target}:${edge.targetHandle ?? 'in'}`,
          externalPortId,
          label: `输入${inPortIdx + 1}`,
          direction: 'in' as const,
          type: 'any',
        });
        reconnectedEdges.push({
          id: genId('edge'),
          source: edge.source,
          target: '__SG_NODE_ID__', // 占位，后面替换为 sgNodeId
          sourceHandle: edge.sourceHandle,
          targetHandle: externalPortId,
          kind: edge.kind,
          label: edge.label,
          disabled: edge.disabled,
        });
        inPortIdx++;
      }
    }

    const sgId = genId('sg');
    const sgDef: SubgraphDefinition = {
      id: sgId,
      name,
      nodes: selectedNodes,
      edges: internalEdges,
      portMappings,
    };

    // 新 SubgraphNode 位置：选中节点质心
    const cx = selectedNodes.reduce((s, n) => s + n.position.x, 0) / selectedNodes.length;
    const cy = selectedNodes.reduce((s, n) => s + n.position.y, 0) / selectedNodes.length;
    const sgNodeId = genId('subgraph');

    // 替换重连边中的占位节点 id 为实际的 sgNodeId
    for (const e of reconnectedEdges) {
      if (e.source === '__SG_NODE_ID__') e.source = sgNodeId;
      if (e.target === '__SG_NODE_ID__') e.target = sgNodeId;
    }

    const sgNode: ModNode = {
      id: sgNodeId,
      type: 'subgraph',
      position: { x: cx, y: cy },
      data: {
        nodeId: sgNodeId,
        label: name,
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        // P1-1：新建子图节点使用最新 formatVersion
        formatVersion: LATEST_FORMAT_VERSION,
        kind: 'subgraph',
        subgraphId: sgId,
        subgraphName: name,
        customTypeId: null,
        customFields: {},
      },
      ports: portMappings.map((m) => ({
        id: m.externalPortId,
        label: m.label,
        type: m.type,
        direction: m.direction,
        required: false,
        multiple: m.direction === 'in',
      })),
      selected: true,
    };

    // 从主图移除选中节点 + 相关连线，添加 SubgraphNode + 重连边，注册子图
    // 纯外部边（source 和 target 都不在选中集合）保留
    const pureExternalEdges = graph.edges.filter(
      (e) => !selectedIdSet.has(e.source) && !selectedIdSet.has(e.target),
    );
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: [...s.graph.nodes.filter((n) => !selectedIdSet.has(n.id)), sgNode],
        edges: [...pureExternalEdges, ...reconnectedEdges],
        subgraphs: { ...s.graph.subgraphs, [sgId]: sgDef },
      },
      selectedNodeId: sgNodeId,
    }));
    return sgNodeId;
  },

  setEditingSubgraphId: (subgraphId) => set({ editingSubgraphId: subgraphId }),

  addCustomNode: (typeId, position) => {
    const schema = customNodeRegistry.get(typeId);
    if (!schema) {
      throw new Error(`自定义节点类型未注册：${typeId}`);
    }
    const nodeId = genId('custom');
    const data = {
      nodeId,
      label: schema.label,
      note: '',
      disabled: false,
      collapsed: false,
      codeLocked: false,
      // P1-1：新建自定义节点使用最新 formatVersion
      formatVersion: LATEST_FORMAT_VERSION,
      kind: 'subgraph' as const,
      subgraphId: '',
      subgraphName: schema.label,
      customTypeId: typeId,
      customFields: {},
    };
    const node: ModNode = {
      id: nodeId,
      type: 'subgraph',
      position,
      data,
      ports: schema.ports,
      selected: false,
    };
    set((s) => ({
      graph: { ...s.graph, nodes: [...s.graph.nodes, node] },
      selectedNodeId: nodeId,
    }));
    return nodeId;
  },
}));

// === 选择器便捷 hooks ===

/**
 * 获取当前选中节点。
 * P2 性能优化：使用 useShallow 减少因无关节点变化导致的重渲染，
 * 仅当 selectedNodeId 或对应节点引用变化时才触发更新。
 */
export function useSelectedNode(): ModNode | null {
  return useNodeGraphStore((s) => {
    if (!s.selectedNodeId) return null;
    return s.graph.nodes.find((n) => n.id === s.selectedNodeId) ?? null;
  });
}
