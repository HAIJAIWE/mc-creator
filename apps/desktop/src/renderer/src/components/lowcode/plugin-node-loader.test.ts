import { describe, it, expect, beforeEach } from 'vitest';
import { evaluatePluginCode, extractJsFileNames } from './plugin-node-loader.js';
import { clearPluginNodes, getNode } from './node-registry.js';

beforeEach(() => {
  clearPluginNodes();
});

describe('plugin-node-loader 沙箱', () => {
  it('registerNode 脚本可注册', () => {
    const res = evaluatePluginCode(
      `registerNode({ id: 't:hello', title: 'Hello', category: 'content', inputs: [], outputs: [], toSpec: (ctx) => [{ path: 'a.txt', content: ctx.nodeId }] });`,
      'nodes/hello.js',
    );
    expect(res.errors).toEqual([]);
    expect(res.registered).toEqual(['t:hello']);
    expect(getNode('t:hello')?.title).toBe('Hello');
  });

  it('命中 require/process 直接拒绝', () => {
    const res = evaluatePluginCode(`const fs = require('node:fs');`, 'nodes/evil.js');
    expect(res.registered).toEqual([]);
    expect(res.errors.length).toBe(1);
    expect(getNode('evil:x')).toBeUndefined();
  });

  it('module.exports 形式兜底注册', () => {
    const res = evaluatePluginCode(
      `module.exports = { id: 't:exp', title: 'Exp', category: 'logic', inputs: [], outputs: [], toSpec: () => [] };`,
      'nodes/exp.js',
    );
    expect(res.errors).toEqual([]);
    expect(getNode('t:exp')?.category).toBe('logic');
  });

  it('extractJsFileNames 兼容多种桥接形态', () => {
    expect(extractJsFileNames(['a.js', 'b.txt', '.hidden.js'])).toEqual(['a.js']);
    expect(
      extractJsFileNames({ success: true, data: [{ name: 'x.js', type: 'file' }, { name: 'dir', type: 'directory' }] }),
    ).toEqual(['x.js']);
    expect(extractJsFileNames({ success: false, error: 'nope' })).toEqual([]);
  });
});
