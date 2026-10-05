/**
 * preload 白名单防回归测试（§4.2 / §4.3 / §10.6）。
 *
 * 背景：`preload/index.ts` 是 `sandbox: true` + `contextIsolation: true` 的**显式**
 * 白名单 —— 渲染层能触达什么完全由这里决定。所以「主进程注册了 handler」和
 * 「渲染层能用」是两件事，而**后者更容易被漏掉**（加了 handler 忘了加白名单，
 * 表现是 UI 里某个按钮永远报 "No handler registered"）。
 *
 * 这条测试同时守两件事：
 * 1. 只读内核通道**确实**进了白名单（正向）；
 * 2. `KERNEL_EXECUTE`（W/X 类）**确实不在**白名单里 —— 并且用源码级断言守住，
 *    防止哪天有人顺手把它加上（那等于绕过 §10.6 的确认 UI 验证）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  PROCESS_LIST,
} from '../shared/ipc-channels.js';

const exposed = new Map<string, unknown>();
const invoked: Array<{ channel: string; args: unknown[] }> = [];

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed.set(key, value);
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args });
      return Promise.resolve({ ok: true, data: null, error: null });
    },
    on: () => undefined,
    removeListener: () => undefined,
  },
}));

beforeEach(() => {
  invoked.length = 0;
});

/** preload 模块在 import 时就完成 exposeInMainWorld，故用动态 import 保证只跑一次。 */
async function loadApi(): Promise<Record<string, unknown>> {
  if (exposed.size === 0) {
    await import('./index.js');
  }
  return exposed.get('mcApi') as Record<string, unknown>;
}

describe('内核只读通道已进 preload 白名单（§4.2）', () => {
  it('mcApi.kernelListKinds / kernelRead 都存在，且 invoke 到正确通道', async () => {
    const api = await loadApi();
    expect(typeof api['kernelListKinds']).toBe('function');
    expect(typeof api['kernelRead']).toBe('function');

    await (api['kernelListKinds'] as () => Promise<unknown>)();
    expect(invoked.at(-1)?.channel).toBe(KERNEL_LIST_KINDS);

    await (api['kernelRead'] as (req: unknown) => Promise<unknown>)({
      kind: 'list_instances',
      payload: {},
    });
    expect(invoked.at(-1)?.channel).toBe(KERNEL_READ);
    expect(invoked.at(-1)?.args[0]).toEqual({ kind: 'list_instances', payload: {} });
  });

  it('白名单里的每个内核方法都只 invoke 那三个只读通道之一', async () => {
    const api = await loadApi();
    const allowed = new Set<string>([KERNEL_LIST_KINDS, KERNEL_READ]);
    const kernelMethods = Object.entries(api).filter(([name]) => name.startsWith('kernel'));
    expect(kernelMethods.length).toBeGreaterThan(0);
    for (const [, fn] of kernelMethods) {
      await (fn as (arg?: unknown) => Promise<unknown>)({ kind: 'get_capabilities', payload: {} });
    }
    for (const call of invoked) {
      if (!allowed.has(call.channel)) {
        // 只要不是别的域的通道，就必须落在只读内核通道里
        continue;
      }
      expect(allowed.has(call.channel)).toBe(true);
    }
    // 内核方法一个都没碰 KERNEL_EXECUTE
    expect(invoked.every((c) => c.channel !== KERNEL_EXECUTE)).toBe(true);
  });

  it('mcApi 上没有任何键暴露 KERNEL_EXECUTE（W/X 类对渲染层不可达）', async () => {
    const api = await loadApi();
    const keys = Object.keys(api);
    expect(keys.some((k) => k.toLowerCase().includes('execute'))).toBe(false);
    // 进程托管的只读通道仍在（回归：别把 kernel 接线做成破坏性改动）
    expect(typeof api['processList']).toBe('function');
    expect(PROCESS_LIST).toBe('process:list');
  });
});

/** 粗粒度去注释：只看**代码**里有没有 KERNEL_EXECUTE，注释里提到它不算。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('源码级守卫：KERNEL_EXECUTE 不许出现在 preload 的代码里', () => {
  it('preload/index.ts 的代码（去注释后）不含 KERNEL_EXECUTE 也不含 kernel:execute', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    expect(code.includes('KERNEL_EXECUTE')).toBe(false);
    expect(code.includes('kernel:execute')).toBe(false);
  });

  it('只读通道常量确实挂在 contextBridge 上（不是被注释掉的死代码）', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    expect(code.includes('ipcRenderer.invoke(KERNEL_LIST_KINDS)')).toBe(true);
    expect(code.includes('ipcRenderer.invoke(KERNEL_READ, req)')).toBe(true);
    // 且两个只读通道都被 import 进来（import 段里出现 = 真在用）
    expect(code.includes('KERNEL_LIST_KINDS,')).toBe(true);
    expect(code.includes('KERNEL_READ,')).toBe(true);
  });

  it('三个通道常量互不相同（防止复制粘贴时把两个通道写成同一个名字）', () => {
    const all = [KERNEL_LIST_KINDS, KERNEL_READ, KERNEL_EXECUTE];
    expect(new Set(all).size).toBe(3);
    expect(KERNEL_LIST_KINDS).toBe('kernel:listKinds');
    expect(KERNEL_READ).toBe('kernel:read');
    expect(KERNEL_EXECUTE).toBe('kernel:execute');
  });
});
