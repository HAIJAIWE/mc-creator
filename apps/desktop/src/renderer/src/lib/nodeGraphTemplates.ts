import type { NodeGraph, ModNode, ModEdge, NodeData, NodeKind, NodePort } from '@mc-creator/shared';

/**
 * 节点图模板
 *
 * 提供预置的 NodeGraph 数据，供用户从模板快速创建 Mod。
 * 模板是纯数据（不依赖 store），便于测试与序列化。
 *
 * 使用方式：在 NodePalette 中点击模板按钮，
 * 经用户确认后调用 useNodeGraphStore.getState().loadGraph(template.graph) 载入。
 */

/** 模板元信息 */
export interface NodeGraphTemplate {
  /** 唯一 id */
  id: string;
  /** 显示名（中文） */
  name: string;
  /** 简短描述（1-2 句话） */
  description: string;
  /** 分类：'starter' | 'item' | 'combat' | 'machine' | 'event' | 'code' */
  category: 'starter' | 'item' | 'combat' | 'machine' | 'event' | 'code';
  /** emoji 图标（用于显示，避免引入图片资源） */
  icon: string;
  /** 节点数量（用于显示） */
  nodeCount: number;
  /** 完整的 NodeGraph 数据 */
  graph: NodeGraph;
}

/** 模板分类元信息 */
export interface TemplateCategory {
  id: NodeGraphTemplate['category'];
  label: string;
  description: string;
}

/** 模板分类列表（用于 NodePalette 分组显示） */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { id: 'starter', label: '入门', description: '从零开始的基础模板' },
  { id: 'item', label: '物品', description: '物品相关模板' },
  { id: 'combat', label: '战斗', description: '武器装备相关模板' },
  { id: 'machine', label: '机器', description: '机器与多方块结构' },
  { id: 'event', label: '事件', description: '事件监听与处理' },
  { id: 'code', label: '代码', description: '自定义代码节点示例' },
];

// === 节点工厂辅助 ===
// 与 node-graph-store.ts 中 createDefaultNodeData / createDefaultPorts 保持一致，
// 确保模板节点数据结构与 store 创建的节点结构匹配。

/** 根据节点类型创建默认 data（与 node-graph-store.ts 保持一致） */
function createDefaultNodeData(kind: NodeKind): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
    codeLocked: false,
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
    default:
      throw new Error(`Unknown node kind: ${kind satisfies never}`);
  }
}

/** 根据节点类型返回默认端口（与 node-graph-store.ts 保持一致） */
function createDefaultPorts(kind: NodeKind): NodePort[] {
  switch (kind) {
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
    default:
      return [];
  }
}

/**
 * 构造模板用节点
 * @param id 节点 id（如 'item_1'）
 * @param kind 节点类型
 * @param position 节点位置
 * @param dataOverrides data 字段覆盖（如 { itemId: 'ruby', displayName: '红宝石' }）
 * @param ports 自定义端口（不传则使用 createDefaultPorts）
 */
function makeNode(
  id: string,
  kind: NodeKind,
  position: { x: number; y: number },
  dataOverrides: Record<string, unknown> = {},
  ports?: NodePort[],
): ModNode {
  const baseData = createDefaultNodeData(kind);
  const merged = { ...baseData, ...dataOverrides, nodeId: id } as NodeData;
  return {
    id,
    type: kind,
    position,
    data: merged,
    ports: ports ?? createDefaultPorts(kind),
    selected: false,
  };
}

/**
 * 构造模板用边
 * @param id 边 id（如 'edge_1'）
 * @param source 源节点 id
 * @param target 目标节点 id
 * @param opts 可选参数：sourceHandle/targetHandle/kind/label
 */
function makeEdge(
  id: string,
  source: string,
  target: string,
  opts: {
    sourceHandle?: string;
    targetHandle?: string;
    kind?: ModEdge['kind'];
    label?: string;
  } = {},
): ModEdge {
  return {
    id,
    source,
    target,
    sourceHandle: opts.sourceHandle,
    targetHandle: opts.targetHandle,
    kind: opts.kind ?? 'craft',
    disabled: false,
  };
}

// === 内置模板 ===

/** 所有内置模板（至少 6 个，覆盖各分类） */
export const NODE_GRAPH_TEMPLATES: NodeGraphTemplate[] = [
  // 1. 空白画布
  {
    id: 'blank',
    name: '空白画布',
    description: '从零开始，自由搭建节点图',
    category: 'starter',
    icon: '📄',
    nodeCount: 0,
    graph: {
      version: 1,
      modId: 'template_blank',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [],
      edges: [],
      subgraphs: {},
    },
  },

  // 2. 简单物品 mod
  {
    id: 'simple-item',
    name: '简单物品',
    description: '一个红宝石物品，适合入门学习',
    category: 'item',
    icon: '💎',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_simple_item',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 200, y: 200 },
          {
            itemId: 'ruby',
            displayName: '红宝石',
            label: '红宝石',
            category: 'material',
            maxStackSize: 64,
            maxDamage: 0,
            rarity: 'rare',
            glow: true,
            note: '一种稀有宝石，可用于合成高级装备',
          },
        ),
      ],
      edges: [],
      subgraphs: {},
    },
  },

  // 3. 武器工具 mod
  {
    id: 'weapon-tool',
    name: '武器工具',
    description: '红宝石剑及其合成配方示例',
    category: 'combat',
    icon: '⚔️',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_weapon_tool',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 200, y: 100 },
          {
            itemId: 'ruby_sword',
            displayName: '红宝石剑',
            label: '红宝石剑',
            category: 'sword',
            maxStackSize: 1,
            maxDamage: 500,
            rarity: 'rare',
            glow: true,
            note: '用红宝石锻造的锋利长剑',
          },
        ),
        makeNode(
          'recipe_1',
          'recipe',
          { x: 200, y: 320 },
          {
            recipeId: 'ruby_sword_recipe',
            recipeType: 'crafting_shaped',
            outputCount: 1,
            cookTime: 200,
            experience: 0,
            pattern: ['A', 'B'],
            label: '红宝石剑配方',
            note: '红宝石 + 木棍合成红宝石剑',
          },
        ),
      ],
      edges: [
        // 物品 → 配方的 in 端口（craft 关系）
        makeEdge('edge_1', 'item_1', 'recipe_1', {
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'craft',
        }),
      ],
      subgraphs: {},
    },
  },

  // 4. 简单机器 mod
  {
    id: 'simple-machine',
    name: '简单机器',
    description: '红宝石方块与红宝石熔炉',
    category: 'machine',
    icon: '🏭',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_simple_machine',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'block_1',
          'block',
          { x: 200, y: 100 },
          {
            blockId: 'ruby_block',
            displayName: '红宝石块',
            label: '红宝石块',
            hardness: 5.0,
            blastResistance: 30.0,
            luminance: 0,
            transparent: false,
            solid: true,
            modelType: 'cube_all',
            isBlockEntity: false,
            note: '由 9 个红宝石合成的存储方块',
          },
        ),
        // 机器节点附加 controller 端口（type: block_state），演示 block → machine 控制关系
        makeNode(
          'machine_1',
          'machine',
          { x: 200, y: 340 },
          {
            machineId: 'ruby_furnace',
            displayName: '红宝石熔炉',
            label: '红宝石熔炉',
            energyCapacity: 20000,
            maxEnergyTransfer: 200,
            inputSlots: 1,
            outputSlots: 1,
            defaultProcessTime: 100,
            defaultEnergyPerTick: 20,
            guiWidth: 176,
            guiHeight: 166,
            isBlockEntity: true,
            note: '高速熔炉，消耗红宝石能源加速烧炼',
          },
          [
            // 附加 controller 端口用于连接方块（block_state 类型）
            {
              id: 'controller',
              label: '控制器',
              type: 'block_state',
              direction: 'in',
              required: true,
              multiple: false,
            },
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
          ],
        ),
      ],
      edges: [
        // 方块 → 机器的 controller 端口（flow 关系，block_state 类型）
        makeEdge('edge_1', 'block_1', 'machine_1', {
          sourceHandle: 'out',
          targetHandle: 'controller',
          kind: 'flow',
        }),
      ],
      subgraphs: {},
    },
  },

  // 5. 事件监听 mod
  {
    id: 'event-listener',
    name: '事件监听',
    description: '玩家右键方块时检查物品并生成实体',
    category: 'event',
    icon: '⚡',
    nodeCount: 3,
    graph: {
      version: 1,
      modId: 'template_event_listener',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'event_1',
          'event',
          { x: 100, y: 100 },
          {
            eventType: 'player_right_click_block',
            eventArgs: '{"hand":"main_hand"}',
            label: '玩家右键方块',
            note: '玩家右键方块时触发',
          },
        ),
        makeNode(
          'condition_1',
          'condition',
          { x: 100, y: 320 },
          {
            conditionType: 'has_item',
            conditionArgs: '{"item":"minecraft:stick","hand":"main_hand"}',
            invert: false,
            label: '手持木棍',
            note: '检查玩家主手是否持有木棍',
          },
        ),
        makeNode(
          'action_1',
          'action',
          { x: 100, y: 540 },
          {
            actionType: 'spawn_entity',
            actionArgs: '{"entity":"minecraft:lightning_bolt","offset":{"x":0,"y":1,"z":0}}',
            label: '生成闪电',
            note: '在玩家位置生成一道闪电',
          },
        ),
      ],
      edges: [
        // event → condition 的 in 端口（控制流）
        makeEdge('edge_1', 'event_1', 'condition_1', {
          sourceHandle: 'trigger',
          targetHandle: 'in',
          kind: 'control',
        }),
        // condition.true → action 的 in 端口（控制流；condition.false 不连接）
        makeEdge('edge_2', 'condition_1', 'action_1', {
          sourceHandle: 'true',
          targetHandle: 'in',
          kind: 'control',
        }),
      ],
      subgraphs: {},
    },
  },

  // 6. 自定义代码 mod
  {
    id: 'custom-code',
    name: '自定义代码',
    description: '代码节点处理输入物品并返回副本',
    category: 'code',
    icon: '📝',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_custom_code',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 100, y: 200 },
          {
            itemId: 'input_item',
            displayName: '输入物品',
            label: '输入物品',
            category: 'material',
            maxStackSize: 64,
            maxDamage: 0,
            rarity: 'common',
            glow: false,
            note: '待处理的输入物品',
          },
        ),
        makeNode(
          'code_1',
          'code',
          { x: 400, y: 200 },
          {
            language: 'java',
            code: '// 复制输入物品并返回\nreturn input.copy();',
            inputSignature: '{"in":"item_stack"}',
            outputSignature: '{"out":"item_stack"}',
            methodName: 'process',
            label: '复制物品',
            note: 'L2 混合模式：内嵌 Java 代码处理物品',
          },
        ),
      ],
      edges: [
        // 物品 → 代码节点的 in 端口（data 关系）
        makeEdge('edge_1', 'item_1', 'code_1', {
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'data',
        }),
      ],
      subgraphs: {},
    },
  },

  // 7. 铁剑（基础武器模板）
  {
    id: 'iron-sword',
    name: '铁剑',
    description: '基础铁质武器，耐久 250，新手入门',
    category: 'combat',
    icon: '⚔️',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_iron_sword',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 200, y: 200 },
          {
            itemId: 'iron_sword',
            displayName: '铁剑',
            label: '铁剑',
            category: 'sword',
            maxStackSize: 1,
            maxDamage: 250,
            rarity: 'common',
            glow: false,
            note: '基础铁质武器，平衡的攻击力与耐久',
          },
        ),
      ],
      edges: [],
      subgraphs: {},
    },
  },

  // 8. 钻石镐（高级工具模板）
  {
    id: 'diamond-pickaxe',
    name: '钻石镐',
    description: '钻石工具，耐久 1561，可挖黑曜石',
    category: 'item',
    icon: '⛏️',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_diamond_pickaxe',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 200, y: 200 },
          {
            itemId: 'diamond_pickaxe',
            displayName: '钻石镐',
            label: '钻石镐',
            category: 'pickaxe',
            maxStackSize: 1,
            maxDamage: 1561,
            rarity: 'common',
            glow: false,
            note: '可挖掘黑曜石的高级工具，钻石材质',
          },
        ),
      ],
      edges: [],
      subgraphs: {},
    },
  },

  // 9. 金苹果（稀有食物模板）
  {
    id: 'golden-apple',
    name: '金苹果',
    description: '稀有食物，食用给予生命恢复与抗性提升',
    category: 'item',
    icon: '🍎',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_golden_apple',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 200, y: 200 },
          {
            itemId: 'golden_apple',
            displayName: '金苹果',
            label: '金苹果',
            category: 'food',
            maxStackSize: 64,
            maxDamage: 0,
            rarity: 'rare',
            glow: true,
            note: '食用给予生命恢复 II 与抗性提升的稀有食物',
          },
        ),
      ],
      edges: [],
      subgraphs: {},
    },
  },

  // 10. 熔炉配方（烧炼配方模板，演示 recipe.smelting）
  {
    id: 'furnace-recipe',
    name: '熔炉配方',
    description: '将粗红宝石烧炼为红宝石的熔炉配方示例',
    category: 'starter',
    icon: '🔥',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_furnace_recipe',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'item_1',
          'item',
          { x: 100, y: 150 },
          {
            itemId: 'raw_ruby',
            displayName: '粗红宝石',
            label: '粗红宝石',
            category: 'material',
            maxStackSize: 64,
            maxDamage: 0,
            rarity: 'common',
            glow: false,
            note: '熔炉烧炼前的原矿材料',
          },
        ),
        makeNode(
          'recipe_1',
          'recipe',
          { x: 100, y: 380 },
          {
            recipeId: 'ruby_smelting',
            recipeType: 'smelting',
            outputCount: 1,
            cookTime: 200,
            experience: 0.1,
            pattern: [],
            label: '红宝石烧炼',
            note: '粗红宝石 → 红宝石，10 秒烧炼，0.1 经验',
          },
        ),
      ],
      edges: [
        // 物品 → 配方 in 端口（craft 关系）
        makeEdge('edge_1', 'item_1', 'recipe_1', {
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'craft',
        }),
      ],
      subgraphs: {},
    },
  },

  // 11. 简单发电机（机器模板，演示 block → machine controller 连接）
  {
    id: 'basic-generator',
    name: '简单发电机',
    description: '基础能源生成机器，方块控制器 + 机器逻辑',
    category: 'machine',
    icon: '🔋',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_basic_generator',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode(
          'block_1',
          'block',
          { x: 200, y: 100 },
          {
            blockId: 'generator_block',
            displayName: '发电机方块',
            label: '发电机方块',
            hardness: 3.0,
            blastResistance: 10.0,
            luminance: 7,
            transparent: false,
            solid: true,
            modelType: 'cube_all',
            isBlockEntity: true,
            note: '发电机外壳方块，发光等级 7',
          },
        ),
        makeNode(
          'machine_1',
          'machine',
          { x: 200, y: 340 },
          {
            machineId: 'basic_generator',
            displayName: '基础发电机',
            label: '基础发电机',
            energyCapacity: 50000,
            maxEnergyTransfer: 500,
            inputSlots: 0,
            outputSlots: 1,
            defaultProcessTime: 100,
            defaultEnergyPerTick: 50,
            guiWidth: 176,
            guiHeight: 166,
            note: '消耗燃料生成 FE 能源，50000 容量',
          },
          [
            // 附加 controller 端口用于连接方块（block_state 类型）
            {
              id: 'controller',
              label: '控制器',
              type: 'block_state',
              direction: 'in',
              required: true,
              multiple: false,
            },
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
          ],
        ),
      ],
      edges: [
        // 方块 → 机器 controller 端口（flow 关系，block_state 类型）
        makeEdge('edge_1', 'block_1', 'machine_1', {
          sourceHandle: 'out',
          targetHandle: 'controller',
          kind: 'flow',
        }),
      ],
      subgraphs: {},
    },
  },
];
