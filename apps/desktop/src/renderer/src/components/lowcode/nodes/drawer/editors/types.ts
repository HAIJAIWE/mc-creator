import type { NodeGraph, NodeKind, PortType } from '@mc-creator/shared';

/** 字段类型（对应 7 类编辑器 + text + code） */
export type FieldType =
  | 'text'
  | 'number'
  | 'dropdown'
  | 'noderef'
  | 'resourceId'
  | 'color'
  | 'nbt'
  | 'segmented'
  | 'code';

/** 字段 schema（驱动 NodeDetailForm 渲染） */
export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** noderef 编辑器用：限定可选节点的端口类型 */
  dataType?: PortType;
  /** 条件显示：当指定字段值匹配时才显示 */
  condition?: { field: string; equals?: string; in?: string[] };
  /** 排除的节点 kind 列表：字段不在这些 kind 的抽屉里显示 */
  excludeKinds?: NodeKind[];
  /** code 编辑器用：代码语言（用于语法高亮提示，不强制） */
  language?: string;
  /** code 编辑器用：占位符文本 */
  placeholder?: string;
  /** 正则校验模式（如 Java 标识符 /^[a-zA-Z_][a-zA-Z0-9_]*$/） */
  pattern?: string;
  /** pattern 不匹配时的错误提示 */
  patternMessage?: string;
}

/** 编辑器统一 props */
export interface EditorProps<T = unknown> {
  value: T;
  onChange: (v: T) => void;
  schema: FieldSchema;
  graph: NodeGraph;
  error?: string;
}
