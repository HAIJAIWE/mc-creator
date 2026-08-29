// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McIcon } from './McIcon.js';

describe('McIcon', () => {
  it('渲染指定 scope/name 的图标（SVG 内联，继承颜色）', () => {
    render(<McIcon scope="pixel" name="plus" size={16} />);
    const el = screen.getByRole('img', { name: 'plus' });
    expect(el).toBeTruthy();
    expect(el.getAttribute('style')).toContain('width: 16px');
    expect(el.getAttribute('style')).toContain('height: 16px');
    // 内联 SVG 注入内容应存在，且带 mc-icon-svg 类
    expect(el.className).toContain('mc-icon-svg');
    expect(el.querySelector('svg')).toBeTruthy();
  });

  it('未知资源返回 null（不渲染）', () => {
    const { container } = render(<McIcon scope="pixel" name="does_not_exist_xyz" />);
    expect(container.firstChild).toBeNull();
  });

  it('className 透传', () => {
    render(<McIcon scope="pixel" name="plus" className="mc-icon-custom" />);
    expect(screen.getByRole('img', { name: 'plus' }).className).toContain('mc-icon-custom');
  });
});
