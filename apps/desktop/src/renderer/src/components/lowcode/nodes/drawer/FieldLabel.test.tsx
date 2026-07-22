// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldLabel } from './FieldLabel.js';

describe('FieldLabel', () => {
  it('渲染标签文字', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.getByText('物品 ID')).toBeTruthy();
  });

  it('required=true 时渲染 * 标记', () => {
    render(<FieldLabel label="物品 ID" required />);
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('required=false 时不渲染 * 标记', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.queryByText('*')).toBeNull();
  });

  it('有 tooltip 时渲染 ? 图标', () => {
    render(<FieldLabel label="物品 ID" tooltip="这是解释" />);
    expect(screen.getByText('?')).toBeTruthy();
  });

  it('无 tooltip 时不渲染 ? 图标', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.queryByText('?')).toBeNull();
  });

  it('hover ? 显示 tooltip 文本', () => {
    render(<FieldLabel label="物品 ID" tooltip="资源 ID 格式说明" />);
    const icon = screen.getByText('?');
    fireEvent.mouseEnter(icon);
    expect(screen.getByText('资源 ID 格式说明')).toBeTruthy();
  });

  it('mouseLeave ? 隐藏 tooltip 文本', () => {
    render(<FieldLabel label="物品 ID" tooltip="资源 ID 格式说明" />);
    const icon = screen.getByText('?');
    fireEvent.mouseEnter(icon);
    expect(screen.getByText('资源 ID 格式说明')).toBeTruthy();
    fireEvent.mouseLeave(icon);
    expect(screen.queryByText('资源 ID 格式说明')).toBeNull();
  });
});
