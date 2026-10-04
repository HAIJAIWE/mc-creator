import { describe, it, expect } from 'vitest';
import { pascalCase, packageName, packagePath, mainClassName } from './templates.js';

describe('templates', () => {
  it('pascalCase：下划线转 PascalCase', () => {
    expect(pascalCase('ruby_tools')).toBe('RubyTools');
    expect(pascalCase('demo')).toBe('Demo');
  });

  it('packageName：默认包名', () => {
    expect(packageName('ruby_tools')).toBe('com.example.ruby_tools');
  });

  it('packagePath：包路径', () => {
    expect(packagePath('ruby_tools')).toBe('com/example/ruby_tools');
  });

  it('mainClassName：主入口类名', () => {
    expect(mainClassName('ruby_tools')).toBe('RubyToolsMod');
  });
});
