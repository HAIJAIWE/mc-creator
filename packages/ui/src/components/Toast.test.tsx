import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TOAST_DEFAULT_DURATION, Toast, ToastProvider, useToast, type ToastVariant } from './Toast';

/** 测试探针：在 Provider 内消费 toast API */
function ToastProbe() {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.show({ message: '默认信息' })}>
        show
      </button>
      <button type="button" onClick={() => toast.info('信息提示')}>
        info
      </button>
      <button type="button" onClick={() => toast.success('成功提示')}>
        success
      </button>
      <button type="button" onClick={() => toast.warning('警告提示')}>
        warning
      </button>
      <button type="button" onClick={() => toast.error('错误提示')}>
        error
      </button>
      <button type="button" onClick={() => toast.info('常驻提示', { duration: 0 })}>
        永驻
      </button>
      <button type="button" onClick={() => toast.clear()}>
        clear
      </button>
    </div>
  );
}

function renderWithProvider() {
  return render(
    <ToastProvider>
      <ToastProbe />
    </ToastProvider>,
  );
}

const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const toasts = () => screen.queryAllByTestId('mc-toast');
const toastTexts = () => toasts().map((el) => el.textContent ?? '');

describe('Toast · Provider 基本行为', () => {
  it('初始没有 toast', () => {
    renderWithProvider();
    expect(toasts()).toHaveLength(0);
  });

  it('toast 栈容器存在', () => {
    renderWithProvider();
    expect(screen.getByTestId('mc-toast-stack')).toBeInTheDocument();
  });

  it('show 弹出一条', () => {
    renderWithProvider();
    click('show');
    expect(toasts()).toHaveLength(1);
    expect(screen.getByText('默认信息')).toBeInTheDocument();
  });

  it('show 默认 variant 为 info', () => {
    renderWithProvider();
    click('show');
    expect(toasts()[0]).toHaveAttribute('role', 'status');
  });

  it('四条快捷方法各自产出对应文案', () => {
    renderWithProvider();
    click('info');
    click('success');
    click('warning');
    click('error');
    expect(toastTexts().join('|')).toContain('信息提示');
    expect(toastTexts().join('|')).toContain('成功提示');
    expect(toastTexts().join('|')).toContain('警告提示');
    expect(toastTexts().join('|')).toContain('错误提示');
  });

  it('多条 toast 堆叠（后加入的在后面）', () => {
    renderWithProvider();
    click('info');
    click('success');
    click('warning');
    expect(toasts()).toHaveLength(3);
    expect(toastTexts()[0]).toContain('信息提示');
    expect(toastTexts()[2]).toContain('警告提示');
  });

  it('toast 容器 fixed 定位（不随页面滚动）', () => {
    renderWithProvider();
    expect(screen.getByTestId('mc-toast-stack').className).toContain('fixed');
  });

  it('placement 可换到右下角', () => {
    render(
      <ToastProvider placement="bottom-right">
        <span>内容</span>
      </ToastProvider>,
    );
    expect(screen.getByTestId('mc-toast-stack').className).toContain('bottom-4');
  });
});

describe('Toast · 无障碍', () => {
  it('error 用 role="alert" + aria-live="assertive"（立即打断读屏）', () => {
    renderWithProvider();
    click('error');
    const el = toasts()[0];
    expect(el).toHaveAttribute('role', 'alert');
    expect(el).toHaveAttribute('aria-live', 'assertive');
  });

  it('info / success / warning 用 role="status" + aria-live="polite"', () => {
    renderWithProvider();
    click('info');
    click('success');
    click('warning');
    for (const el of toasts()) {
      expect(el).toHaveAttribute('role', 'status');
      expect(el).toHaveAttribute('aria-live', 'polite');
    }
  });

  it('aria-atomic=true（每次变化朗读整段，不只念差异）', () => {
    renderWithProvider();
    click('info');
    expect(toasts()[0]).toHaveAttribute('aria-atomic', 'true');
  });

  it('live region 属性挂在真实 toast 节点上（不做 sr-only 副本）', () => {
    renderWithProvider();
    click('info');
    // 同一段文本在 DOM 里只应出现一次（桌面端 LiveRegion 会复制一份）
    expect(screen.getAllByText('信息提示')).toHaveLength(1);
  });

  it('关闭按钮的可访问名包含消息内容', () => {
    renderWithProvider();
    click('error');
    expect(screen.getByRole('button', { name: '关闭通知：错误提示' })).toBeInTheDocument();
  });

  it('toast 复用 .mc-pop 浮层样式', () => {
    renderWithProvider();
    click('info');
    expect(toasts()[0]).toHaveClass('mc-pop');
  });
});

describe('Toast · 自动关闭', () => {
  it('按 variant 的默认时长自动消失', () => {
    vi.useFakeTimers();
    try {
      renderWithProvider();
      click('info');
      expect(toasts()).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(TOAST_DEFAULT_DURATION.info + 10);
      });
      expect(toasts()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('error 的默认时长比 info 长（要读完）', () => {
    expect(TOAST_DEFAULT_DURATION.error).toBeGreaterThan(TOAST_DEFAULT_DURATION.info);
    expect(TOAST_DEFAULT_DURATION.warning).toBeGreaterThan(TOAST_DEFAULT_DURATION.info);
  });

  it('duration=0 不自动消失', () => {
    vi.useFakeTimers();
    try {
      renderWithProvider();
      click('永驻');
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(toasts()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('可传 duration 覆盖默认时长', () => {
    vi.useFakeTimers();
    try {
      function Probe() {
        const toast = useToast();
        return (
          <button type="button" onClick={() => toast.show({ message: '短通知', duration: 500 })}>
            发
          </button>
        );
      }
      render(
        <ToastProvider>
          <Probe />
        </ToastProvider>,
      );
      click('发');
      expect(toasts()).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(510);
      });
      expect(toasts()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('多条 toast 各按自己的时长消失', () => {
    vi.useFakeTimers();
    try {
      function Probe() {
        const toast = useToast();
        return (
          <>
            <button type="button" onClick={() => toast.show({ message: '短', duration: 100 })}>
              短
            </button>
            <button type="button" onClick={() => toast.show({ message: '长', duration: 5000 })}>
              长
            </button>
          </>
        );
      }
      render(
        <ToastProvider>
          <Probe />
        </ToastProvider>,
      );
      click('短');
      click('长');
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(toasts()).toHaveLength(1);
      expect(toasts()[0]).toHaveTextContent('长');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Toast · 手动关闭', () => {
  it('点关闭按钮移除该条', () => {
    renderWithProvider();
    click('info');
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：信息提示' }));
    expect(toasts()).toHaveLength(0);
  });

  it('只关掉被点的那一条', () => {
    renderWithProvider();
    click('info');
    click('success');
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：信息提示' }));
    expect(toasts()).toHaveLength(1);
    expect(toasts()[0]).toHaveTextContent('成功提示');
  });

  it('clear 清空全部', () => {
    renderWithProvider();
    click('info');
    click('success');
    click('warning');
    click('clear');
    expect(toasts()).toHaveLength(0);
  });

  it('手动关闭会取消该条的待触发定时器（不会二次操作）', () => {
    vi.useFakeTimers();
    try {
      renderWithProvider();
      click('永驻');
      fireEvent.click(screen.getByRole('button', { name: '关闭通知：常驻提示' }));
      expect(toasts()).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(toasts()).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Provider 卸载时清理定时器（不泄漏）', () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = renderWithProvider();
      click('info');
      unmount();
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });
});

describe('Toast · show 返回 id', () => {
  it('返回的 id 可用于手动 dismiss', () => {
    let captured = '';
    function Probe() {
      const toast = useToast();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              captured = toast.show({ message: '可关闭的通知' });
            }}
          >
            发
          </button>
          <button type="button" onClick={() => toast.dismiss(captured)}>
            按 id 关
          </button>
        </>
      );
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    click('发');
    expect(captured).not.toBe('');
    click('按 id 关');
    expect(toasts()).toHaveLength(0);
  });

  it('连续 show 产生不重复的 id（不会互相顶掉）', () => {
    const ids: string[] = [];
    function Probe() {
      const toast = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            ids.push(toast.show({ message: 'A' }));
            ids.push(toast.show({ message: 'B' }));
          }}
        >
          发两条
        </button>
      );
    }
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    click('发两条');
    expect(new Set(ids).size).toBe(2);
    expect(toasts()).toHaveLength(2);
  });
});

describe('Toast · useToast 的 Provider 约束', () => {
  it('在 Provider 外使用会抛错（早失败好过静默 undefined）', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<ToastProbe />)).toThrow(/must be used within ToastProvider/);
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('Toast · 单个 Toast 组件', () => {
  it('独立使用可渲染文案', () => {
    render(<Toast id="x" message="独立通知" />);
    expect(screen.getByText('独立通知')).toBeInTheDocument();
  });

  it('独立使用省略 variant 时默认 info（role=status）', () => {
    render(<Toast id="x" message="独立通知" />);
    expect(screen.getByTestId('mc-toast')).toHaveAttribute('role', 'status');
  });

  it('error 变体渲染 role="alert"', () => {
    render(<Toast id="x" message="坏了" variant="error" />);
    expect(screen.getByTestId('mc-toast')).toHaveAttribute('role', 'alert');
  });

  it('四个变体都能渲染', () => {
    const variants: ToastVariant[] = ['info', 'success', 'warning', 'error'];
    for (const variant of variants) {
      const { unmount } = render(<Toast id={variant} message={variant} variant={variant} />);
      expect(screen.getByText(variant)).toBeInTheDocument();
      unmount();
    }
  });

  it('没有 onDismiss 时不渲染关闭按钮（不留死按钮）', () => {
    render(<Toast id="x" message="只读" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('传了 onDismiss 时渲染可用的关闭按钮', () => {
    const onDismiss = vi.fn();
    render(<Toast id="x" message="可关" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: '关闭通知：可关' }));
    expect(onDismiss).toHaveBeenCalledWith('x');
  });

  it('多行文案保留换行（whitespace-pre-wrap 在消息节点上）', () => {
    const { container } = render(<Toast id="x" message={'第一行\n第二行'} />);
    const message = container.querySelector('.whitespace-pre-wrap');
    expect(message).not.toBeNull();
    expect(message).toHaveTextContent('第一行 第二行');
  });
});
