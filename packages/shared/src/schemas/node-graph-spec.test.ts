import { describe, it, expect } from 'vitest';
import { NodeKind, VariableNodeData } from './node-graph-spec.js';

describe('NodeKind 扩展（阶段 C：variable）', () => {
  it('包含 variable', () => {
    expect(NodeKind.options).toContain('variable');
  });
});

describe('VariableNodeData', () => {
  it('常量 int 变量解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v1',
      label: '最大伤害',
      kind: 'variable',
      varName: 'MAX_DAMAGE',
      varType: 'int',
      value: 10,
      isConstant: true,
    });
    expect(v.varType).toBe('int');
    expect(v.isConstant).toBe(true);
    expect(v.value).toBe(10);
  });

  it('变量 string 解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v2',
      label: '玩家名',
      kind: 'variable',
      varName: 'playerName',
      varType: 'string',
      value: 'Steve',
      isConstant: false,
    });
    expect(v.isConstant).toBe(false);
  });

  it('varName 必须是合法标识符', () => {
    expect(() =>
      VariableNodeData.parse({
        nodeId: 'v3',
        label: 'x',
        kind: 'variable',
        varName: '1invalid',
        varType: 'int',
        value: 0,
        isConstant: false,
      }),
    ).toThrow();
  });

  it('varType 必须在枚举内', () => {
    expect(() =>
      VariableNodeData.parse({
        nodeId: 'v4',
        label: 'x',
        kind: 'variable',
        varName: 'x',
        varType: 'float',
        value: 0,
        isConstant: false,
      }),
    ).toThrow();
  });

  it('默认 isConstant=false', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v5',
      label: 'x',
      kind: 'variable',
      varName: 'x',
      varType: 'int',
      value: 0,
    });
    expect(v.isConstant).toBe(false);
  });
});
