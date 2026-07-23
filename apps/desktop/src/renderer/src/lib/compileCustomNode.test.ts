import { describe, it, expect, beforeEach } from 'vitest';
import { compileCustomNode } from './compileCustomNode.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { SubgraphNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileCustomNode', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('schema 已注册 + fields 齐全时返回 snippet（Mustache 渲染）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: '合成台',
      description: '',
      icon: '',
      color: 'mc-code',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int speed = {{field:speed}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c1',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:crafter',
      customFields: { speed: 42 },
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.error).toBeUndefined();
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).toBe('int speed = 42;');
    expect(result.snippet!.language).toBe('java');
    expect(result.snippet!.snippetId).toBe('c1');
    // 返回类型是 CustomCodeSnippetSpec
    const _: CustomCodeSnippetSpec = result.snippet!;
    expect(_.snippetId).toBe('c1');
  });

  it('customTypeId 为 null 时返回 error', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c2',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: 'sg_1',
      subgraphName: '',
      customTypeId: null,
      customFields: {},
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('customTypeId');
  });

  it('schema 未注册时返回 error', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c3',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'unregistered:type',
      customFields: {},
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('未注册');
  });

  it('required 字段缺失时返回 error', () => {
    customNodeRegistry.register({
      typeId: 'mymod:required',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int {{field:speed}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c4',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:required',
      customFields: {},
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('speed');
  });

  it('字段值做 Java 转义（防止注入）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:escape',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [],
      codeTemplate: 'String x = "{{field:name}}";',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c5',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:escape',
      customFields: { name: 'a"; evil(); "' },
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).not.toContain('evil()');
    expect(result.snippet!.code).toContain('\\"');
  });
});
