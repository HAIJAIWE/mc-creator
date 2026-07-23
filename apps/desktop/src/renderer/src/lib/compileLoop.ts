import type { LoopNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';
import { validateJavaIdentifier } from './compileVariable.js';

/**
 * 编译循环节点为 Java 循环代码，包装为 CustomCodeSnippetSpec。
 * bodyCode 是循环体代码（由调用方从子图或动作节点编译得到）。
 *
 * 安全性：
 * - forEach 的 loopVarName 必须为空（回退到默认 'item'）或合法 Java 标识符，
 *   防止注入变量名破坏 Java 声明。
 *
 * 返回 { snippet }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileLoop(
  data: LoopNodeData,
  bodyCode: string,
): { snippet: CustomCodeSnippetSpec } {
  const header = buildLoopHeader(data);
  const code = `${header} {\n  ${bodyCode}\n}`;

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: `loop_${data.nodeId}`,
    },
  };
}

function buildLoopHeader(data: LoopNodeData): string {
  switch (data.loopType) {
    case 'for':
      return `for (${data.init ?? 'int i = 0'}; ${data.condition}; ${data.update ?? 'i++'})`;
    case 'forEach': {
      const javaType = loopVarTypeToJava(data.loopVarType);
      // 空名回退到默认 'item'；非空时校验为合法 Java 标识符，防止注入破坏声明
      const varName = data.loopVarName ? validateJavaIdentifier(data.loopVarName) : 'item';
      const iterable = data.iterable || 'items';
      return `for (${javaType} ${varName} : ${iterable})`;
    }
    case 'while':
      return `while (${data.condition})`;
  }
}

function loopVarTypeToJava(varType: LoopNodeData['loopVarType']): string {
  switch (varType) {
    case 'int':
      return 'int';
    case 'item':
      return 'ItemStack';
    case 'block':
      return 'BlockState';
    case 'string':
      return 'String';
  }
}
