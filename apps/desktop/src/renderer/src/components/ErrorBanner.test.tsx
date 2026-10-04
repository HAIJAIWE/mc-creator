// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBanner } from './ErrorBanner.js';

afterEach(cleanup);

describe('ErrorBanner', () => {
  it('渲染错误消息', () => {
    render(<ErrorBanner message="导出失败：缺少 icon.png" />);
    expect(screen.getByText('导出失败：缺少 icon.png')).toBeInTheDocument();
  });

  it('传 onClose 时渲染关闭按钮，点击触发回调', () => {
    const onClose = vi.fn();
    render(<ErrorBanner message="导出失败" onClose={onClose} />);
    const closeBtn = screen.getByRole('button');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('不传 onClose 时不渲染关闭按钮', () => {
    render(<ErrorBanner message="导出失败" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('容器使用红色边框/底色的 mc-card 语义样式', () => {
    render(<ErrorBanner message="导出失败" />);
    const root = screen.getByText('导出失败').closest('.mc-card');
    expect(root).not.toBeNull();
    // 红色stone 色调：边框与底色都带 mc-redstone
    expect(root?.className).toContain('border-mc-redstone');
    expect(root?.className).toContain('bg-mc-redstone/15');
    expect(root?.className).toContain('text-mc-redstone');
  });

  it('消息文本在可换行的容器内（多行编译错误不撑破布局）', () => {
    const { container } = render(<ErrorBanner message="编译失败" />);
    const text = container.querySelector('span.flex-1');
    expect(text?.className).toContain('whitespace-pre-wrap');
  });

  it('关闭按钮有可访问名（不依赖像素图标 alt）', () => {
    render(<ErrorBanner message="导出失败" onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: '关闭错误提示' });
    expect(closeBtn).toHaveAttribute('type', 'button');
  });
});
