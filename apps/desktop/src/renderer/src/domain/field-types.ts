import type { NodeKind, PortType } from '@mc-creator/shared';

/**
 * 节点字段的领域类型定义（与视图层解耦）。
 *
 * 这些类型描述的是「节点数据有哪些字段、如何校验/展示」，
 * 属于领域规则而非 React 组件契约，因此放在 domain/ 下，
 * 供 store、lib 与 components 共同依赖（避免 store 反向依赖 components）。
 */

/**
 * 字段类型（对应编辑器 + text + code）。
 *
 * 注意区分两种 ID：
 * - `resourceId`：**引用型** ID，指向其他 mod/原版的物品等，取值必须是 `namespace:path`
 * - `localId`：**定义型** ID，本 mod 自身内容的标识（物品/方块/实体/配方/机器/结构/
 *   群系/维度/流体/GUI），取值是裸 id `^[a-z0-9_]+$`，命名空间恒为当前 mod（只读展示）
 */
export type FieldType =
  | 'text'
  | 'number'
  | 'dropdown'
  | 'noderef'
  | 'resourceId'
  | 'localId'
  | 'color'
  | 'nbt'
  | 'segmented'
  | 'code'
  | 'list';

/** list 编辑器用：每行的子字段定义 */
export interface ListItemSchema {
  /** 子字段键（如 name / type） */
  key: string;
  label: string;
  type: 'text' | 'dropdown';
  options?: string[];
  /** Java 标识符正则（name 字段用） */
  pattern?: string;
  patternMessage?: string;
}

/** 字段分组枚举（用于属性面板折叠分组） */
export type FieldGroup = 'basic' | 'appearance' | 'behavior' | 'advanced';

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
  /** list 编辑器用：每行子字段定义 */
  listItemSchema?: ListItemSchema[];
  /** 字段分组：用于属性面板折叠分组（basic/appearance/behavior/advanced） */
  group?: FieldGroup;
  /** 字段说明文本（用于 tooltip），优先级高于 domain/fieldTooltips.ts */
  description?: string;
}
