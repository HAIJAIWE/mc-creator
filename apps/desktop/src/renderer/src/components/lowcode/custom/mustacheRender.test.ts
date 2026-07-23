import { describe, it, expect } from 'vitest';
import { renderMustache } from './mustacheRender.js';

describe('renderMustache', () => {
  it('替换 {{field:key}} 占位符', () => {
    const result = renderMustache('int {{field:speed}} = 1;', { speed: '50' });
    expect(result).toBe('int 50 = 1;');
  });

  it('多字段替换', () => {
    const result = renderMustache('public class {{field:className}} { int {{field:speed}}; }', {
      className: 'MyBlock',
      speed: '10',
    });
    expect(result).toBe('public class MyBlock { int 10; }');
  });

  it('字段值转义 Java 特殊字符（防止注入）', () => {
    const result = renderMustache('String x = "{{field:name}}";', { name: 'a"; evil(); "' });
    // 双引号和反斜杠转义：整个字段值应作为字符串字面量内容，evil() 是字符串数据而非代码
    expect(result).toContain('\\"');
    // 字段值作为字符串内容应保留（evil() 在字符串字面量内是数据，不是代码注入）
    expect(result).toContain('evil()');
    // 不应产生非法 Java 转义序列 \( \) \;
    expect(result).not.toContain('\\(');
    expect(result).not.toContain('\\)');
    expect(result).not.toContain('\\;');
  });

  it('反斜杠先于双引号转义（防止 \\\\" 注入关闭字符串）', () => {
    // 输入以反斜杠结尾 + 引号：必须先转义反斜杠，再转义引号
    // 输入值: a\" (3 chars: a, \, ")
    // 期望输出 Java 源码: String x = "a\\\""; (反斜杠→\\, 引号→\")
    const result = renderMustache('String x = "{{field:v}}";', { v: 'a\\"' });
    expect(result).toBe('String x = "a\\\\\\"";');
  });

  it('换行/回车/Tab 转义为 \\n \\r \\t', () => {
    const result = renderMustache('String x = "{{field:v}}";', { v: 'a\nb\rc\td' });
    expect(result).toContain('\\n');
    expect(result).toContain('\\r');
    expect(result).toContain('\\t');
    // 不应包含原始控制字符
    expect(result).not.toMatch(/\n/);
    expect(result).not.toMatch(/\r/);
    expect(result).not.toMatch(/\t/);
  });

  it('字段缺失保留原占位符', () => {
    const result = renderMustache('{{field:missing}}', {});
    expect(result).toBe('{{field:missing}}');
  });

  it('非字符串字段值转为字符串', () => {
    const result = renderMustache('count = {{field:n}}', { n: 42 });
    expect(result).toBe('count = 42');
  });

  // ============================================================
  // P0-2: 模板引擎升级 — {{#if}}/{{else}}/{{/if}}
  // ============================================================
  describe('{{#if}} 条件块', () => {
    it('条件为真时渲染 if 块内容', () => {
      const tpl = '{{#if glow}}private boolean glow = true;{{/if}}';
      expect(renderMustache(tpl, { glow: true })).toBe('private boolean glow = true;');
    });

    it('条件为假时跳过 if 块内容', () => {
      const tpl = '{{#if glow}}private boolean glow = true;{{/if}}';
      expect(renderMustache(tpl, { glow: false })).toBe('');
    });

    it('条件字段缺失时视为 falsy 跳过', () => {
      const tpl = '{{#if glow}}GLOW{{/if}}';
      expect(renderMustache(tpl, {})).toBe('');
    });

    it('非空字符串视为 truthy', () => {
      const tpl = '{{#if name}}HAS_NAME{{/if}}';
      expect(renderMustache(tpl, { name: 'Item' })).toBe('HAS_NAME');
    });

    it('空字符串视为 falsy', () => {
      const tpl = '{{#if name}}HAS_NAME{{/if}}';
      expect(renderMustache(tpl, { name: '' })).toBe('');
    });

    it('非零数字视为 truthy', () => {
      const tpl = '{{#if count}}N>0{{/if}}';
      expect(renderMustache(tpl, { count: 5 })).toBe('N>0');
    });

    it('数字 0 视为 falsy', () => {
      const tpl = '{{#if count}}N>0{{/if}}';
      expect(renderMustache(tpl, { count: 0 })).toBe('');
    });

    it('非空数组视为 truthy', () => {
      const tpl = '{{#if items}}HAS_ITEMS{{/if}}';
      expect(renderMustache(tpl, { items: [1, 2] })).toBe('HAS_ITEMS');
    });

    it('空数组视为 falsy', () => {
      const tpl = '{{#if items}}HAS_ITEMS{{/if}}';
      expect(renderMustache(tpl, { items: [] })).toBe('');
    });

    it('{{else}} 分支：条件为真时只渲染 if 分支', () => {
      const tpl = '{{#if flag}}TRUE{{else}}FALSE{{/if}}';
      expect(renderMustache(tpl, { flag: true })).toBe('TRUE');
    });

    it('{{else}} 分支：条件为假时只渲染 else 分支', () => {
      const tpl = '{{#if flag}}TRUE{{else}}FALSE{{/if}}';
      expect(renderMustache(tpl, { flag: false })).toBe('FALSE');
    });

    it('if 块内可嵌套 {{field:key}} 插值', () => {
      const tpl = '{{#if show}}name={{field:name}};{{/if}}';
      expect(renderMustache(tpl, { show: true, name: 'X' })).toBe('name=X;');
    });

    it('if 块前后可有普通文本', () => {
      const tpl = 'before;{{#if flag}}MID;{{/if}}after;';
      expect(renderMustache(tpl, { flag: true })).toBe('before;MID;after;');
      expect(renderMustache(tpl, { flag: false })).toBe('before;after;');
    });

    it('嵌套 if：外层假时内层不渲染', () => {
      const tpl = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}';
      expect(renderMustache(tpl, { a: false, b: true })).toBe('');
    });

    it('嵌套 if：两层都真时全部渲染', () => {
      const tpl = '{{#if a}}A{{#if b}}B{{/if}}{{/if}}';
      expect(renderMustache(tpl, { a: true, b: true })).toBe('AB');
    });

    it('嵌套 if-else：外层真、内层假走内层 else', () => {
      const tpl = '{{#if a}}A{{#if b}}B{{else}}b{{/if}}{{/if}}';
      expect(renderMustache(tpl, { a: true, b: false })).toBe('Ab');
    });

    it('未闭合 {{#if}} 保留原文（容错）', () => {
      const tpl = '{{#if flag}}MID';
      expect(renderMustache(tpl, { flag: true })).toBe('{{#if flag}}MID');
    });
  });

  // ============================================================
  // P0-2: 模板引擎升级 — {{#each}}/{{this}}/{{/each}}
  // ============================================================
  describe('{{#each}} 循环块', () => {
    it('遍历字符串数组用 {{this}} 输出', () => {
      const tpl = '{{#each names}}-{{this}}{{/each}}';
      expect(renderMustache(tpl, { names: ['A', 'B', 'C'] })).toBe('-A-B-C');
    });

    it('遍历数字数组', () => {
      const tpl = '{{#each nums}}{{this}},{{/each}}';
      expect(renderMustache(tpl, { nums: [1, 2, 3] })).toBe('1,2,3,');
    });

    it('空数组输出空字符串', () => {
      const tpl = '{{#each xs}}{{this}}{{/each}}';
      expect(renderMustache(tpl, { xs: [] })).toBe('');
    });

    it('非数组字段（字符串）按字符序列处理为单元素遍历', () => {
      // 字符串不是数组，应视为单元素 [字符串]
      const tpl = '{{#each s}}[{{this}}]{{/each}}';
      expect(renderMustache(tpl, { s: 'hi' })).toBe('[hi]');
    });

    it('字段缺失视为空数组，输出空字符串', () => {
      const tpl = '{{#each xs}}{{this}}{{/each}}';
      expect(renderMustache(tpl, {})).toBe('');
    });

    it('循环外层文本与循环内容拼接', () => {
      const tpl = 'START{{#each xs}}|{{this}}{{/each}}END';
      expect(renderMustache(tpl, { xs: ['a', 'b'] })).toBe('START|a|bEND');
    });

    it('循环内可访问当前项的子字段 {{this.field}}', () => {
      const tpl = '{{#each items}}[{{this.name}}={{this.value}}]{{/each}}';
      expect(
        renderMustache(tpl, {
          items: [
            { name: 'A', value: 1 },
            { name: 'B', value: 2 },
          ],
        }),
      ).toBe('[A=1][B=2]');
    });

    it('循环内子字段缺失保留原占位符', () => {
      const tpl = '{{#each items}}[{{this.missing}}]{{/each}}';
      expect(renderMustache(tpl, { items: [{ a: 1 }, { b: 2 }] })).toBe(
        '[{{this.missing}}][{{this.missing}}]',
      );
    });

    it('循环内仍可访问外层 {{field:key}}', () => {
      const tpl = '{{#each xs}}{{field:prefix}}{{this}};{{/each}}';
      expect(renderMustache(tpl, { prefix: 'P', xs: ['a', 'b'] })).toBe('Pa;Pb;');
    });

    it('循环内嵌套 {{#if}} 条件', () => {
      const tpl = '{{#each items}}{{#if active}}{{this.name}};{{/if}}{{/each}}';
      expect(
        renderMustache(tpl, {
          items: [
            { name: 'A', active: true },
            { name: 'B', active: false },
            { name: 'C', active: true },
          ],
        }),
      ).toBe('A;C;');
    });

    it('未闭合 {{#each}} 保留原文（容错）', () => {
      const tpl = '{{#each xs}}X';
      expect(renderMustache(tpl, { xs: [1, 2] })).toBe('{{#each xs}}X');
    });

    it('循环内 {{this}} 在 Java 字符串字面量中被转义', () => {
      const tpl =
        'String[] xs = { {{#each names}}"{{this}}"{{#unless @last}}, {{/unless}}{{/each}} };';
      // @last 暂不支持，模板应原样保留 {{#unless @last}}, {{/unless}}
      const result = renderMustache(tpl, { names: ['a"', 'b'] });
      // 第一项 " 被转义为 \"
      expect(result).toContain('"a\\""');
      expect(result).toContain('"b"');
    });
  });

  // ============================================================
  // 综合场景
  // ============================================================
  describe('综合场景', () => {
    it('Java 类模板：if + each + 字段插值组合', () => {
      const tpl = [
        'public class {{field:className}} {',
        '  {{#if glow}}private boolean glow = true;{{/if}}',
        '  private String[] items = { {{#each items}}"{{this}}", {{/each}} };',
        '}',
      ].join('\n');
      const result = renderMustache(tpl, {
        className: 'MyBlock',
        glow: true,
        items: ['a', 'b'],
      });
      expect(result).toContain('public class MyBlock {');
      expect(result).toContain('private boolean glow = true;');
      expect(result).toContain('"a", "b",');
    });

    it('未匹配 {{else}} 在 if 外保留原文', () => {
      const tpl = 'X{{else}}Y';
      expect(renderMustache(tpl, {})).toBe('X{{else}}Y');
    });
  });
});
