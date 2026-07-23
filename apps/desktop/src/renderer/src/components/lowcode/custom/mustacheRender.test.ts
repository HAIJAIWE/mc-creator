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
});
