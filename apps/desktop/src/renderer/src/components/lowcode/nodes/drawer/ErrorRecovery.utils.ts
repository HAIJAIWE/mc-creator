import type { FieldSchema } from './editors/types.js';

/**
 * 根据字段 schema 和错误文字生成修复建议。
 * 匹配规则基于 validateField 产生的错误文案关键字。
 */
export function getErrorSuggestion(
  field: FieldSchema,
  error: string | undefined,
  _value: unknown,
): string | undefined {
  if (!error) return undefined;
  if (field.required && /必填/.test(error)) {
    return `请输入${field.label}`;
  }
  if (field.type === 'number') {
    if (field.max !== undefined && /大于最大值/.test(error)) {
      return `建议改为 ${field.max}`;
    }
    if (field.min !== undefined && /小于最小值/.test(error)) {
      return `建议改为 ${field.min}`;
    }
  }
  if (field.type === 'resourceId' && /格式错误/.test(error)) {
    return `示例：mymod:iron_sword（modid:path，全小写+下划线）`;
  }
  if (field.type === 'localId' && /格式错误/.test(error)) {
    return `示例：ruby_sword（全小写字母+下划线，命名空间由当前 mod 自动决定）`;
  }
  return undefined;
}

/**
 * 根据字段类型和错误生成一键修复按钮文字。
 * 仅 number 超限可一键修复（改为边界值），其他错误返回 undefined。
 */
export function getFixLabel(field: FieldSchema, error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (field.type === 'number') {
    if (field.max !== undefined && /大于最大值/.test(error)) return '改为最大值';
    if (field.min !== undefined && /小于最小值/.test(error)) return '改为最小值';
  }
  return undefined;
}
