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

  // ============================================================
  // P0-3: templateParts 字段
  // ============================================================
  describe('templateParts（P0-3 条件化代码生成）', () => {
    it('默认 templateParts 为空数组', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
      });
      expect(s.templateParts).toEqual([]);
    });

    it('可省略 condition 的 part 解析为无条件 part', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [{ template: 'PART;' }],
      });
      expect(s.templateParts).toHaveLength(1);
      expect(s.templateParts[0]!.condition).toBeUndefined();
      expect(s.templateParts[0]!.template).toBe('PART;');
    });

    it('condition 含 field + equals 正确解析', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [
          {
            condition: { field: 'mode', equals: 'advanced' },
            template: 'ADVANCED;',
          },
        ],
      });
      expect(s.templateParts[0]!.condition).toEqual({
        field: 'mode',
        equals: 'advanced',
      });
    });

    it('condition 含 field + in 数组正确解析', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [
          {
            condition: { field: 'tier', in: ['diamond', 'netherite'] },
            template: 'ENCHANT;',
          },
        ],
      });
      expect(s.templateParts[0]!.condition!.in).toEqual(['diamond', 'netherite']);
    });

    it('condition field 为空字符串校验失败', () => {
      expect(() =>
        CustomNodeSchema.parse({
          typeId: 'x:y',
          label: 'x',
          description: '',
          icon: '',
          color: '',
          codeTemplate: '',
          templateParts: [{ condition: { field: '' }, template: 'X;' }],
        }),
      ).toThrow();
    });

    it('多 part 数组按顺序保留', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [
          { template: 'P1;' },
          { condition: { field: 'a', equals: '1' }, template: 'P2;' },
          { condition: { field: 'b', in: ['x', 'y'] }, template: 'P3;' },
          { template: 'P4;' },
        ],
      });
      expect(s.templateParts).toHaveLength(4);
      expect(s.templateParts[0]!.template).toBe('P1;');
      expect(s.templateParts[1]!.condition!.field).toBe('a');
      expect(s.templateParts[2]!.condition!.in).toEqual(['x', 'y']);
      expect(s.templateParts[3]!.condition).toBeUndefined();
    });

    it('part.template 默认空字符串', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [{ condition: { field: 'a' } }],
      });
      expect(s.templateParts[0]!.template).toBe('');
    });

    it('equals 和 in 可同时存在（并集语义）', () => {
      const s = CustomNodeSchema.parse({
        typeId: 'x:y',
        label: 'x',
        description: '',
        icon: '',
        color: '',
        codeTemplate: '',
        templateParts: [
          {
            condition: { field: 'v', equals: 'a', in: ['b', 'c'] },
            template: 'X;',
          },
        ],
      });
      expect(s.templateParts[0]!.condition!.equals).toBe('a');
      expect(s.templateParts[0]!.condition!.in).toEqual(['b', 'c']);
    });
  });
});
