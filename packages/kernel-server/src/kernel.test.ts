import { describe, expect, it } from 'vitest';
import { capabilitiesFor, type Edition, type KernelContract } from '@mc-creator/contract';
import { ServerKernel } from './kernel.js';

describe('ServerKernel scaffold', () => {
  it('edition 为 server', () => {
    expect(new ServerKernel().edition).toBe('server');
  });

  it('capabilities 与 contract.capabilitiesFor("server") 一致（supported 集合相等）', () => {
    const got = new ServerKernel().capabilities();
    const expected = capabilitiesFor('server');
    expect(got.map((c) => c.kind)).toEqual(expected.map((c) => c.kind));
    expect(new Set(got.filter((c) => c.supported).map((c) => c.kind))).toEqual(
      new Set(expected.filter((c) => c.supported).map((c) => c.kind)),
    );
  });

  it('status healthy 且 edition 一致', () => {
    const s = new ServerKernel().status();
    expect(s.edition).toBe('server');
    expect(s.healthy).toBe(true);
    expect(typeof s.updatedAt).toBe('string');
  });

  it('dispatch stub 返回 ok:false 且 error.category 为 unknown', async () => {
    const handle = new ServerKernel().dispatch({ id: 't1', kind: 'noop', payload: null });
    expect(handle.id).toBe('t1');
    await expect(handle.result()).resolves.toMatchObject({
      ok: false,
      error: { category: 'unknown' },
    });
  });

  it('progress 为空 AsyncIterable（立即 done），cancel 空实现不抛错', async () => {
    const handle = new ServerKernel().dispatch({ id: 't2', kind: 'noop', payload: null });
    const seen: unknown[] = [];
    for await (const e of handle.progress) seen.push(e);
    expect(seen).toEqual([]);
    expect(() => handle.cancel()).not.toThrow();
  });

  it('registry 式 get 语义（Map 模拟）', () => {
    const kernel: KernelContract = new ServerKernel();
    const registry = new Map<Edition, KernelContract>([[kernel.edition, kernel]]);
    expect(registry.get('server')).toBe(kernel);
    expect(registry.get('java')).toBeUndefined();
  });
});
