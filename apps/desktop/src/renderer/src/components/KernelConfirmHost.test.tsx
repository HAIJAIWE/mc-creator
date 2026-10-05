// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { KernelConfirmHost } from './KernelConfirmHost.js';
import type { KernelConfirmReq } from '../../../shared/ipc-channels.js';

/**
 * 内核确认宿主测试（X2b）。
 *
 * 只测「响应发出」：批准/取消是否调 `respondKernelConfirm({ id, approved })`、
 * 同 id 覆盖、unmount 取消订阅。超时拒绝由主进程侧计时兜底，这里不测
 * （宿主侧没有任何计时器，绝不自动确认）。
 */

type ConfirmCb = (req: KernelConfirmReq) => void;

let capturedCb: ConfirmCb | null = null;
let offFn: ReturnType<typeof vi.fn>;
const respondKernelConfirm = vi.fn(async (_res: unknown) => undefined);
const onKernelConfirmRequest = vi.fn((_cb: ConfirmCb) => offFn);

function wireReq(overrides: Partial<KernelConfirmReq> = {}): KernelConfirmReq {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'stop_server',
    summary: '停止服务端 srv-a',
    risk: 'execute',
    requestedAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  capturedCb = null;
  offFn = vi.fn();
  respondKernelConfirm.mockReset().mockResolvedValue(undefined);
  onKernelConfirmRequest.mockReset().mockImplementation((cb: ConfirmCb) => {
    capturedCb = cb;
    return offFn;
  });
  (window as unknown as { mcApi: unknown }).mcApi = {
    onKernelConfirmRequest,
    respondKernelConfirm,
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function push(req: KernelConfirmReq): void {
  expect(capturedCb).not.toBeNull();
  act(() => {
    (capturedCb as ConfirmCb)(req);
  });
}

describe('KernelConfirmHost', () => {
  it('收到请求后弹出确认框（message 用 summary，title 含 kind）', async () => {
    render(<KernelConfirmHost />);
    expect(onKernelConfirmRequest).toHaveBeenCalledTimes(1);
    push(wireReq());
    expect(await screen.findByText('停止服务端 srv-a')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '确认执行 stop_server' })).toBeTruthy();
  });

  it('点确定发出 approved=true 的应答并关闭弹窗', async () => {
    render(<KernelConfirmHost />);
    const req = wireReq();
    push(req);
    fireEvent.click(await screen.findByRole('button', { name: '确定' }));
    await waitFor(() =>
      expect(respondKernelConfirm).toHaveBeenCalledWith({ id: req.id, approved: true }),
    );
    await waitFor(() => expect(screen.queryByText('停止服务端 srv-a')).toBeNull());
  });

  it('点取消发出 approved=false 的应答并关闭弹窗', async () => {
    render(<KernelConfirmHost />);
    const req = wireReq({ summary: '重启服务端 srv-b', kind: 'restart_server' });
    push(req);
    expect(await screen.findByText('重启服务端 srv-b')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(respondKernelConfirm).toHaveBeenCalledWith({ id: req.id, approved: false }),
    );
    await waitFor(() => expect(screen.queryByText('重启服务端 srv-b')).toBeNull());
  });

  it('同 id 重复请求以后到为准', async () => {
    render(<KernelConfirmHost />);
    const id = '22222222-2222-4222-8222-222222222222';
    push(wireReq({ id, summary: '旧摘要' }));
    expect(await screen.findByText('旧摘要')).toBeTruthy();
    push(wireReq({ id, summary: '新摘要' }));
    expect(await screen.findByText('新摘要')).toBeTruthy();
    expect(screen.queryByText('旧摘要')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(respondKernelConfirm).toHaveBeenCalledWith({ id, approved: true }));
    expect(respondKernelConfirm).toHaveBeenCalledTimes(1);
  });

  it('unmount 时取消订阅', () => {
    const { unmount } = render(<KernelConfirmHost />);
    expect(capturedCb).not.toBeNull();
    unmount();
    expect(offFn).toHaveBeenCalledTimes(1);
  });
});
