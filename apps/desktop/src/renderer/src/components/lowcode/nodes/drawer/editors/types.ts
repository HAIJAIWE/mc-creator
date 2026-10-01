import type { NodeGraph } from '@mc-creator/shared';
import type { FieldSchema } from '../../../../../domain/field-types.js';

/**
 * 字段 schema 的领域定义已下沉到 domain/field-types.ts（避免 store 反向依赖 components）。
 * 此处 re-export，让 editors/ 下的编辑器组件沿用 './types.js' 单一入口。
 */
export type { FieldSchema, FieldType, ListItemSchema } from '../../../../../domain/field-types.js';

/** 编辑器统一 props */
export interface EditorProps<T = unknown> {
  value: T;
  onChange: (v: T) => void;
  schema: FieldSchema;
  graph: NodeGraph;
  error?: string;
}
