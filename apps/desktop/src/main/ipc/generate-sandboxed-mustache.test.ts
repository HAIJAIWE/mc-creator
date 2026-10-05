/**
 * `SANDBOXED_MUSTACHE_RENDER` IPC 接线测试。
 *
 * 与纯函数测试分开的原因：这里要证明「通道真正走的是那份加固实现」，
 * 而不是某个只有测试用得上的旁路 —— 也就是说，加固不能只活在函数层面。
 *
 * 纪律：mock 必须在导入被测模块**之前**（vi.mock 会被提升）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';

// Mock electron：记录注册到的处理器，随后直接调用它验证行为
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), isPackaged: false },
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  BrowserWindow: { getAllWindows: () => [] },
}));

import { registerSandboxedMustacheHandler } from './generate.js';
import { SANDBOXED_MUSTACHE_RENDER } from '../../shared/ipc-channels.js';
import type { SandboxedMustacheRenderResponse } from '../../shared/ipc-channels.js';

beforeEach(() => {
  handlers.clear();
  registerSandboxedMustacheHandler();
});

/** 通过真实注册的 IPC 处理器发一次请求。 */
async function invoke(payload: unknown): Promise<SandboxedMustacheRenderResponse> {
  const handler = handlers.get(SANDBOXED_MUSTACHE_RENDER);
  if (handler === undefined) throw new Error('处理器未注册');
  return (await handler({}, payload)) as SandboxedMustacheRenderResponse;
}

describe('SANDBOXED_MUSTACHE_RENDER 通道', () => {
  it('注册在正确的通道名上', () => {
    expect(handlers.has(SANDBOXED_MUSTACHE_RENDER)).toBe(true);
  });

  it('正常模板：返回渲染结果', async () => {
    const res = await invoke({
      template: 'public class {{field:name}} { int {{field:v}}; }',
      fields: { name: 'Demo', v: 7 },
    });
    expect(res).toEqual({ ok: true, result: 'public class Demo { int 7; }' });
  });

  it('原型链攻击：{{field:constructor}} 拿不到 Object 构造函数', async () => {
    const res = await invoke({ template: '{{field:constructor}}', fields: {} });
    expect(res.ok).toBe(true);
    expect(res.result).toBe('{{field:constructor}}');
    expect(res.result).not.toContain('function');
  });

  it('原型链攻击：{{#each __proto__}} 不遍历原型链', async () => {
    const res = await invoke({ template: 'A{{#each __proto__}}LEAK{{/each}}B', fields: {} });
    expect(res.ok).toBe(true);
    expect(res.result).toBe('AB');
  });

  it('输出放大攻击：6MB 字段 → 结构化错误，且带机器可读 code 前缀', async () => {
    const res = await invoke({
      template: 'A{{field:big}}B',
      fields: { big: 'x'.repeat(6 * 1024 * 1024) },
    });
    expect(res.ok).toBe(false);
    expect(res.result).toBeUndefined();
    expect(res.error).toMatch(/^\[OUTPUT_LIMIT_EXCEEDED\]/);
  });

  it('深度攻击：2000 层嵌套 → 结构化错误', async () => {
    const res = await invoke({
      template: '{{#if a}}'.repeat(2000),
      fields: { a: true },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^\[BLOCK_DEPTH_EXCEEDED\]/);
  });

  it('迭代攻击：超长数组 → 结构化错误', async () => {
    const res = await invoke({
      template: '{{#each xs}}{{this}}{{/each}}',
      fields: { xs: Array.from({ length: 10_001 }, (_, i) => i) },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^\[ITERATION_LIMIT_EXCEEDED\]/);
  });

  it('fields 带 __proto__ 键：请求 schema 已把它剥掉，通道内不可能读到原型链', async () => {
    const res = await invoke({
      template: 'A{{field:__proto__}}B',
      // JSON 解析出来的对象：__proto__ 是自有可枚举属性
      fields: JSON.parse('{"__proto__":{"x":1}}'),
    });
    // 实测 zod 的 z.record 会重建输出对象，`__proto__` 这类键在通道入口就被剥掉
    // （所以这里渲染成功）；即便它漏了过来，渲染层也只会判为「字段缺失」。
    // 断言的重点是：**无论哪一层，都读不到原型链成员**。
    expect(res.ok).toBe(true);
    expect(res.result).toBe('A{{field:__proto__}}B');
    expect(res.result).not.toContain('hasOwnProperty');
  });

  it('fields 深层嵌套 → 结构化错误', async () => {
    let deep: Record<string, unknown> = { leaf: 'x' };
    for (let i = 0; i < 100; i++) deep = { nested: deep };
    const res = await invoke({ template: '{{field:root}}', fields: { root: deep } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/^\[FIELDS_TOO_DEEP\]/);
  });

  it('fields 为 null / 数组：由 zod schema 在通道入口拒绝（契约沿用既有行为）', async () => {
    await expect(invoke({ template: 'x', fields: null })).rejects.toThrow();
    await expect(invoke({ template: 'x', fields: [1, 2] })).rejects.toThrow();
  });

  it('响应永远符合 shared 契约（{ ok, result?, error? }）', async () => {
    const results = [
      await invoke({ template: 'plain', fields: {} }),
      await invoke({ template: '{{field:nope}}', fields: {} }),
      await invoke({ template: '{{field:a}}', fields: { a: 'x'.repeat(6 * 1024 * 1024) } }),
    ];
    for (const res of results) {
      expect(typeof res.ok).toBe('boolean');
      if (res.ok) expect(typeof res.result).toBe('string');
      else expect(typeof res.error).toBe('string');
    }
  });

  it('模板超 50KB 由 zod schema 在通道入口挡住（契约沿用既有行为）', async () => {
    await expect(invoke({ template: 'a'.repeat(50_001), fields: {} })).rejects.toThrow();
  });
});
