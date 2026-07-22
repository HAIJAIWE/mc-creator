// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McNodeHeader } from './McNodeHeader.js';

describe('McNodeHeader', () => {
  const defaultProps = {
    icon: 'sword',
    title: '物品',
    colorClass: 'mc-item',
    badge: '普通',
    collapsed: false,
    onToggleCollapse: () => {},
    onOpenDrawer: () => {},
  };

  it('渲染图标 + 标题 + 徽章', () => {
    render(<McNodeHeader {...defaultProps} />);
    expect(screen.getByText('物品')).toBeTruthy();
    expect(screen.getByText('普通')).toBeTruthy();
  });

  it('点击折叠按钮触发 onToggleCollapse', () => {
    const onToggle = vi.fn();
    render(<McNodeHeader {...defaultProps} onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByLabelText('折叠'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('点击设置按钮触发 onOpenDrawer', () => {
    const onOpen = vi.fn();
    render(<McNodeHeader {...defaultProps} onOpenDrawer={onOpen} />);
    fireEvent.click(screen.getByLabelText('设置'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('折叠状态显示 ▸ 标记', () => {
    render(<McNodeHeader {...defaultProps} collapsed={true} />);
    const btn = screen.getByLabelText('折叠');
    expect(btn.textContent).toContain('▸');
  });

  it('展开状态显示 ▾ 标记', () => {
    render(<McNodeHeader {...defaultProps} collapsed={false} />);
    const btn = screen.getByLabelText('折叠');
    expect(btn.textContent).toContain('▾');
  });

  it('debugState=debugging 时显示调试标记', () => {
    render(<McNodeHeader {...defaultProps} debugState="debugging" />);
    expect(screen.getByLabelText('调试中')).toBeTruthy();
  });

  it('debugState=breakpoint 时显示断点标记', () => {
    render(<McNodeHeader {...defaultProps} debugState="breakpoint" />);
    expect(screen.getByLabelText('断点')).toBeTruthy();
  });

  it('errorState=error 时显示错误标记', () => {
    render(<McNodeHeader {...defaultProps} errorState="error" />);
    expect(screen.getByLabelText('错误')).toBeTruthy();
  });
});
