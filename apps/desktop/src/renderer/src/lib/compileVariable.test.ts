import { describe, it, expect } from 'vitest';
import { compileVariable } from './compileVariable.js';
import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileVariable', () => {
  it('常量 int 编译为 static final 字段', () => {
    const data: VariableNodeData = {
      nodeId: 'v1',
      label: '最大伤害',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'MAX_DAMAGE',
      varType: 'int',
      value: 10,
      isConstant: true,
      collapsed: false,
    };
    const { snippet, varName } = compileVariable(data);
    expect(varName).toBe('MAX_DAMAGE');
    expect(snippet.snippetId).toBe('v1');
    expect(snippet.language).toBe('java');
    expect(snippet.code).toContain('public static final int MAX_DAMAGE = 10;');
    expect(snippet.methodName).toBe('MAX_DAMAGE');
  });

  it('变量 string 编译为实例字段', () => {
    const data: VariableNodeData = {
      nodeId: 'v2',
      label: '玩家名',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'playerName',
      varType: 'string',
      value: 'Steve',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('public String playerName = "Steve";');
    expect(snippet.code).not.toContain('static final');
  });

  it('boolean 编译', () => {
    const data: VariableNodeData = {
      nodeId: 'v3',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'enabled',
      varType: 'boolean',
      value: true,
      isConstant: true,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('public static final boolean enabled = true;');
  });

  it('item 类型编译为 ItemStack 引用', () => {
    const data: VariableNodeData = {
      nodeId: 'v4',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'defaultItem',
      varType: 'item',
      value: 'iron_sword',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('ItemStack');
    expect(snippet.code).toContain('iron_sword');
  });

  it('返回类型是 CustomCodeSnippetSpec', () => {
    const data: VariableNodeData = {
      nodeId: 'v5',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'x',
      varType: 'int',
      value: 0,
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    const _: CustomCodeSnippetSpec = snippet;
    expect(_.snippetId).toBeDefined();
  });

  it('string 类型转义反斜杠（先于引号转义，防止关闭字符串）', () => {
    // 输入 a\" (3 chars: a, \, ") 暴露反斜杠/引号转义顺序问题：
    // 正确顺序（先 \ 后 "）: a\\\"  → Java 字符串内容 a\"
    // 错误顺序（先 " 后 \）: a\\\\\" → 反斜杠吞掉了引号转义，语义改变
    const data: VariableNodeData = {
      nodeId: 'v6',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'path',
      varType: 'string',
      value: 'a\\"',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    // 期望 Java 源码: public String path = "a\\\"";
    // 即字符串字面量 "a\\\"" 内容为 a\"
    expect(snippet.code).toBe('public String path = "a\\\\\\"";');
  });

  it('string 类型转义引号防止注入', () => {
    const data: VariableNodeData = {
      nodeId: 'v7',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 's',
      varType: 'string',
      value: 'x"; evil(); "',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    // 整个字段值作为字符串内容，evil() 是数据而非代码
    expect(snippet.code).toContain('\\"');
    expect(snippet.code).toContain('evil()');
  });

  it('item 类型转义字符串值（防止 ResourceLocation 注入）', () => {
    const data: VariableNodeData = {
      nodeId: 'v8',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'it',
      varType: 'item',
      value: 'a";evil();"',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    // ResourceLocation 字符串字面量内的引号需被转义为 \"
    expect(snippet.code).toContain('\\"');
    // evil() 作为字符串数据保留（在字符串字面量内是安全的）
    expect(snippet.code).toContain('evil()');
    // ResourceLocation 参数应为单个合法 Java 字符串字面量（转义后的 \" 不应断开字符串）
    // 校验：ResourceLocation("...") 中 ... 部分匹配 Java 字符串字面量语法（含转义序列）
    expect(snippet.code).toMatch(/ResourceLocation\("(?:[^"\\]|\\.)*"\)/);
  });

  it('block 类型转义字符串值（防止 ResourceLocation 注入）', () => {
    const data: VariableNodeData = {
      nodeId: 'v9',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'bk',
      varType: 'block',
      value: 'x";inject();"',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('\\"');
    expect(snippet.code).toContain('inject()');
    expect(snippet.code).toMatch(/ResourceLocation\("(?:[^"\\]|\\.)*"\)/);
  });

  it('非法 varName 抛出错误（Java 标识符校验）', () => {
    const data: VariableNodeData = {
      nodeId: 'v10',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: '1invalid name!',
      varType: 'int',
      value: 0,
      isConstant: false,
      collapsed: false,
    };
    expect(() => compileVariable(data)).toThrow(/Java 标识符/);
  });

  it('合法 varName 含 $ 和 _ 通过校验', () => {
    const data: VariableNodeData = {
      nodeId: 'v11',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: '$my_var1',
      varType: 'int',
      value: 0,
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('$my_var1');
  });

  it('int 类型 0 不被替换为 0（Number.isFinite 校验）', () => {
    const data: VariableNodeData = {
      nodeId: 'v12',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'zero',
      varType: 'int',
      value: 0,
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('= 0;');
  });

  it('int 类型 NaN/Infinity 回退为 0', () => {
    const data: VariableNodeData = {
      nodeId: 'v13',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'n',
      varType: 'int',
      value: 'NaN',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('= 0;');
  });

  it('int 类型截断小数为整数（Math.trunc）', () => {
    const data: VariableNodeData = {
      nodeId: 'v14',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'n',
      varType: 'int',
      value: 3.7,
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('= 3;');
    expect(snippet.code).not.toContain('3.7');
  });

  it('double 类型 0.0 不被替换（Number.isFinite 校验）', () => {
    const data: VariableNodeData = {
      nodeId: 'v15',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'd',
      varType: 'double',
      value: 0,
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toMatch(/= 0(\.0)?;/);
  });

  it('double 类型 Infinity 回退为 0.0', () => {
    const data: VariableNodeData = {
      nodeId: 'v16',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'variable',
      varName: 'd',
      varType: 'double',
      value: 'Infinity',
      isConstant: false,
      collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toMatch(/= 0(\.0)?;/);
  });
});
