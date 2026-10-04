/**
 * Toast 操作按钮（actions）与 closeLabel 注入的测试。
 *
 * 与 Toast.test.tsx 分工：那边测既有行为不许漂移，这边只测本轮新增的两块。
 *
 * 为什么 actions 值得单独测：它是「需要用户决策的通知」的唯一载体
 * （desktop 的文件冲突提示：接受服务器 / 保留本地 / 查看差异）。
 * 没有它，提示就只能降级成纯文字 —— 用户看完没法做动作。
 */
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TOAST_DEFAULT_DURATION, Toast, ToastProvider, useToast } from './Toast';
import type { ToastAction, ToastContextValue } from './Toast';

/** 拿到 useToast 的完整 API（渲染在 Provider 内）。 */
function setup(): ToastContextValue {
  const api: { current: ToastContextValue | null } = { current: null };
  function Probe() {
    api.current = useToast();
    return null;
  }
  render(
    <ToastProvider>
      <Probe />
    </ToastProvider>,
  );
  const v = api.current;
  if (v === null) throw new Error('Probe 未挂载');
  return v;
}

describe('Toast · actions（需要用户决策的通知）', () => {
  const actions = (): ToastAction[] => [
    { label: '接受服务器', onClick: vi.fn(), tone: 'primary' },
    { label: '保留本地', onClick: vi.fn() },
    { label: '查看差异', onClick: vi.fn() },
  ];

  it('渲染 actions 且有可访问分组（role=group + aria-label）', () => {
    render(<Toast message="服务器版本与本地不同" actions={actions()} />);
    const group = screen.getByRole('group', { name: '操作' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '接受服务器' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保留本地' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看差异' })).toBeInTheDocument();
  });

  it('点击某个 action 只触发它自己的回调', () => {
    const list = actions();
    render(<Toast message="冲突" actions={list} />);
    fireEvent.click(screen.getByRole('button', { name: '保留本地' }));
    expect(list[1]?.onClick).toHaveBeenCalledTimes(1);
    expect(list[0]?.onClick).not.toHaveBeenCalled();
    expect(list[2]?.onClick).not.toHaveBeenCalled();
  });

  it('tone=primary 用主按钮样式，其余用 ghost', () => {
    render(<Toast message="冲突" actions={actions()} />);
    expect(screen.getByRole('button', { name: '接受服务器' })).toHaveClass('mc-btn-primary');
    expect(screen.getByRole('button', { name: '保留本地' })).toHaveClass('mc-btn-ghost');
  });

  it('tone 省略 → 默认 ghost', () => {
    render(<Toast message="x" actions={[{ label: 'A', onClick: vi.fn() }]} />);
    expect(screen.getByRole('button', { name: 'A' })).toHaveClass('mc-btn-ghost');
  });

  it('disabled 的 action 不可点', () => {
    const onClick = vi.fn();
    render(<Toast message="x" actions={[{ label: 'A', onClick, disabled: true }]} />);
    const btn = screen.getByRole('button', { name: 'A' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('actions 为空数组 → 不渲染分组（不留空壳 role=group）', () => {
    render(<Toast message="x" actions={[]} />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('无 actions → 布局与原来一致（无 role=group）', () => {
    render(<Toast message="纯告知" />);
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('纯告知');
  });

  it('actions 不影响 role/aria-live 语义', () => {
    render(<Toast message="冲突" variant="error" actions={actions()} />);
    const node = screen.getByRole('alert');
    expect(node).toHaveAttribute('aria-live', 'assertive');
  });

  it('多行文案与 actions 共存（文案区与按钮区不重叠）', () => {
    render(<Toast message={'第一行\n第二行'} actions={[{ label: 'A', onClick: vi.fn() }]} />);
    expect(screen.getByRole('status')).toHaveTextContent('第一行');
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });
});

describe('ToastProvider · actions 透传与「带决策按钮则不自动消失」', () => {
  /*
   * 直接调 API（而非 fireEvent.click 触发探针按钮）时必须用 act() 包：
   * show() 内部是 setState，脱离 React 事件系统调用不会自动 flush，
   * 断言会看到「上一帧」的 DOM 而报找不到元素。
   */
  it('show() 传 actions → 渲染出来', () => {
    const api = setup();
    let id = '';
    act(() => {
      id = api.show({ message: '冲突', actions: [{ label: 'A', onClick: vi.fn() }] });
    });
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
    expect(screen.getByTestId('mc-toast')).toHaveAttribute('data-toast-id', id);
  });

  it('**快捷方法传 actions 且未给 duration → duration 自动为 0**（不自动消失）', () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      const onClick = vi.fn();
      act(() => {
        api.warning('需要你决定', { actions: [{ label: '好', onClick }] });
      });
      // 默认 warning 是 4s 自动消失；带决策按钮必须留住入口
      act(() => {
        vi.advanceTimersByTime(TOAST_DEFAULT_DURATION.warning + 1000);
      });
      expect(screen.getByRole('button', { name: '好' })).toBeInTheDocument();
      // 且没有挂定时器（duration=0 的语义）
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('actions + 显式 duration → 尊重调用方（限时提醒场景）', () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      act(() => {
        api.error('限时提示', { actions: [{ label: '好', onClick: vi.fn() }], duration: 2000 });
      });
      expect(screen.getByRole('button', { name: '好' })).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(screen.queryByRole('button', { name: '好' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('只给 duration（无 actions）→ 仍按传入时长自动消失（行为未变）', () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      act(() => {
        api.info('普通提示', { duration: 1000 });
      });
      act(() => {
        vi.advanceTimersByTime(1100);
      });
      expect(screen.queryByText('普通提示')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('actions 为空数组不算「有决策按钮」（按 variant 默认时长走）', () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      act(() => {
        api.info('空 actions', { actions: [] });
      });
      expect(vi.getTimerCount()).toBe(1);
      act(() => {
        vi.advanceTimersByTime(TOAST_DEFAULT_DURATION.info + 100);
      });
      expect(screen.queryByText('空 actions')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('快捷方法 options 省略 → 行为不变（默认时长）', () => {
    vi.useFakeTimers();
    try {
      const api = setup();
      act(() => {
        api.success('成功');
      });
      expect(vi.getTimerCount()).toBe(1);
      expect(screen.getByText('成功')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismiss 后 actions 一并消失', () => {
    const api = setup();
    let id = '';
    act(() => {
      id = api.warning('待处理', { actions: [{ label: 'A', onClick: vi.fn() }] });
    });
    act(() => api.dismiss(id));
    expect(screen.queryByRole('button', { name: 'A' })).not.toBeInTheDocument();
  });
});

describe('Toast · closeLabel 注入（i18n，§4.5）', () => {
  it('默认仍是「关闭通知：{message}」', () => {
    render(<Toast message="出错了" onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: '关闭通知：出错了' })).toBeInTheDocument();
  });

  it('传 closeLabel → 覆盖可访问名（英文环境读 Close 而非中文）', () => {
    render(<Toast message="出错了" onDismiss={() => {}} closeLabel="Close" />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '关闭通知：出错了' })).not.toBeInTheDocument();
  });

  it('closeLabel 为空串 → 按钮无可访问名（调用方自己负责，组件不兜底造词）', () => {
    render(<Toast message="x" onDismiss={() => {}} closeLabel="" />);
    const btn = document.querySelector('button');
    expect(btn).toHaveAttribute('aria-label', '');
  });

  it('有 actions 时 closeLabel 仍生效（两个槽互不干扰）', () => {
    render(
      <Toast
        message="冲突"
        onDismiss={() => {}}
        closeLabel="Close"
        actions={[{ label: 'A', onClick: vi.fn() }]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'A' })).toBeInTheDocument();
  });

  it('无 onDismiss → 不渲染关闭按钮（独立使用时不给死按钮）', () => {
    render(<Toast message="x" actions={[{ label: 'A', onClick: vi.fn() }]} />);
    expect(screen.queryByRole('button', { name: /关闭/ })).not.toBeInTheDocument();
  });
});

describe('自检（确认本文件在 vitest 环境里真跑）', () => {
  it('createRef 可用', () => {
    const ref = createRef<HTMLDivElement>();
    expect(ref.current).toBeNull();
  });
});
