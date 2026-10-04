// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { WarningBanner } from './WarningBanner.js';

afterEach(cleanup);

describe('WarningBanner', () => {
  it('渲染标题并带警告条数', () => {
    render(<WarningBanner warnings={['缺少物品贴图', '配方 ID 重复']} />);
    expect(screen.getByText('生成提示（2）')).toBeInTheDocument();
  });

  it('逐条渲染警告文本为列表项', () => {
    render(<WarningBanner warnings={['缺少物品贴图', '配方 ID 重复']} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('缺少物品贴图');
    expect(items[1]).toHaveTextContent('配方 ID 重复');
  });

  it('无警告时条数为 0，列表为空', () => {
    render(<WarningBanner warnings={[]} />);
    expect(screen.getByText('生成提示（0）')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('传 onClose 时渲染关闭按钮，点击触发回调', () => {
    const onClose = vi.fn();
    render(<WarningBanner warnings={['a']} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('不传 onClose 时不渲染关闭按钮', () => {
    render(<WarningBanner warnings={['a']} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('容器使用黄色语义的 mc-card 样式', () => {
    render(<WarningBanner warnings={['a']} />);
    const root = screen.getByText('生成提示（1）').closest('.mc-card');
    expect(root).not.toBeNull();
    expect(root?.className).toContain('border-yellow-500/60');
    expect(root?.className).toContain('bg-yellow-500/15');
  });

  it('关闭按钮有可访问名与悬浮提示（不依赖像素图标 alt）', () => {
    render(<WarningBanner warnings={['a']} onClose={() => {}} />);
    const closeBtn = screen.getByRole('button', { name: '关闭警告' });
    expect(closeBtn).toHaveAttribute('title', '关闭警告');
  });
});
