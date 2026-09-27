// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineRowEditor } from './InlineRowEditor.js';

describe('InlineRowEditor 行内值编辑器', () => {
  it('text：点击值进入编辑，Enter 提交', () => {
    const onCommit = vi.fn();
    render(
      <InlineRowEditor
        kind="text"
        value="hi"
        display="hi"
        onCommit={onCommit}
        ariaLabel="名称"
        testId="t1"
      />,
    );
    fireEvent.click(screen.getByTestId('inline-value-t1'));
    const input = screen.getByTestId('inline-input-t1');
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('hello');
    expect(screen.queryByTestId('inline-input-t1')).toBeNull();
  });

  it('text：Esc 取消不提交', () => {
    const onCommit = vi.fn();
    render(
      <InlineRowEditor
        kind="text"
        value="hi"
        display="hi"
        onCommit={onCommit}
        ariaLabel="名称"
        testId="t2"
      />,
    );
    fireEvent.click(screen.getByTestId('inline-value-t2'));
    const input = screen.getByTestId('inline-input-t2');
    fireEvent.change(input, { target: { value: 'changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-input-t2')).toBeNull();
  });

  it('number：合法数字提交数值类型', () => {
    const onCommit = vi.fn();
    render(
      <InlineRowEditor
        kind="number"
        value={5}
        display="5"
        onCommit={onCommit}
        ariaLabel="数量"
        testId="n1"
      />,
    );
    fireEvent.click(screen.getByTestId('inline-value-n1'));
    fireEvent.change(screen.getByTestId('inline-input-n1'), { target: { value: '42' } });
    fireEvent.keyDown(screen.getByTestId('inline-input-n1'), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('number：非法输入不提交、回退显示', () => {
    const onCommit = vi.fn();
    render(
      <InlineRowEditor
        kind="number"
        value={5}
        display="5"
        onCommit={onCommit}
        ariaLabel="数量"
        testId="n2"
      />,
    );
    fireEvent.click(screen.getByTestId('inline-value-n2'));
    fireEvent.change(screen.getByTestId('inline-input-n2'), { target: { value: 'abc' } });
    fireEvent.keyDown(screen.getByTestId('inline-input-n2'), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId('inline-input-n2')).toBeNull();
    expect(screen.getByTestId('inline-value-n2')).toBeTruthy();
  });

  it('boolean：开关点击直接提交取反', () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <InlineRowEditor
        kind="boolean"
        value={false}
        display="false"
        onCommit={onCommit}
        ariaLabel="开关"
        testId="b1"
      />,
    );
    const sw = screen.getByTestId('inline-bool-b1');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(sw);
    expect(onCommit).toHaveBeenCalledWith(true);
    rerender(
      <InlineRowEditor
        kind="boolean"
        value={true}
        display="true"
        onCommit={onCommit}
        ariaLabel="开关"
        testId="b1"
      />,
    );
    expect(screen.getByTestId('inline-bool-b1').getAttribute('aria-checked')).toBe('true');
  });

  it('交互元素带 nodrag（防画布拖拽误触）', () => {
    render(
      <InlineRowEditor
        kind="text"
        value="hi"
        display="hi"
        onCommit={() => {}}
        ariaLabel="名称"
        testId="t3"
      />,
    );
    expect(screen.getByTestId('inline-value-t3').className).toContain('nodrag');
  });
});
