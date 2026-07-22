import { z } from 'zod';
import { NodePort, PortType } from './node-graph-spec.js';

/**
 * 自定义节点类型 schema（阶段 C）
 *
 * 高手用户可定义自己的节点类型：JSON schema 驱动端口和字段，
 * 代码模板用 Mustache 语法（{{field:key}}）注入字段值。
 * 自定义节点数据上挂 kind: 'subgraph' + customTypeId，由 SubgraphNode 路由到 CustomNodeContent 渲染。
 */

/** 字段 schema（与 Plan A 的 FieldSchema 对齐，但独立定义以避免循环依赖） */
export const CustomNodeFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum([
    'text',
    'number',
    'dropdown',
    'noderef',
    'resourceId',
    'color',
    'nbt',
    'segmented',
  ]),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  dataType: PortType.optional(),
  condition: z
    .object({
      field: z.string(),
      equals: z.string().optional(),
      in: z.array(z.string()).optional(),
    })
    .optional(),
});
export type CustomNodeFieldSchema = z.infer<typeof CustomNodeFieldSchema>;

export const CustomNodeSchema = z.object({
  /** 类型 ID（如 'mymod:custom_crafter'，全局唯一） */
  typeId: z.string().min(1),
  /** 显示名 */
  label: z.string(),
  /** 描述 */
  description: z.string().default(''),
  /** 像素图标名 */
  icon: z.string().default(''),
  /** 头部色条 Tailwind class（如 'mc-custom'） */
  color: z.string().default('mc-code'),
  /** 端口定义（复用 NodePort） */
  ports: z.array(NodePort).default([]),
  /** 字段定义（复用 7 类编辑器） */
  fields: z.array(CustomNodeFieldSchema).default([]),
  /** Java 代码模板（Mustache 语法，{{field:key}} 注入字段值） */
  codeTemplate: z.string().default(''),
});
export type CustomNodeSchema = z.infer<typeof CustomNodeSchema>;
