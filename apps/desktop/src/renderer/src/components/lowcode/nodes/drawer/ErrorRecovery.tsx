import { memo } from 'react';
import type { FieldSchema } from './editors/types.js';

interface ErrorRecoveryProps {
  /** 错误文字（falsy 时不渲染） */
  error?: string;
  /** 修复建议文字 */
  suggestion?: string;
  /** 一键修复按钮文字（需同时提供 onFix 才渲染按钮） */
  fixLabel?: string;
  /** 一键修复回调 */
  onFix?: () => void;
}

function ErrorRecoveryComponent({ error, suggestion, fixLabel, onFix }: ErrorRecoveryProps) {
  if (!error) return null;
  return (
    <div
      className="mt-1 rounded-mc border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"
      role="alert"
      aria-live="assertive"
    >
      <div>⚠ {error}</div>
      {suggestion && <div className="mt-0.5 text-red-200">建议：{suggestion}</div>}
      {fixLabel && onFix && (
        <button
          type="button"
          onClick={onFix}
          className="mt-1 rounded-mc border border-red-400 bg-red-800/60 px-2 py-0.5 text-red-100 transition-colors hover:bg-red-700/80"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

export const ErrorRecovery = memo(ErrorRecoveryComponent);

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
