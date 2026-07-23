import { describe, it, expect } from 'vitest';
import { compileLoop } from './compileLoop.js';
import type { LoopNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileLoop', () => {
  it('for 循环编译为 Java for 代码', () => {
    const data: LoopNodeData = {
      nodeId: 'l1',
      label: '计数',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'for',
      init: 'int i = 0',
      condition: 'i < 10',
      update: 'i++',
      loopVarName: 'i',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.snippetId).toBe('l1');
    expect(snippet.code).toContain('for (int i = 0; i < 10; i++)');
    expect(snippet.code).toContain('// body');
  });

  it('forEach 循环编译为 Java for-each', () => {
    const data: LoopNodeData = {
      nodeId: 'l2',
      label: '遍历',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'itemList',
      collapsed: false,
      codeLocked: false,
    };
    const { snippet } = compileLoop(data, '// do something');
    expect(snippet.code).toContain('for (ItemStack item : itemList)');
    expect(snippet.code).toContain('// do something');
  });

  it('while 循环编译为 Java while', () => {
    const data: LoopNodeData = {
      nodeId: 'l3',
      label: 'w',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'while',
      condition: 'running',
      loopVarName: '',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.code).toContain('while (running)');
    expect(snippet.code).toContain('// body');
  });

  it('返回类型是 { snippet }（CustomCodeSnippetSpec）', () => {
    const data: LoopNodeData = {
      nodeId: 'l4',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'for',
      init: 'int i = 0',
      condition: 'i<1',
      update: 'i++',
      loopVarName: 'i',
      loopVarType: 'int',
      collapsed: false,
      codeLocked: false,
    };
    const result = compileLoop(data, '');
    const _: CustomCodeSnippetSpec = result.snippet;
    expect(_.snippetId).toBe('l4');
  });

  it('forEach 非法 loopVarName 抛出错误（Java 标识符校验）', () => {
    const data: LoopNodeData = {
      nodeId: 'l5',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: '1invalid name!',
      loopVarType: 'item',
      iterable: 'items',
      collapsed: false,
      codeLocked: false,
    };
    expect(() => compileLoop(data, '// body')).toThrow(/Java 标识符/);
  });

  it('forEach 空 loopVarName 回退到默认 "item"（不抛错）', () => {
    const data: LoopNodeData = {
      nodeId: 'l6',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: '',
      loopVarType: 'item',
      iterable: 'items',
      collapsed: false,
      codeLocked: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.code).toContain('for (ItemStack item : items)');
  });

  it('forEach 合法 loopVarName 含 $ 和 _ 通过校验', () => {
    const data: LoopNodeData = {
      nodeId: 'l7',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'loop',
      loopType: 'forEach',
      condition: '',
      loopVarName: '$each_item',
      loopVarType: 'item',
      iterable: 'items',
      collapsed: false,
      codeLocked: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.code).toContain('for (ItemStack $each_item : items)');
  });
});
