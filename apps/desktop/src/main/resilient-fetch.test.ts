// @vitest-environment node
/**
 * 「直连优先、连接失败再走代理」的下载通道。
 *
 * 这条路是被真实网络逼出来的：本机直连 `maven.neoforged.net` 必然
 * `UND_ERR_CONNECT_TIMEOUT`，而系统代理能通（实测 2026-10-22）。
 */
import { describe, it, expect, vi } from 'vitest';

import { createResilientFetch } from './resilient-fetch.js';

/** 造一个 undici 风格的连接层错误。 */
function connectError(code = 'UND_ERR_CONNECT_TIMEOUT'): Error {
  const e = new TypeError('fetch failed');
  (e as { cause?: { code: string } }).cause = { code };
  return e;
}

describe('resilient-fetch · 直连优先，失败再走代理', () => {
  it('直连成功时完全不碰代理', async () => {
    const direct = vi.fn(async () => new Response('ok'));
    const viaProxy = vi.fn(async () => new Response('proxy'));
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    const res = await f('https://example.test/a');
    expect(await res.text()).toBe('ok');
    expect(direct).toHaveBeenCalledTimes(1);
    expect(viaProxy).not.toHaveBeenCalled();
  });

  it('直连连接层失败 → 换代理再试一次并返回结果', async () => {
    const direct = vi.fn(async () => {
      throw connectError();
    });
    const viaProxy = vi.fn(async () => new Response('via-proxy'));
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    const res = await f('https://example.test/a');
    expect(await res.text()).toBe('via-proxy');
    expect(direct).toHaveBeenCalledTimes(1);
    expect(viaProxy).toHaveBeenCalledTimes(1);
  });

  it('HTTP 状态码错误**不**换路（那是源的问题，该换源而不是换路）', async () => {
    const direct = vi.fn(async () => new Response('nope', { status: 404 }));
    const viaProxy = vi.fn(async () => new Response('proxy'));
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    const res = await f('https://example.test/a');
    expect(res.status).toBe(404);
    expect(viaProxy).not.toHaveBeenCalled();
  });

  it('取消信号触发时立刻抛出，绝不重试', async () => {
    const direct = vi.fn(async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    });
    const viaProxy = vi.fn(async () => new Response('proxy'));
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    await expect(f('https://example.test/a')).rejects.toThrow('aborted');
    expect(viaProxy).not.toHaveBeenCalled();
  });

  it('两条路都失败 → 报出直连的原始原因，并带上代理那次的失败', async () => {
    const direct = vi.fn(async () => {
      throw connectError();
    });
    const viaProxy = vi.fn(async () => {
      throw new Error('proxy down');
    });
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    await expect(f('https://example.test/a')).rejects.toThrow(
      /fetch failed；走系统代理重试也失败：proxy down/,
    );
  });

  it('非连接层错误（业务异常）不换路', async () => {
    const direct = vi.fn(async () => {
      throw new Error('boom');
    });
    const viaProxy = vi.fn(async () => new Response('proxy'));
    const f = createResilientFetch({
      direct: direct as unknown as typeof fetch,
      viaProxy: viaProxy as unknown as typeof fetch,
    });

    await expect(f('https://example.test/a')).rejects.toThrow('boom');
    expect(viaProxy).not.toHaveBeenCalled();
  });
});
