import type { LoopNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 编译循环节点为 Java 循环代码，包装为 CustomCodeSnippetSpec。
 * bodyCode 是循环体代码（由调用方从子图或动作节点编译得到）。
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
      const varName = data.loopVarName || 'item';
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
