import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip, tooltipPlacementClass, type TooltipPlacement } from './Tooltip';

/**
 * 推进假定时器。
 *
 * 必须包在 act() 里：Tooltip 的 setState 发生在 setTimeout 回调中，
 * React 18 在 act 之外不会 flush 这次更新，断言会读到旧 DOM。
 */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** 触发机制的用例统一用 delayMs=0，免得每个都跟定时器打交道。 */
const NO_DELAY = 0;

describe('Tooltip · 默认行为', () => {
  it('初始不显示提示', () => {
    render(
      <Tooltip content="说明文字" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('hover 后显示提示', () => {
    render(
      <Tooltip content="说明文字" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('说明文字');
  });

  it('移开鼠标后隐藏提示', () => {
    render(
      <Tooltip content="说明文字" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    const source = screen.getByText('触发源');
    fireEvent.mouseEnter(source);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(source);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('触发源被包一层 tabIndex=0 的 span（键盘可达）', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    expect(screen.getByText('触发源')).toHaveAttribute('tabindex', '0');
  });

  it('触发源带 aria-describedby 指向提示', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    const describedBy = screen.getByText('触发源').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveAttribute('role', 'tooltip');
  });

  it('aria-describedby 在提示未显示时就存在（读屏聚焦即可取到）', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    expect(screen.getByText('触发源')).toHaveAttribute('aria-describedby');
  });

  it('aria-describedby 指向的 id 在提示未显示时不存在（不悬空到错误节点）', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    const describedBy = screen.getByText('触发源').getAttribute('aria-describedby') as string;
    expect(document.getElementById(describedBy)).toBeNull();
  });

  it('复用 index.css 的 .mc-pop', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('mc-pop');
  });

  it('提示 pointer-events-none（不挡住鼠标）', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('pointer-events-none');
  });

  it('支持 ReactNode 触发源（图标按钮）', () => {
    render(
      <Tooltip content="删除" delayMs={NO_DELAY}>
        <button type="button">X</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'X' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('删除');
  });

  it('支持 ReactNode 提示内容', () => {
    render(
      <Tooltip content={<strong data-testid="rich">粗体提示</strong>} delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByTestId('rich')).toBeInTheDocument();
  });

  it('tooltip 用 data-testid 便于测试定位', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByTestId('mc-tooltip')).toBeInTheDocument();
  });
});

describe('Tooltip · 键盘可触发', () => {
  it('focus 也能显示（只监听 mouseenter 的 tooltip 对键盘用户等于不存在）', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('blur 后隐藏', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.blur(screen.getByText('触发源'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('delayMs=0 时 focus 立即显示', () => {
    render(
      <Tooltip content="说明" delayMs={0}>
        触发源
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('包裹的 span 真的能被 focus() 聚焦', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    const source = screen.getByText('触发源');
    // 用原生 focus()（而不是 fireEvent.focus）才能证明它真的可聚焦；
    // 原生 focus 会触发 React 的 onFocus → setState，所以要包 act。
    act(() => {
      source.focus();
    });
    expect(document.activeElement).toBe(source);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('键盘 focus 触发的提示内容与 hover 一致', () => {
    render(
      <Tooltip content="键盘提示" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveTextContent('键盘提示');
  });

  it('Escape 收起已显示的提示', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    const source = screen.getByText('触发源');
    fireEvent.focus(source);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    fireEvent.keyDown(source, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('未显示时 Escape 不做任何事', () => {
    render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.keyDown(screen.getByText('触发源'), { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Tooltip · delayMs', () => {
  it('延迟期间不显示', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" delayMs={300}>
          触发源
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText('触发源'));
      advance(299);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('延迟结束后显示', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" delayMs={300}>
          触发源
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText('触发源'));
      advance(300);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('延迟未到就移开 → 取消显示（不闪现）', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" delayMs={300}>
          触发源
        </Tooltip>,
      );
      const source = screen.getByText('触发源');
      fireEvent.mouseEnter(source);
      fireEvent.mouseLeave(source);
      advance(1000);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('隐藏不延迟（即时收起，不粘手）', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" delayMs={300}>
          触发源
        </Tooltip>,
      );
      const source = screen.getByText('触发源');
      fireEvent.mouseEnter(source);
      advance(300);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();

      fireEvent.mouseLeave(source);

      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('重复 hover 不会累积多个定时器', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" delayMs={200}>
          触发源
        </Tooltip>,
      );
      const source = screen.getByText('触发源');
      fireEvent.mouseEnter(source);
      fireEvent.mouseLeave(source);
      fireEvent.mouseEnter(source);
      fireEvent.mouseLeave(source);
      fireEvent.mouseEnter(source);
      advance(200);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('卸载时清掉待触发定时器（不对已卸载组件 setState）', () => {
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = render(
        <Tooltip content="说明" delayMs={300}>
          触发源
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText('触发源'));
      unmount();
      advance(1000);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('默认 delayMs 为 200（鼠标划过不闪）', () => {
    vi.useFakeTimers();
    try {
      render(<Tooltip content="说明">触发源</Tooltip>);
      fireEvent.mouseEnter(screen.getByText('触发源'));
      advance(199);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
      advance(1);
      expect(screen.getByRole('tooltip')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Tooltip · disabled', () => {
  it('disabled 时 hover 不显示', () => {
    render(
      <Tooltip content="说明" disabled delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('disabled 时 focus 不显示', () => {
    render(
      <Tooltip content="说明" disabled delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.focus(screen.getByText('触发源'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('disabled 时延迟计时器根本不会被安排', () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip content="说明" disabled delayMs={200}>
          触发源
        </Tooltip>,
      );
      fireEvent.mouseEnter(screen.getByText('触发源'));
      advance(1000);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('disabled 翻成 true 时收起已显示的提示', () => {
    const { rerender } = render(
      <Tooltip content="说明" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    rerender(
      <Tooltip content="说明" delayMs={NO_DELAY} disabled>
        触发源
      </Tooltip>,
    );

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('Tooltip · placement', () => {
  it('默认 top', () => {
    render(
      <Tooltip content="说明" placement="top" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('bottom-full');
  });

  it('bottom 用 top-full', () => {
    render(
      <Tooltip content="说明" placement="bottom" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('top-full');
  });

  it('left 用 right-full', () => {
    render(
      <Tooltip content="说明" placement="left" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('right-full');
  });

  it('right 用 left-full', () => {
    render(
      <Tooltip content="说明" placement="right" delayMs={NO_DELAY}>
        触发源
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByText('触发源'));
    expect(screen.getByRole('tooltip')).toHaveClass('left-full');
  });

  it('四个 placement 的定位 class 互不相同', () => {
    const all: TooltipPlacement[] = ['top', 'bottom', 'left', 'right'];
    const classes = all.map((p) => tooltipPlacementClass(p));
    expect(new Set(classes).size).toBe(4);
  });

  it('四个 placement 都带居中位移类（纯 CSS 居中，不做 JS 测量）', () => {
    const all: TooltipPlacement[] = ['top', 'bottom', 'left', 'right'];
    for (const p of all) {
      expect(tooltipPlacementClass(p)).toMatch(/translate-[xy]-1\/2/);
    }
  });

  it('placement 决定的是「相对触发源」的方向（top 在上方）', () => {
    expect(tooltipPlacementClass('top')).toContain('bottom-full');
    expect(tooltipPlacementClass('bottom')).toContain('top-full');
    expect(tooltipPlacementClass('left')).toContain('right-full');
    expect(tooltipPlacementClass('right')).toContain('left-full');
  });

  it('未知 placement 返回 undefined（查表未命中，不抛错）', () => {
    expect(tooltipPlacementClass('nope' as TooltipPlacement)).toBeUndefined();
  });
});

describe('Tooltip · className 透传', () => {
  it('className 合并到外层容器', () => {
    const { container } = render(
      <Tooltip content="说明" className="my-tip">
        触发源
      </Tooltip>,
    );
    expect(container.firstElementChild).toHaveClass('my-tip');
  });
});
