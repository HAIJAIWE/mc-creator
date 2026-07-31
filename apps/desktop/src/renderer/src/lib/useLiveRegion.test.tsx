// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { useLiveRegion } from './useLiveRegion.js';

afterEach(cleanup);

/**
 * useLiveRegion hook 测试。
 *
 * 覆盖维度：
 * 1. 初始状态：message 为空字符串
 * 2. announce 更新消息：触发 React 状态变化
 * 3. clear 清空消息：重置为空字符串
 * 4. clearAfterMs 自动清除：超时后消息清空
 * 5. LiveRegion 组件渲染：返回的 FC 能正确渲染消息与 politeness
 * 6. 防抖行为：默认 500ms 内多次 announce 仅最后一次生效
 * 7. debounceMs=0 立即生效：跳过防抖直接更新
 *
 * 重要：React 18 + fake timers 下，setTimeout 回调中的 setState 必须用
 * `await act(async () => ...)` 包裹才能确保状态更新被 flush。
 *
 * 注意：本测试与 LiveRegion.test.tsx 中的 useLiveRegion 测试互补 ——
 * 那个文件测了组件挂载、点击按钮触发等集成场景，本文件聚焦 hook API 本身。
 */

// 工具组件：把 hook 结果挂到 DOM 上便于断言
function Harness({
  hookOptions,
  onReady,
}: {
  hookOptions?: Parameters<typeof useLiveRegion>[0];
  onReady?: (r: ReturnType<typeof useLiveRegion>) => void;
}) {
  const result = useLiveRegion(hookOptions);
  // 把 hook 结果通过回调暴露给测试（在 render 阶段调用，外部读取最新值）
  if (onReady) {
    onReady(result);
  }
  const { LiveRegion } = result;
  return (
    <div>
      <LiveRegion />
      <button onClick={() => result.announce('点击消息')}>announce</button>
      <button onClick={() => result.clear()}>clear</button>
      <span data-testid="message-mirror">{result.message}</span>
    </div>
  );
}

describe('useLiveRegion', () => {
  it('初始状态：message 为空字符串', () => {
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(<Harness onReady={(r) => (hookResult = r)} />);
    expect(hookResult.message).toBe('');
  });

  it('announce 更新消息：触发 React 状态变化，LiveRegion 内容随之更新', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(<Harness onReady={(r) => (hookResult = r)} />);
    // 默认 debounceMs=500，需快进到 500ms 之后
    await act(async () => {
      hookResult.announce('编译完成');
    });
    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    expect(hookResult.message).toBe('编译完成');
    const region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('编译完成');
    vi.useRealTimers();
  });

  it('clear 清空消息：重置为空字符串，并取消未触发的 announce', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(<Harness onReady={(r) => (hookResult = r)} />);

    await act(async () => {
      hookResult.announce('待清除');
    });
    await act(async () => {
      vi.advanceTimersByTime(550);
    });
    expect(hookResult.message).toBe('待清除');

    await act(async () => {
      hookResult.clear();
    });
    expect(hookResult.message).toBe('');
    vi.useRealTimers();
  });

  it('clearAfterMs 自动清除：超时后消息清空', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(
      <Harness
        hookOptions={{ clearAfterMs: 1000, debounceMs: 0 }}
        onReady={(r) => (hookResult = r)}
      />,
    );

    await act(async () => {
      hookResult.announce('临时消息');
    });
    expect(hookResult.message).toBe('临时消息');

    // 未到清除时间，消息仍在
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(hookResult.message).toBe('临时消息');

    // 超过 clearAfterMs，消息清空
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(hookResult.message).toBe('');
    vi.useRealTimers();
  });

  it('LiveRegion 组件渲染：返回的 FC 能正确渲染消息与 politeness', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(
      <Harness
        hookOptions={{ politeness: 'assertive', debounceMs: 0 }}
        onReady={(r) => (hookResult = r)}
      />,
    );

    await act(async () => {
      hookResult.announce('紧急通知');
    });

    const region = screen.getByTestId('live-region');
    expect(region.textContent).toBe('紧急通知');
    expect(region.getAttribute('aria-live')).toBe('assertive');
    vi.useRealTimers();
  });

  it('防抖行为：默认 500ms 内多次 announce 仅最后一次生效', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(<Harness onReady={(r) => (hookResult = r)} />);

    await act(async () => {
      hookResult.announce('第一次');
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await act(async () => {
      hookResult.announce('第二次');
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    await act(async () => {
      hookResult.announce('第三次（最终）');
    });
    await act(async () => {
      vi.advanceTimersByTime(550);
    });

    // 防抖窗口内只生效最后一次
    expect(hookResult.message).toBe('第三次（最终）');
    vi.useRealTimers();
  });

  it('debounceMs=0 立即生效：跳过防抖直接更新', () => {
    let hookResult!: ReturnType<typeof useLiveRegion>;
    render(<Harness hookOptions={{ debounceMs: 0 }} onReady={(r) => (hookResult = r)} />);

    act(() => {
      hookResult.announce('立即生效');
    });
    expect(hookResult.message).toBe('立即生效');
  });

  it('politeness 默认 polite：未传时使用合理默认', () => {
    render(<Harness />);
    const region = screen.getByTestId('live-region');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });

  it('message 为空时 LiveRegion 仍渲染（屏幕阅读器后续可感知）', () => {
    render(<Harness />);
    const region = screen.getByTestId('live-region');
    expect(region).toBeTruthy();
    expect(region.textContent).toBe('');
  });
});
