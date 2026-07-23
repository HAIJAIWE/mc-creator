import type {
  NodeData,
  NodePort,
  NodeGraph,
  VariableNodeData,
  SubgraphNodeData,
  LoopNodeData,
} from '@mc-creator/shared';

/**
 * 根据节点 data 返回端口列表（数据驱动）。
 *
 * - 静态端口节点（item/block/entity/event 等）：端口固定，不依赖 data 具体值
 * - 动态端口节点（Plan C 的 variable/loop）：端口标签随 data 字段变化
 * - subgraph 节点：端口来自 graph.subgraphs[portMappings]，需传入 graph 参数
 *
 * createDefaultPorts(kind) 在 store 中保留（向后兼容），内部改为调用 getPorts。
 * 所有节点组件渲染端口时用 node.ports（已由 store 初始化），不运行时调 getPorts。
 *
 * @param data 节点数据
 * @param graph 可选，子图节点需要查 graph.subgraphs 获取 portMappings
 */
export function getPorts(data: NodeData, graph?: NodeGraph): NodePort[] {
  switch (data.kind) {
    // === Plan A 原 11 分支保持不变 ===
    case 'item':
      return [
        {
          id: 'out',
          label: '物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'block':
      return [
        {
          id: 'out',
          label: '方块',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'entity':
      return [
        {
          id: 'out',
          label: '实体',
          type: 'entity',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'recipe':
      return [
        {
          id: 'in',
          label: '材料',
          type: 'item_stack',
          direction: 'in',
          required: true,
          multiple: true,
        },
        {
          id: 'out',
          label: '产物',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'machine':
      return [
        {
          id: 'in_item',
          label: '输入物品',
          type: 'item_stack',
          direction: 'in',
          required: false,
          multiple: true,
        },
        {
          id: 'in_energy',
          label: '能源输入',
          type: 'energy',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out_item',
          label: '输出物品',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'multiblock':
      return [
        {
          id: 'controller',
          label: '控制器',
          type: 'block_state',
          direction: 'in',
          required: true,
          multiple: false,
        },
        {
          id: 'out',
          label: '结构',
          type: 'block_state',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'event':
      return [
        {
          id: 'trigger',
          label: '触发',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'condition':
      return [
        {
          id: 'in',
          label: '输入',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'true',
          label: '真',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
        {
          id: 'false',
          label: '假',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'action':
      return [
        {
          id: 'in',
          label: '执行',
          type: 'void',
          direction: 'in',
          required: false,
          multiple: false,
        },
        {
          id: 'out',
          label: '完成',
          type: 'void',
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    case 'code':
      return [
        { id: 'in', label: '输入', type: 'any', direction: 'in', required: false, multiple: false },
        {
          id: 'out',
          label: '输出',
          type: 'any',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ];
    case 'comment':
      return [];

    // === 阶段 C 新增 3 分支 ===
    case 'variable': {
      const v = data as VariableNodeData;
      return [
        {
          id: 'value',
          label: v.varName || '变量',
          type: varTypeToPortType(v.varType),
          direction: 'out',
          required: false,
          multiple: true,
        },
      ];
    }
    case 'subgraph': {
      const s = data as SubgraphNodeData;
      if (!s.subgraphId || !graph) return [];
      const sg = graph.subgraphs[s.subgraphId];
      if (!sg) return [];
      return sg.portMappings.map((m) => ({
        id: m.externalPortId,
        label: m.label,
        type: m.type,
        direction: m.direction,
        required: false,
        multiple: m.direction === 'in',
      }));
    }
    case 'loop': {
      const l = data as LoopNodeData;
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
          label: l.loopVarName || '循环变量',
          type: loopVarTypeToPortType(l.loopVarType),
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
    }
    default:
      return [];
  }
}

/** VariableNodeData.varType → NodePort['type'] 映射 */
function varTypeToPortType(varType: VariableNodeData['varType']): NodePort['type'] {
  switch (varType) {
    case 'int':
      return 'integer';
    case 'double':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'item':
      return 'item_stack';
    case 'block':
      return 'block_state';
  }
}

/** LoopNodeData.loopVarType → NodePort['type'] 映射 */
function loopVarTypeToPortType(loopVarType: LoopNodeData['loopVarType']): NodePort['type'] {
  switch (loopVarType) {
    case 'int':
      return 'integer';
    case 'item':
      return 'item_stack';
    case 'block':
      return 'block_state';
    case 'string':
      return 'string';
  }
}
