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
      fields: [{ key: 'name', label: '名称', type: 'text', required: false }],
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
    // 字段值作为字符串内容保留（evil() 在字符串字面量内是数据，不是代码注入）
    expect(result.snippet!.code).toContain('evil()');
    expect(result.snippet!.code).toContain('\\"');
    // 不应产生非法 Java 转义序列
    expect(result.snippet!.code).not.toContain('\\(');
    expect(result.snippet!.code).not.toContain('\\)');
    expect(result.snippet!.code).not.toContain('\\;');
  });

  it('fields 净化：未在 schema 中定义的额外字段不参与渲染（问题 12）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:filter',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      // 模板故意引用未在 schema 中定义的 extra 字段
      codeTemplate: 'int speed = {{field:speed}}; String extra = "{{field:extra}}";',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c6',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:filter',
      // 用户传入了 schema 未定义的 extra 字段
      customFields: { speed: 42, extra: 'LEAKED' },
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).toContain('int speed = 42');
    // extra 未在 schema 中定义，即使 customFields 提供了也不应被渲染（保留占位符）
    expect(result.snippet!.code).toContain('{{field:extra}}');
    expect(result.snippet!.code).not.toContain('LEAKED');
  });

  it('fields 净化：number 类型字段非数字值回退为 0（问题 20）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:coerce',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int speed = {{field:speed}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c7',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:coerce',
      // 传入非数字字符串，应被强制回退为 0 而非注入原始文本
      customFields: { speed: 'not-a-number' },
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    // 非数字应回退为 0，避免注入非法 Java 标识符
    expect(result.snippet!.code).toBe('int speed = 0;');
    expect(result.snippet!.code).not.toContain('not-a-number');
  });

  it('fields 净化：number 类型字段字符串数字被强制转为数字（问题 20）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:coerce2',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      ports: [],
      fields: [{ key: 'count', label: '数量', type: 'number', required: true }],
      codeTemplate: 'int count = {{field:count}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c8',
      label: 'x',
      note: '',
      disabled: false,
      kind: 'subgraph',
      subgraphId: '',
      subgraphName: '',
      customTypeId: 'mymod:coerce2',
      // 字符串形式的数字应被转为数字
      customFields: { count: '42' },
      collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).toBe('int count = 42;');
  });
});
