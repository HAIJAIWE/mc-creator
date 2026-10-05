import type {
  SubgraphNodeData,
  CustomCodeSnippetSpec,
  CustomNodeFieldSchema,
  CustomNodeSchema,
  CustomNodeTemplatePart,
  TemplatePartCondition,
} from '@mc-creator/shared';
import { customNodeRegistry } from '../domain/customNodeRegistry.js';
import {
  isForbiddenFieldKey,
  renderMustache,
} from '../components/lowcode/custom/mustacheRender.js';

/** preload `contextBridge.exposeInMainWorld('sandboxedMustache', …)` 暴露的形状。 */
interface SandboxedMustacheBridge {
  renderMustache: (
    template: string,
    fields: Record<string, unknown>,
  ) => Promise<{ ok: boolean; result?: string; error?: string }>;
}

function getSandboxedMustacheBridge(): SandboxedMustacheBridge | null {
  // 运行在 Electron 渲染进程里时 window.sandboxedMustache 由 preload 暴露；
  // 非 Electron 上下文（jsdom 单测 / bench）为 undefined。
  return (globalThis as { sandboxedMustache?: SandboxedMustacheBridge }).sandboxedMustache ?? null;
}

/**
 * 主进程拒绝渲染时抛出的错误，**保留主进程返回的结构化 code**。
 *
 * code 单独挂在属性上（供 programmatic 判断），`message` 里也带一遍
 * （供 UI 错误列表直接展示）。`generate.ts` 的返回格式是 `[CODE] 中文说明`，
 * 这里把两段拆开，同时保证拆分失败时原样保留主进程给的字符串。
 */
export class MustacheRenderRejectedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`主进程拒绝渲染 [${code}]：${message}`);
    this.name = 'MustacheRenderRejectedError';
    this.code = code;
  }
}

const REJECTED_CODE_RE = /^\[([A-Z0-9_]+)\]\s*([\s\S]*)$/;

/**
 * 通过主进程通道渲染。
 *
 * 返回 `string` = 渲染成功；返回 `null` = **通道从未注册**（非 Electron 上下文），
 * 这是既有的 null 语义，由调用方决定怎么办。
 *
 * 「主进程明确拒绝」（`ok:false`，含 zod 入参校验失败、预算超限、深度/迭代超限、
 * 结构非法）**一律抛 `MustacheRenderRejectedError`，绝不静默回退**。
 *
 * 为什么必须这样切分：
 * - 修漏洞前这里是 `sandboxed ?? renderMustache(...)`：主进程一旦因为
 *   `OUTPUT_LIMIT_EXCEEDED` / `BLOCK_DEPTH_EXCEEDED` 返回 `ok:false`，渲染层就
 *   回退到**未加固**的本地实现 —— 攻击输入在渲染进程里重新无上限生效，
 *   `{{field:constructor}}` 真的泄出 `function Object() { [native code] }`。
 *   加固只覆盖了成功路径，回退路径把加固整个抵消掉。
 * - 「通道不存在」与「主进程拒绝」是两回事：前者只发生在非 Electron 上下文，
 *   后者是**攻击输入触发的拒绝**。把后者也当成「拿不到桥、静默兜底」，
 *   等于把安全检查的结果当成环境问题。
 */
async function renderMustacheViaMainProcess(
  template: string,
  fields: Record<string, unknown>,
): Promise<string | null> {
  const bridge = getSandboxedMustacheBridge();
  // 既有 null 语义：通道未注册 → 返回 null，由调用方走渲染层兜底
  if (bridge === null) return null;

  let result: { ok: boolean; result?: string; error?: string };
  try {
    result = await bridge.renderMustache(template, fields);
  } catch (err) {
    // IPC 调用本身失败（主进程 handler 崩溃 / zod 抛错 → invoke reject）：
    // 同样是「主进程明确拒绝」，不是环境问题，不回退。
    const msg = err instanceof Error ? err.message : String(err);
    throw new MustacheRenderRejectedError('IPC_INVOKE_FAILED', `IPC 调用失败：${msg}`);
  }

  if (result.ok === true) {
    if (typeof result.result !== 'string') {
      // 协议违例（ok:true 却没带 result）：同样不回退，否则等于给主进程开后门
      throw new MustacheRenderRejectedError(
        'MALFORMED_RESPONSE',
        '主进程返回 ok:true 但缺少 result 字段',
      );
    }
    return result.result;
  }

  const raw = typeof result.error === 'string' ? result.error : '(主进程未提供错误说明)';
  const matched = REJECTED_CODE_RE.exec(raw);
  const code = matched?.[1] ?? 'UNKNOWN';
  const message = matched?.[2] ?? raw;
  throw new MustacheRenderRejectedError(code, message);
}

/**
 * 渲染单个模板片段：**主进程是唯一真相来源**。
 *
 * - 通道存在 → 只用主进程结果（拒绝则抛，见上）
 * - 通道不存在（非 Electron 上下文）→ 用渲染层兜底实现；该实现与主进程
 *   逐条对齐了预算/原型链防线（`mustacheRender.ts`），不再是放大器
 */
async function renderTemplatePart(
  template: string,
  sanitizedFields: Record<string, unknown>,
): Promise<string> {
  const viaMain = await renderMustacheViaMainProcess(template, sanitizedFields);
  return viaMain ?? renderMustache(template, sanitizedFields);
}

/**
 * 编译自定义节点为 Java 代码片段，包装为 CustomCodeSnippetSpec。
 *
 * 流程：
 * 1. 从 data.customTypeId 查 customNodeRegistry 取 schema
 * 2. 校验 required 字段（fields 中 required=true 的 key 必须在 fields 参数中存在且非空）
 * 3. 净化 fields：仅保留 schema 中定义的 key，并按字段类型强制转换值
 *    - number 类型：Number() 转换，NaN 回退为 0（防止注入非法 Java 标识符）
 *    - 其他类型：保留原值（渲染器会做 String() 转换 + Java 字符串转义）
 * 4. 渲染代码：
 *    - 若 schema.templateParts 非空（P0-3 新增）：按数组顺序评估每个 part 的 condition，
 *      满足条件的 part 渲染后拼接，对标 MCreator FreeMarker 条件化生成。
 *      此时 codeTemplate 被忽略。
 *    - 否则（templateParts 为空）：回退到 schema.codeTemplate 渲染（向后兼容）。
 *
 * 失败时返回 { error }（不抛异常，由调用方收集到 errors）：
 * - customTypeId 为 null：非自定义节点，不应调此函数
 * - schema 未注册：自定义类型已删除或未导入（**注意：这条路径在渲染之前就返回，
 *   「未注册 custom node」与「主进程拒绝渲染」因此天然不会互相干扰**）
 * - required 字段缺失：用户需填写
 *
 * 唯一的例外是渲染阶段：主进程拒绝渲染会抛 `MustacheRenderRejectedError`
 * （`compileAll` 会捕获并记进 errors，不影响其他节点）。这是刻意的 ——
 * 模板被安全检查拒绝时不能继续用本地实现「凑合出」一段代码。
 *
 * 返回 { snippet?, error? }，由 compileNodeGraph push 到 customCode 数组。
 */
export async function compileCustomNode(
  data: SubgraphNodeData,
  fields: Record<string, unknown>,
): Promise<{ snippet?: CustomCodeSnippetSpec; error?: string }> {
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
  const code = await renderSchemaTemplate(schema, sanitizedFields);

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
 * 渲染整个 schema 的代码：templateParts 非空走分片，否则回退 codeTemplate。
 */
async function renderSchemaTemplate(
  schema: CustomNodeSchema,
  sanitizedFields: Record<string, unknown>,
): Promise<string> {
  const parts = schema.templateParts;
  if (parts.length > 0) {
    return renderTemplateParts(parts, sanitizedFields, schema.fields);
  }
  return renderTemplatePart(schema.codeTemplate, sanitizedFields);
}

/**
 * 渲染条件化代码模板片段（P0-3，对标 MCreator FreeMarker 条件化生成）。
 *
 * - 按数组顺序评估每个 part 的 condition，满足的 part 渲染后拼接
 * - 无 condition 的 part 无条件渲染（如 import / 类声明骨架）
 * - 安全性：condition.field 必须在 schemaFields 中已定义，否则视为不匹配
 *   （防止用户通过额外字段绕过 schema 控制）
 * - 字段缺失视为不匹配（与渲染器 {{#if}} 行为一致）
 * - equals 和 in 同时存在时取并集（满足任一即渲染）
 *
 * 注：字段值统一通过 String() 转换后与 equals/in 中的字符串比较，
 * 这样 number 字段 3 与 condition equals='3' 可匹配。
 *
 * 任何一个 part 被主进程拒绝渲染都会向上抛出：拼接一半的结果不是合法代码片段，
 * 静默继续只会产出编译不过的 Java。
 */
async function renderTemplateParts(
  parts: CustomNodeTemplatePart[],
  sanitizedFields: Record<string, unknown>,
  schemaFields: CustomNodeFieldSchema[],
): Promise<string> {
  const schemaFieldKeys = new Set(
    schemaFields.filter((f) => !isForbiddenFieldKey(f.key)).map((f) => f.key),
  );
  let result = '';
  for (const part of parts) {
    if (!part.condition) {
      result += await renderTemplatePart(part.template, sanitizedFields);
      continue;
    }
    if (evaluateCondition(part.condition, sanitizedFields, schemaFieldKeys)) {
      result += await renderTemplatePart(part.template, sanitizedFields);
    }
  }
  return result;
}

/**
 * 评估 templatePart 的 condition 是否满足。
 *
 * 返回 false 的情况：
 * - condition.field 不在 schemaFieldKeys 中（未定义字段，防绕过；原型链键也不算数）
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
  // 字段缺失视为不匹配（Object.hasOwn 而非 `in`：`in` 会命中原型链，
  // 让 condition.field='constructor' 这种探针走进分支）
  if (!Object.hasOwn(sanitizedFields, condition.field)) return false;
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
 * - 其他类型：保留原值，由渲染器负责 String() 转换与 Java 字符串转义
 *
 * 未在 schema 中定义的 key 会被丢弃，防止额外字段泄露到模板渲染。
 *
 * 两处原型链防线（key 来自**导入的自定义节点 JSON**，因此不可信）：
 * 1. `Object.hasOwn(fields, field.key)` 而不是 `field.key in fields`
 *    —— `in` 会命中原型链；
 * 2. 跳过原型链键（`__proto__` / `prototype` / `constructor`）
 *    —— `result['__proto__'] = value` 会改掉 `result` 自己的原型（原型污染），
 *    后续所有「读 result」的逻辑都会开始信任攻击者指定的原型。
 */
function sanitizeFields(
  fields: Record<string, unknown>,
  schemaFields: CustomNodeFieldSchema[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of schemaFields) {
    if (isForbiddenFieldKey(field.key)) continue;
    if (!Object.hasOwn(fields, field.key)) continue;
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
