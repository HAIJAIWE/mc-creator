/**
 * X1 UI 确认测试（`kernel-confirm-ui.ts`）。
 *
 * 全部用 fake 窗口测，不碰 electron：
 * - `getWindow` fake：可控返回 null / 正常窗口 / 已销毁窗口；
 * - `send` fake：`webContents.send` 只把 `(channel, payload)` 记下来，
 *   测试从中读出 `id` 再调 `handleResponse`，模拟 renderer 的 invoke 应答；
 * - `invoke` fake：直接调 `confirm.handleResponse({ id, approved })`，
 *   形状不对 / id 对不上就是"错配丢弃"。
 *
 * 覆盖任务书点名的五件事：
 * 1. 正常批准；2. 超时拒绝；3. id 错配丢弃；4. 无窗口 fallback；5. 并发两请求各归位。
 * 外加两条护栏：等待期间窗口被销毁 → false；send 抛错 → fallback/默认 false。
 */

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { KERNEL_CONFIRM_REQUEST } from '../shared/ipc/channels.js';
import { KernelConfirmRequest as KernelConfirmWireRequest } from '../shared/ipc/kernel.js';
import { createUiConfirm, type UiConfirmWindow } from './kernel-confirm-ui.js';
import type { KernelConfirmRequest } from './kernel-runtime.js';

function req(overrides: Partial<KernelConfirmRequest> = {}): KernelConfirmRequest {
  return {
    kind: 'delete_instance',
    payload: { instanceId: 'demo' },
    summary: '删除实例 demo',
    risk: 'execute',
    ...overrides,
  };
}

interface Sent {
  channel: string;
  payload: unknown;
}

type FakeWindow = UiConfirmWindow & { destroyed: boolean };

function fakeWindow(
  sent: Sent[],
  opts: { destroyed?: boolean; throwOnSend?: boolean } = {},
): FakeWindow {
  return {
    destroyed: opts.destroyed ?? false,
    isDestroyed(): boolean {
      return this.destroyed;
    },
    webContents: {
      send(channel: string, payload: unknown): void {
        if (opts.throwOnSend === true) throw new Error('window gone');
        sent.push({ channel, payload });
      },
    },
  };
}

/** 从第 n 次 send 里取出线上传输的 id（顺带断言 send 通道名正确）。 */
function wireId(sent: Sent[], index = 0): string {
  expect(sent.length).toBeGreaterThan(index);
  expect(sent[index]?.channel).toBe(KERNEL_CONFIRM_REQUEST);
  const payload = sent[index]?.payload as { id?: unknown };
  expect(typeof payload?.id).toBe('string');
  return payload?.id as string;
}

describe('createUiConfirm：正常批准', () => {
  it('send 带 id 的请求，应答同 id approved=true → true', async () => {
    const sent: Sent[] = [];
    const win = fakeWindow(sent);
    const confirm = createUiConfirm({ getWindow: () => win, timeoutMs: 1000 });
    const p = confirm(req());
    expect(sent).toHaveLength(1);
    expect(sent[0]?.channel).toBe(KERNEL_CONFIRM_REQUEST);
    // 线上形状一次过 schema（id 是 uuid，risk/summary 都在，payload 没上通道）。
    const parsed = KernelConfirmWireRequest.safeParse(sent[0]?.payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kind).toBe('delete_instance');
      expect(parsed.data.summary).toBe('删除实例 demo');
      expect(parsed.data.risk).toBe('execute');
      expect(typeof parsed.data.requestedAt).toBe('number');
      expect('payload' in (sent[0]?.payload as Record<string, unknown>)).toBe(false);
    }
    confirm.handleResponse({ id: wireId(sent), approved: true });
    await expect(p).resolves.toBe(true);
    expect(confirm.pendingCount()).toBe(0);
  });
});

describe('createUiConfirm：超时拒绝', () => {
  it('无应答 → 超时后 false（fail-closed；此处用 20ms 代表 60s）', async () => {
    const sent: Sent[] = [];
    const confirm = createUiConfirm({ getWindow: () => fakeWindow(sent), timeoutMs: 20 });
    await expect(confirm(req())).resolves.toBe(false);
    expect(sent).toHaveLength(1); // 请求确实发出去了，只是没人理
    expect(confirm.pendingCount()).toBe(0); // 超时后 pending 被清理
  });
});

describe('createUiConfirm：id 错配丢弃', () => {
  it('伪造/串台的应答被丢弃，正确 id 仍可批准', async () => {
    const sent: Sent[] = [];
    const confirm = createUiConfirm({ getWindow: () => fakeWindow(sent), timeoutMs: 1000 });
    const p = confirm(req());
    const id = wireId(sent);
    // 错配 id（合法 uuid 但对不上 pending）→ 丢弃，pending 不动。
    confirm.handleResponse({ id: randomUUID(), approved: true });
    expect(confirm.pendingCount()).toBe(1);
    // 形状不对 → 同样丢弃。
    confirm.handleResponse({ nope: 1 });
    confirm.handleResponse(null);
    expect(confirm.pendingCount()).toBe(1);
    // 正确 id approved=true → 批准（证明前面的错配没把 gate 搞坏）。
    confirm.handleResponse({ id, approved: true });
    await expect(p).resolves.toBe(true);
    expect(confirm.pendingCount()).toBe(0);
  });

  it('迟到应答（超时之后才来）对不上 pending → 丢弃，不影响结果', async () => {
    const sent: Sent[] = [];
    const confirm = createUiConfirm({ getWindow: () => fakeWindow(sent), timeoutMs: 20 });
    const p = confirm(req());
    const id = wireId(sent);
    await expect(p).resolves.toBe(false); // 先超时拒绝
    confirm.handleResponse({ id, approved: true }); // 迟到 → 丢弃，不抛
    expect(confirm.pendingCount()).toBe(0);
  });
});

describe('createUiConfirm：无窗口 fallback', () => {
  it('无窗口时显式传入 fallback 才降级（UI→原生链），默认直接 false', async () => {
    const fallback = vi.fn(async (_req: KernelConfirmRequest): Promise<boolean> => true);
    const withFallback = createUiConfirm({ getWindow: () => null, fallback });
    await expect(withFallback(req())).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]?.[0]).toMatchObject({ kind: 'delete_instance' });

    const bare = createUiConfirm({ getWindow: () => null });
    await expect(bare(req())).resolves.toBe(false);
  });

  it('窗口已销毁视为无窗口：不 send，走 fallback/默认 false', async () => {
    const sent: Sent[] = [];
    const win = fakeWindow(sent, { destroyed: true });
    const fallback = vi.fn(async () => false);
    const confirm = createUiConfirm({ getWindow: () => win, fallback });
    await expect(confirm(req())).resolves.toBe(false);
    expect(sent).toHaveLength(0);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('fallback 抛错也 fail-closed（不把异常变成"同意"）', async () => {
    const confirm = createUiConfirm({
      getWindow: () => null,
      fallback: () => {
        throw new Error('dialog 炸了');
      },
    });
    await expect(confirm(req())).resolves.toBe(false);
  });
});

describe('createUiConfirm：并发两请求各归位', () => {
  it('乱序应答按 id 回到各自的 gate', async () => {
    const sent: Sent[] = [];
    const confirm = createUiConfirm({ getWindow: () => fakeWindow(sent), timeoutMs: 1000 });
    const p1 = confirm(req({ kind: 'delete_instance', summary: '删 A' }));
    const p2 = confirm(req({ kind: 'restart_server', summary: '重启 B' }));
    expect(sent).toHaveLength(2);
    const id1 = wireId(sent, 0);
    const id2 = wireId(sent, 1);
    expect(id1).not.toBe(id2); // 两个请求 id 不同，并发关联才有意义
    expect(confirm.pendingCount()).toBe(2);
    // 先回 p2（拒绝），再回 p1（批准）：乱序。
    confirm.handleResponse({ id: id2, approved: false });
    confirm.handleResponse({ id: id1, approved: true });
    await expect(p1).resolves.toBe(true);
    await expect(p2).resolves.toBe(false);
    expect(confirm.pendingCount()).toBe(0);
  });
});

describe('createUiConfirm：等待期间窗口没了', () => {
  it('应答回来时窗口已销毁 → false（用户没机会拍板）', async () => {
    const sent: Sent[] = [];
    const win = fakeWindow(sent);
    const confirm = createUiConfirm({ getWindow: () => win, timeoutMs: 1000 });
    const p = confirm(req());
    win.destroyed = true;
    confirm.handleResponse({ id: wireId(sent), approved: true });
    await expect(p).resolves.toBe(false);
    expect(confirm.pendingCount()).toBe(0);
  });

  it('send 瞬间抛错（窗口正在销毁）→ fallback，默认 false', async () => {
    const sent: Sent[] = [];
    const win = fakeWindow(sent, { throwOnSend: true });
    const fallback = vi.fn(async () => true);
    const confirm = createUiConfirm({ getWindow: () => win, fallback, timeoutMs: 1000 });
    await expect(confirm(req())).resolves.toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(confirm.pendingCount()).toBe(0);

    const bare = createUiConfirm({
      getWindow: () => fakeWindow([], { throwOnSend: true }),
    });
    await expect(bare(req())).resolves.toBe(false);
  });
});
