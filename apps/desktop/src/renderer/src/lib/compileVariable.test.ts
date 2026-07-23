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
});
