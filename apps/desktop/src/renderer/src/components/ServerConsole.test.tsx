// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ServerConsole } from './ServerConsole.js';
import type { KernelTaskResultT } from '../../../shared/ipc-channels.js';

/**
 * 服务端控制台测试（§17 只读观测面）。
 *
 * 只断言本组件的四件事：
 * 1. mount 后立即拉一次 read_logs（serverId 直接透传）；
 * 2. 每 5s 自动轮询（fake timers 前进 5s 触发第二次拉取）；
 * 3. unmount 后不再拉取（interval 已清、在途响应不 setState）；
 * 4. 形状错误 / 主进程错误只显示本组件错误条，不崩。
 */

const kernelRead = vi.fn();

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    kernelRead: (req: unknown) => kernelRead(req),
  },
}));

function ok(data: unknown): KernelTaskResultT {
  return { ok: true, data, error: null };
}

function fail(message: string): KernelTaskResultT {
  return {
    ok: false,
    data: null,
    error: { category: 'validation', message, code: 'X', retryable: false },
  };
}

const LOGS = ok({
  serverId: 'srv-a',
  file: 'logs/latest.log',
  tail: ['line-1', 'line-2', 'line-3'],
});

beforeEach(() => {
  kernelRead.mockReset().mockResolvedValue(LOGS);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerConsole：自动刷新只读控制台', () => {
  it('mount 后立即拉取一次 read_logs（serverId 直接透传）', async () => {
    render(<ServerConsole serverId="srv-a" />);
    await waitFor(() => expect(kernelRead).toHaveBeenCalledTimes(1));
    expect(kernelRead.mock.calls[0][0]).toEqual({
      kind: 'read_logs',
      payload: { serverId: 'srv-a' },
    });
    // tail 以 <pre> 展示
    const pre = await screen.findByTestId('console-tail');
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent).toContain('line-1');
    // 顶部显示 file 路径
    expect(screen.getByTestId('console-file').textContent).toContain('logs/latest.log');
  });

  it('每 5s 自动轮询一次（前进 5s 触发第二次拉取）', async () => {
    vi.useFakeTimers();
    render(<ServerConsole serverId="srv-a" />);
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(2);
    expect(kernelRead.mock.calls[1][0]).toEqual({
      kind: 'read_logs',
      payload: { serverId: 'srv-a' },
    });
  });

  it('unmount 后不再拉取（interval 已清）', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<ServerConsole serverId="srv-a" />);
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
  });

  it('响应形状错误时只显示本组件错误条，不崩', async () => {
    kernelRead.mockResolvedValue(ok({ wrongKey: [] }));
    render(<ServerConsole serverId="srv-a" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('KernelReadLogsResponse');
    // 没崩：操作区仍在
    expect(screen.getByLabelText('手动刷新')).toBeTruthy();
    expect(screen.getByTestId('console-status').textContent).toContain('错误');
  });

  it('主进程返回 ok:false 时显示其错误信息，不崩', async () => {
    kernelRead.mockResolvedValue(fail('内核数据根目录未配置'));
    render(<ServerConsole serverId="srv-a" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('内核数据根目录未配置');
  });

  it('空 tail 显示“暂无日志输出”', async () => {
    kernelRead.mockResolvedValue(ok({ serverId: 'srv-a', file: 'logs/latest.log', tail: [] }));
    render(<ServerConsole serverId="srv-a" />);
    expect(await screen.findByText('暂无日志输出')).toBeTruthy();
  });

  it('只取尾 100 行', async () => {
    const tail150 = Array.from({ length: 150 }, (_, i) => `row-${i + 1}`);
    kernelRead.mockResolvedValue(ok({ serverId: 'srv-a', file: 'logs/latest.log', tail: tail150 }));
    render(<ServerConsole serverId="srv-a" />);
    const pre = await screen.findByTestId('console-tail');
    const lines = (pre.textContent ?? '').split('\n');
    expect(lines).toHaveLength(100);
    expect(lines[0]).toBe('row-51');
    expect(lines[99]).toBe('row-150');
  });

  it('暂停后停止轮询，继续后恢复轮询', async () => {
    vi.useFakeTimers();
    render(<ServerConsole serverId="srv-a" />);
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('console-status').textContent).not.toContain('已暂停');
    fireEvent.click(screen.getByLabelText('暂停自动刷新'));
    expect(screen.getByTestId('console-status').textContent).toContain('已暂停');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('继续自动刷新'));
    // 恢复时立即拉一次
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(3);
  });

  it('手动刷新按钮立即触发一次拉取', async () => {
    vi.useFakeTimers();
    render(<ServerConsole serverId="srv-a" />);
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('手动刷新'));
    await act(async () => {});
    expect(kernelRead).toHaveBeenCalledTimes(2);
  });

  it('serverId 变化时重置状态并重拉', async () => {
    kernelRead.mockImplementation(async (req: { kind: string; payload: { serverId: string } }) =>
      ok({
        serverId: req.payload.serverId,
        file: `${req.payload.serverId}/latest.log`,
        tail: [`hello-${req.payload.serverId}`],
      }),
    );
    const { rerender } = render(<ServerConsole serverId="srv-a" />);
    expect(await screen.findByText('hello-srv-a')).toBeTruthy();
    const firstCalls = kernelRead.mock.calls.length;
    expect(firstCalls).toBeGreaterThanOrEqual(1);
    rerender(<ServerConsole serverId="srv-b" />);
    await waitFor(() =>
      expect(
        kernelRead.mock.calls.some(
          (c) => (c[0] as { payload: { serverId: string } }).payload.serverId === 'srv-b',
        ),
      ).toBe(true),
    );
    expect(await screen.findByText('hello-srv-b')).toBeTruthy();
  });
});
