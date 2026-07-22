import { describe, it, expect } from 'vitest';
import { CustomNodeSchema } from './custom-node-schema.js';

describe('CustomNodeSchema', () => {
  it('完整 schema 解析', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'mymod:custom_crafter',
      label: '自定义合成台',
      description: '3x3 合成',
      icon: 'crafting-table',
      color: 'mc-custom',
      ports: [
        {
          id: 'in',
          label: '输入',
          type: 'item_stack',
          direction: 'in',
          required: false,
          multiple: true,
        },
        {
          id: 'out',
          label: '产物',
          type: 'item_stack',
          direction: 'out',
          required: false,
          multiple: false,
        },
      ],
      fields: [{ key: 'speed', label: '速度', type: 'number', min: 1, max: 100 }],
      codeTemplate: 'public class {{className}} { int {{field:speed}} = 1; }',
    });
    expect(s.typeId).toBe('mymod:custom_crafter');
    expect(s.ports).toHaveLength(2);
    expect(s.fields).toHaveLength(1);
  });

  it('typeId 必填', () => {
    expect(() => CustomNodeSchema.parse({ label: 'x' })).toThrow();
  });

  it('ports/fields 默认空数组', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'x:y',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      codeTemplate: '',
    });
    expect(s.ports).toEqual([]);
    expect(s.fields).toEqual([]);
  });

  it('codeTemplate 必填（可为空字符串）', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'x:y',
      label: 'x',
      description: '',
      icon: '',
      color: '',
      codeTemplate: '',
    });
    expect(s.codeTemplate).toBe('');
  });
});
