import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';
import { escapeJavaStringLiteral } from './javaEscape.js';

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
      // L-5 修复：显式比较，避免数字/字符串等 truthy 值被误生成 `= true;`
      return value === true ? 'true' : 'false';
    case 'item':
      // Critical 修复：yarn 下 Registries.ITEM.get(Identifier) 直接返回 Item（可 null），
      // 用 requireNonNullElse 回落 Items.AIR，与 block 分支同构。
      return `new ItemStack(java.util.Objects.requireNonNullElse(Registries.ITEM.get(new Identifier("${escapeJavaStringLiteral(
        String(value),
      )}")), Items.AIR))`;
    case 'block':
      return `java.util.Objects.requireNonNullElse(Registries.BLOCK.get(new Identifier("${escapeJavaStringLiteral(
        String(value),
      )}")), Blocks.AIR).getDefaultState()`;
  }
}
