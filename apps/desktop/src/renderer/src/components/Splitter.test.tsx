// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { Splitter } from './Splitter.js';

describe('Splitter', () => {
  let addSpy: ReturnType<typeof vi.spyOn>;
  let removeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    addSpy = vi.spyOn(document, 'addEventListener');
    removeSpy = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    addSpy.mockRestore();
    removeSpy.mockRestore();
  });

  it('按下后移动鼠标触发 onResize(delta)', () => {
    const onResize = vi.fn();
    const { container } = render(<Splitter onResize={onResize} />);
    const bar = container.firstChild as HTMLElement;

    fireEvent.mouseDown(bar, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 130 });
    expect(onResize).toHaveBeenCalledWith(30);

    fireEvent.mouseMove(document, { clientX: 110 });
    expect(onResize).toHaveBeenLastCalledWith(-20);
  });

  it('mouseup 后清理监听器与 body cursor', () => {
    const { container } = render(<Splitter onResize={() => {}} />);
    const bar = container.firstChild as HTMLElement;

    fireEvent.mouseDown(bar, { clientX: 0 });
    fireEvent.mouseUp(document);
    expect(removeSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });
});
