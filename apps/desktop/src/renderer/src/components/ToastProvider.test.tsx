// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ToastProvider } from './ToastProvider.js';
import { useToast } from './useToast.js';

/** 测试探针：在 Provider 内消费 toast API */
function ToastProbe() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success('成功提示')}>success</button>
      <button onClick={() => toast.error('错误提示')}>error</button>
      <button onClick={() => toast.warning('警告提示')}>warning</button>
      <button onClick={() => toast.info('信息提示')}>info</button>
    </div>
  );
}

describe('ToastProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('触发 success 后渲染 toast 消息', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    expect(screen.getByText('成功提示')).toBeTruthy();
  });

  it('4 种类型都渲染对应消息', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    fireEvent.click(screen.getByText('error'));
    fireEvent.click(screen.getByText('warning'));
    fireEvent.click(screen.getByText('info'));
    expect(screen.getByText('成功提示')).toBeTruthy();
    expect(screen.getByText('错误提示')).toBeTruthy();
    expect(screen.getByText('警告提示')).toBeTruthy();
    expect(screen.getByText('信息提示')).toBeTruthy();
  });

  it('success 3s 后自动消失', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    expect(screen.getByText('成功提示')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText('成功提示')).toBeNull();
  });

  it('手动点击关闭按钮立即消失', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    const closeBtn = screen.getAllByLabelText('关闭')[0];
    fireEvent.click(closeBtn);
    expect(screen.queryByText('成功提示')).toBeNull();
  });
});

describe('useToast', () => {
  it('在 Provider 外使用抛错', () => {
    function Broken() {
      useToast();
      return null;
    }
    expect(() => render(<Broken />)).toThrow('useToast must be used within ToastProvider');
  });
});
