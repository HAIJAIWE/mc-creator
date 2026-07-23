import { z } from 'zod';
import { NodePort, PortType } from './node-graph-spec.js';

/**
 * 自定义节点类型 schema（阶段 C）
 *
 * 高手用户可定义自己的节点类型：JSON schema 驱动端口和字段，
 * 代码模板用 Mustache 语法（{{field:key}}）注入字段值。
 * 自定义节点数据上挂 kind: 'subgraph' + customTypeId，由 SubgraphNode 路由到 CustomNodeContent 渲染。
 *
 * P0-3 升级：新增 templateParts 字段，对标 MCreator FreeMarker 条件化代码生成。
 * - templateParts 非空时优先按条件渲染各 part，拼接为最终代码
 * - templateParts 为空（默认）时回退到 codeTemplate（向后兼容）
 * - 每个 part 含可选 condition（field + equals/in），满足条件才渲染
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

/**
 * 代码模板 part 的渲染条件。
 *
 * 对标 MCreator FreeMarker 的 <#if> 块：
 * - field：参与判断的字段 key（必须在 schema.fields 中已定义）
 * - equals：当字段值（String() 后）等于 equals 时为真
 * - in：当字段值（String() 后）属于 in 数组时为真
 * - equals 和 in 同时存在时取并集（满足任一即为真）
 * - condition 整体省略时，part 无条件渲染
 */
export const TemplatePartCondition = z.object({
  field: z.string().min(1),
  equals: z.string().optional(),
  in: z.array(z.string()).optional(),
});
export type TemplatePartCondition = z.infer<typeof TemplatePartCondition>;

/**
 * 代码模板片段：一段带可选条件的 Mustache 模板。
 *
 * compileCustomNode 渲染时按数组顺序评估每个 part 的 condition，
 * 满足条件的 part 用 renderMustache 渲染后拼接，未满足的跳过。
 */
export const CustomNodeTemplatePart = z.object({
  /** 渲染条件；省略则该 part 无条件渲染（如 import / 类声明） */
  condition: TemplatePartCondition.optional(),
  /** Mustache 模板（支持 {{field:key}}/{{#if}}/{{#each}} 等全部语法） */
  template: z.string().default(''),
});
export type CustomNodeTemplatePart = z.infer<typeof CustomNodeTemplatePart>;

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
  /** Java 代码模板（Mustache 语法，{{field:key}} 注入字段值）；templateParts 为空时使用 */
  codeTemplate: z.string().default(''),
  /**
   * 条件化代码模板片段（P0-3 新增，对标 MCreator FreeMarker 条件化生成）。
   * 非空时按数组顺序评估每个 part 的 condition，满足的 part 拼接为最终代码，
   * 此时 codeTemplate 被忽略。为空（默认）时回退到 codeTemplate，保证向后兼容。
   */
  templateParts: z.array(CustomNodeTemplatePart).default([]),
});
export type CustomNodeSchema = z.infer<typeof CustomNodeSchema>;
