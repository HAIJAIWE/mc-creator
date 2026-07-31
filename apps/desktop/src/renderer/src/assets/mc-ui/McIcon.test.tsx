// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McIcon } from './McIcon.js';

describe('McIcon', () => {
  it('渲染指定 scope/name 的图标 img', () => {
    render(<McIcon scope="pixel" name="plus" size={16} />);
    const img = screen.getByAltText('plus');
    expect(img).toBeTruthy();
    expect(img.getAttribute('width')).toBe('16');
    expect(img.getAttribute('style')).toContain('pixelated');
  });

  it('未知资源返回 null（不渲染）', () => {
    const { container } = render(<McIcon scope="pixel" name="does_not_exist_xyz" />);
    expect(container.firstChild).toBeNull();
  });

  it('className 透传', () => {
    render(<McIcon scope="pixel" name="plus" className="mc-icon-custom" />);
    expect(screen.getByAltText('plus').getAttribute('class')).toContain('mc-icon-custom');
  });
});
