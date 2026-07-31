// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { LiveRegion } from './LiveRegion.js';
import { useLiveRegion } from './useLiveRegion.js';

afterEach(cleanup);

/**
 * LiveRegion 组件测试。
 *
 * 覆盖维度：
 * 1. 默认渲染（无 props 时使用合理默认值）
 * 2. politeness 属性正确传递
 * 3. atomic 属性正确传递（true/false）
 * 4. message 变化触发 aria-live 区域内容更新
 * 5. sr-only 视觉隐藏类已应用（对辅助技术可见，对视觉隐藏）
 * 6. id 透传到 DOM
 * 7. className 与 sr-only 合并（不覆盖默认 sr-only）
 * 8. 空消息处理（仍渲染 DOM 节点，让屏幕阅读器后续可感知）
 * 9. relevant 属性传递（确保自定义 relevant 工作）
 * 10. role="status" 固定（确保语义正确）
 */
describe('LiveRegion', () => {
  it('默认渲染：使用 polite 与 atomic=true 默认值，且始终渲染 DOM 节点', () => {
    render(<LiveRegion message="hello" />);
    const region = screen.getByTestId('live-region');
    expect(region).toBeTruthy();
    expect(region.tagName).toBe('DIV');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    // role="status" 是固定语义（动态通知区），不允许调用方覆盖
    expect(region.getAttribute('role')).toBe('status');
  });

  it('politeness 属性：assertive 正确传递到 aria-live', () => {
    render(<LiveRegion message="紧急" politeness="assertive" />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-live')).toBe('assertive');
  });

  it('politeness 属性：polite 显式传递也生效', () => {
    render(<LiveRegion message="提示" politeness="polite" />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('atomic 属性：false 时传递到 aria-atomic（按需禁用整体朗读）', () => {
    render(<LiveRegion message="段落 A 段落 B" atomic={false} />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-atomic')).toBe('false');
  });

  it('message 变化触发 aria-live 区域内容更新（屏幕阅读器会感知）', () => {
    const { rerender } = render(<LiveRegion message="第一次" />);
    let region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('第一次');

    rerender(<LiveRegion message="第二次" />);
    region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('第二次');
  });

  it('sr-only 视觉隐藏类已应用（对辅助技术可见，对视觉隐藏）', () => {
    render(<LiveRegion message="隐藏消息" />);
    const region = screen.getByTestId('live-region');
    expect(region.className).toContain('sr-only');
  });

  it('id 透传到 DOM，并生成对应的 data-testid 后缀', () => {
    render(<LiveRegion message="带 id" id="compile-status" />);
    const region = screen.getByTestId('live-region-compile-status');
    expect(region.id).toBe('compile-status');
  });

  it('className 与 sr-only 合并：调用方追加的类不覆盖默认 sr-only', () => {
    render(<LiveRegion message="合并" className="text-xs font-bold" />);
    const region = screen.getByTestId('live-region');
    expect(region.className).toContain('sr-only');
    expect(region.className).toContain('text-xs');
    expect(region.className).toContain('font-bold');
  });

  it('空消息处理：仍渲染 DOM 节点，让屏幕阅读器后续可感知变化', () => {
    render(<LiveRegion message="" />);
    const region = screen.getByTestId('live-region');
    expect(region).toBeTruthy();
    expect(region.textContent).toBe('');
    // aria-live 属性不应因空消息而消失
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('relevant 属性：自定义 relevant=removals 时传递到 DOM', () => {
    render(<LiveRegion message="移除通知" relevant="removals" />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-relevant')).toBe('removals');
  });

  it('relevant 属性：默认 additions（避免删除时刷屏）', () => {
    render(<LiveRegion message="默认 relevant" />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-relevant')).toBe('additions');
  });

  it('多实例共存：不同 id 的 LiveRegion 互不干扰', () => {
    render(
      <>
        <LiveRegion message="状态 A" id="region-a" />
        <LiveRegion message="状态 B" id="region-b" />
      </>,
    );
    const a = screen.getByTestId('live-region-region-a');
    const b = screen.getByTestId('live-region-region-b');
    expect(a.textContent).toBe('状态 A');
    expect(b.textContent).toBe('状态 B');
  });
});

describe('LiveRegion — clearAfterMs 自动清空', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  /** 工具：推进 vitest 假时钟并刷新 React 渲染队列 */
  async function flush(ms = 0) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('clearAfterMs 触发后自动清空 DOM 文本（避免屏幕阅读器重复朗读）', async () => {
    render(<LiveRegion message="提示" clearAfterMs={1000} />);
    const region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('提示');

    await flush(1000);
    expect(region.textContent).toBe('');
  });

  it('不传 clearAfterMs 时消息永久保留', async () => {
    render(<LiveRegion message="持久" />);
    const region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('持久');
    await flush(10000);
    expect(region.textContent).toBe('持久');
  });

  it('消息更新时 clearAfterMs 定时器重置（不会过早清空新消息）', async () => {
    const { rerender } = render(<LiveRegion message="A" clearAfterMs={1000} />);
    const region = screen.getByTestId('live-region');

    await flush(500);
    expect(region.textContent).toBe('A');

    // 更新消息，定时器应重置
    rerender(<LiveRegion message="B" clearAfterMs={1000} />);
    expect(region.textContent).toBe('B');

    // 推进 700ms（距 B 已 700ms，未到 1000ms），B 仍在
    await flush(700);
    expect(region.textContent).toBe('B');

    // 再推进 400ms（累计 1100ms from B），B 应清空
    await flush(400);
    expect(region.textContent).toBe('');
  });

  it('clearAfterMs 与空消息共存不报错', async () => {
    render(<LiveRegion message="" clearAfterMs={500} />);
    const region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('');
    await flush(500);
    expect(region.textContent).toBe('');
  });

  it('组件卸载时定时器被清理（不抛错、不触发 setState on unmounted）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(<LiveRegion message="x" clearAfterMs={1000} />);
    unmount();
    await act(async () => {
      expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/** 测试用包装组件：使用 useLiveRegion hook */
function Harness({ onReady }: { onReady?: (api: ReturnType<typeof useLiveRegion>) => void }) {
  const api = useLiveRegion();
  useEffect(() => {
    onReady?.(api);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div>
      <LiveRegion message={api.message} />
      <button type="button" onClick={() => api.announce('已通知')}>
        通知
      </button>
      <button type="button" onClick={() => api.clear()}>
        清空
      </button>
      <span data-testid="msg-mirror">{api.message}</span>
    </div>
  );
}

describe('useLiveRegion hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  async function flush(ms = 0) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('初始 message 为空字符串', () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);
    expect(captured).toBeDefined();
    expect(captured!.message).toBe('');
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');
  });

  it('announce 在 500ms 防抖窗口后更新 message', async () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);

    act(() => {
      captured!.announce('第一条');
    });
    // 防抖窗口内未更新
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');

    await flush(500);
    expect(screen.getByTestId('msg-mirror').textContent).toBe('第一条');
  });

  it('500ms 内多次 announce 只保留最后一次（防抖）', async () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);

    act(() => captured!.announce('A'));
    await flush(200);
    act(() => captured!.announce('B'));
    await flush(200);
    act(() => captured!.announce('C'));

    // 累计 400ms，仍处于 500ms 防抖窗口内，message 应仍为空
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');

    // 推进 500ms，应只保留最后一条
    await flush(500);
    expect(screen.getByTestId('msg-mirror').textContent).toBe('C');
  });

  it('clear 立即清空 message 并取消未触发的 announce', async () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);

    act(() => captured!.announce('待清空'));
    await flush(200);

    act(() => captured!.clear());
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');

    // 推进到原 announce 时间，不应触发更新（已被取消）
    await flush(500);
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');
  });

  it('clear 后再次 announce 仍能正常工作', async () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);

    act(() => captured!.announce('A'));
    await flush(500);
    expect(screen.getByTestId('msg-mirror').textContent).toBe('A');

    act(() => captured!.clear());
    expect(screen.getByTestId('msg-mirror').textContent).toBe('');

    act(() => captured!.announce('B'));
    await flush(500);
    expect(screen.getByTestId('msg-mirror').textContent).toBe('B');
  });

  it('点击按钮触发 announce → LiveRegion 文本更新', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '通知' }));
    expect(screen.getByTestId('live-region').textContent).toBe('');
    await flush(500);
    expect(screen.getByTestId('live-region').textContent).toBe('已通知');
  });

  it('点击清空按钮立即清空 LiveRegion 文本', async () => {
    let captured: ReturnType<typeof useLiveRegion> | undefined;
    render(<Harness onReady={(api) => (captured = api)} />);
    act(() => captured!.announce('Hello'));
    await flush(500);
    expect(screen.getByTestId('live-region').textContent).toBe('Hello');

    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.getByTestId('live-region').textContent).toBe('');
  });

  it('卸载后定时器被清理（不触发 setState on unmounted）', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { unmount } = render(
      <Harness
        onReady={(api) => {
          // 排一个未触发的 announce
          setTimeout(() => api.announce('已卸载后不应触发'), 0);
        }}
      />,
    );
    await flush(0);
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
