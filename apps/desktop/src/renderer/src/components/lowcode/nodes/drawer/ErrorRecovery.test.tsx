// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorRecovery, getErrorSuggestion, getFixLabel } from './ErrorRecovery.js';
import type { FieldSchema } from './editors/types.js';

describe('ErrorRecovery', () => {
  it('无错误时不渲染', () => {
    const { container } = render(<ErrorRecovery error={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('error 为空字符串时不渲染', () => {
    const { container } = render(<ErrorRecovery error="" />);
    expect(container.firstChild).toBeNull();
  });

  it('有错误时渲染错误文字', () => {
    render(<ErrorRecovery error="数值超限" />);
    expect(screen.getByText(/数值超限/)).toBeTruthy();
  });

  it('有修复建议时显示建议文字', () => {
    render(<ErrorRecovery error="超限" suggestion="建议改为 99999" />);
    expect(screen.getByText(/建议改为 99999/)).toBeTruthy();
  });

  it('有一键修复按钮时点击触发 onFix', () => {
    const onFix = vi.fn();
    render(<ErrorRecovery error="超限" fixLabel="一键修复" onFix={onFix} />);
    fireEvent.click(screen.getByText('一键修复'));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it('有 fixLabel 但无 onFix 时不渲染按钮', () => {
    render(<ErrorRecovery error="超限" fixLabel="一键修复" />);
    expect(screen.queryByText('一键修复')).toBeNull();
  });
});

describe('getErrorSuggestion', () => {
  const numberField: FieldSchema = {
    key: 'maxDamage',
    label: '最大耐久',
    type: 'number',
    min: 0,
    max: 99999,
  };
  const resourceIdField: FieldSchema = {
    key: 'itemId',
    label: '物品 ID',
    type: 'resourceId',
    required: true,
  };
  const requiredField: FieldSchema = {
    key: 'itemId',
    label: '物品 ID',
    type: 'text',
    required: true,
  };

  it('无错误返回 undefined', () => {
    expect(getErrorSuggestion(numberField, undefined, 100)).toBeUndefined();
  });

  it('必填错误返回输入提示', () => {
    expect(getErrorSuggestion(requiredField, '物品 ID为必填项', '')).toContain('请输入');
  });

  it('number 超上限返回建议值', () => {
    expect(getErrorSuggestion(numberField, '值 1000000 大于最大值 99999', 1000000)).toBe(
      '建议改为 99999',
    );
  });

  it('number 超下限返回建议值', () => {
    expect(getErrorSuggestion(numberField, '值 -1 小于最小值 0', -1)).toBe('建议改为 0');
  });

  it('resourceId 格式错误返回示例', () => {
    expect(
      getErrorSuggestion(resourceIdField, '格式错误，应为 modid:path（全小写+下划线）', 'BadID'),
    ).toContain('mymod:iron_sword');
  });

  it('未知错误返回 undefined', () => {
    expect(getErrorSuggestion(numberField, '某种未知错误', 100)).toBeUndefined();
  });
});

describe('getFixLabel', () => {
  const numberField: FieldSchema = {
    key: 'maxDamage',
    label: '最大耐久',
    type: 'number',
    min: 0,
    max: 99999,
  };

  it('无错误返回 undefined', () => {
    expect(getFixLabel(numberField, undefined)).toBeUndefined();
  });

  it('number 超上限返回「改为最大值」', () => {
    expect(getFixLabel(numberField, '值 1000000 大于最大值 99999')).toBe('改为最大值');
  });

  it('number 超下限返回「改为最小值」', () => {
    expect(getFixLabel(numberField, '值 -1 小于最小值 0')).toBe('改为最小值');
  });

  it('非 number 错误返回 undefined', () => {
    const textField: FieldSchema = { key: 'name', label: '名称', type: 'text' };
    expect(getFixLabel(textField, '某种错误')).toBeUndefined();
  });
});
