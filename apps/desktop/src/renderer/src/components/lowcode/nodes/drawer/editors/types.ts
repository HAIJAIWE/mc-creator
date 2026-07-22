import type { NodeGraph, PortType } from '@mc-creator/shared';

/** 字段类型（对应 7 类编辑器 + text） */
export type FieldType =
  'text' | 'number' | 'dropdown' | 'noderef' | 'resourceId' | 'color' | 'nbt' | 'segmented';

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
}

/** 编辑器统一 props */
export interface EditorProps<T = unknown> {
  value: T;
  onChange: (v: T) => void;
  schema: FieldSchema;
  graph: NodeGraph;
  error?: string;
}
