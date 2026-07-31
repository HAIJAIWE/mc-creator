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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
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
      codeLocked: false,
      formatVersion: 1,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).toBe('int count = 42;');
  });

  // ============================================================
  // P0-3: condition 化代码生成（templateParts）
  // ============================================================
  describe('templateParts 条件化代码生成', () => {
    it('templateParts 为空时回退到 codeTemplate（向后兼容）', () => {
      customNodeRegistry.register({
        typeId: 'mymod:fallback',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
        codeTemplate: '// from codeTemplate\nint speed = {{field:speed}};',
        templateParts: [],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp1',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:fallback',
        customFields: { speed: 5 },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.code).toBe('// from codeTemplate\nint speed = 5;');
    });

    it('templateParts 非空时优先使用，codeTemplate 被忽略', () => {
      customNodeRegistry.register({
        typeId: 'mymod:prefer',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
        codeTemplate: 'SHOULD_BE_IGNORED',
        templateParts: [{ template: '// from templateParts\nint speed = {{field:speed}};' }],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp2',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:prefer',
        customFields: { speed: 9 },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.code).toBe('// from templateParts\nint speed = 9;');
      expect(result.snippet!.code).not.toContain('SHOULD_BE_IGNORED');
    });

    it('多 part 按数组顺序拼接', () => {
      customNodeRegistry.register({
        typeId: 'mymod:multi',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [{ key: 'name', label: '名称', type: 'text', required: false }],
        templateParts: [
          { template: 'PART1={{field:name}};' },
          { template: 'PART2;' },
          { template: 'PART3;' },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp3',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:multi',
        customFields: { name: 'X' },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.code).toBe('PART1=X;PART2;PART3;');
    });

    it('condition equals=true 时渲染对应 part', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_eq',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          {
            key: 'mode',
            label: '模式',
            type: 'dropdown',
            options: ['simple', 'advanced'],
            required: false,
          },
        ],
        templateParts: [
          { template: 'CLASS_START;' },
          {
            condition: { field: 'mode', equals: 'advanced' },
            template: 'ADVANCED_BLOCK;',
          },
          {
            condition: { field: 'mode', equals: 'simple' },
            template: 'SIMPLE_BLOCK;',
          },
          { template: 'CLASS_END;' },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp4',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_eq',
        customFields: { mode: 'advanced' },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.code).toBe('CLASS_START;ADVANCED_BLOCK;CLASS_END;');
    });

    it('condition equals 不匹配时跳过对应 part', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_skip',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          {
            key: 'mode',
            label: '模式',
            type: 'dropdown',
            options: ['simple', 'advanced'],
            required: false,
          },
        ],
        templateParts: [
          { template: 'START;' },
          {
            condition: { field: 'mode', equals: 'advanced' },
            template: 'ADVANCED;',
          },
          { template: 'END;' },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp5',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_skip',
        customFields: { mode: 'simple' },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet).toBeDefined();
      expect(result.snippet!.code).toBe('START;END;');
    });

    it('condition in 数组匹配任一即渲染', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_in',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          {
            key: 'tier',
            label: '等级',
            type: 'dropdown',
            options: ['wood', 'iron', 'diamond', 'netherite'],
            required: false,
          },
        ],
        templateParts: [
          {
            condition: { field: 'tier', in: ['diamond', 'netherite'] },
            template: 'ENCHANT_GLOW;',
          },
        ],
      });
      // tier=diamond 匹配
      const data1: SubgraphNodeData = {
        nodeId: 'tp6a',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_in',
        customFields: { tier: 'diamond' },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      expect(compileCustomNode(data1, data1.customFields).snippet!.code).toBe('ENCHANT_GLOW;');

      // tier=iron 不匹配
      const data2: SubgraphNodeData = {
        ...data1,
        nodeId: 'tp6b',
        customFields: { tier: 'iron' },
      };
      expect(compileCustomNode(data2, data2.customFields).snippet!.code).toBe('');
    });

    it('condition 字段缺失视为不匹配', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_missing',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          {
            key: 'flag',
            label: '标志',
            type: 'dropdown',
            options: ['on', 'off'],
            required: false,
          },
        ],
        templateParts: [
          {
            condition: { field: 'flag', equals: 'on' },
            template: 'FLAG_ON;',
          },
          { template: 'DEFAULT;' },
        ],
      });
      // customFields 不传 flag
      const data: SubgraphNodeData = {
        nodeId: 'tp7',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_missing',
        customFields: {},
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet!.code).toBe('DEFAULT;');
    });

    it('condition 引用未在 schema 中定义的字段视为不匹配（不抛错）', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_unknown_field',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [],
        templateParts: [
          {
            condition: { field: 'unknownField', equals: 'x' },
            template: 'LEAKED;',
          },
          { template: 'SAFE;' },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp8',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_unknown_field',
        customFields: { unknownField: 'x' }, // 用户传入了未定义字段
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      // 未定义字段的 condition 不应触发，避免用户通过额外字段绕过 schema 控制
      expect(result.snippet!.code).toBe('SAFE;');
      expect(result.snippet!.code).not.toContain('LEAKED');
    });

    it('condition 同时有 equals 和 in，满足任一即渲染（并集）', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_union',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          {
            key: 'v',
            label: '值',
            type: 'dropdown',
            options: ['a', 'b', 'c', 'd'],
            required: false,
          },
        ],
        templateParts: [
          {
            condition: { field: 'v', equals: 'a', in: ['c', 'd'] },
            template: 'MATCH;',
          },
        ],
      });
      const mk = (id: string, v: string) =>
        ({
          nodeId: id,
          label: 'x',
          note: '',
          disabled: false,
          kind: 'subgraph',
          subgraphId: '',
          subgraphName: '',
          customTypeId: 'mymod:cond_union',
          customFields: { v },
          collapsed: false,
          codeLocked: false,
          formatVersion: 1,
        }) as SubgraphNodeData;
      // equals 匹配
      expect(compileCustomNode(mk('u1', 'a'), { v: 'a' }).snippet!.code).toBe('MATCH;');
      // in 匹配
      expect(compileCustomNode(mk('u2', 'c'), { v: 'c' }).snippet!.code).toBe('MATCH;');
      expect(compileCustomNode(mk('u3', 'd'), { v: 'd' }).snippet!.code).toBe('MATCH;');
      // 都不匹配
      expect(compileCustomNode(mk('u4', 'b'), { v: 'b' }).snippet!.code).toBe('');
    });

    it('templateParts 内的 Mustache 块语法（if/each）正常工作', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_block',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [
          { key: 'glow', label: '发光', type: 'segmented', required: false },
          { key: 'name', label: '名称', type: 'text', required: false },
          { key: 'items', label: '物品', type: 'nbt', required: false },
        ],
        templateParts: [
          {
            template:
              'public class X { {{#if glow}}boolean glow=true;{{/if}} String name="{{field:name}}"; String[] items={ {{#each items}}"{{this}}", {{/each}} }; }',
          },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp9',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_block',
        customFields: { glow: true, name: 'MyBlock', items: ['a', 'b'] },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      expect(result.snippet!.code).toContain('boolean glow=true;');
      expect(result.snippet!.code).toContain('String name="MyBlock";');
      expect(result.snippet!.code).toContain('"a", "b",');
    });

    it('number 字段在 condition equals 中按字符串比较', () => {
      customNodeRegistry.register({
        typeId: 'mymod:cond_num',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        ports: [],
        fields: [{ key: 'tier', label: '等级', type: 'number', required: false }],
        templateParts: [
          {
            condition: { field: 'tier', equals: '3' },
            template: 'TIER_3;',
          },
          { template: 'DEFAULT;' },
        ],
      });
      const data: SubgraphNodeData = {
        nodeId: 'tp10',
        label: 'x',
        note: '',
        disabled: false,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: 'mymod:cond_num',
        customFields: { tier: 3 },
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
      };
      const result = compileCustomNode(data, data.customFields);
      // number 3 经 String() 后与 '3' 相等
      expect(result.snippet!.code).toBe('TIER_3;DEFAULT;');
    });
  });
});
