// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
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

/** 仅查询可见 toast 栈，排除 aria-live 朗读区（sr-only 复制了一份消息文本） */
function toastText(text: string) {
  return within(screen.getByTestId('toast-stack')).getByText(text);
}

function queryToastText(text: string) {
  return within(screen.getByTestId('toast-stack')).queryByText(text);
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
    expect(toastText('成功提示')).toBeTruthy();
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
    expect(toastText('成功提示')).toBeTruthy();
    expect(toastText('错误提示')).toBeTruthy();
    expect(toastText('警告提示')).toBeTruthy();
    expect(toastText('信息提示')).toBeTruthy();
  });

  it('success 3s 后自动消失', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    expect(toastText('成功提示')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(queryToastText('成功提示')).toBeNull();
  });

  it('手动点击关闭按钮立即消失', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    const closeBtn = within(screen.getByTestId('toast-stack')).getAllByLabelText('关闭')[0];
    fireEvent.click(closeBtn);
    expect(queryToastText('成功提示')).toBeNull();
  });

  it('a11y：最新 toast 写入 aria-live 朗读区（error 用 assertive）', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('error'));
    const region = screen.getByTestId('live-region-toast-announcer');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('assertive');
    expect(region.textContent).toContain('错误提示');
  });

  it('a11y：success 用 polite 礼貌级别朗读', () => {
    render(
      <ToastProvider>
        <ToastProbe />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText('success'));
    const region = screen.getByTestId('live-region-toast-announcer');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toContain('成功提示');
  });
});

describe('useToast', () => {
  it('在 Provider 外使用抛错', () => {
    function Broken() {
      useToast();
      return null;
    }
    // D10：React 18.3 render 抛错会经 jsdom error 事件报 Uncaught 噪音，
    // 拦截该事件 + 包 act 断言，仅保留可断言的 throw
    const onError = (e: Event) => {
      e.preventDefault();
    };
    window.addEventListener('error', onError);
    try {
      expect(() =>
        act(() => {
          render(<Broken />);
        }),
      ).toThrow('useToast must be used within ToastProvider');
    } finally {
      window.removeEventListener('error', onError);
    }
  });
});
