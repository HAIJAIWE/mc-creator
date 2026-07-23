import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 编译变量节点为 Java 字段声明，包装为 CustomCodeSnippetSpec。
 *
 * - isConstant=true → public static final
 * - isConstant=false → public 实例字段
 * - item/block 类型用 ItemStack/BlockState 引用
 *
 * 返回 { snippet, varName }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileVariable(data: VariableNodeData): {
  snippet: CustomCodeSnippetSpec;
  varName: string;
} {
  const javaType = varTypeToJava(data.varType);
  const javaValue = formatValue(data.value, data.varType);
  const modifier = data.isConstant ? 'public static final' : 'public';
  const code = `${modifier} ${javaType} ${data.varName} = ${javaValue};`;

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: data.varName,
    },
    varName: data.varName,
  };
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
    case 'int':
      return String(Number(value) || 0);
    case 'double':
      return `${Number(value) || 0.0}`;
    case 'string':
      return `"${String(value).replace(/"/g, '\\"')}"`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'item':
      // 用 ResourceLocation 解析物品 id（保留原值，支持任意命名空间）
      return `new ItemStack(ForgeRegistries.ITEMS.getValue(new ResourceLocation("${String(value)}")))`;
    case 'block':
      return `ForgeRegistries.BLOCKS.getValue(new ResourceLocation("${String(value)}")).defaultBlockState()`;
  }
}
