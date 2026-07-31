// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary.js';

afterEach(cleanup);

// 故意抛错的子组件（throw 让 TS 推断为 void，需显式标注 ReactNode 才能作为 JSX 组件）
function ThrowOnRender({ error }: { error: Error }): ReactNode {
  throw error;
}
function GoodChild() {
  return <div data-testid="child">正常渲染</div>;
}

describe('ErrorBoundary', () => {
  it('正常子组件直接渲染', () => {
    render(
      <ErrorBoundary name="Test">
        <GoodChild />
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeTruthy();
    expect(screen.getByText('正常渲染')).toBeTruthy();
  });

  it('捕获子组件渲染错误并显示默认回退 UI', () => {
    const error = new Error('测试崩溃');
    // 抑制 console.error 噪音
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary name="TestArea">
        <ThrowOnRender error={error} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('TestArea 出错')).toBeTruthy();
    expect(screen.getByText('测试崩溃')).toBeTruthy();
    expect(screen.getByText('重试')).toBeTruthy();
    spy.mockRestore();
  });

  it('未提供 name 时使用默认错误文案', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <ThrowOnRender error={new Error('oops')} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('渲染出错')).toBeTruthy();
    spy.mockRestore();
  });

  it('使用自定义 fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary fallback={<div data-testid="custom-fallback">自定义回退</div>}>
        <ThrowOnRender error={new Error('err')} />
      </ErrorBoundary>,
    );
    expect(screen.getByTestId('custom-fallback')).toBeTruthy();
    spy.mockRestore();
  });

  it('点击重试后清除错误状态（重新渲染子组件）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    let shouldThrow = true;
    function ConditionalThrow() {
      if (shouldThrow) throw new Error('first fail');
      return <div data-testid="recovered">恢复</div>;
    }

    render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>,
    );

    // 第一次渲染失败
    expect(screen.getByText('渲染出错')).toBeTruthy();

    // 修复条件后点击重试
    shouldThrow = false;
    fireEvent.click(screen.getByText('重试'));

    expect(screen.getByTestId('recovered')).toBeTruthy();
    spy.mockRestore();
  });

  it('componentDidCatch 调用 console.error 记录错误', () => {
    const error = new Error('captured');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary name="WithCapture">
        <ThrowOnRender error={error} />
      </ErrorBoundary>,
    );

    expect(spy).toHaveBeenCalled();
    // React 18 dev 模式会先报未捕获错误，我们的 componentDidCatch 调用可能不是第一个
    // 在所有调用中查找包含 ErrorBoundary name 的
    const hasNameCall = spy.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('WithCapture'),
    );
    expect(hasNameCall).toBe(true);
    spy.mockRestore();
  });
});
