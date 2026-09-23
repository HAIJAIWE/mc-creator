/** 编译错误码体系
 *
 * 统一错误码格式：`CATEGORY_SUBCATEGORY`
 * - 便于程序化匹配（替代字符串包含检查）
 * - 支持国际化（i18n key）
 * - 可扩展：携带 metadata（建议修复、相关节点类型等）
 */

/** 错误分类 */
export enum CompileErrorCategory {
  /** 图结构错误 */
  GRAPH = 'GRAPH',
  /** 节点配置错误 */
  NODE = 'NODE',
  /** 连线/端口错误 */
  CONNECTION = 'CONNECTION',
  /** 循环/递归错误 */
  CYCLE = 'CYCLE',
  /** 外部依赖错误 */
  EXTERNAL = 'EXTERNAL',
  /** 配方错误 */
  RECIPE = 'RECIPE',
  /** 过程/事件错误 */
  PROCEDURE = 'PROCEDURE',
  /** 代码/脚本错误 */
  CODE = 'CODE',
  /** 内部/系统错误 */
  INTERNAL = 'INTERNAL',
}

/** 结构化编译错误 */
export interface CompileError {
  /** 错误码（如 'GRAPH_MISSING_MODID'） */
  code: string;
  /** 人类可读消息 */
  message: string;
  /** 关联节点 ID（可选，用于定位高亮） */
  nodeId?: string;
  /** 关联边 ID（可选） */
  edgeId?: string;
  /** 代码位置（行/列/片段，用于代码节点） */
  location?: { line?: number; column?: number; snippet?: string };
  /** 建议修复动作（可选） */
  suggestion?: string;
  /** 原始错误（如 JSON 解析异常） */
  cause?: Error;
  /** 错误分类 */
  category: CompileErrorCategory;
  /** 时间戳 */
  timestamp: number;
}

/** 错误码常量 */
export const CompileErrorCode = {
  // GRAPH
  GRAPH_MISSING_MODID: 'GRAPH_MISSING_MODID',
  GRAPH_INVALID_MODID: 'GRAPH_INVALID_MODID',
  GRAPH_MODID_SANITIZED: 'GRAPH_MODID_SANITIZED',

  // NODE
  NODE_DISABLED: 'NODE_DISABLED',
  NODE_LOCKED_EMPTY: 'NODE_LOCKED_EMPTY',
  NODE_KIND_MISMATCH: 'NODE_KIND_MISMATCH',
  NODE_UNKNOWN_KIND: 'NODE_UNKNOWN_KIND',

  // CONNECTION
  CONNECTION_MISSING_SOURCE: 'CONNECTION_MISSING_SOURCE',
  CONNECTION_MISSING_TARGET: 'CONNECTION_MISSING_TARGET',
  CONNECTION_SELF_LOOP: 'CONNECTION_SELF_LOOP',
  CONNECTION_NODE_NOT_FOUND: 'CONNECTION_NODE_NOT_FOUND',
  CONNECTION_NODE_DISABLED: 'CONNECTION_NODE_DISABLED',
  CONNECTION_PORT_NOT_FOUND: 'CONNECTION_PORT_NOT_FOUND',
  CONNECTION_TYPE_INCOMPATIBLE: 'CONNECTION_TYPE_INCOMPATIBLE',
  CONNECTION_DIRECTION_INVALID: 'CONNECTION_DIRECTION_INVALID',
  CONNECTION_MULTIPLE_LIMIT: 'CONNECTION_MULTIPLE_LIMIT',

  // CYCLE
  CYCLE_CONTROL_FLOW: 'CYCLE_CONTROL_FLOW',
  CYCLE_PROCEDURE_RECURSIVE: 'CYCLE_PROCEDURE_RECURSIVE',

  // EXTERNAL
  EXTERNAL_MOD_NOT_INSTALLED: 'EXTERNAL_MOD_NOT_INSTALLED',

  // RECIPE
  RECIPE_NO_OUTPUT: 'RECIPE_NO_OUTPUT',
  RECIPE_INVALID_PATTERN: 'RECIPE_INVALID_PATTERN',

  // PROCEDURE
  PROCEDURE_UNUSED: 'PROCEDURE_UNUSED',
  PROCEDURE_MISSING_INPUT: 'PROCEDURE_MISSING_INPUT',
  PROCEDURE_INVALID_ARGS: 'PROCEDURE_INVALID_ARGS',

  // CODE
  CODE_JSON_PARSE_FAILED: 'CODE_JSON_PARSE_FAILED',
  CODE_JSON_NOT_OBJECT: 'CODE_JSON_NOT_OBJECT',
  CODE_SIGNATURE_NON_STRING: 'CODE_SIGNATURE_NON_STRING',

  // INTERNAL
  INTERNAL_COMPILER_THREW: 'INTERNAL_COMPILER_THREW',
} as const;

/** 类型安全的错误码 */
export type CompileErrorCode = (typeof CompileErrorCode)[keyof typeof CompileErrorCode];

/** 创建标准化编译错误 */
export function createCompileError(
  code: CompileErrorCode,
  message: string,
  options: {
    nodeId?: string;
    edgeId?: string;
    location?: { line?: number; column?: number; snippet?: string };
    suggestion?: string;
    cause?: Error;
  } = {},
): CompileError {
  const category = code.split('_')[0] as CompileErrorCategory;
  return {
    code,
    message,
    category,
    timestamp: Date.now(),
    ...options,
  };
}

/** 常用错误工厂函数 */
export const CompileErrors = {
  graphMissingModId: (nodeId?: string) =>
    createCompileError(CompileErrorCode.GRAPH_MISSING_MODID, '节点图缺少 modId，无法编译', {
      nodeId,
      suggestion: '在图设置中填写 modId（小写字母/数字/下划线）',
    }),

  graphInvalidModId: (modId: string, nodeId?: string) =>
    createCompileError(
      CompileErrorCode.GRAPH_INVALID_MODID,
      `modId「${modId}」净化后为空（全部为非法字符），请使用小写字母/数字/下划线`,
      { nodeId, suggestion: '修改 modId 仅包含 a-z、0-9、_' },
    ),

  graphModIdSanitized: (original: string, sanitized: string, nodeId?: string) =>
    createCompileError(
      CompileErrorCode.GRAPH_MODID_SANITIZED,
      `modId「${original}」包含非法字符，已净化为「${sanitized}」`,
      { nodeId, suggestion: '建议直接使用净化后的 modId' },
    ),

  nodeLockedEmpty: (nodeId: string) =>
    createCompileError(
      CompileErrorCode.NODE_LOCKED_EMPTY,
      `节点 ${nodeId} 已锁定代码但 lockedCode 为空，回退到常规编译`,
      { nodeId, suggestion: '补全 lockedCode 或解锁节点' },
    ),

  connectionMissingSource: (edgeId?: string) =>
    createCompileError(CompileErrorCode.CONNECTION_MISSING_SOURCE, '连线缺少源节点', { edgeId }),

  connectionMissingTarget: (edgeId?: string) =>
    createCompileError(CompileErrorCode.CONNECTION_MISSING_TARGET, '连线缺少目标节点', { edgeId }),

  connectionSelfLoop: (edgeId?: string) =>
    createCompileError(CompileErrorCode.CONNECTION_SELF_LOOP, '不允许自连线', { edgeId }),

  connectionNodeNotFound: (nodeId: string, edgeId?: string) =>
    createCompileError(CompileErrorCode.CONNECTION_NODE_NOT_FOUND, `节点不存在：${nodeId}`, {
      nodeId,
      edgeId,
    }),

  connectionNodeDisabled: (nodeId: string, edgeId?: string) =>
    createCompileError(
      CompileErrorCode.CONNECTION_NODE_DISABLED,
      `${nodeId === edgeId ? '源' : '目标'}节点已禁用`,
      { nodeId, edgeId },
    ),

  connectionPortNotFound: (nodeId: string, portId: string, edgeId?: string) =>
    createCompileError(CompileErrorCode.CONNECTION_PORT_NOT_FOUND, `端口不存在：${portId}`, {
      nodeId,
      edgeId,
    }),

  connectionTypeIncompatible: (sourceType: string, targetType: string, edgeId?: string) =>
    createCompileError(
      CompileErrorCode.CONNECTION_TYPE_INCOMPATIBLE,
      `端口类型不兼容: ${sourceType} -> ${targetType}`,
      { edgeId, suggestion: '检查源端口和目标端口类型是否匹配' },
    ),

  connectionDirectionInvalid: (portId: string, expected: 'in' | 'out', edgeId?: string) =>
    createCompileError(
      CompileErrorCode.CONNECTION_DIRECTION_INVALID,
      `端口 ${portId} 必须是 ${expected === 'in' ? '输入' : '输出'} 方向`,
      { edgeId },
    ),

  connectionMultipleLimit: (targetNodeId: string, portId: string, edgeId?: string) =>
    createCompileError(
      CompileErrorCode.CONNECTION_MULTIPLE_LIMIT,
      '单连线端口已存在连线（将替换旧连线）',
      { nodeId: targetNodeId, edgeId },
    ),

  cycleControlFlow: (cycle: string[]) =>
    createCompileError(
      CompileErrorCode.CYCLE_CONTROL_FLOW,
      `检测到控制流环：${cycle.join(' -> ')}`,
      { suggestion: '移除形成环的控制流连线' },
    ),

  cycleProcedureRecursive: (procedureId: string, procedureName: string) =>
    createCompileError(
      CompileErrorCode.CYCLE_PROCEDURE_RECURSIVE,
      `过程 ${procedureId}（${procedureName}）存在递归调用链，Java 运行时将导致 StackOverflowError`,
      { nodeId: procedureId, suggestion: '移除过程间的相互调用' },
    ),

  externalModNotInstalled: (namespace: string) =>
    createCompileError(
      CompileErrorCode.EXTERNAL_MOD_NOT_INSTALLED,
      `引用了外部 mod 命名空间「${namespace}」，但该 mod 未安装，运行时可能缺失依赖`,
      { suggestion: '安装对应的外部 mod 或移除引用' },
    ),

  recipeNoOutput: (recipeId: string, nodeId: string) =>
    createCompileError(
      CompileErrorCode.RECIPE_NO_OUTPUT,
      `配方节点 ${nodeId}（${recipeId}）没有输出物品连线`,
      { nodeId, suggestion: '连接配方输出端口到一个物品节点' },
    ),

  procedureUnused: (procedureId: string, procedureName: string) =>
    createCompileError(
      CompileErrorCode.PROCEDURE_UNUSED,
      `过程 ${procedureId}（${procedureName}）未被任何事件或过程引用，生成的 Java 方法将无调用方`,
      { nodeId: procedureId, suggestion: '在事件或其他过程中调用此过程，或删除它' },
    ),

  codeJsonParseFailed: (nodeId: string, error: Error) =>
    createCompileError(
      CompileErrorCode.CODE_JSON_PARSE_FAILED,
      `节点 ${nodeId} 的参数 JSON 解析失败：${error.message}，已忽略`,
      { nodeId, cause: error, suggestion: '检查 JSON 语法是否正确' },
    ),

  codeJsonNotObject: (nodeId: string, actualType: string) =>
    createCompileError(
      CompileErrorCode.CODE_JSON_NOT_OBJECT,
      `节点 ${nodeId} 的参数 JSON 应为对象，实际为 ${actualType}，已忽略`,
      { nodeId, suggestion: '确保参数 JSON 是一个对象 {...}' },
    ),

  codeSignatureNonString: (nodeId: string) =>
    createCompileError(
      CompileErrorCode.CODE_SIGNATURE_NON_STRING,
      `节点 ${nodeId} 的端口签名 JSON 含非字符串值，已过滤（端口签名值应为 PortType 字符串）`,
      { nodeId, suggestion: '端口签名的值必须是字符串类型的 PortType' },
    ),

  internalCompilerThrew: (kind: string, nodeId: string, error: Error) =>
    createCompileError(
      CompileErrorCode.INTERNAL_COMPILER_THREW,
      `${kind}节点 ${nodeId} 编译失败：${error.message}`,
      { nodeId, cause: error },
    ),
};

/** 将结构化错误转为旧格式字符串（兼容现有代码） */
export function toErrorString(err: CompileError): string {
  let msg = `[${err.code}] ${err.message}`;
  if (err.nodeId) msg += ` (节点: ${err.nodeId})`;
  if (err.suggestion) msg += ` - 建议: ${err.suggestion}`;
  return msg;
}

/** 将错误数组转为字符串数组（兼容现有代码） */
export function toErrorStrings(errors: CompileError[]): string[] {
  return errors.map(toErrorString);
}
