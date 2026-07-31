import type { NodeKind } from '@mc-creator/shared';
import { ItemNode } from './ItemNode.js';
import { BlockNode } from './BlockNode.js';
import { EntityNode } from './EntityNode.js';
import { RecipeNode } from './RecipeNode.js';
import { MachineNode } from './MachineNode.js';
import { MultiBlockNode } from './MultiBlockNode.js';
import { EventNode } from './EventNode.js';
import { ConditionNode } from './ConditionNode.js';
import { ActionNode } from './ActionNode.js';
import { CodeNode } from './CodeNode.js';
import { CommentNode } from './CommentNode.js';
import { VariableNode } from './VariableNode.js';
import { SubgraphNode } from './SubgraphNode.js';
import { LoopNode } from './LoopNode.js';
import { ProcedureNode } from './ProcedureNode.js';

/**
 * 节点类型注册表
 *
 * React Flow 通过 nodeTypes 映射渲染对应组件。
 * 集中注册避免在每个使用 NodeGraphEditor 的地方重复定义。
 */
export const nodeTypes = {
  item: ItemNode,
  block: BlockNode,
  entity: EntityNode,
  recipe: RecipeNode,
  machine: MachineNode,
  multiblock: MultiBlockNode,
  event: EventNode,
  condition: ConditionNode,
  action: ActionNode,
  code: CodeNode,
  comment: CommentNode,
  // 阶段 C 新增
  variable: VariableNode,
  subgraph: SubgraphNode,
  loop: LoopNode,
  // P1-3 新增
  procedure: ProcedureNode,
} as const;

export type NodeTypeRegistry = typeof nodeTypes;

/** 节点类型元信息（用于 NodePalette 显示） */
export interface NodeMeta {
  kind: NodeKind;
  label: string;
  description: string;
  /** 像素图标名（McIcon scope=game） */
  icon: string;
  /** 分类 */
  category: 'content' | 'logic' | 'advanced';
  /** 配色（与节点头部颜色一致） */
  color: string;
}

export const NODE_METADATA: NodeMeta[] = [
  // 内容节点
  {
    kind: 'item',
    label: '物品',
    description: '武器/工具/食物/材料等可持物品',
    icon: 'sword',
    category: 'content',
    color: 'pink',
  },
  {
    kind: 'block',
    label: '方块',
    description: '普通方块或功能方块',
    icon: 'stone-block',
    category: 'content',
    color: 'orange',
  },
  {
    kind: 'entity',
    label: '生物',
    description: '动物/怪物/水生生物等实体',
    icon: 'creeper',
    category: 'content',
    color: 'cyan',
  },
  {
    kind: 'recipe',
    label: '配方',
    description: '合成/烧炼/切石配方',
    icon: 'crafting-table',
    category: 'content',
    color: 'yellow',
  },
  {
    kind: 'machine',
    label: '机器',
    description: '方块实体 + GUI + 能源接口',
    icon: 'gear-hammer',
    category: 'content',
    color: 'emerald',
  },
  {
    kind: 'multiblock',
    label: '多方块结构',
    description: '3D 结构（如工业高炉）',
    icon: 'castle',
    category: 'content',
    color: 'violet',
  },
  // 逻辑节点
  {
    kind: 'event',
    label: '事件',
    description: '触发器：右键/破坏/死亡等',
    icon: 'power-button',
    category: 'logic',
    color: 'purple',
  },
  {
    kind: 'condition',
    label: '条件',
    description: '分支判断（真/假两路）',
    icon: 'scales',
    category: 'logic',
    color: 'blue',
  },
  {
    kind: 'action',
    label: '动作',
    description: '执行效果（生成实体/伤害/传送等）',
    icon: 'fireball',
    category: 'logic',
    color: 'red',
  },
  // 高级节点
  {
    kind: 'code',
    label: '代码节点',
    description: 'L2 混合模式：内嵌 Java/JS/Kotlin',
    icon: 'scroll-quill',
    category: 'advanced',
    color: 'gray',
  },
  {
    kind: 'comment',
    label: '备注',
    description: '文档用途，不参与编译',
    icon: 'thought-bubble',
    category: 'advanced',
    color: 'yellow',
  },
  // 阶段 C 新增
  {
    kind: 'variable',
    label: '变量',
    description: '全局变量/常量，可被其他节点引用',
    icon: 'variable',
    category: 'advanced',
    color: 'cyan',
  },
  {
    kind: 'subgraph',
    label: '子图',
    description: '封装复用子图，支持嵌套',
    icon: 'subgraph',
    category: 'advanced',
    color: 'violet',
  },
  {
    kind: 'loop',
    label: '循环',
    description: 'for/forEach/while 批量逻辑',
    icon: 'loop',
    category: 'advanced',
    color: 'emerald',
  },
  // P1-3 新增
  {
    kind: 'procedure',
    label: '过程',
    description: '命名可复用逻辑（对标 MCreator procedure），编译为 Java 方法',
    icon: 'link',
    category: 'logic',
    color: 'indigo',
  },
];

export const NODE_CATEGORIES: { id: NodeMeta['category']; label: string }[] = [
  { id: 'content', label: '内容节点' },
  { id: 'logic', label: '逻辑节点' },
  { id: 'advanced', label: '高级节点' },
];
