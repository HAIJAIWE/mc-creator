import type {
  SubgraphNodeData,
  CustomCodeSnippetSpec,
  CustomNodeFieldSchema,
  CustomNodeTemplatePart,
  TemplatePartCondition,
} from '@mc-creator/shared';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import { renderMustache } from '../components/lowcode/custom/mustacheRender.js';

/**
 * 编译自定义节点为 Java 代码片段，包装为 CustomCodeSnippetSpec。
 *
 * 流程：
 * 1. 从 data.customTypeId 查 customNodeRegistry 取 schema
 * 2. 校验 required 字段（fields 中 required=true 的 key 必须在 fields 参数中存在且非空）
 * 3. 净化 fields：仅保留 schema 中定义的 key，并按字段类型强制转换值
 *    - number 类型：Number() 转换，NaN 回退为 0（防止注入非法 Java 标识符）
 *    - 其他类型：保留原值（renderMustache 会做 String() 转换 + Java 字符串转义）
 * 4. 渲染代码：
 *    - 若 schema.templateParts 非空（P0-3 新增）：按数组顺序评估每个 part 的 condition，
 *      满足条件的 part 用 renderMustache 渲染后拼接，对标 MCreator FreeMarker 条件化生成。
 *      此时 codeTemplate 被忽略。
 *    - 否则（templateParts 为空）：回退到 schema.codeTemplate 渲染（向后兼容）。
 * 5. 包装为 CustomCodeSnippetSpec 返回
 *
 * 失败时返回 { error }（不抛异常，由调用方收集到 errors）：
 * - customTypeId 为 null：非自定义节点，不应调此函数
 * - schema 未注册：自定义类型已删除或未导入
 * - required 字段缺失：用户需填写
 *
 * 返回 { snippet?, error? }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileCustomNode(
  data: SubgraphNodeData,
  fields: Record<string, unknown>,
): { snippet?: CustomCodeSnippetSpec; error?: string } {
  if (!data.customTypeId) {
    return { error: `节点 ${data.nodeId} 的 customTypeId 为 null，不能作为自定义节点编译` };
  }
  const schema = customNodeRegistry.get(data.customTypeId);
  if (!schema) {
    return { error: `自定义节点类型未注册：${data.customTypeId}（节点 ${data.nodeId}）` };
  }

  // 校验 required 字段
  for (const field of schema.fields) {
    if (!field.required) continue;
    const val = fields[field.key];
    if (val === undefined || val === null || val === '') {
      return {
        error: `自定义节点 ${data.nodeId} 缺少必填字段：${field.key}（${field.label}）`,
      };
    }
  }

  // 净化 fields：仅保留 schema 中定义的 key，并按类型强制转换值
  const sanitizedFields = sanitizeFields(fields, schema.fields);

  // 渲染代码：P0-3 优先使用 templateParts，否则回退到 codeTemplate
  const code =
    schema.templateParts && schema.templateParts.length > 0
      ? renderTemplateParts(schema.templateParts, sanitizedFields, schema.fields)
      : renderMustache(schema.codeTemplate, sanitizedFields);

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: `custom_${data.nodeId}`,
    },
  };
}

/**
 * 渲染条件化代码模板片段（P0-3，对标 MCreator FreeMarker 条件化生成）。
 *
 * - 按数组顺序评估每个 part 的 condition，满足的 part 用 renderMustache 渲染后拼接
 * - 无 condition 的 part 无条件渲染（如 import / 类声明骨架）
 * - 安全性：condition.field 必须在 schemaFields 中已定义，否则视为不匹配
 *   （防止用户通过额外字段绕过 schema 控制）
 * - 字段缺失视为不匹配（与 mustacheRender {{#if}} 行为一致）
 * - equals 和 in 同时存在时取并集（满足任一即渲染）
 *
 * 注：字段值统一通过 String() 转换后与 equals/in 中的字符串比较，
 * 这样 number 字段 3 与 condition equals='3' 可匹配。
 */
function renderTemplateParts(
  parts: CustomNodeTemplatePart[],
  sanitizedFields: Record<string, unknown>,
  schemaFields: CustomNodeFieldSchema[],
): string {
  const schemaFieldKeys = new Set(schemaFields.map((f) => f.key));
  let result = '';
  for (const part of parts) {
    if (!part.condition) {
      result += renderMustache(part.template, sanitizedFields);
      continue;
    }
    if (evaluateCondition(part.condition, sanitizedFields, schemaFieldKeys)) {
      result += renderMustache(part.template, sanitizedFields);
    }
  }
  return result;
}

/**
 * 评估 templatePart 的 condition 是否满足。
 *
 * 返回 false 的情况：
 * - condition.field 不在 schemaFieldKeys 中（未定义字段，防绕过）
 * - sanitizedFields 中无该字段（用户未提供）
 * - 字段值（String() 后）既不等于 equals 也不在 in 数组中
 *
 * equals 和 in 都未提供时返回 true（视为无条件），但此时更建议省略 condition。
 */
function evaluateCondition(
  condition: TemplatePartCondition,
  sanitizedFields: Record<string, unknown>,
  schemaFieldKeys: Set<string>,
): boolean {
  // 安全检查：condition 引用的字段必须在 schema 中定义
  if (!schemaFieldKeys.has(condition.field)) return false;
  // 字段缺失视为不匹配
  if (!(condition.field in sanitizedFields)) return false;
  const raw = sanitizedFields[condition.field];
  if (raw === undefined || raw === null) return false;
  const str = String(raw);

  const eqMatch = condition.equals !== undefined && str === condition.equals;
  const inMatch = condition.in !== undefined && condition.in.includes(str);
  // equals 和 in 都未提供：视为无条件满足
  if (condition.equals === undefined && condition.in === undefined) return true;
  return eqMatch || inMatch;
}

/**
 * 净化字段值：仅保留 schema 中定义的 key，并按类型强制转换。
 *
 * - number 类型：用 Number() 转换；NaN/Infinity 回退为 0，防止注入非法 Java 标识符
 * - 其他类型：保留原值，由 renderMustache 负责 String() 转换与 Java 字符串转义
 *
 * 未在 schema 中定义的 key 会被丢弃，防止额外字段泄露到模板渲染。
 */
function sanitizeFields(
  fields: Record<string, unknown>,
  schemaFields: CustomNodeFieldSchema[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of schemaFields) {
    if (!(field.key in fields)) continue;
    const raw = fields[field.key];
    if (field.type === 'number') {
      const n = Number(raw);
      result[field.key] = Number.isFinite(n) ? n : 0;
    } else {
      result[field.key] = raw;
    }
  }
  return result;
}
