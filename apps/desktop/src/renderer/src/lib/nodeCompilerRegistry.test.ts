import { describe, it, expect, beforeEach } from 'vitest';
import type { ModNode, NodeGraph, NodeKind, ItemSpec } from '@mc-creator/shared';
import {
  registerCompiler,
  getCompiler,
  clearCompilers,
  registeredKinds,
  mergeOutput,
  compileAll,
  type CompilerOutput,
  type CompileContext,
} from './nodeCompilerRegistry.js';

// ============================================================
// P1-2 节点编译器注册表（对标 MCreator ModElementGenerator registry）
//
// 设计目标：
// - registerCompiler/getCompiler 按 kind 注册与查找
// - mergeOutput 把产出合并到 dst（数组 concat）
// - compileAll 遍历节点按 kind 分发，异常转 error，未注册 kind 跳过
// ============================================================

/** 构造最小 ModNode（data 仅含 kind + nodeId，测试用） */
function makeNode(id: string, kind: NodeKind): ModNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { nodeId: id, kind } as ModNode['data'],
    ports: [],
    selected: false,
  };
}

/** 构造最小 CompileContext（测试用） */
function makeCtx(): CompileContext {
  const emptyGraph: NodeGraph = {
    version: 1,
    modId: 'test',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
    subgraphs: {},
  };
  return {
    graph: emptyGraph,
    sanitizedModId: 'test',
    compileLoopBody: () => '// no body',
  };
}

describe('nodeCompilerRegistry', () => {
  beforeEach(() => {
    clearCompilers();
  });

  describe('registerCompiler / getCompiler', () => {
    it('注册后能按 kind 查到', () => {
      const compiler = {
        kind: 'item' as const,
        compile: () => ({}),
      };
      registerCompiler(compiler);
      expect(getCompiler('item')).toBe(compiler);
    });

    it('未注册的 kind 返回 undefined', () => {
      expect(getCompiler('block')).toBeUndefined();
    });

    it('同 kind 重复注册覆盖旧值', () => {
      const c1 = { kind: 'item' as const, compile: () => ({}) };
      const c2 = { kind: 'item' as const, compile: () => ({}) };
      registerCompiler(c1);
      registerCompiler(c2);
      expect(getCompiler('item')).toBe(c2);
    });
  });

  describe('clearCompilers / registeredKinds', () => {
    it('clearCompilers 后所有编译器被清除', () => {
      registerCompiler({ kind: 'item', compile: () => ({}) });
      registerCompiler({ kind: 'block', compile: () => ({}) });
      expect(registeredKinds()).toHaveLength(2);
      clearCompilers();
      expect(registeredKinds()).toEqual([]);
      expect(getCompiler('item')).toBeUndefined();
    });

    it('registeredKinds 返回已注册 kind 列表', () => {
      registerCompiler({ kind: 'item', compile: () => ({}) });
      registerCompiler({ kind: 'entity', compile: () => ({}) });
      const kinds = registeredKinds();
      expect(kinds).toContain('item');
      expect(kinds).toContain('entity');
      expect(kinds).toHaveLength(2);
    });
  });

  describe('mergeOutput', () => {
    it('数组合并（concat 追加）', () => {
      const dst: CompilerOutput = { items: [{ id: 'a', name: 'A' } as ItemSpec] };
      const src: CompilerOutput = { items: [{ id: 'b', name: 'B' } as ItemSpec] };
      mergeOutput(dst, src);
      expect(dst.items).toHaveLength(2);
      expect(dst.items?.[0].id).toBe('a');
      expect(dst.items?.[1].id).toBe('b');
    });

    it('dst 字段不存在时初始化数组', () => {
      const dst: CompilerOutput = {};
      const src: CompilerOutput = { blocks: [{ id: 'x', name: 'X' } as never] };
      mergeOutput(dst, src);
      expect(dst.blocks).toHaveLength(1);
    });

    it('warnings 和 errors 追加', () => {
      const dst: CompilerOutput = { warnings: ['w1'], errors: ['e1'] };
      const src: CompilerOutput = { warnings: ['w2'], errors: ['e2'] };
      mergeOutput(dst, src);
      expect(dst.warnings).toEqual(['w1', 'w2']);
      expect(dst.errors).toEqual(['e1', 'e2']);
    });

    it('src 字段为 undefined 时不影响 dst', () => {
      const dst: CompilerOutput = { items: [{ id: 'a', name: 'A' } as ItemSpec] };
      const src: CompilerOutput = { blocks: [{ id: 'b', name: 'B' } as never] };
      mergeOutput(dst, src);
      expect(dst.items).toHaveLength(1);
      expect(dst.blocks).toHaveLength(1);
    });
  });

  describe('compileAll', () => {
    it('按 kind 分发到注册的编译器', () => {
      const itemCalls: string[] = [];
      registerCompiler({
        kind: 'item',
        compile: (node) => {
          itemCalls.push(node.id);
          return { items: [{ id: node.id, name: 'I' } as ItemSpec] };
        },
      });

      const nodes = [makeNode('n1', 'item'), makeNode('n2', 'item')];
      const { output, errors } = compileAll(nodes, makeCtx());

      expect(itemCalls).toEqual(['n1', 'n2']);
      expect(output.items).toHaveLength(2);
      expect(output.items?.[0].id).toBe('n1');
      expect(output.items?.[1].id).toBe('n2');
      expect(errors).toEqual([]);
    });

    it('保持节点图顺序（按入参 nodes 顺序）', () => {
      registerCompiler({
        kind: 'item',
        compile: (node) => ({ items: [{ id: node.id, name: 'I' } as ItemSpec] }),
      });
      registerCompiler({
        kind: 'block',
        compile: (node) => ({ blocks: [{ id: node.id, name: 'B' } as never] }),
      });

      const nodes = [makeNode('a', 'item'), makeNode('b', 'block'), makeNode('c', 'item')];
      const { output } = compileAll(nodes, makeCtx());

      // items 数组保持 a, c（图顺序）
      expect(output.items?.map((i) => i.id)).toEqual(['a', 'c']);
      // blocks 数组保持 b
      expect(output.blocks?.map((b) => b.id)).toEqual(['b']);
    });

    it('未注册 kind 静默跳过（不报错）', () => {
      registerCompiler({
        kind: 'item',
        compile: () => ({ items: [{ id: 'x', name: 'X' } as ItemSpec] }),
      });
      // comment 未注册
      const nodes = [makeNode('n1', 'comment'), makeNode('n2', 'item')];
      const { output, errors } = compileAll(nodes, makeCtx());
      expect(output.items).toHaveLength(1);
      expect(errors).toEqual([]);
    });

    it('编译器抛异常时转为 error，不中断其他节点', () => {
      registerCompiler({
        kind: 'item',
        compile: (node) => {
          if (node.id === 'bad') throw new Error('boom');
          return { items: [{ id: node.id, name: 'I' } as ItemSpec] };
        },
      });
      const nodes = [makeNode('good', 'item'), makeNode('bad', 'item')];
      const { output, errors } = compileAll(nodes, makeCtx());
      // good 节点仍编译成功
      expect(output.items).toHaveLength(1);
      expect(output.items?.[0].id).toBe('good');
      // bad 节点产生 error（带 kind 前缀 + id + message）
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('item节点 bad 编译失败');
      expect(errors[0]).toContain('boom');
    });

    it('编译器返回的 output.errors 直接合并（保留自定义错误消息）', () => {
      registerCompiler({
        kind: 'subgraph',
        compile: (node) => ({
          errors: [`自定义节点 ${node.id} 编译失败：schema 未注册`],
        }),
      });
      const nodes = [makeNode('s1', 'subgraph')];
      const { output, errors } = compileAll(nodes, makeCtx());
      // output.errors 含编译器自定义消息
      expect(output.errors).toEqual(['自定义节点 s1 编译失败：schema 未注册']);
      // 中央 errors 为空（未抛异常）
      expect(errors).toEqual([]);
    });

    it('编译器返回的 warnings 合并到 output.warnings', () => {
      registerCompiler({
        kind: 'item',
        compile: (node) => ({
          items: [{ id: node.id, name: 'I' } as ItemSpec],
          warnings: [`item ${node.id} 有建议`],
        }),
      });
      const nodes = [makeNode('n1', 'item'), makeNode('n2', 'item')];
      const { output } = compileAll(nodes, makeCtx());
      expect(output.warnings).toEqual(['item n1 有建议', 'item n2 有建议']);
    });

    it('空节点列表返回空 output', () => {
      const { output, errors } = compileAll([], makeCtx());
      expect(output).toEqual({});
      expect(errors).toEqual([]);
    });

    it('ctx 传递给编译器（graph/sanitizedModId/compileLoopBody 可用）', () => {
      const ctx = makeCtx();
      ctx.sanitizedModId = 'mymod';
      // 用 holder 对象捕获 ctx，避免 let + 闭包赋值导致 TS CFA 把类型收窄为 null/never
      const holder: { ctx?: CompileContext } = {};
      registerCompiler({
        kind: 'item',
        compile: (node, c) => {
          holder.ctx = c;
          return { items: [{ id: node.id, name: 'I' } as ItemSpec] };
        },
      });
      compileAll([makeNode('n1', 'item')], ctx);
      expect(holder.ctx).toBeDefined();
      expect(holder.ctx?.sanitizedModId).toBe('mymod');
      expect(holder.ctx?.graph).toBe(ctx.graph);
      expect(typeof holder.ctx?.compileLoopBody).toBe('function');
    });
  });
});
