import type {
  SubgraphNodeData,
  CustomCodeSnippetSpec,
  CustomNodeFieldSchema,
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
 * 4. 用 renderMustache 把 schema.codeTemplate 与净化后的 fields 合并渲染
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

  const code = renderMustache(schema.codeTemplate, sanitizedFields);

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
 * 净化字段值：仅保留 schema 中定义的 key，并按字段类型强制转换。
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
