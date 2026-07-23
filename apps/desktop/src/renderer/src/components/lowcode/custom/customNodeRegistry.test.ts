import { describe, it, expect, beforeEach } from 'vitest';
import { customNodeRegistry } from './customNodeRegistry.js';
import type { CustomNodeSchema } from '@mc-creator/shared';

function makeSchema(typeId: string): CustomNodeSchema {
  return {
    typeId,
    label: typeId,
    description: '',
    icon: '',
    color: 'mc-code',
    ports: [],
    fields: [],
    codeTemplate: '',
    templateParts: [],
  };
}

describe('customNodeRegistry（单例）', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('register + get', () => {
    customNodeRegistry.register(makeSchema('mymod:x'));
    const s = customNodeRegistry.get('mymod:x');
    expect(s?.typeId).toBe('mymod:x');
  });

  it('has', () => {
    expect(customNodeRegistry.has('mymod:x')).toBe(false);
    customNodeRegistry.register(makeSchema('mymod:x'));
    expect(customNodeRegistry.has('mymod:x')).toBe(true);
  });

  it('list', () => {
    customNodeRegistry.register(makeSchema('mymod:a'));
    customNodeRegistry.register(makeSchema('mymod:b'));
    expect(customNodeRegistry.list()).toHaveLength(2);
  });

  it('importJSON 合法 JSON 注册成功', () => {
    const json = JSON.stringify(makeSchema('mymod:imported'));
    const result = customNodeRegistry.importJSON(json);
    expect(result.ok).toBe(true);
    expect(customNodeRegistry.has('mymod:imported')).toBe(true);
  });

  it('importJSON 非法 JSON 返回 error', () => {
    const result = customNodeRegistry.importJSON('not json');
    expect(result.ok).toBe(false);
  });

  it('importJSON schema 校验失败返回 error', () => {
    const result = customNodeRegistry.importJSON(JSON.stringify({ typeId: '' }));
    expect(result.ok).toBe(false);
  });

  it('export 单个 schema', () => {
    customNodeRegistry.register(makeSchema('mymod:x'));
    const json = customNodeRegistry.export('mymod:x');
    const parsed = JSON.parse(json);
    expect(parsed.typeId).toBe('mymod:x');
  });

  it('exportAll 全部 schema', () => {
    customNodeRegistry.register(makeSchema('mymod:a'));
    customNodeRegistry.register(makeSchema('mymod:b'));
    const json = customNodeRegistry.exportAll();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
  });
});
