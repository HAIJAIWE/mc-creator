import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 编译变量节点为 Java 字段声明，包装为 CustomCodeSnippetSpec。
 *
 * - isConstant=true → public static final
 * - isConstant=false → public 实例字段
 * - item/block 类型用 ItemStack/BlockState 引用
 *
 * 安全性：
 * - varName 必须是合法 Java 标识符（防止注入字段名破坏声明）
 * - string/item/block 类型的值做 Java 字符串字面量转义（先转义反斜杠再转义引号）
 *
 * 返回 { snippet, varName }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileVariable(data: VariableNodeData): {
  snippet: CustomCodeSnippetSpec;
  varName: string;
} {
  const safeName = validateJavaIdentifier(data.varName);
  const javaType = varTypeToJava(data.varType);
  const javaValue = formatValue(data.value, data.varType);
  const modifier = data.isConstant ? 'public static final' : 'public';
  const code = `${modifier} ${javaType} ${safeName} = ${javaValue};`;

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: safeName,
    },
    varName: safeName,
  };
}

/**
 * 校验 Java 标识符。Java 标识符规则：首字符为字母/下划线/$，其余为字母/数字/下划线/$。
 * 非法标识符抛出错误，防止字段名注入破坏 Java 声明。
 */
export function validateJavaIdentifier(name: string): string {
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name)) {
    throw new Error(`变量名「${name}」不是合法的 Java 标识符`);
  }
  return name;
}

/** Java 字符串字面量转义：先转义反斜杠再转义引号，避免 \" 被错误解析为关闭字符串 */
function escapeJavaStringLiteral(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function varTypeToJava(varType: VariableNodeData['varType']): string {
  switch (varType) {
    case 'int':
      return 'int';
    case 'double':
      return 'double';
    case 'string':
      return 'String';
    case 'boolean':
      return 'boolean';
    case 'item':
      return 'ItemStack';
    case 'block':
      return 'BlockState';
  }
}

function formatValue(value: unknown, varType: VariableNodeData['varType']): string {
  switch (varType) {
    case 'int': {
      const n = Number(value);
      return String(Number.isFinite(n) ? Math.trunc(n) : 0);
    }
    case 'double': {
      const n = Number(value);
      return String(Number.isFinite(n) ? n : 0.0);
    }
    case 'string':
      return `"${escapeJavaStringLiteral(String(value))}"`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'item':
      // 用 ResourceLocation 解析物品 id（值做 Java 字符串字面量转义，防止注入关闭字符串）
      return `new ItemStack(ForgeRegistries.ITEMS.getValue(new ResourceLocation("${escapeJavaStringLiteral(
        String(value),
      )}")))`;
    case 'block':
      return `ForgeRegistries.BLOCKS.getValue(new ResourceLocation("${escapeJavaStringLiteral(
        String(value),
      )}")).defaultBlockState()`;
  }
}
