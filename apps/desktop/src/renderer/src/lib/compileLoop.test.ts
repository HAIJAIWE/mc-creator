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
    };
    const result = compileLoop(data, '');
    const _: CustomCodeSnippetSpec = result.snippet;
    expect(_.snippetId).toBe('l4');
  });
});
