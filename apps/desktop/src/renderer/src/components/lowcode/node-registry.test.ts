import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerNode,
  unregisterNode,
  getNode,
  listNodes,
  clearPluginNodes,
  compilePluginFiles,
  type PluginNodeContext,
} from './node-registry.js';
import type { NodeGraph } from '@mc-creator/shared';

beforeEach(() => {
  clearPluginNodes();
});

function makeGraph(): NodeGraph {
  return {
    version: 1,
    modId: 'test_mod',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      {
        id: 'n1',
        type: 'subgraph',
        position: { x: 0, y: 0 },
        data: {
          nodeId: 'n1',
          label: 'Hello',
          note: '',
          disabled: false,
          collapsed: false,
          codeLocked: false,
          formatVersion: 1,
          kind: 'subgraph',
          subgraphId: '',
          subgraphName: '',
          customTypeId: 'myplugin:hello_block',
          customFields: { blockId: 'hello_block' },
        },
        ports: [],
        selected: false,
      },
    ],
    edges: [],
    subgraphs: {},
  };
}

describe('plugin node-registry', () => {
  it('register/get/list/unregister 往返', () => {
    expect(listNodes()).toEqual([]);
    registerNode({
      id: 'myplugin:hello_block',
      title: 'Hello 方块',
      category: 'content',
      inputs: [],
      outputs: [],
      toSpec: () => [],
    });
    expect(getNode('myplugin:hello_block')?.title).toBe('Hello 方块');
    expect(listNodes()).toHaveLength(1);
    expect(listNodes('content')).toHaveLength(1);
    expect(listNodes('logic')).toHaveLength(0);
    expect(unregisterNode('myplugin:hello_block')).toBe(true);
    expect(getNode('myplugin:hello_block')).toBeUndefined();
    expect(unregisterNode('myplugin:hello_block')).toBe(false);
  });

  it('Zod 校验拒绝非法定义', () => {
    expect(() =>
      registerNode({ id: '', title: '', category: 'content', toSpec: () => [] }),
    ).toThrow();
    expect(() =>
      registerNode({ id: 'x', title: 'X', category: 'content', toSpec: 'not-a-function' }),
    ).toThrow();
  });

  it('compilePluginFiles 收集 toSpec 产物', async () => {
    registerNode({
      id: 'myplugin:hello_block',
      title: 'Hello 方块',
      category: 'content',
      inputs: [],
      outputs: [],
      toSpec: (ctx: PluginNodeContext) => [
        {
          path: `src/generated/${ctx.graphModId}_hello.java`,
          content: `// ${ctx.nodeId}`,
        },
      ],
    });
    const res = await compilePluginFiles(makeGraph());
    expect(res.errors).toEqual([]);
    expect(res.files).toHaveLength(1);
    expect(res.files[0]?.path).toContain('test_mod_hello.java');
  });

  it('未注册的 customTypeId 被跳过（留给 JSON schema 路径）', async () => {
    const res = await compilePluginFiles(makeGraph());
    expect(res).toEqual({ files: [], warnings: [], errors: [] });
  });

  it('toSpec 抛错记为 error，不中断', async () => {
    registerNode({
      id: 'myplugin:hello_block',
      title: 'Hello 方块',
      category: 'content',
      inputs: [],
      outputs: [],
      toSpec: () => {
        throw new Error('boom');
      },
    });
    const res = await compilePluginFiles(makeGraph());
    expect(res.files).toEqual([]);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0]).toContain('boom');
  });
});
