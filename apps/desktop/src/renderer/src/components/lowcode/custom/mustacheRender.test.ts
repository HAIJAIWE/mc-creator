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
    // 双引号和反斜杠转义
    expect(result).not.toContain('evil()');
    expect(result).toContain('\\"');
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
